// Dalala — Windows desktop shell (Electron) with per-device activation.
const { app, BrowserWindow, Menu, shell, dialog, ipcMain, clipboard } = require('electron');
const path = require('path');
const lic = require('./license');
const fs = require('fs');
const os = require('os');
const http = require('http');
const net = require('./netserver');
const PRODUCT = lic.PRODUCT;

app.setAppUserModelId('ly.dalala.' + PRODUCT.id);
if (!app.requestSingleInstanceLock()) app.quit();
Menu.setApplicationMenu(null);

let win = null, actWin = null, state = { ok: false, reason: 'none' }, lastSaved = '';

/* ---------- several computers, one database (LAN) ----------
   network.json: { mode: 'local' | 'host' | 'client', port, key, host }  */
const NET_DEFAULT = { mode: 'local', port: 47630, key: '', host: '' };
const netFile = () => path.join(app.getPath('userData'), 'network.json');
function netConfig() { try { return { ...NET_DEFAULT, ...JSON.parse(fs.readFileSync(netFile(), 'utf8')) }; } catch (e) { return { ...NET_DEFAULT }; } }
let NET = null, server = null, serverError = '';
function lanAddresses() { return Object.values(os.networkInterfaces()).flat().filter(n => n && n.family === 'IPv4' && !n.internal).map(n => n.address); }
async function startServer() {
  if (NET.mode !== 'host') return;
  if (!NET.key) { NET.key = net.newKey(); fs.writeFileSync(netFile(), JSON.stringify(NET, null, 1)); }
  let rules = {}; try { rules = require('./netrules'); } catch (e) { /* no product rules */ }
  server = net.createServer({ rules, port: NET.port, key: NET.key, dir: path.join(app.getPath('userData'), 'shared'), onEvent: (k, m) => { if (k === 'error') serverError = m; } });
  try { await server.listen(); } catch (e) { serverError = e.message; dialog.showErrorBox(PRODUCT.nameAr, `تعذر تشغيل خادم الشبكة على المنفذ ${NET.port}.\n${e.message}`); server = null; }
}
function ping(host, port, key) {
  return new Promise(resolve => {
    const req = http.get({ host, port, path: '/api/ping', timeout: 4000, headers: { 'x-dalala-key': key } }, res => { let b = ''; res.on('data', c => { b += c; }); res.on('end', () => { try { resolve({ ok: true, ...JSON.parse(b) }); } catch (e) { resolve({ ok: false, error: 'bad reply' }); } }); });
    req.on('timeout', () => { req.destroy(); resolve({ ok: false, error: 'timeout' }); }); req.on('error', e => resolve({ ok: false, error: e.code || e.message }));
  });
}
ipcMain.on('net:config', e => {
  const c = NET || netConfig();
  e.returnValue = { mode: c.mode, key: c.key, port: c.port, host: c.host, name: os.hostname(),
    url: c.mode === 'host' ? `http://127.0.0.1:${c.port}` : c.mode === 'client' ? `http://${c.host}:${c.port}` : '' };
});
ipcMain.handle('net:info', () => ({ ...NET, ips: lanAddresses(), hostname: os.hostname(), server: server ? server.status() : null, serverError }));
ipcMain.handle('net:test', (_e, { host, port, key }) => ping(String(host || '').trim(), +port || NET_DEFAULT.port, String(key || '').trim().toUpperCase()));
ipcMain.handle('net:set', (_e, cfg) => {
  const next = { ...NET_DEFAULT, ...NET, mode: ['local', 'host', 'client'].includes(cfg.mode) ? cfg.mode : 'local', port: Math.min(65000, Math.max(1024, +cfg.port || NET_DEFAULT.port)), host: String(cfg.host || '').trim(), key: cfg.mode === 'client' ? String(cfg.key || '').trim().toUpperCase() : (NET.key || '') };
  fs.writeFileSync(netFile(), JSON.stringify(next, null, 1));
  setTimeout(() => { app.relaunch(); app.exit(0); }, 300);
  return true;
});
const ICON = path.join(__dirname, 'web', 'assets', 'icon.png');

