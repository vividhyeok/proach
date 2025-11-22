const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('electronAPI', {
  selectPdfFile: () => ipcRenderer.invoke('select-pdf-file'),
  copyPdfToApp: (srcPath, destName) => ipcRenderer.invoke('copy-pdf-to-app', srcPath, destName),
  openPdfInChrome: (pdfPath) => ipcRenderer.invoke('open-pdf-in-chrome', pdfPath),
  setAlwaysOnTop: (value) => ipcRenderer.invoke('set-always-on-top', value)
});
