// Copies the web app (one folder up) into ./web so it is packaged with the desktop build.
const fs = require('fs'); const path = require('path');
const src = path.resolve(__dirname, '..'); const dst = path.join(__dirname, 'web');
fs.rmSync(dst, { recursive: true, force: true });
for (const item of ['index.html', 'assets']) fs.cpSync(path.join(src, item), path.join(dst, item), { recursive: true });
console.log('web app synced to', dst);
