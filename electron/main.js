/**
 * @file main.js
 * @module ElectronMain
 * @description Electron masaüstü ana süreci (Main Process).
 * Güvenli pencere yönetimi (contextIsolation, sandbox, SOP politikaları), IPC pencere kontrolü
 * ve tek örnek kilidi (Single Instance Lock) mekanizmalarını yönetir.
 */

const { app, BrowserWindow, shell, ipcMain, Menu, safeStorage } = require('electron');
const path = require('path');

/**
 * Ana BrowserWindow örneği.
 * @type {BrowserWindow|null}
 */
let mainWindow = null;

/**
 * Uygulamanın ana masaüstü penceresini oluşturur ve güvenlik tercihlerini ayarlar.
 * contextIsolation, sandbox ve webSecurity zorunlu kılınarak XSS saldırılarında
 * yerel sistem komutlarının çalıştırılması engellenir.
 * @function createWindow
 * @returns {void}
 */
function createWindow() {
    mainWindow = new BrowserWindow({
        width: 1280,
        height: 850,
        minWidth: 900,
        minHeight: 650,
        title: "Secure Chat — E2EE Messenger",
        backgroundColor: "#0d1117",
        show: false, // Sayfa hazır olana kadar pencereyi gösterme (beyaz parlama önleme)
        icon: path.join(__dirname, 'assets', 'icon.png'),
        webPreferences: {
            preload: path.join(__dirname, 'preload.js'),
            nodeIntegration: false,
            contextIsolation: true,
            sandbox: true,
            webSecurity: true // [GÜVENLİK FIX] SOP zorunlu kılınır — XSS ile yerel dosya/iç ağ erişimi engellenir
        }
    });

    // Menü çubuğunu gizle / sadeleştir
    Menu.setApplicationMenu(null);

    // Renderer içeriğini yükle (public/index.html)
    const indexPath = path.join(__dirname, '..', 'public', 'index.html');
    mainWindow.loadFile(indexPath);

    // Hazır olduğunda zarifçe göster
    mainWindow.once('ready-to-show', () => {
        mainWindow.show();
    });

    // Harici linklerin (örn. web siteleri) Electron penceresi içinde değil, varsayılan tarayıcıda açılmasını sağla
    mainWindow.webContents.setWindowOpenHandler(({ url }) => {
        if (url.startsWith('http:') || url.startsWith('https:')) {
            shell.openExternal(url);
        }
        return { action: 'deny' };
    });

    mainWindow.on('closed', () => {
        mainWindow = null;
    });
}

// IPC Olayları (Renderer sürecinden gelen pencere aksiyonları)

/**
 * Pencereyi simge durumuna küçültür.
 */
ipcMain.on('window-minimize', () => {
    if (mainWindow) mainWindow.minimize();
});

/**
 * Pencereyi ekran boyutuna büyütür veya önceki boyutuna geri getirir.
 */
ipcMain.on('window-maximize', () => {
    if (mainWindow) {
        if (mainWindow.isMaximized()) {
            mainWindow.unmaximize();
        } else {
            mainWindow.maximize();
        }
    }
});

/**
 * Pencereyi kapatır.
 */
ipcMain.on('window-close', () => {
    if (mainWindow) mainWindow.close();
});

// === Electron safeStorage IPC Köprüsü (Windows DPAPI / macOS Keychain) ===

/**
 * İşletim sistemi düzeyinde şifreleme hizmeti kullanılabilir mi kontrol eder.
 * Windows'ta DPAPI, macOS'ta Keychain, Linux'ta libsecret kullanır.
 * @returns {Promise<boolean>}
 */
ipcMain.handle('safe-storage-available', () => {
    return safeStorage.isEncryptionAvailable();
});

/**
 * Düz metin veriyi işletim sistemi anahtarlığı ile şifreler.
 * @param {Electron.IpcMainInvokeEvent} _event
 * @param {string} plaintext - Şifrelenecek düz metin.
 * @returns {Promise<string|null>} Base64 kodlu şifreli veri veya şifreleme yoksa null.
 */
ipcMain.handle('safe-storage-encrypt', (_event, plaintext) => {
    if (!safeStorage.isEncryptionAvailable()) return null;
    return safeStorage.encryptString(plaintext).toString('base64');
});

/**
 * İşletim sistemi anahtarlığı ile şifrelenmiş veriyi çözer.
 * @param {Electron.IpcMainInvokeEvent} _event
 * @param {string} base64Cipher - Base64 kodlu şifreli veri.
 * @returns {Promise<string|null>} Çözülmüş düz metin veya şifreleme yoksa null.
 */
ipcMain.handle('safe-storage-decrypt', (_event, base64Cipher) => {
    if (!safeStorage.isEncryptionAvailable()) return null;
    try {
        const buffer = Buffer.from(base64Cipher, 'base64');
        return safeStorage.decryptString(buffer);
    } catch (e) {
        console.error('[!] safeStorage decrypt hatası:', e);
        return null;
    }
});

// Tek örnek kilidi (Single Instance Lock) — Uygulamanın birden fazla kopyasının aynı anda açılmasını önler
const gotTheLock = app.requestSingleInstanceLock();
if (!gotTheLock) {
    app.quit();
} else {
    app.on('second-instance', () => {
        if (mainWindow) {
            if (mainWindow.isMinimized()) mainWindow.restore();
            mainWindow.focus();
        }
    });

    app.whenReady().then(() => {
        createWindow();

        app.on('activate', () => {
            if (BrowserWindow.getAllWindows().length === 0) {
                createWindow();
            }
        });
    });
}

app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') {
        app.quit();
    }
});
