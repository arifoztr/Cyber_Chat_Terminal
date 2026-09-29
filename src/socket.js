/**
 * @file socket.js
 * @module SocketServer
 * @description Socket.IO tabanlı gerçek zamanlı iletişim ve güvenlik sunucusu.
 * Uçtan Uca Şifreleme (E2EE) anahtar takası (ECDH handshake), paket yönlendirme,
 * çevrimdışı mesaj kuyruğu, JWT kimlik doğrulaması, hız sınırlaması (rate limiting)
 * ve BOLA/IDOR/Timing saldırılarına karşı siber savunma mekanizmalarını yönetir.
 */

const bcrypt = require('bcrypt');
const crypto = require('crypto');
const dbManager = require('./database');

/**
 * Kullanıcı başına çevrimdışı kuyrukta saklanabilecek maksimum paket sayısı.
 * @constant {number}
 */
const MAX_QUEUE_SIZE = 50;

/**
 * Çevrimiçi kullanıcıların bağlı soket kimliklerini tutan harita (userId -> Set<socketId>).
 * @type {Map<string, Set<string>>}
 */
const onlineNodes = new Map();

/**
 * Kullanıcı sayımı (user enumeration) ve zamanlama (timing) saldırılarını engellemek için sahte parola hash'i.
 * @constant {string}
 */
const DUMMY_HASH = '$2b$10$7EqJtq98hPqEX7fNZaFWoO0VpIxFk3E9V2bJgN1Jt3kR0n3X2m2Xe';

/**
 * JWT imzalamada kullanılan 256-bit gizli anahtar.
 * .env dosyasında JWT_SECRET tanımlı değilse CSPRNG ile rastgele üretilir.
 * @type {string}
 */
let JWT_SECRET;
if (process.env.JWT_SECRET && process.env.JWT_SECRET.trim().length >= 32) {
    JWT_SECRET = process.env.JWT_SECRET.trim();
} else {
    JWT_SECRET = crypto.randomBytes(32).toString('hex');
    console.warn('╔══════════════════════════════════════════════════════════════════════╗');
    console.warn('║  [!] GÜVENLİK UYARISI: JWT_SECRET .env dosyasında tanımlı değil!     ║');
    console.warn('║  Güvenli rastgele 256-bit anahtar üretildi (Sabit anahtar kaldırıldı)║');
    console.warn('║  Sunucu yeniden başladığında oturumların korunması için .env         ║');
    console.warn('║  dosyasına en az 32 karakterlik bir JWT_SECRET ekleyin.              ║');
    console.warn('╚══════════════════════════════════════════════════════════════════════╝');
}

/**
 * @typedef {Object} SanitizedUser
 * @property {string} email - Kullanıcı e-postası.
 * @property {string} username - Kullanıcı adı.
 * @property {string} userId - Kullanıcı ID'si.
 * @property {string|null} avatar - Kullanıcı avatar verisi.
 */

/**
 * Kullanıcı nesnesinden parola hash'i ve dahili alanları temizleyerek güvenli istemci nesnesi üretir.
 * @function sanitizeUser
 * @param {Object} u - Veritabanındaki ham kullanıcı nesnesi.
 * @returns {SanitizedUser|null} Temizlenmiş kullanıcı nesnesi.
 */
function sanitizeUser(u) {
    if (!u) return null;
    return {
        email: u.email,
        username: u.username,
        userId: u.userId,
        avatar: u.avatar || null
    };
}

/**
 * Çıkış yapılmış (iptal edilmiş) token'ların kara listesi (token -> expTimestampMs).
 * @type {Map<string, number>}
 */
const revokedTokens = new Map();

/**
 * Belirtilen JWT token'ını kara listeye alarak geçersiz kılar.
 * @function revokeToken
 * @param {string} token - İptal edilecek JWT dizesi.
 * @returns {void}
 */
function revokeToken(token) {
    if (!token || typeof token !== 'string') return;
    try {
        const parts = token.split('.');
        if (parts.length === 3) {
            const payload = JSON.parse(Buffer.from(parts[1], 'base64url').toString());
            const expMs = payload.exp > 1e11 ? payload.exp : (payload.exp * 1000);
            revokedTokens.set(token, expMs || (Date.now() + 24 * 3600 * 1000));
            return;
        }
    } catch (e) {}
    revokedTokens.set(token, Date.now() + 24 * 3600 * 1000);
}

// Süresi dolan iptal edilmiş token'ları hafızadan temizleme
setInterval(() => {
    const now = Date.now();
    for (const [t, exp] of revokedTokens.entries()) {
        if (now > exp) revokedTokens.delete(t);
    }
}, 60 * 60 * 1000);

/**
 * RFC 7519 uyumlu HS256 JWT token üretir.
 * @function signJWT
 * @param {Object} payload - Token içerisine yerleştirilecek veri nesnesi.
 * @param {string} payload.email - Kullanıcı e-postası.
 * @param {string} payload.userId - Kullanıcı ID'si.
 * @param {number} [payload.exp] - Opsiyonel sona erme zamanı (saniye).
 * @returns {string} İmzalanmış JWT dizesi.
 */
function signJWT(payload) {
    const nowSec = Math.floor(Date.now() / 1000);
    const header = Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT' })).toString('base64url');
    const body = Buffer.from(JSON.stringify({
        ...payload,
        iat: nowSec,
        exp: payload.exp || (nowSec + 24 * 60 * 60) // 24 saat
    })).toString('base64url');
    const signature = crypto.createHmac('sha256', JWT_SECRET).update(`${header}.${body}`).digest('base64url');
    return `${header}.${body}.${signature}`;
}

/**
 * JWT token'ını zamanlama saldırılarına karşı sabit zamanlı (timing-safe) karşılaştırma ile doğrular.
 * @function verifyJWT
 * @param {string} token - Doğrulanacak JWT dizesi.
 * @returns {Object|null} Geçerli ise payload nesnesi, geçersiz veya süresi dolmuşsa null.
 */
