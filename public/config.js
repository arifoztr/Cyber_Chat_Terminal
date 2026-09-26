/**
 * @file config.js
 * @module AppConfig
 * @description İstemci ortam yapılandırma parametreleri.
 * Tarayıcı veya Electron çalışma ortamında sunucu adresi ve global sabitleri tanımlar.
 */

/**
 * Uygulama global yapılandırma nesnesi.
 * @namespace APP_CONFIG
 * @type {Object}
 * @property {string} BACKEND_URL - Backend API ve WebSocket sunucusunun hedef bağlantı adresi.
 */
window.APP_CONFIG = {
    /**
     * Backend API & WebSocket Sunucu Adresi.
     * @type {string}
     */
    BACKEND_URL: "https://cyber-chat-i7sq.onrender.com"
};