function harden(wc, allowNav) {
  wc.setWindowOpenHandler(({ url }) => { if (/^https?:/.test(url)) shell.openExternal(url); return { action: 'deny' }; });
  wc.on('will-navigate', (e, url) => { if (!allowNav(url)) { e.preventDefault(); if (/^https?:/.test(url)) shell.openExternal(url); } });
  wc.on('devtools-opened', () => wc.closeDevTools());
  wc.on('before-input-event', (e, input) => {
    if (input.type !== 'keyDown') return;
    const ctrl = input.control || input.meta; const k = (input.key || '').toLowerCase();
    if (k === 'f12' || (ctrl && input.shift && ['i', 'j', 'c'].includes(k))) { e.preventDefault(); return; }
    if (k === 'f5') { wc.reload(); e.preventDefault(); }
    else if (ctrl && (k === '=' || k === '+')) { wc.setZoomLevel(wc.getZoomLevel() + 0.5); e.preventDefault(); }
    else if (ctrl && k === '-') { wc.setZoomLevel(wc.getZoomLevel() - 0.5); e.preventDefault(); }
    else if (ctrl && k === '0') { wc.setZoomLevel(0); e.preventDefault(); }
  });
}

function createMain() {
  win = new BrowserWindow({
    width: 1400, height: 880, minWidth: 980, minHeight: 640, title: PRODUCT.nameAr, icon: ICON,
    backgroundColor: PRODUCT.bg || '#f4f6fb', autoHideMenuBar: true, show: false,
    webPreferences: { preload: path.join(__dirname, 'preload-app.js'), contextIsolation: true, nodeIntegration: false, sandbox: true, spellcheck: false, devTools: false },
  });
  harden(win.webContents, url => url.startsWith('file://'));
  win.loadFile(path.join(__dirname, 'web', 'index.html'));
  win.once('ready-to-show', () => { win.maximize(); win.show(); });
  win.webContents.session.on('will-download', (_e, item) => {
    item.setSaveDialogOptions({ title: 'حفظ الملف — Save file', defaultPath: path.join(app.getPath('documents'), item.getFilename()) });
    item.once('done', (_ev, st) => { if (st === 'completed' && win) { lastSaved = item.getSavePath(); win.webContents.send('file:saved', lastSaved); } });
  });
  win.webContents.on('render-process-gone', (_e, d) => { dialog.showErrorBox(PRODUCT.nameAr, `حدث خطأ غير متوقع وسيتم إعادة التحميل.\n(${d.reason})`); win.reload(); });
  win.on('closed', () => { win = null; });
}

function createActivation() {
  actWin = new BrowserWindow({
    width: 760, height: 700, resizable: false, maximizable: false, title: `${PRODUCT.nameAr} — التفعيل`, icon: ICON,
    backgroundColor: '#0f172a', autoHideMenuBar: true, show: false,
    webPreferences: { preload: path.join(__dirname, 'preload-activation.js'), contextIsolation: true, nodeIntegration: false, sandbox: true, devTools: false },
  });
  harden(actWin.webContents, () => false);
  actWin.loadFile(path.join(__dirname, 'activation.html'));
  actWin.once('ready-to-show', () => actWin.show());
  actWin.on('closed', () => { actWin = null; });
}

ipcMain.handle('lic:info', () => ({ product: PRODUCT, deviceId: lic.deviceId(), reason: state.reason, payload: state.payload || null }));
ipcMain.handle('lic:activate', (_e, key) => {
  const r = lic.activate(app.getPath('userData'), key);
  if (r.ok) { state = r; setTimeout(() => { createMain(); if (actWin) actWin.close(); }, 900); }
  return { ok: r.ok, reason: r.reason, payload: r.payload || null };
});
ipcMain.handle('lic:copy', (_e, text) => { clipboard.writeText(String(text || '')); return true; });
ipcMain.handle('lic:open', (_e, url) => { if (/^https:\/\/wa\.me\/\d+/.test(String(url))) shell.openExternal(url); return true; });
ipcMain.on('lic:status', e => {
  e.returnValue = state.ok ? { licensed: true, customer: state.payload.c || '', expiry: state.payload.e || '', issued: state.payload.i || '', deviceId: lic.deviceId(), product: PRODUCT.id } : { licensed: false };
});

