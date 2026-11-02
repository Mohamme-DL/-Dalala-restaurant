// Dalala Restaurant — Windows desktop shell (Electron)
const { app, BrowserWindow, Menu, shell, dialog } = require('electron');
const path = require('path');

app.setAppUserModelId('ly.dalala.restaurant');
if (!app.requestSingleInstanceLock()) { app.quit(); }

let win;
function createWindow() {
  win = new BrowserWindow({
    width: 1400, height: 880, minWidth: 980, minHeight: 640,
    title: 'منظومة دلالة للمطاعم والمقاهي', icon: path.join(__dirname, 'web', 'assets', 'icon.png'),
    backgroundColor: '#0f172a', autoHideMenuBar: true, show: false,
    webPreferences: { contextIsolation: true, nodeIntegration: false, sandbox: true, spellcheck: false },
  });
  Menu.setApplicationMenu(null);
  win.loadFile(path.join(__dirname, 'web', 'index.html'));
  win.once('ready-to-show', () => { win.maximize(); win.show(); });

  // Links to the outside world open in the default browser, never inside the app.
  win.webContents.setWindowOpenHandler(({ url }) => { if (/^https?:/.test(url)) shell.openExternal(url); return { action: 'deny' }; });
  win.webContents.on('will-navigate', (e, url) => { if (!url.startsWith('file://')) { e.preventDefault(); if (/^https?:/.test(url)) shell.openExternal(url); } });

  // Backups / CSV exports: always ask where to save.
  win.webContents.session.on('will-download', (_e, item) => {
    item.setSaveDialogOptions({ title: 'حفظ الملف — Save file', defaultPath: path.join(app.getPath('documents'), item.getFilename()) });
  });

  // Keyboard: F5 reload, Ctrl+P print, Ctrl +/- zoom
  win.webContents.on('before-input-event', (e, input) => {
    if (input.type !== 'keyDown') return;
    const ctrl = input.control || input.meta;
    if (input.key === 'F5') { win.reload(); e.preventDefault(); }
    else if (ctrl && (input.key === '=' || input.key === '+')) { win.webContents.setZoomLevel(win.webContents.getZoomLevel() + 0.5); e.preventDefault(); }
    else if (ctrl && input.key === '-') { win.webContents.setZoomLevel(win.webContents.getZoomLevel() - 0.5); e.preventDefault(); }
    else if (ctrl && input.key === '0') { win.webContents.setZoomLevel(0); e.preventDefault(); }
  });

  win.webContents.on('render-process-gone', (_e, details) => {
    dialog.showErrorBox('منظومة دلالة للمطاعم والمقاهي', `حدث خطأ غير متوقع وسيتم إعادة التحميل.\n(${details.reason})`);
    win.reload();
  });
}

app.on('second-instance', () => { if (win) { if (win.isMinimized()) win.restore(); win.focus(); } });
app.whenReady().then(createWindow);
app.on('window-all-closed', () => app.quit());
