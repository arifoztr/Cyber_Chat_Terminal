require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });
const express = require('express');
const app = express();
const http = require('http').createServer(app);
const path = require('path');

// Oluşturduğumuz modülleri içeri aktarıyoruz
const dbManager = require('./database');
const setupSockets = require('./socket');

const PORT = process.env.PORT || 3000;

// [FAZ 1] GÜVENLİ AKTARIM: Express Güvenlik Başlıkları (Security Headers)
app.use((req, res, next) => {
    if (process.env.NODE_ENV === 'production') {
        res.setHeader('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
    }
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('X-Frame-Options', 'DENY');
    res.setHeader('X-XSS-Protection', '0'); // Modern tarayıcı standardı: Eski hatalı XSS filtresi kapatılır, CSP devralır
    
    // [GÜVENLİK FIX - SEC-13] Sıkılaştırılmış Content-Security-Policy:
    // 'unsafe-inline' ve harici CDN alan adları script-src direktifinden tamamen kaldırıldı.
    const cspPolicy = [
        "default-src 'self'",
        "script-src 'self'",
        "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
        "font-src 'self' https://fonts.gstatic.com data:",
        "img-src 'self' data: blob:",
        "connect-src 'self' ws: wss: http: https:",
        "object-src 'none'",
        "base-uri 'self'",
        "frame-ancestors 'none'"
    ].join('; ');
    res.setHeader('Content-Security-Policy', cspPolicy);

    // Geliştirme ortamında önbelleği devre dışı bırak (F5 atıldığında yeni kod gelsin)
    res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');

    if (!req.url.includes('/socket.io/')) {
        console.log(`[HTTP ${req.method}] ${req.url}`);
    }
    next();
});

// [FİX-2] Proxy Arkası IP Güveni (Nginx, Cloudflare vb.)
app.set('trust proxy', 1);

// PaaS / Uptime Monitörleri için Healthcheck Endpoint'i
app.get('/health', (req, res) => {
    res.status(200).json({ status: 'ok', timestamp: new Date().toISOString() });
});

// [FİX-1] Yalnızca ./public/ dizinindeki istemci dosyaları sunuluyor.
app.use(express.static(path.join(__dirname, '..', 'public'), { maxAge: 0, etag: false }));

app.get('/', (req, res) => {
    res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
    res.sendFile(path.join(__dirname, '..', 'public', 'index.html'));
});

// [GÜVENLİK FIX - SEC-08] Sıkılaştırılmış CORS ve CSWSH Koruması
function isOriginAllowed(origin, callback) {
    // Same-origin istekler veya Electron file:// protokolü
    if (!origin || origin.startsWith('file://')) {
        return callback(null, true);
    }
    // Sandboxed iframe veya data URI kaynaklı 'null' origin'leri engelle (CSWSH Savunması)
    if (origin === 'null') {
        return callback(new Error('CSWSH Savunması: "null" origin bağlantısı reddedildi'));
    }
    // .env dosyasında CORS_ORIGIN tanımlıysa sadece bu domainlere izin ver
    if (process.env.CORS_ORIGIN) {
        const whitelist = process.env.CORS_ORIGIN.split(',').map(o => o.trim()).filter(Boolean);
        if (whitelist.includes(origin)) return callback(null, true);
        return callback(new Error('CORS Savunması: Yetkisiz Origin'));
    }
    // Tanımlı değilse yalnızca yerel host adreslerine katı hostname denetimiyle izin ver
    try {
        const parsed = new URL(origin);
        const allowedHosts = ['localhost', '127.0.0.1', '0.0.0.0'];
        if (allowedHosts.includes(parsed.hostname)) {
            return callback(null, true);
        }
    } catch (_) {}
    return callback(new Error('CSWSH Savunması: Bilinmeyen Origin bağlantısı reddedildi'));
}

// Socket.io Ayarları (5MB dosya aktarımı base64 ve şifreleme ile ~7-8MB olabileceğinden buffer 10MB yapılır)
const io = require('socket.io')(http, {
    cors: { origin: isOriginAllowed, credentials: true, methods: ["GET", "POST"] },
    transports: ['websocket', 'polling'],
    maxHttpBufferSize: 10 * 1024 * 1024
});

// Modüler socket olayları
setupSockets(io);

// Sunucu başlatma fonksiyonu
function startServer(port = PORT) {
    return dbManager.initDB().then(() => {
        // 2. Çöp Toplayıcıyı Başlat (Zaman aşımına uğrayan paketleri temizler)
        dbManager.startGarbageCollector();
        
        // 3. Sunucuyu Dinlemeye Başla
        return new Promise((resolve) => {
            const server = http.listen(port, '0.0.0.0', () => {
                console.log(`==================================================`);
                console.log(`[+] AES-GCM P2P SİBER MERKEZİ AKTİF: http://localhost:${port}`);
                console.log(`[+] YEREL IP ERİŞİMİ: http://127.0.0.1:${port}`);
                console.log(`[!] SİSTEM "CLEAN ARCHITECTURE" MODÜLLERİYLE BAŞLADI`);
                console.log(`[!] FAZ-1: JWT, RATE-LIMIT & SECURE HEADERS AKTİF`);
                console.log(`==================================================`);
                resolve(server);
            });
        });
    });
}

// Sunucu güvenli kapanış (Graceful Shutdown) mekanizması
async function gracefulShutdown(signal) {
    console.log(`\n[${signal}] Sinyal alındı. Kapatılıyor, DB diske yazılıyor...`);
    await dbManager.saveDatabaseImmediate();
    process.exit(0);
}

if (require.main === module) {
    startServer();
    process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
    process.on('SIGINT',  () => gracefulShutdown('SIGINT'));
}

module.exports = {
    app,
    http,
    io,
    isOriginAllowed,
    gracefulShutdown,
    startServer
};
