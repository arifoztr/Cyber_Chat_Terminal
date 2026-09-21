const { app, BrowserWindow, shell, ipcMain, Menu } = require('electron');
const path = require('path');

let mainWindow = null;

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
            sandbox: false,
            webSecurity: false // Yerel file:// protokolünden https backend'e CORS/Socket bağlantısını pürüzsüzleştirmek için
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

// IPC Olayları
ipcMain.on('window-minimize', () => {
    if (mainWindow) mainWindow.minimize();
});

ipcMain.on('window-maximize', () => {
    if (mainWindow) {
        if (mainWindow.isMaximized()) {
            mainWindow.unmaximize();
        } else {
            mainWindow.maximize();
        }
    }
});

ipcMain.on('window-close', () => {
    if (mainWindow) mainWindow.close();
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
