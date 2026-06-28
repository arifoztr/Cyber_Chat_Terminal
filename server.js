require('dotenv').config();
const express = require('express');
const app = express();
const http = require('http').createServer(app);
const path = require('path');

// Oluşturduğumuz modülleri içeri aktarıyoruz
const dbManager = require('./database');
const setupSockets = require('./socket');

const PORT = 3000;

// [FAZ 1] GÜVENLİ AKTARIM: Express Güvenlik Başlıkları (Security Headers)
app.use((req, res, next) => {
    res.setHeader('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('X-Frame-Options', 'DENY');
    res.setHeader('X-XSS-Protection', '1; mode=block');
    next();
});

// [FİX-2] Proxy Arkası IP Güveni (Nginx, Cloudflare vb.)
app.set('trust proxy', 1);

// [FİX-1] Yalnızca ./public/ dizinindeki istemci dosyaları sunuluyor.
// database.json, server.js, socket.js, package.json vb. artık HTTP üzerinden erişilemez.
app.use(express.static(path.join(__dirname, 'public'), { maxAge: '1h', etag: true }));

app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'siber_e2ee_sohbet_terminali.html'));
});

// Socket.io Ayarları
// [FİX-14] CORS origin artık çevre değişkeniyle yapılandırılabilir.
// Üretimde CORS_ORIGIN=https://example.com ayarlayın. Varsayılan: "*" (geliştirme).
const CORS_ORIGIN = process.env.CORS_ORIGIN || '*';
const io = require('socket.io')(http, {
    cors: { origin: CORS_ORIGIN, methods: ["GET", "POST"] },
    transports: ['websocket', 'polling']
});

// Modüler socket olayları
setupSockets(io);

// 1. Önce Veritabanını Başlat
dbManager.initDB().then(() => {
    
    // 2. Çöp Toplayıcıyı Başlat (Zaman aşımına uğrayan paketleri temizler)
    dbManager.startGarbageCollector();
    
    // 3. Sunucuyu Dinlemeye Başla
    http.listen(PORT, () => {
        console.log(`==================================================`);
        console.log(`[+] AES-GCM P2P SİBER MERKEZİ AKTİF: PORT ${PORT}`);
        console.log(`[!] SİSTEM "CLEAN ARCHITECTURE" MODÜLLERİYLE BAŞLADI`);
        console.log(`[!] FAZ-1: JWT, RATE-LIMIT & SECURE HEADERS AKTİF`);
        console.log(`[!] FİX: Hassas dosyalar ./public/ dışında tutuldu (DB sızıntısı önlendi)`);
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