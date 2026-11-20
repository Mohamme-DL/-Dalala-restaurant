#!/bin/sh
# Windows 7 edition (Electron 22.3.27 = last Electron that runs on Windows 7 SP1), built on Linux without Wine.
# Output: dist/Dalala-Restaurant-Setup-<version>-Win7-x64.exe and -Win7-ia32.exe (32-bit Windows 7)
# usage: sh build-w7.sh 1.2.9      (run in a copy of this folder: it changes package.json)
set -e
V=${1:?version}
node -e "const f='package.json',p=require('./'+f);p.version='$V';p.devDependencies.electron='22.3.27';p.build.electronVersion='22.3.27';p.build.electronLanguages=['ar','en-US'];p.build.win.target=[{target:'dir',arch:['x64','ia32']}];require('fs').writeFileSync(f,JSON.stringify(p,null,2))"
rm -f package-lock.json && npm install --no-audit --no-fund
node build-app.js
rm -rf dist && npx electron-builder --win dir --x64 --ia32
node set-exe-meta.mjs
sed 's#dist/win-unpacked/#dist/win-ia32-unpacked/#' set-exe-meta.mjs > set-exe-meta-ia32.mjs && node set-exe-meta-ia32.mjs && rm set-exe-meta-ia32.mjs
for A in x64 ia32; do makensis -V2 -INPUTCHARSET UTF8 -DVERSION=$V -DARCH=$A installer-w7.nsi; done
ls -la dist/*.exe