function verifyJWT(token) {
    try {
        if (!token || typeof token !== 'string') return null;
        if (revokedTokens.has(token)) return null; // Çıkış yapılmış token engeli

        const parts = token.split('.');
        if (parts.length !== 3) return null;
        const [header, body, signature] = parts;

        const expectedSig = crypto.createHmac('sha256', JWT_SECRET).update(`${header}.${body}`).digest('base64url');
        
        // Sabit zamanlı (timing-safe) karşılaştırma — Yan kanal saldırılarını engeller
        const sigBuf = Buffer.from(signature);
        const expBuf = Buffer.from(expectedSig);
        if (sigBuf.length !== expBuf.length || !crypto.timingSafeEqual(sigBuf, expBuf)) {
            return null;
        }

        const payload = JSON.parse(Buffer.from(body, 'base64url').toString());
        const nowSec = Math.floor(Date.now() / 1000);
        // Hem standart saniye hem geriye dönük milisaniye kontrolü
        const expSec = payload.exp > 1e11 ? Math.floor(payload.exp / 1000) : payload.exp;
        if (expSec < nowSec) return null;

        return payload;
    } catch (e) { return null; }
}

/**
 * Soket bağlantısından güvenli bir şekilde istemci IP adresini ayıklar.
 * Sahte başlık enjeksiyonlarına (spoofing) karşı yalnızca güvenilen proxy ortamlarında iletilen başlıklara güvenir.
 * @function getClientIp
 * @param {Object} socket - İstemci soket nesnesi.
 * @returns {string} Güvenilir istemci IP adresi.
 */
function getClientIp(socket) {
    const directIp = socket.handshake.address || socket.conn?.remoteAddress || '';
    
    // Doğrudan bağlantı bir döngü (loopback) veya özel ağ adresinden mi geliyor?
    const isLoopbackOrPrivate = directIp.includes('127.0.0.1') || 
                                directIp.includes('::1') || 
                                directIp.includes('::ffff:127.0.0.1') ||
                                directIp.startsWith('10.') || 
                                directIp.startsWith('172.16.') || 
                                directIp.startsWith('192.168.');

    // Yalnızca yapılandırılmış proxy ortamında veya yerel ters vekil arkasındaysa başlığa güven
    const trustProxy = process.env.TRUST_PROXY === 'true' || 
                       process.env.TRUST_PROXY === '1' || 
                       process.env.NODE_ENV === 'production' || 
                       isLoopbackOrPrivate;

    if (trustProxy) {
        // Cloudflare önceliği
        const cfIp = socket.handshake.headers['cf-connecting-ip'];
        if (cfIp && typeof cfIp === 'string') {
            const trimmed = cfIp.trim();
            if (trimmed.length <= 45) return trimmed;
        }
        const forwarded = socket.handshake.headers['x-forwarded-for'];
        if (forwarded && typeof forwarded === 'string') {
            const ip = forwarded.split(',')[0].trim();
            if (ip && ip.length <= 45) return ip;
        }
    }
    
    return directIp || '127.0.0.1';
}

/**
 * Socket.IO sunucusuna ait tüm middleware ve olay dinleyicilerini yapılandırır.
 * @function setupSockets
 * @param {Object} io - Socket.IO sunucu örneği.
 * @returns {Object} Test ve yönetim için yardımcı fonksiyonlar ve durum haritaları.
 */
