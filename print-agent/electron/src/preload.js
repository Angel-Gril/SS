const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('agent', {
  getConfig: () => ipcRenderer.invoke('config:get'),
  saveConfig: (next) => ipcRenderer.invoke('config:save', next),
  listPrinters: () => ipcRenderer.invoke('printers:list'),
  testPrint: (printer) => ipcRenderer.invoke('print:test', printer),
});
