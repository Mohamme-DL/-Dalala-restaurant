// Exposes the (read-only) license status to the web app. The web app refuses to start without it.
const { contextBridge, ipcRenderer } = require('electron');
contextBridge.exposeInMainWorld('dalalaDesktop', Object.freeze(ipcRenderer.sendSync('lic:status')));
// Several computers, one database: network mode for this computer (local / host / client)
contextBridge.exposeInMainWorld('dalalaNet', Object.freeze({
  config: Object.freeze(ipcRenderer.sendSync('net:config')),
  info: () => ipcRenderer.invoke('net:info'),
  test: opts => ipcRenderer.invoke('net:test', opts),
  set: cfg => ipcRenderer.invoke('net:set', cfg),
}));
// Printing on a chosen printer (receipts, A4, labels) and automatic backup files
contextBridge.exposeInMainWorld('dalalaPrint', Object.freeze({ list: () => ipcRenderer.invoke('print:list'), run: o => ipcRenderer.invoke('print:run', o) }));
contextBridge.exposeInMainWorld('dalalaBackup', Object.freeze({
  save: (name, json) => ipcRenderer.invoke('bk:save', name, json), list: () => ipcRenderer.invoke('bk:list'),
  read: name => ipcRenderer.invoke('bk:read', name), open: () => ipcRenderer.invoke('bk:open'),
}));
// after a file is saved: the app can offer to open it
contextBridge.exposeInMainWorld('dalalaFiles', Object.freeze({ onSaved: cb => ipcRenderer.on('file:saved', (_e, p) => cb(String(p))), openLast: () => ipcRenderer.invoke('file:openLast') }));
