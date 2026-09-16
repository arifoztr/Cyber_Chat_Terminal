const fs = require('fs');
const path = require('path');
const sqlite3 = require('sqlite3').verbose();

const dbPath = process.env.DB_PATH || path.join(__dirname, 'database.sqlite');
const legacyJsonPath = path.join(__dirname, 'database.json');
const backupJsonPath = path.join(__dirname, 'database.json.backup');

// Eğer DB_PATH için özel bir dizin belirtilmişse ve dizin yoksa oluştur
const dbDir = path.dirname(dbPath);
if (!fs.existsSync(dbDir)) {
    try {
        fs.mkdirSync(dbDir, { recursive: true });
    } catch (e) {
        console.error('[!] Veritabanı dizini oluşturulamadı:', e);
    }
}

// Sabit Limitler
const MAX_PACKET_AGE_MS = 7 * 24 * 60 * 60 * 1000; // 7 Gün

// Bellek İçi Veri Durumu (State)
const db = { users: {}, queue: {} };
const userIdIndex = {};

// SQLite Veritabanı Örneği
let sqliteDb = null;

// Gecikmeli Yazma (Debounce) ve Kilit (Lock) Mekanizmaları
let _saveTimer = null;
let _pendingResolvers = [];
let _writeLock = Promise.resolve();

// Referansları güvenli bir şekilde dışarı açıyoruz
function getDB() { return db; }
function getUserIdIndex() { return userIdIndex; }

// Promise Tabanlı SQLite Wrapper Fonksiyonları
function dbRun(sql, params = []) {
    return new Promise((resolve, reject) => {
        if (!sqliteDb) return reject(new Error("Veritabanı başlatılmadı"));
        sqliteDb.run(sql, params, function(err) {
            if (err) reject(err);
            else resolve(this);
        });
    });
}

function dbGet(sql, params = []) {
    return new Promise((resolve, reject) => {
        if (!sqliteDb) return reject(new Error("Veritabanı başlatılmadı"));
        sqliteDb.get(sql, params, (err, row) => {
            if (err) reject(err);
            else resolve(row);
        });
    });
}

function dbAll(sql, params = []) {
    return new Promise((resolve, reject) => {
        if (!sqliteDb) return reject(new Error("Veritabanı başlatılmadı"));
        sqliteDb.all(sql, params, (err, rows) => {
            if (err) reject(err);
            else resolve(rows);
        });
    });
}

// O(n) taramayı O(1) yapan Index oluşturucu - SQLite'dan çeker
async function rebuildUserIdIndex() {
    try {
        const rows = await dbAll(`SELECT userId, email FROM users`);
        // Mevcut objeyi temizle (referansı bozmadan)
        Object.keys(userIdIndex).forEach(k => delete userIdIndex[k]);
        for (const row of rows) {
            if (row.userId && row.email) {
                userIdIndex[row.userId] = row.email;
            }
        }
    } catch (e) {
        console.error('[!] rebuildUserIdIndex hatası:', e);
    }
}

// Bellek içi durumu SQLite ile senkronize eden dahili yardımcı fonksiyon
async function syncMemoryToSql() {
    await dbRun('BEGIN TRANSACTION');
    try {
        // 1. Kullanıcıları kaydet/güncelle
        for (const email in db.users) {
            const u = db.users[email];
            if (!u.userId) {
                u.userId = 'AGN-' + Math.floor(1000 + Math.random() * 9000) + '-' + Math.floor(1000 + Math.random() * 9000);
            }
            await dbRun(
                `INSERT INTO users (email, username, password, userId, publicKey, avatar)
                 VALUES (?, ?, ?, ?, ?, ?)
                 ON CONFLICT(email) DO UPDATE SET
                    username=excluded.username,
                    password=excluded.password,
                    userId=excluded.userId,
                    publicKey=excluded.publicKey,
                    avatar=excluded.avatar`,
                [
                    u.email,
                    u.username,
                    u.password,
                    u.userId,
                    u.publicKey ? JSON.stringify(u.publicKey) : null,
                    u.avatar || null
                ]
            );
        }

        // Bellekte silinmiş kullanıcıları SQLite'tan temizle
        const emails = Object.keys(db.users);
        if (emails.length > 0) {
            const placeholders = emails.map(() => '?').join(',');
            await dbRun(`DELETE FROM users WHERE email NOT IN (${placeholders})`, emails);
        } else {
            await dbRun(`DELETE FROM users`);
        }

        // 2. Çevrimdışı mesaj kuyruğunu senkronize et
        await dbRun(`DELETE FROM queue`);
        for (const targetId in db.queue) {
            const packets = db.queue[targetId] || [];
            for (const p of packets) {
                await dbRun(
                    `INSERT INTO queue (targetId, packet, timestamp) VALUES (?, ?, ?)`,
                    [targetId, JSON.stringify(p), p.timestamp || Date.now()]
                );
            }
        }

        await dbRun('COMMIT');
    } catch (e) {
        try { await dbRun('ROLLBACK'); } catch (_) {}
        throw e;
    }
}

