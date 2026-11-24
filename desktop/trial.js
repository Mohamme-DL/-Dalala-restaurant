/* Dalala — trial (demo) period, main process only.
   The trial start is stored in three places (app data folder, ProgramData, registry), each signed with an
   HMAC, so that deleting one copy or editing the date does not restart or extend it. A turned-back clock is
   detected. This is a deterrent for a demo build, not a vault: a determined person can always defeat it. */
'use strict';
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');
const SECRET = 'dlala-trial-7f3a91c2-b04e-4d5a-9e1b-62c8f0a3d517';
const DAY = 86400000;

const mac = r => crypto.createHmac('sha256', SECRET).update([r.p, r.d, r.s, r.n].join('|')).digest('hex').slice(0, 40);
const seal = r => Buffer.from(JSON.stringify({ ...r, m: mac(r) }), 'utf8').toString('base64');
function unseal(text, product, dev) {
  try {
    const r = JSON.parse(Buffer.from(String(text || '').trim(), 'base64').toString('utf8'));
    if (!r || r.m !== mac(r) || r.p !== product || r.d !== dev || !(r.s > 0) || !(r.n >= r.s)) return null;
    return r;
  } catch (e) { return null; }
}

function stores(dir, product, ctx) {
  const pd = (ctx && ctx.programData) || process.env.ProgramData || 'C:\\ProgramData';
  const f1 = path.join(dir, 'trial.dat');
  const f2 = path.join(pd, 'Dalala', 'Cache', crypto.createHash('sha256').update('trial|' + product).digest('hex').slice(0, 12) + '.dat');
  const regKey = 'HKCU\\Software\\Dalala\\Cache';
  const regName = crypto.createHash('sha256').update('trial-reg|' + product).digest('hex').slice(0, 12);
  const useReg = ctx ? !!ctx.reg : process.platform === 'win32';
  const rd = f => { try { return fs.readFileSync(f, 'utf8'); } catch (e) { return ''; } };
  const wr = (f, t) => { try { fs.mkdirSync(path.dirname(f), { recursive: true }); fs.writeFileSync(f, t); } catch (e) { /* ignore */ } };
  return {
    read: () => {
      const out = [rd(f1), rd(f2)];
      if (useReg) { try { const o = execFileSync('reg', ['query', regKey, '/v', regName], { encoding: 'utf8', windowsHide: true, timeout: 8000, stdio: ['ignore', 'pipe', 'ignore'] }); const m = o.match(/REG_SZ\s+(\S+)/); out.push(m ? m[1] : ''); } catch (e) { out.push(''); } }
      return out;
    },
    write: t => {
      wr(f1, t); wr(f2, t);
      if (useReg) { try { execFileSync('reg', ['add', regKey, '/v', regName, '/t', 'REG_SZ', '/d', t, '/f'], { windowsHide: true, timeout: 8000, stdio: 'ignore' }); } catch (e) { /* ignore */ } }
    },
  };
}

/* -> { ok, daysLeft, until, start }  or  { ok:false, reason:'demo-expired' | 'demo-clock' | 'demo-tamper' } */
function check(dir, product, dev, days, ctx) {
  const now = (ctx && ctx.now) ? ctx.now() : Date.now();
  const st = stores(dir, product, ctx);
  const raw = st.read();
  const any = raw.some(x => x && x.trim());
  const good = raw.map(x => unseal(x, product, dev)).filter(Boolean);
  if (!any) { st.write(seal({ p: product, d: dev, s: now, n: now })); return { ok: true, daysLeft: days, until: now + days * DAY, start: now }; }
  if (!good.length) return { ok: false, reason: 'demo-tamper' };
  const start = Math.min(...good.map(r => r.s)), seen = Math.max(...good.map(r => r.n));
  const until = start + days * DAY;
  if (now < seen - 36 * 3600 * 1000) return { ok: false, reason: 'demo-clock', start, until };
  st.write(seal({ p: product, d: dev, s: start, n: Math.max(now, seen) }));
  if (now >= until) return { ok: false, reason: 'demo-expired', start, until };
  return { ok: true, daysLeft: Math.max(1, Math.ceil((until - now) / DAY)), until, start };
}
module.exports = { check };