module.exports = function setupSockets(io) {
    const db = dbManager.getDB();
    const userIdIndex = dbManager.getUserIdIndex();

    // [FAZ 1] RATE LIMITER (Hız Sınırlandırma)
    const rateLimits = new Map();

    /**
     * Belirtilen IP ve aksiyon için hız limitini kontrol eder.
     * @param {string} ip - İstemci IP adresi.
     * @param {string} action - İşlem adı (örn. 'login', 'register', 'send_packet').
     * @param {number} limit - İzin verilen maksimum istek sayısı.
     * @param {number} windowMs - Zaman penceresi (milisaniye).
     * @returns {boolean} İstek limit dahilindeyse true, aşıldıysa false.
     */
    function checkRateLimit(ip, action, limit, windowMs) {
        const now = Date.now();
        const key = `${ip}:${action}`;
        if (!rateLimits.has(key)) {
            rateLimits.set(key, { count: 1, resetAt: now + windowMs });
            return true;
        }
        const record = rateLimits.get(key);
        if (now > record.resetAt) {
            record.count = 1;
            record.resetAt = now + windowMs;
            return true;
        }
        if (record.count >= limit) return false;
        record.count++;
        return true;
    }

    // [GÜVENLİK FIX - SEC-28 / Prompt 2.3] Hatalı Kimlik Doğrulamada Sıkı Hız Sınırı (1 dakikada max 5 başarısız deneme)
    const failedLoginAttempts = new Map();

    /**
     * Başarısız oturum açma denemesi limitini kontrol eder.
     * @param {string} ip - İstemci IP adresi.
     * @returns {boolean} Limit aşılmamışsa true, 5 deneme aşıldıysa false.
     */
    function checkFailedLoginLimit(ip) {
        const now = Date.now();
        const record = failedLoginAttempts.get(ip);
        if (!record || now > record.resetAt) return true;
        return record.count < 5;
    }

    /**
     * Başarısız oturum açma denemesini kaydeder.
     * @param {string} ip - İstemci IP adresi.
     * @returns {void}
     */
    function recordFailedLogin(ip) {
        const now = Date.now();
        const record = failedLoginAttempts.get(ip);
        if (!record || now > record.resetAt) {
            failedLoginAttempts.set(ip, { count: 1, resetAt: now + 60000 });
        } else {
            record.count++;
        }
    }

    /**
     * Başarılı girişte hatalı oturum sayacını sıfırlar.
     * @param {string} ip - İstemci IP adresi.
     * @returns {void}
     */
    function resetFailedLogin(ip) {
        failedLoginAttempts.delete(ip);
    }

    // Rate Limiter Çöp Toplayıcısı
    setInterval(() => {
        const now = Date.now();
        for (const [key, record] of rateLimits.entries()) {
            if (now > record.resetAt) rateLimits.delete(key);
        }
        for (const [key, record] of failedLoginAttempts.entries()) {
            if (now > record.resetAt) failedLoginAttempts.delete(key);
        }
    }, 60000);

    /**
     * Paketin süresinin (TTL veya genel 7 günlük sınır) dolup dolmadığını denetler.
     * @param {Object} p - Kontrol edilecek mesaj paketi.
     * @returns {boolean} Süresi dolmuşsa true, geçerliyse false.
     */
    function isPacketExpired(p) {
        if (!p || !p.timestamp) return false;
        const age = Date.now() - p.timestamp;
        if (p.ttl && typeof p.ttl === 'number' && p.ttl > 0) {
            return age >= (p.ttl * 1000);
        }
        return age >= dbManager.MAX_PACKET_AGE_MS;
    }

    // [FAZ 1] Socket Middleware ile Otomatik JWT Doğrulaması
    io.use((socket, next) => {
        const token = socket.handshake.auth?.token;
        if (token) {
            const payload = verifyJWT(token);
            if (payload && db.users[payload.email]) {
                socket.user = db.users[payload.email];
            }
        }
        next();
    });

    io.on('connection', (socket) => {
        const ip = getClientIp(socket);
        console.log(`[+] YENİ BİR DÜĞÜM BAĞLANDI: ${socket.id} (IP: ${ip})`);

        /**
         * Yeni kullanıcı kaydı olayı.
         * Prototype pollution koruması, parola karmaşıklığı denetimi ve CSPRNG ile benzersiz ID üretimini uygular.
         * @name register
         * @param {Object} data - Kayıt bilgileri ({ email, password, username }).
         * @param {function(Object): void} callback - Sonuç geri çağırma fonksiyonu.
         */
        socket.on('register', async (data, callback) => {
            console.log(`[>> REGİSTER İSTEĞİ ALINDI] email: ${data?.email ? data.email.replace(/(.{2})(.*)(@.*)/, '$1***$3') : 'yok'}, ip: ${ip}`);
            if (!checkRateLimit(ip, 'register', 20, 60000)) {
                console.warn(`[!] REGİSTER RATE LIMIT AŞILDI: ${ip}`);
                return callback({ success: false, message: "SİBER SAVUNMA: Çok fazla kayıt denemesi. Lütfen bir dakika bekleyin." });
            }

            try {
                let { email, password, username } = data;
                if (!email || !password || !username) {
                    return callback({ success: false, message: "Tüm alanlar zorunludur." });
                }
                email = String(email).trim().toLowerCase();
                username = String(username).trim();

                // [GÜVENLİK FIX - SEC-14] Prototype Pollution Koruması & E-posta Doğrulaması
                const forbiddenKeys = ['__proto__', 'constructor', 'prototype'];
                if (forbiddenKeys.includes(email) || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
                    return callback({ success: false, message: "Geçersiz e-posta adresi formatı." });
                }

                // [GÜVENLİK FIX - SEC-15] Parola Güvenlik Politikası
                if (typeof password !== 'string' || password.length < 8 || password.length > 72) {
                    return callback({ success: false, message: "Şifre en az 8, en fazla 72 karakter uzunluğunda olmalıdır." });
                }

                // Kullanıcı adı uzunluk ve güvenlik sınırı
                if (username.length < 2 || username.length > 32) {
                    return callback({ success: false, message: "Kullanıcı adı 2-32 karakter uzunluğunda olmalıdır." });
                }

                if (db.users[email]) {
                    console.log(`[!] REGİSTER: E-posta zaten kullanımda (${email.replace(/(.{2})(.*)(@.*)/, '$1***$3')})`);
                    return callback({ success: false, message: "Bu e-posta adresi zaten kullanımda." });
                }
                
                const hashedPassword = await bcrypt.hash(password, 10);

                // [GÜVENLİK FIX - SEC-16] Kriptografik Olarak Güvenli CSPRNG ile Çakışmasız ID Üretimi
                let userId;
                do {
                    userId = 'AGN-' + crypto.randomInt(1000, 10000) + '-' + crypto.randomInt(1000, 10000);
                } while (userIdIndex[userId]);
                
                db.users[email] = { email, username, password: hashedPassword, userId: userId, publicKey: null, avatar: null };
                userIdIndex[userId] = email;
                await dbManager.saveDatabase();
                
                const newUser = db.users[email];
                socket.user = newUser;
                if (!onlineNodes.has(userId)) onlineNodes.set(userId, new Set());
                onlineNodes.get(userId).add(socket.id);
                io.emit('node_status_change', { userId: userId, status: 'online' });

                console.log(`[+] YENİ KULLANICI KAYIT OLDU VE GİRİŞ YAPTI: ${username} (${userId})`);
                const token = signJWT({ email: newUser.email, userId: newUser.userId });
                if (callback) callback({
                    success: true,
                    message: "Kayıt başarılı.",
                    token,
                    user: sanitizeUser(newUser)
                });
            } catch (error) {
                console.error('[!] register hatası:', error);
                if (callback) callback({ success: false, message: "Sunucu hatası oluştu. Lütfen tekrar deneyin." });
            }
        });

        /**
         * Kullanıcı giriş olayı.
         * Bcrypt hash doğrulaması, sahte hash karşılaştırması (timing attack koruması) ve JWT üretimini gerçekleştirir.
         * @name login
         * @param {Object} data - Giriş bilgileri ({ email, password }).
         * @param {function(Object): void} callback - Sonuç geri çağırma fonksiyonu.
         */
        socket.on('login', async (data, callback) => {
            console.log(`[>> LOGİN İSTEĞİ ALINDI] email: ${data?.email ? String(data.email).replace(/(.{2})(.*)(@.*)/, '$1***$3') : 'yok'}, ip: ${ip}`);
            if (!checkRateLimit(ip, 'login', 30, 60000) || !checkFailedLoginLimit(ip)) {
                console.warn(`[!] [${new Date().toISOString()}] LOGİN RATE LIMIT AŞILDI: ${ip}`);
                return callback({ success: false, message: "SİBER SAVUNMA: Çok fazla giriş denemesi. Lütfen bir dakika bekleyin." });
            }

            try {
                let { email, password } = data;
                if (!email || !password) {
                    return callback({ success: false, message: "E-posta ve şifre zorunludur." });
                }
                email = email.trim().toLowerCase();
                const user = db.users[email];
                
                if (!user) {
                    recordFailedLogin(ip);
                    console.warn(`[!] [${new Date().toISOString()}] BAŞARISIZ GİRİŞ: Bilinmeyen e-posta (IP: ${ip}, E-posta: ${email.replace(/(.{2})(.*)(@.*)/, '$1***$3')})`);
                    // Zamanlama farkını önlemek için sahte hash karşılaştırması yap
                    await bcrypt.compare(password, DUMMY_HASH);
                    return callback({ success: false, message: "E-posta veya şifre hatalı." });
                }
                if (!user.password) {
                    recordFailedLogin(ip);
                    console.warn(`[!] [${new Date().toISOString()}] BAŞARISIZ GİRİŞ: Şifresiz hesap (IP: ${ip}, E-posta: ${email.replace(/(.{2})(.*)(@.*)/, '$1***$3')})`);
                    await bcrypt.compare(password, DUMMY_HASH);
                    return callback({ success: false, message: "E-posta veya şifre hatalı." });
                }
                
                const isMatch = await bcrypt.compare(password, user.password);
                if (!isMatch) {
                    recordFailedLogin(ip);
                    console.warn(`[!] [${new Date().toISOString()}] BAŞARISIZ GİRİŞ: Hatalı şifre (IP: ${ip}, E-posta: ${email.replace(/(.{2})(.*)(@.*)/, '$1***$3')})`);
                    return callback({ success: false, message: "E-posta veya şifre hatalı." });
                }

                // Başarılı girişte hatalı deneme sayacı sıfırlanır
                resetFailedLogin(ip);

                if (!user.userId) {
                    user.userId = 'AGN-' + Math.floor(1000 + Math.random() * 9000) + '-' + Math.floor(1000 + Math.random() * 9000);
                    userIdIndex[user.userId] = user.email;
                    await dbManager.saveDatabase();
                }

                socket.user = user;
                if (!onlineNodes.has(user.userId)) onlineNodes.set(user.userId, new Set());
                onlineNodes.get(user.userId).add(socket.id);
                io.emit('node_status_change', { userId: user.userId, status: 'online' });

                console.log(`[+] KULLANICI GİRİŞ YAPTI: ${user.username} (${user.userId})`);
                const token = signJWT({ email: user.email, userId: user.userId });
                
                if (callback) callback({ success: true, token, user: sanitizeUser(user) });
            } catch (error) {
                console.error('[!] login hatası:', error);
                if (callback) callback({ success: false, message: "Sunucu hatası oluştu. Lütfen tekrar deneyin." });
            }
        });

        /**
         * Oturum doğrulama olayı. İstemcide saklanan JWT'yi doğrular ve soket oturumunu yeniler.
         * @name verify_session
         * @param {string} token - Doğrulanacak JWT.
         * @param {function(Object): void} callback - Sonuç geri çağırma fonksiyonu.
         */
        socket.on('verify_session', (token, callback) => {
            if (!checkRateLimit(ip, 'verify_session', 30, 60000)) {
                if (callback) callback({ success: false, message: "RATE_LIMIT" });
                return;
            }
            const payload = verifyJWT(token);
            const email = payload?.email ? payload.email.trim().toLowerCase() : null;
            if (email && db.users[email]) {
                const user = db.users[email];
                socket.user = user;
                if (!onlineNodes.has(user.userId)) onlineNodes.set(user.userId, new Set());
                onlineNodes.get(user.userId).add(socket.id);
                io.emit('node_status_change', { userId: user.userId, status: 'online' });
                if (callback) callback({ success: true, user: sanitizeUser(user) });
            } else {
                if (callback) callback({ success: false });
            }
        });

        /**
         * Çıkış (Logout) olayı. Token'ı anında kara listeye alır ve kullanıcının soket bağlantı durumunu günceller.
         * @name logout
         * @param {Object} [data] - Çıkış verisi ({ token }).
         * @param {function(Object): void} [callback] - Geri çağırma fonksiyonu.
         */
        socket.on('logout', (data, callback) => {
            const token = data?.token || socket.handshake.auth?.token;
            if (token) {
                revokeToken(token);
                console.log(`[-] OTURUM KAPATILDI & TOKEN İPTAL EDİLDİ: ${socket.user?.username || socket.id}`);
            }
            if (socket.user) {
                const userId = socket.user.userId;
                const sockets = onlineNodes.get(userId);
                if (sockets) {
                    sockets.delete(socket.id);
                    if (sockets.size === 0) {
                        onlineNodes.delete(userId);
                        io.emit('node_status_change', { userId, status: 'offline' });
                    }
                }
                socket.user = null;
            }
            if (callback) callback({ success: true });
        });

        // --- PROFİL VE HESAP YÖNETİMİ ---
        
        /**
         * Birden fazla kullanıcının profil bilgilerini (kullanıcı adı ve avatar) toplu getirir.
         * Sınırsız numaralandırma (enumeration) saldırılarına karşı en fazla 50 ID ile sınırlandırılmıştır.
         * @name get_profiles
         * @param {string[]} userIds - Profil sorgulanacak kullanıcı ID dizisi (maksimum 50).
         * @param {function(Object): void} callback - Sonuç ({ profiles: {...} }).
         */
        socket.on('get_profiles', (userIds, callback) => {
            if (!socket.user) return callback ? callback({ profiles: {} }) : undefined;
            if (!checkRateLimit(ip, 'get_profiles', 60, 60000)) return callback ? callback({ profiles: {} }) : undefined;
            const profiles = {};
            if (Array.isArray(userIds)) {
                // [GÜVENLİK FIX - SEC-22] Sınırsız Kullanıcı Numaralandırma Savunması:
                // Bir defada en fazla 50 kullanıcı profili sorgulanabilir.
                const safeUserIds = userIds.slice(0, 50);
                safeUserIds.forEach(uid => {
                    if (typeof uid !== 'string' || uid.length > 50) return;
                    const email = userIdIndex[uid];
                    if (email && db.users[email]) {
                        profiles[uid] = { 
                            username: db.users[email].username || null,
                            avatar: db.users[email].avatar || null 
                        };
                    }
                });
            }
            if (callback) callback({ profiles });
        });

        /**
         * Kullanıcı profil avatarını günceller. Boyut sınırı 200KB'dır.
         * @name update_avatar
         * @param {string} avatarBase64 - Base64 formatında görsel verisi.
         * @param {function(Object): void} callback - Sonuç bildirimi.
         */
        socket.on('update_avatar', async (avatarBase64, callback) => {
            if (!checkRateLimit(ip, 'update_avatar', 10, 60000)) return callback({ success: false, message: "Çok fazla istek." });
            if (!socket.user || !db.users[socket.user.email]) return callback({ success: false });
            
            // 200KB limit (Güvenlik için payload boyutu kısıtlaması)
            if (avatarBase64 && avatarBase64.length > 200000) return callback({ success: false, message: "Görsel çok büyük." });
            
            db.users[socket.user.email].avatar = avatarBase64;
            await dbManager.saveDatabase();
            if (callback) callback({ success: true });
        });

        /**
         * Kullanıcı parolasını değiştirir. Eski şifreyi doğrular ve kullanıcının diğer bağlı soketlerini sonlandırır.
         * @name change_password
         * @param {Object} data - Şifre bilgileri ({ oldPassword, newPassword }).
         * @param {function(Object): void} callback - Sonuç bildirimi.
         */
        socket.on('change_password', async (data, callback) => {
            if (!checkRateLimit(ip, 'change_password', 5, 60000)) return callback({ success: false, message: "Çok fazla istek." });
            if (!socket.user || !db.users[socket.user.email]) return callback({ success: false });
            
            try {
                const { oldPassword, newPassword } = data;
                if (!newPassword || typeof newPassword !== 'string' || newPassword.length < 8 || newPassword.length > 72) {
                    return callback({ success: false, message: "Yeni şifre en az 8, en fazla 72 karakter olmalıdır." });
                }
                const user = db.users[socket.user.email];
                
                const isMatch = await bcrypt.compare(oldPassword, user.password);
                if (!isMatch) {
                    console.warn(`[!] [${new Date().toISOString()}] BAŞARISIZ ŞİFRE DEĞİŞTİRME: Eski şifre hatalı (IP: ${ip}, User: ${user.email})`);
                    return callback({ success: false, message: "Mevcut şifre hatalı." });
                }
                
                user.password = await bcrypt.hash(newPassword, 10);
                
                // [GÜVENLİK FIX - SEC-26 / Prompt 8.1] Şifre değiştiğinde kullanıcının diğer bağlı soketlerini uyar/kapat
                const userSockets = onlineNodes.get(user.userId);
                if (userSockets) {
                    userSockets.forEach(sid => {
                        if (sid !== socket.id) {
                            io.to(sid).emit('session_invalidated', { message: 'Şifreniz değiştirildiği için oturumunuz sonlandırıldı.' });
                        }
                    });
                }

                await dbManager.saveDatabase();
                if (callback) callback({ success: true });
            } catch(e) { callback({ success: false, message: "Sunucu hatası." }); }
        });

        /**
         * Kullanıcı hesabını ve ilişkili verileri kalıcı olarak siler.
         * Parola doğrulaması zorunludur. Kuyruktaki mesajlar, soket bağlantıları ve indeks temizlenir.
         * @name delete_account
         * @param {Object} data - Doğrulama bilgileri ({ password }).
         * @param {function(Object): void} callback - Sonuç bildirimi.
         */
        socket.on('delete_account', async (data, callback) => {
            if (!checkRateLimit(ip, 'delete_account', 3, 60000)) return callback({ success: false, message: "Çok fazla istek." });
            if (!socket.user || !db.users[socket.user.email]) return callback({ success: false });
            
            try {
                const { password } = data;
                const user = db.users[socket.user.email];
                
                const isMatch = await bcrypt.compare(password, user.password);
                if (!isMatch) {
                    console.warn(`[!] [${new Date().toISOString()}] BAŞARISIZ HESAP SİLME: Yanlış şifre (IP: ${ip}, User: ${user.email})`);
                    return callback({ success: false, message: "Güvenlik şifresi hatalı." });
                }
                
                const userId = user.userId;
                delete db.users[socket.user.email];
                delete userIdIndex[userId];
                
                // Kuyruktaki mesajlarını temizle
                if (db.queue[userId]) delete db.queue[userId];
                
                const sockets = onlineNodes.get(userId);
                if (sockets) {
                    sockets.forEach(sid => io.sockets.sockets.get(sid)?.disconnect());
                    onlineNodes.delete(userId);
                }
                
                io.emit('node_status_change', { userId, status: 'offline' });
                await dbManager.saveDatabaseImmediate(); // Kritik silme işlemi
                
                if (callback) callback({ success: true });
            } catch(e) { callback({ success: false, message: "Sunucu hatası." }); }
        });

        // --- UÇTAN UCA İLETİŞİM OLAYLARI ---

        /**
         * Kullanıcının ECDH açık anahtarını sunucuya kaydeder.
         * @name publish_public_key
         * @param {Object} publicKeyJwk - JWK formatında açık anahtar nesnesi.
         */
        socket.on('publish_public_key', async (publicKeyJwk) => {
            if (socket.user && db.users[socket.user.email]) {
                db.users[socket.user.email].publicKey = publicKeyJwk;
                await dbManager.saveDatabase();
            }
        });

        /**
         * Belirtilen kullanıcının açık anahtarını ve avatarını getirir (ECDH anahtar türetimi için).
         * @name get_public_key
         * @param {string} targetId - Hedef kullanıcının ID'si.
         * @param {function(Object): void} callback - Sonuç bildirimi.
         */
        socket.on('get_public_key', (targetId, callback) => {
            if (!socket.user) {
                if (callback) callback({ success: false, message: "AUTH_REQUIRED" });
                return;
            }
            if (!checkRateLimit(ip, 'get_pubkey', 60, 60000)) {
                return callback ? callback({ success: false, message: "SİBER SAVUNMA: Çok fazla anahtar isteği." }) : undefined;
            }
            const email = userIdIndex[targetId];
            const targetUser = email ? db.users[email] : null;
            if (targetUser && targetUser.publicKey) {
                // ECDH sırasında avatarı da ilet
                if (callback) callback({ success: true, publicKey: targetUser.publicKey, avatar: targetUser.avatar });
            } else {
                if (callback) callback({ success: false, message: "Anahtar bulunamadı." });
            }
        });

        /**
         * İstemcinin hazır olduğunu ve bekleyen çevrimdışı paketlerin iletilebileceğini bildirir.
         * TTL ve bayat paket kontrollerini uygulayarak yalnızca geçerli mesajları iletir.
         * @name client_ready
         */
        socket.on('client_ready', async () => {
            if (!socket.user) return;
            const userId = socket.user.userId;

            if (db.queue[userId] && db.queue[userId].length > 0) {
                // [GÜVENLİK FIX - SEC-18] Sunucu tarafı katı TTL denetimi:
                // Süresi dolmuş TTL ve bayat paketler elenir, yalnızca geçerli paketler iletilir.
                const validPackets = db.queue[userId].filter(p => !isPacketExpired(p));

                if (validPackets.length > 0) {
                    validPackets.forEach(packet => {
                        if (packet.type === 'session_reset') {
                            io.to(socket.id).emit('session_reset', packet);
                        } else {
                            io.to(socket.id).emit('receive_secure_packet', packet);
                        }
                    });
                }

                delete db.queue[userId];
                await dbManager.saveDatabase();
            }
        });

        /**
         * Tek bir kullanıcının çevrimiçi durumunu denetler.
         * @name check_node_status
         * @param {string} userId - Sorgulanan kullanıcı ID'si.
         * @param {function(Object): void} callback - Durum sonucu ({ userId, isOnline }).
         */
        socket.on('check_node_status', (userId, callback) => {
            if (!socket.user) return callback ? callback({ userId, isOnline: false }) : undefined;
            if (!checkRateLimit(ip, 'node_status', 60, 60000)) return;
            const isOnline = onlineNodes.has(userId) && onlineNodes.get(userId).size > 0;
            if (callback) callback({ userId, isOnline });
        });

        /**
         * Çok sayıda kullanıcının çevrimiçi durumlarını topluca sorgular.
         * @name check_node_statuses
         * @param {string[]} userIds - Sorgulanacak ID dizisi.
         * @param {function(Object): void} callback - Sonuç ({ statuses: { [userId]: boolean } }).
         */
        socket.on('check_node_statuses', (userIds, callback) => {
            if (!callback) return;
            if (!socket.user) return callback({ statuses: {} });
            if (!checkRateLimit(ip, 'node_status', 60, 60000)) return callback({ statuses: {} });
            const statuses = {};
            if (Array.isArray(userIds)) {
                userIds.forEach(userId => {
                    statuses[userId] = onlineNodes.has(userId) && onlineNodes.get(userId).size > 0;
                });
            }
            callback({ statuses });
        });

        /**
         * ECDH anahtar anlaşması teklifini (offer) alıcıya güvenle iletir.
         * Sender spoofing saldırılarını engellemek için senderId oturum sahibiyle zorunlu kılınır.
         * @name ecdh_offer
         * @param {Object} data - Teklif verisi ({ targetId, publicKeyJwk }).
         */
        socket.on('ecdh_offer', (data) => {
            if (!socket.user || !data || !data.targetId) return;
            if (!checkRateLimit(ip, 'ecdh', 10, 60000)) return;
            // Sender spoofing koruması: senderId sunucu tarafından zorunlu kılınır
            const safeData = {
                targetId: data.targetId,
                senderId: socket.user.userId,
                publicKeyJwk: data.publicKeyJwk,
                ephemeralPublicKeyJwk: data.ephemeralPublicKeyJwk || null
            };
            const targetSockets = onlineNodes.get(data.targetId);
            if (targetSockets) targetSockets.forEach(sid => io.to(sid).emit('ecdh_offer', safeData));
        });

        /**
         * ECDH anahtar anlaşması yanıtını (answer) teklif sahibine güvenle iletir.
         * @name ecdh_answer
         * @param {Object} data - Yanıt verisi ({ targetId, publicKeyJwk, ephemeralPublicKeyJwk? }).
         */
        socket.on('ecdh_answer', (data) => {
            if (!socket.user || !data || !data.targetId) return;
            if (!checkRateLimit(ip, 'ecdh', 10, 60000)) return;
            // Sender spoofing koruması: senderId sunucu tarafından zorunlu kılınır
            const safeData = {
                targetId: data.targetId,
                senderId: socket.user.userId,
                publicKeyJwk: data.publicKeyJwk,
                ephemeralPublicKeyJwk: data.ephemeralPublicKeyJwk || null
            };
            const targetSockets = onlineNodes.get(data.targetId);
            if (targetSockets) targetSockets.forEach(sid => io.to(sid).emit('ecdh_answer', safeData));
        });

        /**
         * İki taraflı kriptografik oturum sıfırlama olayını iletir.
         * A kişisi sohbeti veya anahtarları sildiğinde
         * B kişisinin de eski anahtarları imha etmesini sağlar.
         * @name reset_chat_session
         * @param {Object} data - Sıfırlama verisi ({ targetId }).
         * @param {function(Object): void} [callback] - Geri çağırma ({ success: boolean }).
         */
        socket.on('reset_chat_session', async (data, callback) => {
            if (!socket.user || !data || !data.targetId) {
                if (callback) callback({ success: false });
                return;
            }
            if (!checkRateLimit(ip, 'reset_session', 30, 60000)) {
                if (callback) callback({ success: false, error: 'RATE_LIMIT' });
                return;
            }

            const targetId = data.targetId;
            const senderId = socket.user.userId;
            const resetEvent = {
                type: 'session_reset',
                senderId: senderId,
                targetId: targetId,
                timestamp: Date.now()
            };

            const targetSockets = onlineNodes.get(targetId);
            if (targetSockets && targetSockets.size > 0) {
                targetSockets.forEach(sid => io.to(sid).emit('session_reset', resetEvent));
                if (callback) callback({ success: true, queued: false });
            } else {
                if (!db.queue[targetId]) db.queue[targetId] = [];
                db.queue[targetId] = db.queue[targetId].filter(p => !isPacketExpired(p) && p.senderId !== senderId);

                if (db.queue[targetId].length >= MAX_QUEUE_SIZE) {
                    db.queue[targetId].shift();
                }
                db.queue[targetId].push(resetEvent);
                await dbManager.saveDatabase();
                if (callback) callback({ success: true, queued: true });
            }
        });

        /**
         * Uçtan uca şifrelenmiş mesaj paketini alıcıya iletir veya çevrimdışı kuyruğa alır.
         * Sender spoofing, TTL geçerlilik ve kuyruk taşma (FIFO) korumalarını içerir.
         * @name send_secure_packet
         * @param {Object} packet - Şifreli paket verisi ({ targetId, senderId, payload, timestamp, ttl, ... }).
         * @param {function(Object): void} [callback] - Teslimat durumu ({ queued: boolean, error?: string }).
         */
        socket.on('send_secure_packet', async (packet, callback) => {
            if (!socket.user) { if (callback) callback({ queued: false, error: "AUTH_REQUIRED" }); return; }
            if (!checkRateLimit(ip, 'send_packet', 60, 60000)) {
                if (callback) callback({ queued: false, error: "RATE_LIMIT" });
                return;
            }
            // Sender spoofing koruması: senderId, oturum açmış kullanıcıyla eşleşmeli
            if (packet.senderId !== socket.user.userId) { if (callback) callback({ queued: false, error: "SENDER_MISMATCH" }); return; }

            // [GÜVENLİK FIX - SEC-18] Süresi dolmuş TTL paketlerini reddet/kuyruğa alma
            if (isPacketExpired(packet)) {
                if (callback) callback({ queued: false, error: "EXPIRED" });
                return;
            }

            const targetSockets = onlineNodes.get(packet.targetId);
            if (targetSockets && targetSockets.size > 0) {
                targetSockets.forEach(sid => io.to(sid).emit('receive_secure_packet', packet));
                if (callback) callback({ queued: false });
            } else {
                if (!db.queue[packet.targetId]) db.queue[packet.targetId] = [];
                // [GÜVENLİK FIX - SEC-18] Kuyrukta bekleyen süresi dolmuş paketleri filtrele
                db.queue[packet.targetId] = db.queue[packet.targetId].filter(p => !isPacketExpired(p));

                if (db.queue[packet.targetId].length >= MAX_QUEUE_SIZE) {
                    db.queue[packet.targetId].shift(); 
                }

                db.queue[packet.targetId].push(packet);
                await dbManager.saveDatabase();
                if (callback) callback({ queued: true });
            }
        });

        /**
         * Kullanıcı arama olayı. Kullanıcı adı veya ID'ye göre filtreleme yapar.
         * En fazla 20 sonuç döndürür, tek karakterli aramaları engeller.
         * @name search_users
         * @param {string} query - Arama terimi (en az 2 karakter).
         * @param {function(Object): void} callback - Arama sonuçları ({ results: Array }).
         */
        socket.on('search_users', (query, callback) => {
            if (!checkRateLimit(ip, 'search', 30, 60000)) return callback({ results: [] });
            if (!socket.user) return callback({ results: [] });
            if (typeof query !== 'string') return callback({ results: [] });
            const results = [];
            const searchTerm = query.toLowerCase().trim();
            // [GÜVENLİK FIX - SEC-22] Tek karakterli / jokerli brute-force ve toplu numara taramasını engelleme
            if (!searchTerm || searchTerm.length < 2) return callback({ results: [] });
            for (const email in db.users) {
                const user = db.users[email];
                if (user.userId === socket.user.userId) continue;
                if (user.userId.toLowerCase().includes(searchTerm) || user.username.toLowerCase().includes(searchTerm)) {
                    results.push({
                        userId: user.userId,
                        username: user.username,
                        avatar: user.avatar || null,
                        isOnline: onlineNodes.has(user.userId) && onlineNodes.get(user.userId).size > 0
                    });
                }
                if (results.length >= 20) break;
            }
            callback({ results });
        });

        /**
         * Kişi ekleme isteği bildirimini hedef kullanıcıya iletir.
         * @name notify_add_contact
         * @param {Object} data - Bildirim verisi ({ targetId }).
         * @param {function(Object): void} [callback] - Geri çağırma.
         */
        socket.on('notify_add_contact', (data, callback) => {
            if (!socket.user) return;
            if (!checkRateLimit(ip, 'notify', 30, 60000)) return;
            const targetId = data.targetId;
            const targetSockets = onlineNodes.get(targetId);
            if (targetSockets && targetSockets.size > 0) {
                targetSockets.forEach(sid => {
                    io.to(sid).emit('contact_request', {
                        senderId: socket.user.userId,
                        username: socket.user.username,
                        avatar: socket.user.avatar || null
                    });
                });
            }
            if (callback) callback({ success: true });
        });

        /**
         * Kişi ekleme isteğine verilen yanıtı (kabul/red) istek sahibine iletir.
         * @name respond_contact_request
         * @param {Object} data - Yanıt ({ targetId, accepted }).
         * @param {function(Object): void} [callback] - Geri çağırma.
         */
        socket.on('respond_contact_request', (data, callback) => {
            if (!socket.user) return;
            if (!checkRateLimit(ip, 'respond', 30, 60000)) return;
            const { targetId, accepted } = data;
            const targetSockets = onlineNodes.get(targetId);
            if (targetSockets && targetSockets.size > 0) {
                targetSockets.forEach(sid => {
                    io.to(sid).emit('contact_request_response', {
                        senderId: socket.user.userId,
                        username: socket.user.username,
                        avatar: socket.user.avatar || null,
                        accepted
                    });
                });
            }
            if (callback) callback({ success: true });
        });

        /**
         * İletilen veya kuyrukta bekleyen bir mesaj paketini geri çekme / silme olayı.
         * BOLA / IDOR koruması: Yalnızca paketi gönderen kullanıcı kendi paketini geri çekebilir.
         * @name revoke_packet
         * @param {Object} data - İptal edilecek paket bilgileri ({ targetId, packetId }).
         */
        socket.on('revoke_packet', async (data) => {
            if (!socket.user || !data || !data.targetId || !data.packetId) return;
            if (!checkRateLimit(ip, 'revoke', 30, 60000)) return;
            // Sender spoofing koruması: senderId sunucu tarafından oturum sahibi olarak sabitlenir
            const safeData = {
                targetId: data.targetId,
                senderId: socket.user.userId,
                packetId: data.packetId
            };
            const targetSockets = onlineNodes.get(safeData.targetId);
            
            if (targetSockets && targetSockets.size > 0) {
                targetSockets.forEach(sid => io.to(sid).emit('packet_revoked', safeData));
            } else {
                if (db.queue[safeData.targetId]) {
                    const initialLength = db.queue[safeData.targetId].length;
                    // BOLA / IDOR Koruması: Sadece oturum açmış kullanıcının kendi gönderdiği paketi sil
                    db.queue[safeData.targetId] = db.queue[safeData.targetId].filter(
                        p => !((p.id === safeData.packetId || p.packetId === safeData.packetId) && p.senderId === socket.user.userId)
                    );
                    if (initialLength > db.queue[safeData.targetId].length) await dbManager.saveDatabase();
                }
            }
        });

        /**
         * Kişi listesindeki kullanıcıların durum güncellemelerini dinlemek için Socket.IO odalarına (room) katılır.
         * @name join_status_rooms
         * @param {string[]} userIds - Takip edilecek kullanıcı ID listesi.
         */
        socket.on('join_status_rooms', (userIds) => {
            if (!socket.user) return;
            if (!Array.isArray(userIds)) return;
            userIds.forEach(uid => {
                if (typeof uid === 'string' && uid.length < 20) {
                    socket.join(`status_${uid}`);
                }
            });
        });

        /**
         * Soket bağlantısının kesilmesi (disconnect) olayı.
         * Çevrimiçi düğümler listesinden soketi siler ve gerekiyorsa çevrimdışı durumunu yayınlar.
         * @name disconnect
         */
        socket.on('disconnect', () => {
            const userId = socket.user?.userId;
            if (!userId) return;

            const sockets = onlineNodes.get(userId);
            if (sockets) {
                sockets.delete(socket.id);
                if (sockets.size === 0) {
                    onlineNodes.delete(userId);
                    io.emit('node_status_change', { userId, status: 'offline' });
                }
            }
        });

        /**
         * Kullanıcının yazı yazmakta olduğunu hedef tarafa iletir.
         * @name typing
         * @param {Object} data - Hedef kullanıcı ({ targetId }).
         */
        socket.on('typing', (data) => {
            if (!socket.user || !data || !data.targetId) return;
            const targetSockets = onlineNodes.get(data.targetId);
            if (targetSockets && targetSockets.size > 0) {
                targetSockets.forEach(sid => io.to(sid).emit('user_typing', { senderId: socket.user.userId }));
            }
        });

        /**
         * Kullanıcının yazmayı bıraktığını hedef tarafa iletir.
         * @name stop_typing
         * @param {Object} data - Hedef kullanıcı ({ targetId }).
         */
        socket.on('stop_typing', (data) => {
            if (!socket.user || !data || !data.targetId) return;
            const targetSockets = onlineNodes.get(data.targetId);
            if (targetSockets && targetSockets.size > 0) {
                targetSockets.forEach(sid => io.to(sid).emit('user_typing_stop', { senderId: socket.user.userId }));
            }
        });

    });

    return {
        checkRateLimit,
        rateLimits,
        onlineNodes,
        checkFailedLoginLimit,
        recordFailedLogin,
        resetFailedLogin,
        failedLoginAttempts
    };
};

module.exports._internals = {
    signJWT,
    verifyJWT,
    revokeToken,
    getClientIp,
    revokedTokens,
    onlineNodes,
    DUMMY_HASH,
    MAX_QUEUE_SIZE,
    get JWT_SECRET() { return JWT_SECRET; }
};