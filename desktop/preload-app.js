// Exposes the (read-only) license status to the web app. The web app refuses to start without it.
const { contextBridge, ipcRenderer } = require('electron');
contextBridge.exposeInMainWorld('dalalaDesktop', Object.freeze(ipcRenderer.sendSync('lic:status')));
