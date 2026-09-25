const bcrypt = require('bcrypt');
const crypto = require('crypto');
const dbManager = require('./database');

const MAX_QUEUE_SIZE = 50;
const onlineNodes = new Map();

// Timing analizi ve kullanıcı sayımı (user enumeration) saldırılarını önlemek için sahte hash
const DUMMY_HASH = '$2b$10$7EqJtq98hPqEX7fNZaFWoO0VpIxFk3E9V2bJgN1Jt3kR0n3X2m2Xe';

// [GÜVENLİK FIX - SEC-12] JWT Gizli Anahtarı — Sabit anahtar kaldırıldı, CSPRNG ile rastgele anahtar üretimi
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

// [GÜVENLİK] Çıkış yapılan (revoke edilmiş) token'ların kara listesi
const revokedTokens = new Map(); // token -> expireTimestampMs

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

// RFC 7519 Uyumlu Güvenli JWT Üretimi (exp saniye cinsindendir)
function signJWT(payload) {
    const nowSec = Math.floor(Date.now() / 1000);
    const header = Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT' })).toString('base64url');
    const body = Buffer.from(JSON.stringify({
        ...payload,
        iat: nowSec,
        exp: nowSec + 24 * 60 * 60 // 24 saat
    })).toString('base64url');
    const signature = crypto.createHmac('sha256', JWT_SECRET).update(`${header}.${body}`).digest('base64url');
    return `${header}.${body}.${signature}`;
}

// Güvenli JWT Doğrulaması (Zamanlama Saldırısı Korumalı & Kara Liste Kontrollü)
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

// [GÜVENLİK FIX - SEC-07] Güvenli IP Çıkarma — Sahte X-Forwarded-For Başlığı ile Rate Limit Atlama Savunması
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

