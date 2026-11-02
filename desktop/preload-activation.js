const { contextBridge, ipcRenderer } = require('electron');
contextBridge.exposeInMainWorld('lic', {
  info: () => ipcRenderer.invoke('lic:info'),
  activate: key => ipcRenderer.invoke('lic:activate', key),
  copy: text => ipcRenderer.invoke('lic:copy', text),
  open: url => ipcRenderer.invoke('lic:open', url),
});