// Asenkron ve Debounce edilmiş kayıt işlemi
function saveDatabase() {
    return new Promise((resolve) => {
        _pendingResolvers.push(resolve);
        if (_saveTimer) return;
        
        _saveTimer = setTimeout(async () => {
            _saveTimer = null;
            const resolvers = _pendingResolvers.splice(0);
            let writeError = null;
            
            _writeLock = _writeLock.then(async () => {
                try {
                    await syncMemoryToSql();
                    await rebuildUserIdIndex();
                } catch (e) {
                    console.error('[!] Veritabanı yazma hatası:', e);
                    writeError = e;
                }
            });
            
            await _writeLock;
            resolvers.forEach(r => r(writeError));
        }, 50);
    });
}

// Kritik anlar için anında diske yazma işlemi (Örn: Çıkış yaparken)
async function saveDatabaseImmediate() {
    if (_saveTimer) { clearTimeout(_saveTimer); _saveTimer = null; }
    const resolvers = _pendingResolvers.splice(0);
    let writeError = null;
    
    _writeLock = _writeLock.then(async () => {
        try {
            await syncMemoryToSql();
            await rebuildUserIdIndex();
        } catch (e) {
            console.error('[!] Veritabanı yazma hatası (immediate):', e);
            writeError = e;
        }
    });
    
    await _writeLock;
    resolvers.forEach(r => r(writeError));
    if (writeError) throw writeError;
}

