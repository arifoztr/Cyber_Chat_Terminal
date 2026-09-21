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

// CORS Yapılandırması (Cloudflare Pages ve custom domainler için)
const allowedOrigins = process.env.CORS_ORIGIN 
    ? process.env.CORS_ORIGIN.split(',').map(origin => origin.trim()) 
    : true;

// Socket.io Ayarları (5MB dosya aktarımı base64 ve şifreleme ile ~7-8MB olabileceğinden buffer 10MB yapılır)
const io = require('socket.io')(http, {
    cors: { origin: allowedOrigins, credentials: true, methods: ["GET", "POST"] },
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
