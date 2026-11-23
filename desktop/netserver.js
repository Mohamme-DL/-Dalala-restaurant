/* Dalala — shared database server for several computers on one network (runs on the main computer).
   - Stores the whole database in one JSON file (atomic writes + daily backups).
   - Clients send record-level changes ({col, put, del} / {obj, value}); the server applies them and
     keeps a change log so other computers receive only what changed (long-polling).
   - Document numbers (S-000123…) and auto codes are made unique here, so two cashiers saving at
     the same moment never get the same number.
   - Every request needs the pairing key (x-dalala-key header).
   - Optional product rules (netrules.js): put(col, rec, ctx) / obj(name, incoming, current, ctx) hooks
     for things like daily order numbers; op.inc = { id: { field: delta } } adds to counters such as
     stock instead of overwriting them, so two cashiers selling the same item never lose a sale. */
'use strict';
const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const NUMBERED = { number: true, code: true };
const AUTO_CODE = /^([A-Za-z]+-)(\d+)$/;
const LOG_MAX = 5000;

function createServer({ port, key, dir, onEvent = () => {}, rules = {}, webRoot = '' }) {
  const legacy = path.join(dir, 'shared-db.json'); // databases written by versions before the SQLite engine
  const file = path.join(dir, 'dalala.db');
  const backups = path.join(dir, 'backups');
  const jfile = path.join(dir, 'journal.ndjson');
  const store = require('./dbstore').open(file);
  let state = store.load();
  let migrated = 0;
  if (!state.data) { // first start with SQLite: bring the old JSON database (and its unsaved journal) along
    try { state = JSON.parse(fs.readFileSync(legacy, 'utf8')); migrated = 1; } catch (e) { state = { version: 0, data: null }; }
  }
  const log = []; // { v, clientId, ops }
  /* apply already-processed changes (from the journal) to the state */
  function applyChanges(changes) {
    if (!state.data) state.data = {};
    for (const op of changes) {
      if (op.obj) { if (op.value !== undefined) state.data[op.obj] = op.value; else { const o = state.data[op.obj] = { ...(state.data[op.obj] || {}), ...(op.patch || {}) }; (op.unset || []).forEach(k => delete o[k]); } continue; }
      let arr = Array.isArray(state.data[op.col]) ? state.data[op.col] : []; if (op.del && op.del.length) { const ds = new Set(op.del); arr = arr.filter(r => !ds.has(r.id)); }
      const idx = new Map(arr.map((r, i) => [r.id, i])); for (const r of op.put || []) { if (idx.has(r.id)) arr[idx.get(r.id)] = r; else { idx.set(r.id, arr.length); arr.push(r); } }
      state.data[op.col] = arr;
    }
  }
  // replay changes that were confirmed after the last snapshot (power cut / crash)
  if (migrated) try {
    const lines = fs.readFileSync(jfile, 'utf8').split('\n').filter(Boolean); let n = 0;
    for (const line of lines) { let e; try { e = JSON.parse(line); } catch (x) { break; } if (e.v > state.version) { applyChanges(e.ops); state.version = e.v; log.push({ v: e.v, clientId: e.c || '', ops: e.ops }); n++; } }
    if (n) onEvent('recovered', n);
  } catch (e) { /* no journal */ }
  const waiters = new Set();
  const clients = new Map(); // clientId -> { name, lastSeen, ip }
  let saveTimer = null;
  const mem = {}; // scratch memory for product rules (e.g. renumbered orders)

  function journal(entry) { // one transaction on disk before the change is confirmed to the computer that sent it
    try { store.commit(entry.ops, entry.v); }
    catch (e) { onEvent('error', 'database: ' + e.message); }
  }
  function snapshotNow() { clearTimeout(saveTimer); saveTimer = null; store.checkpoint(); }
  if (migrated) { // write the old database into SQLite, then keep the old files as a safety copy
    try {
      store.replaceAll(state.data || {}, state.version || 0);
      for (const f of [legacy, jfile]) if (fs.existsSync(f)) fs.renameSync(f, f + '.migrated');
      onEvent('migrated', 1);
    } catch (e) { onEvent('error', 'migration: ' + e.message); }
  }
  function persist() { // a dated backup copy of the database, once a day (the last 30 are kept)
    clearTimeout(saveTimer);
    saveTimer = setTimeout(() => {
      try {
        const day = new Date().toISOString().slice(0, 10); const bk = path.join(backups, `shared-${day}.db`);
        if (!fs.existsSync(bk)) { store.backupTo(bk);
          fs.readdirSync(backups).filter(f => /^shared-.*\.(db|json)$/.test(f)).sort().slice(0, -30).forEach(f => fs.rmSync(path.join(backups, f), { force: true })); }
      } catch (e) { onEvent('error', e.message); }
    }, 250);
  }
  function nextNumber(arr, field, value) {
    const m = String(value).match(AUTO_CODE); if (!m) return null;
    const prefix = m[1], width = m[2].length;
    const max = arr.reduce((mx, r) => { const mm = String(r[field] || '').match(AUTO_CODE); return mm && mm[1] === prefix ? Math.max(mx, +mm[2]) : mx; }, 0);
    return prefix + String(max + 1).padStart(width, '0');
  }
  function apply(ops, clientId) {
    if (!state.data) state.data = {};
    const changes = []; const touched = new Set(); const patched = new Map(); // obj -> { patch, unset }
    const ctx = { data: state.data, mem, touch: name => touched.add(name) };
    const r6 = n => Math.round(n * 1e6) / 1e6;
    for (const op of ops || []) {
      if (op.obj) {
        if (op.obj === 'version' || /^__/.test(op.obj)) continue;
        const cur = state.data[op.obj];
        const isPatch = !!(op.patch || op.unset);
        let val = isPatch ? { ...(cur && typeof cur === 'object' ? cur : {}), ...(op.patch || {}) } : op.value;
        if (isPatch) for (const k of op.unset || []) delete val[k];
        if (rules.obj) { const r = rules.obj(op.obj, val, cur, ctx); if (r) { val = r; touched.add(op.obj); } }
        state.data[op.obj] = val;
        if (isPatch) { const p = patched.get(op.obj) || { patch: {}, unset: [] }; Object.assign(p.patch, op.patch || {}); for (const k of op.unset || []) { delete p.patch[k]; p.unset.push(k); } patched.set(op.obj, p); }
        else touched.add(op.obj);
        continue;
      }
      if (!op.col || /^__/.test(op.col)) continue;
      const arr = state.data[op.col] = Array.isArray(state.data[op.col]) ? state.data[op.col] : [];
      const index = new Map(arr.map((r, i) => [r.id, i]));
      const del = (op.del || []).filter(id => index.has(id));
      if (del.length) { const ds = new Set(del); state.data[op.col] = arr.filter(r => !ds.has(r.id)); }
      const target = state.data[op.col]; const idx = new Map(target.map((r, i) => [r.id, i]));
      const put = [];
      for (const rec of op.put || []) {
        if (!rec || !rec.id) continue;
        const inc = op.inc && op.inc[rec.id];
        if (inc && idx.has(rec.id)) { const old = target[idx.get(rec.id)]; for (const [f, d] of Object.entries(inc)) if (typeof old[f] === 'number' && typeof d === 'number') rec[f] = r6(old[f] + d); }
        if (rules.put) rules.put(op.col, rec, ctx);
        for (const f of Object.keys(NUMBERED)) { // keep numbers/codes unique across computers
          if (rec[f] && AUTO_CODE.test(String(rec[f])) && target.some(r => r[f] === rec[f] && r.id !== rec.id)) { const n = nextNumber(target, f, rec[f]); if (n) rec[f] = n; }
        }
        if (idx.has(rec.id)) target[idx.get(rec.id)] = rec; else { idx.set(rec.id, target.length); target.push(rec); }
        put.push(rec);
      }
      if (put.length || del.length) changes.push({ col: op.col, put, del });
    }
    // whole value when replaced or changed by a rule; otherwise only the changed keys (attendance, marks… stay small)
    for (const name of touched) changes.push({ obj: name, value: state.data[name] });
    for (const [name, p] of patched) if (!touched.has(name)) changes.push({ obj: name, patch: p.patch, unset: p.unset });
    if (!changes.length) return { version: state.version, changes: [] };
    state.version++;
    journal({ v: state.version, c: clientId, ops: changes });
    log.push({ v: state.version, clientId, ops: changes }); if (log.length > LOG_MAX) log.splice(0, log.length - LOG_MAX);
    persist();
    for (const w of waiters) w(); waiters.clear();
    return { version: state.version, changes };
  }
  const since = v => (log.length && log[0].v <= v + 1) || v === state.version ? { version: state.version, entries: log.filter(e => e.v > v) } : null;

  const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'application/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.png': 'image/png', '.svg': 'image/svg+xml', '.json': 'application/json', '.webmanifest': 'application/manifest+json' };
  function serveWaiter(req, res, p) {
    const txt = (code, t, extra) => { res.writeHead(code, { 'content-type': 'text/plain; charset=utf-8', ...(extra || {}) }); res.end(t); };
    if (p === '/w') return txt(302, '', { location: '/w/' });
    try {
      if (!webRoot || !fs.existsSync(webRoot)) return txt(404, 'waiter app not installed');
      const full = path.resolve(webRoot); let rel = decodeURIComponent(p.slice(3)); if (!rel) rel = 'index.html';
      const f = path.resolve(full, rel);
      if (!f.toLowerCase().startsWith((full + path.sep).toLowerCase()) || !fs.existsSync(f) || !fs.statSync(f).isFile()) return txt(404, 'not found');
      res.writeHead(200, { 'content-type': MIME[path.extname(f).toLowerCase()] || 'application/octet-stream', 'cache-control': 'no-cache' });
      return res.end(req.method === 'HEAD' ? undefined : fs.readFileSync(f));
    } catch (e) { return txt(404, 'not found'); }
  }
  const server = http.createServer((req, res) => {
    const send = (code, obj) => { res.writeHead(code, { 'content-type': 'application/json; charset=utf-8', 'access-control-allow-origin': '*', 'access-control-allow-headers': 'content-type, x-dalala-key, x-dalala-client', 'access-control-allow-methods': 'GET, POST, OPTIONS', 'cache-control': 'no-store' }); res.end(JSON.stringify(obj)); };
    if (req.method === 'OPTIONS') return send(204, {});
    const url = new URL(req.url, 'http://x');
    // waiter web app (phones / tablets) served at /w/ without the key; the data API below still needs it
    if ((req.method === 'GET' || req.method === 'HEAD') && (url.pathname === '/w' || url.pathname.startsWith('/w/'))) return serveWaiter(req, res, url.pathname);
    const okKey = (() => { const k = String(req.headers['x-dalala-key'] || ''); return k.length === key.length && crypto.timingSafeEqual(Buffer.from(k), Buffer.from(key)); })();
    if (url.pathname === '/api/ping') return send(200, { ok: true, app: 'dalala', version: state.version, keyOk: okKey });
    if (!okKey) return send(401, { error: 'key' });
    const cid = String(req.headers['x-dalala-client'] || '');
    if (cid) clients.set(cid, { ...(clients.get(cid) || {}), lastSeen: Date.now(), ip: req.socket.remoteAddress, name: url.searchParams.get('name') || (clients.get(cid) || {}).name || '' });
    if (req.method === 'GET' && url.pathname === '/api/snapshot') return send(200, { version: state.version, data: state.data });
    if (req.method === 'GET' && url.pathname === '/api/changes') {
      const v = +url.searchParams.get('since') || 0; const wait = url.searchParams.get('wait') === '1';
      const reply = () => { const r = since(v); return r ? send(200, r) : send(200, { reset: true, version: state.version }); };
      if (!wait || state.version > v) return reply();
      let done = false; const fire = () => { if (done) return; done = true; clearTimeout(tm); waiters.delete(fire); reply(); };
      const tm = setTimeout(fire, 25000); waiters.add(fire); req.on('close', () => { done = true; clearTimeout(tm); waiters.delete(fire); });
      return undefined;
    }
    if (req.method === 'POST' && (url.pathname === '/api/apply' || url.pathname === '/api/init')) {
      let body = ''; req.setEncoding('utf8');
      req.on('data', c => { body += c; if (body.length > 200 * 1024 * 1024) req.destroy(); });
      req.on('end', () => {
        let msg; try { msg = JSON.parse(body || '{}'); } catch (e) { return send(400, { error: 'json' }); }
        if (url.pathname === '/api/init') {
          if (state.data && Object.keys(state.data).length && !msg.force) return send(409, { error: 'exists', version: state.version });
          state.data = msg.data || {}; state.version++; log.length = 0; try { store.replaceAll(state.data, state.version); } catch (e) { onEvent('error', e.message); } for (const w of waiters) w(); waiters.clear();
          onEvent('init', cid); return send(200, { version: state.version });
        }
        const r = apply(msg.ops, cid); return send(200, r);
      });
      return undefined;
    }
    return send(404, { error: 'not found' });
  });
  return {
    listen: () => new Promise((resolve, reject) => { server.once('error', reject); server.listen(port, '0.0.0.0', () => resolve()); }),
    close: () => new Promise(r => { for (const w of waiters) w(); server.close(() => { try { store.close(); } catch (e) { /* ignore */ } r(); }); }),
    flush: () => { try { snapshotNow(); } catch (e) { onEvent('error', e.message); } },
    status: () => ({ version: state.version, hasData: !!state.data, clients: [...clients.entries()].map(([id, c]) => ({ id, ...c, online: Date.now() - c.lastSeen < 60000 })), file }),
  };
}
function newKey() { const A = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; const b = crypto.randomBytes(8); return [...b].map(x => A[x % 32]).join('').replace(/(.{4})/, '$1-'); }
module.exports = { createServer, newKey };