/* printing: list printers, print the current page silently on a chosen printer */
const fromMain = e => win && e.sender === win.webContents;
ipcMain.handle('print:list', async e => { if (!fromMain(e)) return []; try { return (await e.sender.getPrintersAsync()).map(p => ({ name: p.name, displayName: p.displayName, isDefault: !!p.isDefault })); } catch (err) { return []; } });
ipcMain.handle('print:run', (e, o = {}) => new Promise(resolve => {
  if (!fromMain(e)) return resolve({ ok: false, error: 'denied' });
  // receipts: the page is exactly as long as the receipt (in microns), so the roll is never cut into pages
  const ps = o.pageSize && typeof o.pageSize === 'object' && +o.pageSize.width > 10000 && +o.pageSize.height > 10000 ? { width: Math.min(+o.pageSize.width, 120000), height: Math.min(+o.pageSize.height, 5080000) } : (o.pageSize === 'A4' ? 'A4' : undefined);
  e.sender.print({ silent: !!o.silent, deviceName: String(o.deviceName || ''), printBackground: true, margins: { marginType: o.receipt ? 'none' : 'default' }, ...(ps ? { pageSize: ps } : {}) }, (ok, error) => resolve({ ok, error: ok ? '' : String(error || '') }));
}));
/* automatic backups: <userData>/backups/<name>.json, daily ones kept for 30 days */
const BK_DIR = () => path.join(app.getPath('userData'), 'backups');
const bkName = n => String(n || '').replace(/[^A-Za-z0-9_.-]/g, '').slice(0, 80);
ipcMain.handle('bk:save', (e, name, json) => {
  if (!fromMain(e)) return false; const n = bkName(name); if (!n || typeof json !== 'string' || json.length > 300 * 1024 * 1024) return false;
  try {
    fs.mkdirSync(BK_DIR(), { recursive: true }); const f = path.join(BK_DIR(), n + '.json'); fs.writeFileSync(f + '.tmp', json); fs.renameSync(f + '.tmp', f);
    const all = fs.readdirSync(BK_DIR()).filter(x => x.endsWith('.json')).map(x => ({ x, t: fs.statSync(path.join(BK_DIR(), x)).mtimeMs })).sort((a, b) => b.t - a.t);
    all.filter(o => o.x.startsWith('auto-')).slice(30).forEach(o => fs.rmSync(path.join(BK_DIR(), o.x), { force: true }));
    all.filter(o => !o.x.startsWith('auto-')).slice(40).forEach(o => fs.rmSync(path.join(BK_DIR(), o.x), { force: true }));
    return true;
  } catch (err) { return false; }
});
ipcMain.handle('bk:list', e => { if (!fromMain(e)) return []; try { return fs.readdirSync(BK_DIR()).filter(x => x.endsWith('.json')).map(x => { const st = fs.statSync(path.join(BK_DIR(), x)); return { name: x.slice(0, -5), size: st.size, mtime: st.mtimeMs }; }).sort((a, b) => b.mtime - a.mtime); } catch (err) { return []; } });
ipcMain.handle('bk:read', (e, name) => { if (!fromMain(e)) return ''; const n = bkName(name); try { return fs.readFileSync(path.join(BK_DIR(), n + '.json'), 'utf8'); } catch (err) { return ''; } });
// open the file the user just exported (only that path — never an arbitrary one)
ipcMain.handle('file:openLast', e => { if (!fromMain(e) || !lastSaved || !fs.existsSync(lastSaved)) return false; shell.openPath(lastSaved); return true; });
ipcMain.handle('bk:open', e => { if (!fromMain(e)) return false; fs.mkdirSync(BK_DIR(), { recursive: true }); shell.openPath(BK_DIR()); return true; });

app.on('second-instance', () => { const w = win || actWin; if (w) { if (w.isMinimized()) w.restore(); w.focus(); } });
app.whenReady().then(async () => {
  NET = netConfig(); await startServer();
  state = lic.check(app.getPath('userData'));
  if (state.ok) createMain(); else createActivation();
});
app.on('before-quit', () => { if (server) server.flush(); }); // write the shared database to disk before closing
app.on('window-all-closed', () => { if (server) server.close(); app.quit(); });
