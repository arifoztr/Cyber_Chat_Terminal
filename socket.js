const bcrypt = require('bcrypt');
const crypto = require('crypto');
const dbManager = require('./database');

const MAX_QUEUE_SIZE = 50;
const onlineNodes = new Map();

// [FAZ 1 - FIX] JWT GİZLİ ANAHTARI — Güvenli Fallback Hiyerarşisi
let JWT_SECRET;
if (process.env.JWT_SECRET) {
    JWT_SECRET = process.env.JWT_SECRET;
} else if (process.env.NODE_ENV === 'production') {
    // Üretim ortamında .env yoksa rastgele geçici anahtar üret ve uyar
    JWT_SECRET = require('crypto').randomBytes(32).toString('hex');
    console.error('╔══════════════════════════════════════════════════════════╗');
    console.error('║  [!] KRİTİK: JWT_SECRET ortam değişkeni tanımlı değil! ║');
    console.error('║  Geçici rastgele anahtar üretildi.                      ║');
    console.error('║  Sunucu yeniden başlatılırsa mevcut oturumlar geçersiz   ║');
    console.error('║  olacaktır. Lütfen .env dosyasına JWT_SECRET ekleyin.    ║');
    console.error('╚══════════════════════════════════════════════════════════╝');
} else {
    // Yalnızca geliştirme ortamında sabit anahtar kullanılır
    JWT_SECRET = 'CYBER_HUD_DEV_SECRET_KEY_DO_NOT_USE_IN_PROD';
    console.warn('[⚠] JWT_SECRET .env dosyasında tanımlı değil — geliştirme anahtarı kullanılıyor.');
}

// Basit Bağımlılıksız JWT Üretimi
function signJWT(payload) {
    const header = Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT' })).toString('base64url');
    const body = Buffer.from(JSON.stringify({ ...payload, exp: Date.now() + 24 * 60 * 60 * 1000 })).toString('base64url');
    const signature = crypto.createHmac('sha256', JWT_SECRET).update(`${header}.${body}`).digest('base64url');
    return `${header}.${body}.${signature}`;
}

// Basit Bağımlılıksız JWT Doğrulaması
function verifyJWT(token) {
    try {
        const [header, body, signature] = token.split('.');
        const expectedSig = crypto.createHmac('sha256', JWT_SECRET).update(`${header}.${body}`).digest('base64url');
        if (signature !== expectedSig) return null;
        const payload = JSON.parse(Buffer.from(body, 'base64url').toString());
        if (payload.exp < Date.now()) return null;
        return payload;
    } catch (e) { return null; }
}

