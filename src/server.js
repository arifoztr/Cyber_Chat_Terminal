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
    res.setHeader('X-XSS-Protection', '1; mode=block');
    
    // [GÜVENLİK] Content-Security-Policy (CSP): XSS ve yetkisiz kaynak yüklemelerini önler
    const cspPolicy = [
        "default-src 'self'",
        "script-src 'self' 'unsafe-inline' https://cdn.tailwindcss.com https://cdn.socket.io https://cdn.jsdelivr.net",
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

// CORS ve CSWSH (Cross-Site WebSocket Hijacking) Koruması
function isOriginAllowed(origin, callback) {
    // Origin başlığı yoksa (same-origin istekler, Electron file://, yerel istemciler)
    if (!origin || origin === 'null' || origin.startsWith('file://')) {
        return callback(null, true);
    }
    // .env dosyasında CORS_ORIGIN tanımlıysa sadece bu domainlere izin ver
    if (process.env.CORS_ORIGIN) {
        const whitelist = process.env.CORS_ORIGIN.split(',').map(o => o.trim());
        if (whitelist.includes(origin)) return callback(null, true);
        return callback(new Error('CORS Savunması: Yetkisiz Origin'));
    }
    // Tanımlı değilse yalnızca yerel ağ ve localhost kabul edilir (Rastgele harici siteler engellenir)
    const isLocal = origin.includes('localhost') || origin.includes('127.0.0.1') || origin.includes('0.0.0.0');
    if (isLocal) {
        return callback(null, true);
    }
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

// 1. Önce Veritabanını Başlat
dbManager.initDB().then(() => {
    
    // 2. Çöp Toplayıcıyı Başlat (Zaman aşımına uğrayan paketleri temizler)
    dbManager.startGarbageCollector();
    
    // 3. Sunucuyu Dinlemeye Başla (0.0.0.0 ile hem localhost hem 127.0.0.1 hem yerel ağ dinlenir)
    http.listen(PORT, '0.0.0.0', () => {
        console.log(`==================================================`);
        console.log(`[+] AES-GCM P2P SİBER MERKEZİ AKTİF: http://localhost:${PORT}`);
        console.log(`[+] YEREL IP ERİŞİMİ: http://127.0.0.1:${PORT}`);
        console.log(`[!] SİSTEM "CLEAN ARCHITECTURE" MODÜLLERİYLE BAŞLADI`);
        console.log(`[!] FAZ-1: JWT, RATE-LIMIT & SECURE HEADERS AKTİF`);
        console.log(`==================================================`);
    });
});

// Sunucu güvenli kapanış (Graceful Shutdown) mekanizması
async function gracefulShutdown(signal) {
    console.log(`\n[${signal}] Sinyal alındı. Kapatılıyor, DB diske yazılıyor...`);
    await dbManager.saveDatabaseImmediate();
    process.exit(0);
}

process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
process.on('SIGINT',  () => gracefulShutdown('SIGINT'));
