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
const { publicKey } = require('./license-key');
const PRODUCT = require('./product.json');

const SPKI_ED25519 = Buffer.from('302a300506032b6570032100', 'hex');
const ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

function machineSecret() {
  try {
    if (process.platform === 'win32') {
      const out = execFileSync('reg', ['query', 'HKLM\\SOFTWARE\\Microsoft\\Cryptography', '/v', 'MachineGuid', '/reg:64'], { encoding: 'utf8', windowsHide: true });
      const m = out.match(/MachineGuid\s+REG_SZ\s+([0-9a-fA-F-]+)/); if (m) return 'win:' + m[1].toLowerCase();
    } else if (process.platform === 'darwin') {
      const out = execFileSync('ioreg', ['-rd1', '-c', 'IOPlatformExpertDevice'], { encoding: 'utf8' });
      const m = out.match(/"IOPlatformUUID" = "([^"]+)"/); if (m) return 'mac:' + m[1];
    } else {
      for (const f of ['/etc/machine-id', '/var/lib/dbus/machine-id']) if (fs.existsSync(f)) return 'linux:' + fs.readFileSync(f, 'utf8').trim();
    }
  } catch (e) { /* fall through */ }
  const macs = Object.values(os.networkInterfaces()).flat().filter(n => n && !n.internal && n.mac && n.mac !== '00:00:00:00:00:00').map(n => n.mac).sort();
  return ['fallback', os.hostname(), (os.cpus()[0] || {}).model, macs[0]].join('|');
}
let cachedId = null;
function deviceId() {
  if (cachedId) return cachedId;
  const h = crypto.createHash('sha256').update('dalala-device-v1|' + machineSecret()).digest();
  let s = ''; for (let i = 0; i < 16; i++) s += ALPHABET[h[i] % 32];
  return (cachedId = s.match(/.{4}/g).join('-'));
}
const b64u = s => Buffer.from(String(s).replace(/-/g, '+').replace(/_/g, '/'), 'base64');

function verify(key, dev = deviceId()) {
  const k = String(key || '').replace(/\s+/g, '');
  const m = k.match(/^DLL1\.([A-Za-z0-9_-]+)\.([A-Za-z0-9_-]+)$/);
  if (!m) return { ok: false, reason: 'format' };
  let payload; try { payload = JSON.parse(b64u(m[1]).toString('utf8')); } catch (e) { return { ok: false, reason: 'format' }; }
  let good = false;
  try {
    const pub = crypto.createPublicKey({ key: Buffer.concat([SPKI_ED25519, Buffer.from(publicKey, 'base64')]), format: 'der', type: 'spki' });
    good = crypto.verify(null, Buffer.from(m[1], 'utf8'), pub, b64u(m[2]));
  } catch (e) { good = false; }
  if (!good) return { ok: false, reason: 'signature' };
  if (payload.p !== PRODUCT.id) return { ok: false, reason: 'product', payload };
  if (String(payload.d).toUpperCase() !== dev) return { ok: false, reason: 'device', payload };
  if (payload.e && Date.now() > new Date(payload.e + 'T23:59:59').getTime()) return { ok: false, reason: 'expired', payload };
  return { ok: true, payload };
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
  if (r.ok) writeStore(dir, { key: String(key).replace(/\s+/g, ''), at: Date.now(), seen: Date.now() });
  return r;
}
module.exports = { deviceId, verify, check, activate, PRODUCT };