// [FIX] Proxy arkasında güvenli IP çıkarma yardımcısı
function getClientIp(socket) {
    const forwarded = socket.handshake.headers['x-forwarded-for'];
    if (forwarded) {
        // İlk IP gerçek istemci IP'sidir (virgülle ayrılmış liste)
        return forwarded.split(',')[0].trim();
    }
    return socket.handshake.address;
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
            console.log(`[>> REGİSTER İSTEĞİ ALINDI] email: ${data?.email}, user: ${data?.username}, ip: ${ip}`);
            if (!checkRateLimit(ip, 'register', 20, 60000)) {
                console.warn(`[!] REGİSTER RATE LIMIT AŞILDI: ${ip}`);
                return callback({ success: false, message: "SİBER SAVUNMA: Çok fazla kayıt denemesi. Lütfen bir dakika bekleyin." });
            }

            try {
                const { email, password, username } = data;
                if (!email || !password || !username) {
                    return callback({ success: false, message: "Tüm alanlar zorunludur." });
                }
                if (db.users[email]) {
                    console.log(`[!] REGİSTER: E-posta zaten kullanımda (${email})`);
                    return callback({ success: false, message: "Bu e-posta adresi zaten kullanımda." });
                }
                
                const hashedPassword = await bcrypt.hash(password, 10);
                const userId = 'AGN-' + Math.floor(1000 + Math.random() * 9000) + '-' + Math.floor(1000 + Math.random() * 9000);
                
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
                if (callback) callback({ success: false, message: "Sunucu hatası: " + error.message });
            }
        });

        socket.on('login', async (data, callback) => {
            console.log(`[>> LOGİN İSTEĞİ ALINDI] email: ${data?.email}, ip: ${ip}`);
            if (!checkRateLimit(ip, 'login', 30, 60000)) {
                console.warn(`[!] LOGİN RATE LIMIT AŞILDI: ${ip}`);
                return callback({ success: false, message: "SİBER SAVUNMA: Çok fazla giriş denemesi. Lütfen bir dakika bekleyin." });
            }

            try {
                const { email, password } = data;
                if (!email || !password) {
                    return callback({ success: false, message: "E-posta ve şifre zorunludur." });
                }
                const user = db.users[email];
                
                if (!user) {
                    console.log(`[!] LOGİN: Kullanıcı bulunamadı (${email})`);
                    return callback({ success: false, message: "Kullanıcı bulunamadı." });
                }
                if (!user.password) {
                    return callback({ success: false, message: "Eski tip hesap. Yeni hesap açın." });
                }
                
                const isMatch = await bcrypt.compare(password, user.password);
                if (!isMatch) {
                    console.log(`[!] LOGİN: Hatalı şifre (${email})`);
                    return callback({ success: false, message: "Hatalı şifre." });
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
                if (callback) callback({ success: false, message: "Sunucu hatası: " + error.message });
            }
        });

        socket.on('verify_session', (token, callback) => {
            const payload = verifyJWT(token);
            if (payload && db.users[payload.email]) {
                const user = db.users[payload.email];
                socket.user = user;
                if (!onlineNodes.has(user.userId)) onlineNodes.set(user.userId, new Set());
                onlineNodes.get(user.userId).add(socket.id);
                io.emit('node_status_change', { userId: user.userId, status: 'online' });
                if (callback) callback({ success: true, user: { email: user.email, username: user.username, userId: user.userId, avatar: user.avatar } });
            } else {
                if (callback) callback({ success: false });
            }
        });

        // --- PROFİL VE HESAP YÖNETİMİ ---
        
        socket.on('get_profiles', (userIds, callback) => {
            if (!checkRateLimit(ip, 'get_profiles', 60, 60000)) return callback({ profiles: {} });
            const profiles = {};
            if (Array.isArray(userIds)) {
                userIds.forEach(uid => {
                    const email = userIdIndex[uid];
                    if (email && db.users[email]) {
                        profiles[uid] = { avatar: db.users[email].avatar || null };
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
            if (!checkRateLimit(ip, 'get_pubkey', 60, 60000)) {
                return callback({ success: false, message: "SİBER SAVUNMA: Çok fazla anahtar isteği." });
            }
            const email = userIdIndex[targetId];
            const targetUser = email ? db.users[email] : null;
            if (targetUser && targetUser.publicKey) {
                // ECDH sırasında avatarı da ilet
                callback({ success: true, publicKey: targetUser.publicKey, avatar: targetUser.avatar });
            } else {
                callback({ success: false, message: "Anahtar bulunamadı." });
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
            if (!checkRateLimit(ip, 'node_status', 60, 60000)) return;
            const isOnline = onlineNodes.has(userId) && onlineNodes.get(userId).size > 0;
            if (callback) callback({ userId, isOnline });
        });

        socket.on('check_node_statuses', (userIds, callback) => {
            if (!callback) return;
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
            if (!socket.user) return;
            if (!checkRateLimit(ip, 'ecdh', 10, 60000)) return;
            const targetSockets = onlineNodes.get(data.targetId);
            if (targetSockets) targetSockets.forEach(sid => io.to(sid).emit('ecdh_offer', data));
        });

        socket.on('ecdh_answer', (data) => {
            if (!socket.user) return;
            if (!checkRateLimit(ip, 'ecdh', 10, 60000)) return;
            const targetSockets = onlineNodes.get(data.targetId);
            if (targetSockets) targetSockets.forEach(sid => io.to(sid).emit('ecdh_answer', data));
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
            if (!socket.user) return;
            if (!checkRateLimit(ip, 'revoke', 30, 60000)) return;
            // Sender spoofing koruması: yalnızca kendi mesajını iptal edebilir
            if (data.senderId !== socket.user.userId) return;
            const targetSockets = onlineNodes.get(data.targetId);
            
            if (targetSockets && targetSockets.size > 0) {
                targetSockets.forEach(sid => io.to(sid).emit('packet_revoked', data));
            } else {
                if (db.queue[data.targetId]) {
                    const initialLength = db.queue[data.targetId].length;
                    db.queue[data.targetId] = db.queue[data.targetId].filter(
                        p => p.id !== data.packetId && p.packetId !== data.packetId
                    );
                    if (initialLength > db.queue[data.targetId].length) await dbManager.saveDatabase();
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