module.exports = function setupSockets(io) {
    const db = dbManager.getDB();
    const userIdIndex = dbManager.getUserIdIndex();

    // [FAZ 1] RATE LIMITER (Hız Sınırlandırma)
    const rateLimits = new Map();
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

    // Rate Limiter Çöp Toplayıcısı
    setInterval(() => {
        const now = Date.now();
        for (const [key, record] of rateLimits.entries()) {
            if (now > record.resetAt) rateLimits.delete(key);
        }
    }, 60000);

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
                    user: { email: newUser.email, username: newUser.username, userId: newUser.userId, avatar: newUser.avatar }
                });
            } catch (error) {
                console.error('[!] register hatası:', error);
                if (callback) callback({ success: false, message: "Sunucu hatası oluştu. Lütfen tekrar deneyin." });
            }
        });

        socket.on('login', async (data, callback) => {
            console.log(`[>> LOGİN İSTEĞİ ALINDI] email: ${data?.email ? String(data.email).replace(/(.{2})(.*)(@.*)/, '$1***$3') : 'yok'}, ip: ${ip}`);
            if (!checkRateLimit(ip, 'login', 30, 60000)) {
                console.warn(`[!] LOGİN RATE LIMIT AŞILDI: ${ip}`);
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
                    console.log(`[!] LOGİN: Başarısız kimlik doğrulama (${email})`);
                    // Zamanlama farkını önlemek için sahte hash karşılaştırması yap
                    await bcrypt.compare(password, DUMMY_HASH);
                    return callback({ success: false, message: "E-posta veya şifre hatalı." });
                }
                if (!user.password) {
                    await bcrypt.compare(password, DUMMY_HASH);
                    return callback({ success: false, message: "E-posta veya şifre hatalı." });
                }
                
                const isMatch = await bcrypt.compare(password, user.password);
                if (!isMatch) {
                    console.log(`[!] LOGİN: Başarısız kimlik doğrulama (${email})`);
                    return callback({ success: false, message: "E-posta veya şifre hatalı." });
                }

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
                
                if (callback) callback({ success: true, token, user: { email: user.email, username: user.username, userId: user.userId, avatar: user.avatar } });
            } catch (error) {
                console.error('[!] login hatası:', error);
                if (callback) callback({ success: false, message: "Sunucu hatası oluştu. Lütfen tekrar deneyin." });
            }
        });

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
                if (callback) callback({ success: true, user: { email: user.email, username: user.username, userId: user.userId, avatar: user.avatar } });
            } else {
                if (callback) callback({ success: false });
            }
        });

        // [GÜVENLİK] Çıkış Olayı: Token'ı anında kara listeye alarak geçersiz kılar
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
        
        socket.on('get_profiles', (userIds, callback) => {
            if (!socket.user) return callback ? callback({ profiles: {} }) : undefined;
            if (!checkRateLimit(ip, 'get_profiles', 60, 60000)) return callback ? callback({ profiles: {} }) : undefined;
            const profiles = {};
            if (Array.isArray(userIds)) {
                userIds.forEach(uid => {
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

        socket.on('update_avatar', async (avatarBase64, callback) => {
            if (!checkRateLimit(ip, 'update_avatar', 10, 60000)) return callback({ success: false, message: "Çok fazla istek." });
            if (!socket.user || !db.users[socket.user.email]) return callback({ success: false });
            
            // 200KB limit (Güvenlik için payload boyutu kısıtlaması)
            if (avatarBase64 && avatarBase64.length > 200000) return callback({ success: false, message: "Görsel çok büyük." });
            
            db.users[socket.user.email].avatar = avatarBase64;
            await dbManager.saveDatabase();
            if (callback) callback({ success: true });
        });

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
                if (!isMatch) return callback({ success: false, message: "Mevcut şifre hatalı." });
                
                user.password = await bcrypt.hash(newPassword, 10);
                await dbManager.saveDatabase();
                if (callback) callback({ success: true });
            } catch(e) { callback({ success: false, message: "Sunucu hatası." }); }
        });

        socket.on('delete_account', async (data, callback) => {
            if (!checkRateLimit(ip, 'delete_account', 3, 60000)) return callback({ success: false, message: "Çok fazla istek." });
            if (!socket.user || !db.users[socket.user.email]) return callback({ success: false });
            
            try {
                const { password } = data;
                const user = db.users[socket.user.email];
                
                const isMatch = await bcrypt.compare(password, user.password);
                if (!isMatch) return callback({ success: false, message: "Güvenlik şifresi hatalı." });
                
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

        socket.on('publish_public_key', async (publicKeyJwk) => {
            if (socket.user && db.users[socket.user.email]) {
                db.users[socket.user.email].publicKey = publicKeyJwk;
                await dbManager.saveDatabase();
            }
        });

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

        socket.on('client_ready', async () => {
            if (!socket.user) return;
            const userId = socket.user.userId;

            if (db.queue[userId] && db.queue[userId].length > 0) {
                const validPackets = db.queue[userId].filter(
                    p => !p.timestamp || (Date.now() - p.timestamp) < dbManager.MAX_PACKET_AGE_MS
                );

                if (validPackets.length > 0) {
                    validPackets.forEach(packet => { io.to(socket.id).emit('receive_secure_packet', packet); });
                }

                delete db.queue[userId];
                await dbManager.saveDatabase();
            }
        });

        socket.on('check_node_status', (userId, callback) => {
            if (!socket.user) return callback ? callback({ userId, isOnline: false }) : undefined;
            if (!checkRateLimit(ip, 'node_status', 60, 60000)) return;
            const isOnline = onlineNodes.has(userId) && onlineNodes.get(userId).size > 0;
            if (callback) callback({ userId, isOnline });
        });

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

        socket.on('ecdh_offer', (data) => {
            if (!socket.user || !data || !data.targetId) return;
            if (!checkRateLimit(ip, 'ecdh', 10, 60000)) return;
            // Sender spoofing koruması: senderId sunucu tarafından zorunlu kılınır
            const safeData = {
                targetId: data.targetId,
                senderId: socket.user.userId,
                publicKeyJwk: data.publicKeyJwk
            };
            const targetSockets = onlineNodes.get(data.targetId);
            if (targetSockets) targetSockets.forEach(sid => io.to(sid).emit('ecdh_offer', safeData));
        });

        socket.on('ecdh_answer', (data) => {
            if (!socket.user || !data || !data.targetId) return;
            if (!checkRateLimit(ip, 'ecdh', 10, 60000)) return;
            // Sender spoofing koruması: senderId sunucu tarafından zorunlu kılınır
            const safeData = {
                targetId: data.targetId,
                senderId: socket.user.userId,
                publicKeyJwk: data.publicKeyJwk
            };
            const targetSockets = onlineNodes.get(data.targetId);
            if (targetSockets) targetSockets.forEach(sid => io.to(sid).emit('ecdh_answer', safeData));
        });

        socket.on('send_secure_packet', async (packet, callback) => {
            if (!socket.user) { if (callback) callback({ queued: false, error: "AUTH_REQUIRED" }); return; }
            if (!checkRateLimit(ip, 'send_packet', 60, 60000)) {
                if (callback) callback({ queued: false, error: "RATE_LIMIT" });
                return;
            }
            // Sender spoofing koruması: senderId, oturum açmış kullanıcıyla eşleşmeli
            if (packet.senderId !== socket.user.userId) { if (callback) callback({ queued: false, error: "SENDER_MISMATCH" }); return; }

            const targetSockets = onlineNodes.get(packet.targetId);
            if (targetSockets && targetSockets.size > 0) {
                targetSockets.forEach(sid => io.to(sid).emit('receive_secure_packet', packet));
                if (callback) callback({ queued: false });
            } else {
                if (!db.queue[packet.targetId]) db.queue[packet.targetId] = [];
                db.queue[packet.targetId] = db.queue[packet.targetId].filter(
                    p => !p.timestamp || (Date.now() - p.timestamp) < dbManager.MAX_PACKET_AGE_MS
                );

                if (db.queue[packet.targetId].length >= MAX_QUEUE_SIZE) {
                    db.queue[packet.targetId].shift(); 
                }

                db.queue[packet.targetId].push(packet);
                await dbManager.saveDatabase();
                if (callback) callback({ queued: true });
            }
        });

        socket.on('search_users', (query, callback) => {
            if (!checkRateLimit(ip, 'search', 30, 60000)) return callback({ results: [] });
            if (!socket.user) return callback({ results: [] });
            const results = [];
            const searchTerm = (query || '').toLowerCase().trim();
            if (!searchTerm) return callback({ results: [] });
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

        // Client'ın kişi listesi için Socket.IO room'larına katılım
        socket.on('join_status_rooms', (userIds) => {
            if (!socket.user) return;
            if (!Array.isArray(userIds)) return;
            userIds.forEach(uid => {
                if (typeof uid === 'string' && uid.length < 20) {
                    socket.join(`status_${uid}`);
                }
            });
        });

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

        socket.on('typing', (data) => {
            if (!socket.user || !data || !data.targetId) return;
            const targetSockets = onlineNodes.get(data.targetId);
            if (targetSockets && targetSockets.size > 0) {
                targetSockets.forEach(sid => io.to(sid).emit('user_typing', { senderId: socket.user.userId }));
            }
        });

        socket.on('stop_typing', (data) => {
            if (!socket.user || !data || !data.targetId) return;
            const targetSockets = onlineNodes.get(data.targetId);
            if (targetSockets && targetSockets.size > 0) {
                targetSockets.forEach(sid => io.to(sid).emit('user_typing_stop', { senderId: socket.user.userId }));
            }
        });

    });
};