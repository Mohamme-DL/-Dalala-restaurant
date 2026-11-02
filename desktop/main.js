// Dalala — Windows desktop shell (Electron) with per-device activation.
const { app, BrowserWindow, Menu, shell, dialog, ipcMain, clipboard } = require('electron');
const path = require('path');
const lic = require('./license');
const PRODUCT = lic.PRODUCT;

app.setAppUserModelId('ly.dalala.' + PRODUCT.id);
if (!app.requestSingleInstanceLock()) app.quit();
Menu.setApplicationMenu(null);

let win = null, actWin = null, state = { ok: false, reason: 'none' };
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

app.on('second-instance', () => { const w = win || actWin; if (w) { if (w.isMinimized()) w.restore(); w.focus(); } });
app.whenReady().then(() => {
  state = lic.check(app.getPath('userData'));
  if (state.ok) createMain(); else createActivation();
});
app.on('window-all-closed', () => app.quit());
