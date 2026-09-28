/**
 * @file preload.js
 * @module ElectronPreload
 * @description Electron Preload betiği.
 * Ana süreç (Node.js) ile izole edilmiş tarayıcı penceresi (Renderer) arasında
 * contextBridge aracılığıyla yalnızca güvenli pencere kontrol metodlarını sunar.
 */

const { contextBridge, ipcRenderer } = require('electron');

/**
 * Renderer sürecinde window.electronAPI olarak erişilebilir olan güvenli köprü arayüzü.
 */
contextBridge.exposeInMainWorld('electronAPI', {
    /**
     * Uygulamanın Electron masaüstü ortamında çalıştığını belirten bayrak.
     * @type {boolean}
     */
    isElectron: true,

    /**
     * Çalışılan işletim sistemi platformu (win32, darwin, linux vb.).
     * @type {string}
     */
    platform: process.platform,

    /**
     * Electron sürüm numarası.
     * @type {string}
     */
    version: process.versions.electron,

    /**
     * Pencereyi simge durumuna küçültme IPC çağrısını tetikler.
     * @function
     * @returns {void}
     */
    minimize: () => ipcRenderer.send('window-minimize'),

    /**
     * Pencereyi tam ekran yapma / önceki boyuta döndürme IPC çağrısını tetikler.
     * @function
     * @returns {void}
     */
    maximize: () => ipcRenderer.send('window-maximize'),

    /**
     * Pencereyi kapatma IPC çağrısını tetikler.
     * @function
     * @returns {void}
     */
    close: () => ipcRenderer.send('window-close'),

    // === safeStorage Güvenli Depolama Köprüsü ===

    /**
     * İşletim sistemi düzeyinde şifreleme (DPAPI/Keychain) kullanılabilir mi kontrol eder.
     * @function
     * @returns {Promise<boolean>}
     */
    isSecureStorageAvailable: () => ipcRenderer.invoke('safe-storage-available'),

    /**
     * Düz metni işletim sistemi anahtarlığı ile şifreler.
     * @function
     * @param {string} plaintext - Şifrelenecek düz metin.
     * @returns {Promise<string|null>} Base64 şifreli veri.
     */
    secureEncrypt: (plaintext) => ipcRenderer.invoke('safe-storage-encrypt', plaintext),

    /**
     * İşletim sistemi anahtarlığı ile şifrelenmiş veriyi çözer.
     * @function
     * @param {string} base64Cipher - Base64 şifreli veri.
     * @returns {Promise<string|null>} Çözülmüş düz metin.
     */
    secureDecrypt: (base64Cipher) => ipcRenderer.invoke('safe-storage-decrypt', base64Cipher)
});
