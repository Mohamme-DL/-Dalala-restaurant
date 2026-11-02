// Assembles the protected app folder that gets packaged into the installer:
//   app/  ← main.js, license.js, preloads, activation.html, product.json, license-key.js (obfuscated)
//   app/web/ ← the web app, JavaScript obfuscated
// `node build-app.js --dev` only copies the web app to ./web (no obfuscation) for `npm start`.
const fs = require('fs');
const path = require('path');
const dev = process.argv.includes('--dev');
const root = path.resolve(__dirname, '..');
const product = require('./product.json');
const WEB_ITEMS = product.webItems || ['index.html', 'css', 'js', 'assets'];

function copyWeb(dst) {
  fs.rmSync(dst, { recursive: true, force: true });
  for (const it of WEB_ITEMS) if (fs.existsSync(path.join(root, it))) fs.cpSync(path.join(root, it), path.join(dst, it), { recursive: true });
}
if (dev) {
  copyWeb(path.join(__dirname, 'web'));
  for (const f of ['main.js', 'license.js']) if (!fs.existsSync(path.join(__dirname, f))) throw new Error('missing ' + f);
  console.log('web app copied to ./web (dev, not obfuscated)');
  process.exit(0);
}

const JO = require('javascript-obfuscator');
const base = { compact: true, stringArray: true, stringArrayEncoding: ['base64'], stringArrayThreshold: 0.8, identifierNamesGenerator: 'hexadecimal',
  renameGlobals: false, selfDefending: false, transformObjectKeys: false, unicodeEscapeSequence: false, controlFlowFlattening: false, deadCodeInjection: false, simplify: true };
const obf = (code, target) => JO.obfuscate(code, { ...base, target }).getObfuscatedCode();

const out = path.join(__dirname, 'app');
fs.rmSync(out, { recursive: true, force: true }); fs.mkdirSync(out);
copyWeb(path.join(out, 'web'));
for (const f of ['main.js', 'license.js', 'license-key.js', 'preload-app.js', 'preload-activation.js', 'activation.html', 'product.json']) {
  const src = fs.readFileSync(path.join(__dirname, f), 'utf8');
  fs.writeFileSync(path.join(out, f), f.endsWith('.js') ? obf(src, 'node') : src);
}
let n = 0;
const walk = d => fs.readdirSync(d, { withFileTypes: true }).forEach(e => {
  const p = path.join(d, e.name);
  if (e.isDirectory()) return walk(p);
  if (e.name.endsWith('.js')) { fs.writeFileSync(p, obf(fs.readFileSync(p, 'utf8'), 'browser')); n++; }
  else if (e.name.endsWith('.html')) { // inline <script> blocks (single-file apps)
    const html = fs.readFileSync(p, 'utf8');
    const res = html.replace(/<script>([\s\S]*?)<\/script>/g, (m, code) => { if (code.trim().length < 200) return m; n++; return '<script>' + obf(code, 'browser') + '</script>'; });
    fs.writeFileSync(p, res);
  }
});
walk(path.join(out, 'web'));
console.log(`protected app built in ./app (${n} scripts obfuscated)`);
