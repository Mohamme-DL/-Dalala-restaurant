// Builds dist/Dalala-Restaurant-Setup-<version>.exe with makensis.
// Windows: uses makensis from NSIS (https://nsis.sourceforge.io) on PATH.
// Linux/macOS: uses the makensis that electron-builder downloads into its cache (no Wine needed).
const { execFileSync } = require('child_process'); const fs = require('fs'); const path = require('path'); const os = require('os');
const version = require('./package.json').version;
const cacheRoots = [process.env.ELECTRON_BUILDER_CACHE, path.join(os.homedir(), '.cache', 'electron-builder'), path.join(process.env.LOCALAPPDATA || '', 'electron-builder', 'Cache')].filter(Boolean);
let makensis = 'makensis', env = { ...process.env };
for (const root of cacheRoots) {
  const dir = path.join(root, 'nsis'); if (!fs.existsSync(dir)) continue;
  const nsis = fs.readdirSync(dir).filter(n => /^nsis-\d/.test(n)).sort().pop(); if (!nsis) continue;
  const base = path.join(dir, nsis);
  const bin = process.platform === 'win32' ? path.join(base, 'Bin', 'makensis.exe') : path.join(base, process.platform === 'darwin' ? 'mac' : 'linux', 'makensis');
  if (fs.existsSync(bin)) { makensis = bin; env.NSISDIR = base; break; }
}
console.log('using', makensis);
execFileSync(makensis, ['-V2', '-INPUTCHARSET', 'UTF8', `-DVERSION=${version}`, 'installer.nsi'], { stdio: 'inherit', env, cwd: __dirname });
console.log('installer ready: dist/Dalala-Restaurant-Setup-' + version + '.exe');
