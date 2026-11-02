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
