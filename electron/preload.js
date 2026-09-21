const { contextBridge, ipcRenderer } = require('electron');

// Renderer sürecine güvenli bir API köprüsü sağlıyoruz
contextBridge.exposeInMainWorld('electronAPI', {
    isElectron: true,
    platform: process.platform,
    version: process.versions.electron,
    minimize: () => ipcRenderer.send('window-minimize'),
    maximize: () => ipcRenderer.send('window-maximize'),
    close: () => ipcRenderer.send('window-close')
});