// Veritabanını diski okuyarak başlat
async function initDB() {
    // 1. SQLite veritabanı dosyasını aç/oluştur
    await new Promise((resolve, reject) => {
        sqliteDb = new sqlite3.Database(dbPath, (err) => {
            if (err) reject(err);
            else resolve();
        });
    });

    // 2. WAL modunu aktif et
    await dbRun('PRAGMA journal_mode = WAL;');

    // 3. Tabloları oluştur
    await dbRun(`
        CREATE TABLE IF NOT EXISTS users (
            email TEXT PRIMARY KEY,
            username TEXT NOT NULL,
            password TEXT NOT NULL,
            userId TEXT UNIQUE NOT NULL,
            publicKey TEXT,
            avatar TEXT,
            createdAt INTEGER DEFAULT (unixepoch())
        );
    `);

    await dbRun(`
        CREATE TABLE IF NOT EXISTS queue (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            targetId TEXT NOT NULL,
            packet TEXT NOT NULL,
            timestamp INTEGER NOT NULL,
            FOREIGN KEY (targetId) REFERENCES users(userId) ON DELETE CASCADE
        );
    `);

    // 4. İndeksleri oluştur
    await dbRun(`CREATE INDEX IF NOT EXISTS idx_queue_targetId ON queue(targetId);`);
    await dbRun(`CREATE INDEX IF NOT EXISTS idx_queue_timestamp ON queue(timestamp);`);
    await dbRun(`CREATE INDEX IF NOT EXISTS idx_users_userId ON users(userId);`);

    // 5. Migration (Tek Seferlik)
    const row = await dbGet(`SELECT COUNT(*) AS count FROM users`);
    const userCount = row ? row.count : 0;

    if (userCount === 0) {
        if (fs.existsSync(legacyJsonPath)) {
            try {
                const fileContent = fs.readFileSync(legacyJsonPath, 'utf8');
                if (fileContent && fileContent.trim() !== '') {
                    const parsed = JSON.parse(fileContent);
                    const usersObj = parsed.users || {};
                    const queueObj = parsed.queue || {};

                    await dbRun('BEGIN TRANSACTION');
                    for (const email in usersObj) {
                        const u = usersObj[email];
                        if (!u.userId) {
                            u.userId = 'AGN-' + Math.floor(1000 + Math.random() * 9000) + '-' + Math.floor(1000 + Math.random() * 9000);
                        }
                        await dbRun(
                            `INSERT INTO users (email, username, password, userId, publicKey, avatar)
                             VALUES (?, ?, ?, ?, ?, ?)`,
                            [
                                u.email || email,
                                u.username || 'User',
                                u.password || '',
                                u.userId,
                                u.publicKey ? JSON.stringify(u.publicKey) : null,
                                u.avatar || null
                            ]
                        );
                    }

                    for (const targetId in queueObj) {
                        const packets = queueObj[targetId] || [];
                        for (const p of packets) {
                            await dbRun(
                                `INSERT INTO queue (targetId, packet, timestamp) VALUES (?, ?, ?)`,
                                [targetId, JSON.stringify(p), p.timestamp || Date.now()]
                            );
                        }
                    }
                    await dbRun('COMMIT');
                    console.log("[+] Eski database.json verileri SQLite veritabanına başarıyla aktarıldı.");
                }

                // database.json dosyasını yedekle
                fs.renameSync(legacyJsonPath, backupJsonPath);
                console.log("[+] Eski database.json dosyası database.json.backup olarak yedeklendi.");
            } catch (e) {
                console.error("[!] Migration işlemi sırasında hata oluştu:", e);
                try { await dbRun('ROLLBACK'); } catch (_) {}
            }
        }
    }

    // 6. SQLite verilerini bellek içi duruma (cache) yükle
    const userRows = await dbAll(`SELECT * FROM users`);
    for (const key in db.users) delete db.users[key];
    for (const r of userRows) {
        db.users[r.email] = {
            email: r.email,
            username: r.username,
            password: r.password,
            userId: r.userId,
            publicKey: r.publicKey ? JSON.parse(r.publicKey) : null,
            avatar: r.avatar
        };
    }

    const queueRows = await dbAll(`SELECT * FROM queue`);
    for (const key in db.queue) delete db.queue[key];
    for (const r of queueRows) {
        if (!db.queue[r.targetId]) {
            db.queue[r.targetId] = [];
        }
        db.queue[r.targetId].push(JSON.parse(r.packet));
    }

    // 7. Index'i yeniden inşa et
    await rebuildUserIdIndex();
}

// Arka planda çalışan çöp toplayıcı (Garbage Collector) - Her saat başı eski mesajları siler
function startGarbageCollector() {
    setInterval(async () => {
        try {
            const expireTime = Date.now() - MAX_PACKET_AGE_MS;
            await dbRun(`DELETE FROM queue WHERE timestamp < ?`, [expireTime]);
            console.log(`[PERİYODİK TEMİZLİK] Zaman aşımına uğramış çevrimdışı paketler SQLite'tan temizlendi.`);

            // Bellek içi durumu güncelle
            const queueRows = await dbAll(`SELECT * FROM queue`);
            for (const key in db.queue) delete db.queue[key];
            for (const r of queueRows) {
                if (!db.queue[r.targetId]) {
                    db.queue[r.targetId] = [];
                }
                db.queue[r.targetId].push(JSON.parse(r.packet));
            }
        } catch (e) {
            console.error('[!] Garbage Collector hatası:', e);
        }
    }, 60 * 60 * 1000); // 1 Saat
}

module.exports = {
    getDB,
    getUserIdIndex,
    saveDatabase,
    saveDatabaseImmediate,
    rebuildUserIdIndex,
    initDB,
    startGarbageCollector,
    MAX_PACKET_AGE_MS
};