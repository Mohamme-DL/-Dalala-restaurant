/* Dalala — device licensing (main process only).
   A license key is   DLL1.<payload>.<signature>   where payload = base64url(JSON {p,d,c,i,e,n})
   and signature = Ed25519(payload) made with the vendor's PRIVATE key. The app only holds the
   PUBLIC key (license-key.js): it can check keys but cannot create them. */
'use strict';
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const os = require('os');
const { execFileSync } = require('child_process');
const PRODUCT = require('./product.json');

/* Same activation scheme as the WebView2 edition: a 20-character device code (XXXXX-XXXXX-XXXXX-XXXXX)
   and an activation code = ECDSA P-256 / SHA-256 signature (64 bytes, base32, 5-char groups) of
   "DLALA-RESTAURANT|1|<device code without dashes>", made with the vendor's PRIVATE key.
   The app holds only the PUBLIC key, so it can check activations but never create them. */
const PUB_HEX = '0269cd0b65558f9421a26c9d0e7e748a436568ed135f2ab30d7d43fc85ce6335e282d689ae6fc12df29f8e10fa483af1e4ccc4e760b7244302ed5f5534c1415d';
const SPKI_P256 = Buffer.from('3059301306072a8648ce3d020106082a8648ce3d030107034200' + '04', 'hex');
const B32 = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';
const PRODUCT_TAG = 'DLALA-RESTAURANT';

function b32enc(buf) {
  let out = '', acc = 0, bits = 0;
  for (const b of buf) { acc = (acc << 8) | b; bits += 8; while (bits >= 5) { out += B32[(acc >> (bits - 5)) & 31]; bits -= 5; } acc &= (1 << bits) - 1; }
  if (bits > 0) out += B32[(acc << (5 - bits)) & 31];
  return out;
}
function b32dec(text, expected) {
  let acc = 0, bits = 0; const out = [];
  const s = String(text || '').toUpperCase().replace(/[-\s]/g, '').replace(/O/g, '0').replace(/[IL]/g, '1');
  const n = Math.floor(s.length * 5 / 8);
  for (const c of s) { const v = B32.indexOf(c); if (v < 0) return null; acc = (acc << 5) | v; bits += 5; if (bits >= 8) { if (out.length < n) out.push((acc >> (bits - 8)) & 255); bits -= 8; acc &= (1 << bits) - 1; } }
  return out.length === expected ? Buffer.from(out) : null;
}
const group = (s, n) => (s.match(new RegExp('.{1,' + n + '}', 'g')) || []).join('-');

function run(cmd, args) { try { return execFileSync(cmd, args, { encoding: 'utf8', windowsHide: true, timeout: 15000, stdio: ['ignore', 'pipe', 'ignore'] }); } catch (e) { return ''; } }
function wmi(cls, prop, wmicAlias) {
  let out = run('wmic', [wmicAlias, 'get', prop, '/value']);
  let m = out.match(new RegExp(prop + '=([^\\r\\n]+)', 'i')); if (m && m[1].trim()) return m[1].trim();
  out = run('powershell', ['-NoProfile', '-NonInteractive', '-Command', `(Get-CimInstance ${cls} | Select-Object -First 1).${prop}`]);
  return out.trim().split(/\r?\n/)[0] || '';
}
function cleanSerial(s) {
  const t = String(s || '').trim().toUpperCase(); if (!t) return '';
  if (/O\.E\.M|DEFAULT|NONE|NOT SPECIFIED|SERIAL/.test(t) || t === '0' || t.replace(/[0.-]/g, '').length === 0) return '';
  return t;
}
function machineGuid() {
  const out = run('reg', ['query', 'HKLM\\SOFTWARE\\Microsoft\\Cryptography', '/v', 'MachineGuid', '/reg:64']);
  const m = out.match(/MachineGuid\s+REG_SZ\s+([0-9a-fA-F-]+)/); return m ? m[1] : '';
}
let cachedId = null;
function deviceId() {
  if (cachedId) return cachedId;
  const text = 'DLALA-FP|' + machineGuid().trim().toLowerCase() + '|' + wmi('Win32_Processor', 'ProcessorId', 'cpu').toUpperCase() + '|' + cleanSerial(wmi('Win32_BaseBoard', 'SerialNumber', 'baseboard'));
  const h = crypto.createHash('sha256').update(text, 'utf8').digest().subarray(0, 12);
  return (cachedId = group(b32enc(h), 5));
}
const norm = c => String(c || '').toUpperCase().replace(/[-\s]/g, '');

function verify(key, dev = deviceId()) {
  const sig = b32dec(key, 64);
  if (!sig) return { ok: false, reason: 'format' };
  let good = false;
  try {
    const pub = crypto.createPublicKey({ key: Buffer.concat([SPKI_P256, Buffer.from(PUB_HEX, 'hex')]), format: 'der', type: 'spki' });
    good = crypto.verify('sha256', Buffer.from(PRODUCT_TAG + '|1|' + norm(dev), 'utf8'), { key: pub, dsaEncoding: 'ieee-p1363' }, sig);
  } catch (e) { good = false; }
  return good ? { ok: true, payload: { p: PRODUCT.id, d: dev, c: '' } } : { ok: false, reason: 'signature' };
}

const fileOf = dir => path.join(dir, 'license.dat');
function readStore(dir) { try { return JSON.parse(Buffer.from(fs.readFileSync(fileOf(dir), 'utf8'), 'base64').toString('utf8')); } catch (e) { return null; } }
function writeStore(dir, obj) { fs.mkdirSync(dir, { recursive: true }); fs.writeFileSync(fileOf(dir), Buffer.from(JSON.stringify(obj), 'utf8').toString('base64')); }

/* Check the saved license. For licenses with an end date, refuse if the clock was turned back. */
function check(dir) {
  const st = readStore(dir); if (!st || !st.key) return { ok: false, reason: 'none' };
  const r = verify(st.key);
  if (r.ok && r.payload.e) {
    const now = Date.now();
    if (st.seen && now < st.seen - 36 * 3600 * 1000) return { ok: false, reason: 'clock', payload: r.payload };
    writeStore(dir, { ...st, seen: Math.max(now, st.seen || 0) });
  }
  return r;
}
function activate(dir, key) {
  const r = verify(key);
  if (r.ok) writeStore(dir, { key: group(norm(key), 5), at: Date.now(), seen: Date.now() });
  return r;
}
module.exports = { deviceId, verify, check, activate, PRODUCT };
