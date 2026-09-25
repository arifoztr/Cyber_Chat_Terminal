const fs = require('fs');
const path = require('path');

// Turso Bulut SQLite veya yerel SQLite seçimi
// TURSO_DATABASE_URL ve TURSO_AUTH_TOKEN tanımlıysa Turso kullanılır
const TURSO_URL = process.env.TURSO_DATABASE_URL;
const TURSO_TOKEN = process.env.TURSO_AUTH_TOKEN;
const USE_TURSO = !!(TURSO_URL && TURSO_TOKEN);

// Yerel SQLite yapılandırması (sadece Turso yokken yüklenir)
let sqlite3 = null;
let sqliteDb = null;
let tursoClient = null;

const dbPath = process.env.DB_PATH || path.join(__dirname, 'database.sqlite');
const legacyJsonPath = path.join(__dirname, 'database.json');
const backupJsonPath = path.join(__dirname, 'database.json.backup');

// Yerel mod için dizin oluştur
if (!USE_TURSO) {
    sqlite3 = require('sqlite3').verbose();
    const dbDir = path.dirname(dbPath);
    if (!fs.existsSync(dbDir)) {
        try { fs.mkdirSync(dbDir, { recursive: true }); }
        catch (e) { console.error('[!] Veritabanı dizini oluşturulamadı:', e); }
    }
}

// Sabit Limitler
const MAX_PACKET_AGE_MS = 7 * 24 * 60 * 60 * 1000; // 7 Gün

// Bellek İçi Veri Durumu (State)
const db = { users: {}, queue: {} };
const userIdIndex = {};

// Gecikmeli Yazma (Debounce) ve Kilit (Lock) Mekanizmaları
let _saveTimer = null;
let _pendingResolvers = [];
let _writeLock = Promise.resolve();

function getDB() { return db; }
function getUserIdIndex() { return userIdIndex; }

// ── TURSO WRAPPER FONKSİYONLARI ─────────────────────────────────────
async function tursoRun(sql, params = []) {
    return await tursoClient.execute({ sql, args: params });
}

async function tursoGet(sql, params = []) {
    const result = await tursoClient.execute({ sql, args: params });
    if (!result.rows.length) return undefined;
    const obj = {};
    result.columns.forEach((col, i) => { obj[col] = result.rows[0][i]; });
    return obj;
}

async function tursoAll(sql, params = []) {
    const result = await tursoClient.execute({ sql, args: params });
    return result.rows.map(row => {
        const obj = {};
        result.columns.forEach((col, i) => { obj[col] = row[i]; });
        return obj;
    });
}

// ── YERELSQLite WRAPPER FONKSİYONLARI ───────────────────────────────
function sqliteRun(sql, params = []) {
    return new Promise((resolve, reject) => {
        if (!sqliteDb) return reject(new Error("Veritabanı başlatılmadı"));
        sqliteDb.run(sql, params, function(err) {
            if (err) reject(err);
            else resolve(this);
        });
    });
}

function sqliteGet(sql, params = []) {
    return new Promise((resolve, reject) => {
        if (!sqliteDb) return reject(new Error("Veritabanı başlatılmadı"));
        sqliteDb.get(sql, params, (err, row) => {
            if (err) reject(err);
            else resolve(row);
        });
    });
}

function sqliteAll(sql, params = []) {
    return new Promise((resolve, reject) => {
        if (!sqliteDb) return reject(new Error("Veritabanı başlatılmadı"));
        sqliteDb.all(sql, params, (err, rows) => {
            if (err) reject(err);
            else resolve(rows);
        });
    });
}

// ── UNIFIED WRAPPERS (USE_TURSO'ya göre yönlendirir) ────────────────
async function queryRun(sql, params = []) {
    return (USE_TURSO || tursoClient) ? tursoRun(sql, params) : sqliteRun(sql, params);
}
async function queryGet(sql, params = []) {
    return (USE_TURSO || tursoClient) ? tursoGet(sql, params) : sqliteGet(sql, params);
}
async function queryAll(sql, params = []) {
    return (USE_TURSO || tursoClient) ? tursoAll(sql, params) : sqliteAll(sql, params);
}

// ── INDEX YENİDEN İNŞA ──────────────────────────────────────────────
async function rebuildUserIdIndex() {
    try {
        const rows = await queryAll(`SELECT userId, email FROM users`);
        Object.keys(userIdIndex).forEach(k => delete userIdIndex[k]);
        for (const row of rows) {
            if (row.userId && row.email) userIdIndex[row.userId] = row.email;
        }
    } catch (e) {
        console.error('[!] rebuildUserIdIndex hatası:', e);
    }
}

// ── SYNC: TURSO ile Belleği Senkronize Et ───────────────────────────
async function syncMemoryToTurso() {
    const statements = [];

    for (const email in db.users) {
        const u = db.users[email];
        if (!u.userId) {
            u.userId = 'AGN-' + Math.floor(1000 + Math.random() * 9000) + '-' + Math.floor(1000 + Math.random() * 9000);
        }
        statements.push({
            sql: `INSERT INTO users (email, username, password, userId, publicKey, avatar)
                  VALUES (?, ?, ?, ?, ?, ?)
                  ON CONFLICT(email) DO UPDATE SET
                  username=excluded.username, password=excluded.password,
                  userId=excluded.userId, publicKey=excluded.publicKey, avatar=excluded.avatar`,
            args: [u.email, u.username, u.password, u.userId,
                   u.publicKey ? JSON.stringify(u.publicKey) : null, u.avatar || null]
        });
    }

    const emails = Object.keys(db.users);
    if (emails.length > 0) {
        const placeholders = emails.map(() => '?').join(',');
        statements.push({ sql: `DELETE FROM users WHERE email NOT IN (${placeholders})`, args: emails });
    } else {
        statements.push({ sql: 'DELETE FROM users', args: [] });
    }

    statements.push({ sql: 'DELETE FROM queue', args: [] });
    for (const targetId in db.queue) {
        const packets = db.queue[targetId] || [];
        for (const p of packets) {
            statements.push({
                sql: 'INSERT INTO queue (targetId, packet, timestamp) VALUES (?, ?, ?)',
                args: [targetId, JSON.stringify(p), p.timestamp || Date.now()]
            });
        }
    }

    if (statements.length > 0) {
        await tursoClient.batch(statements, 'write');
    }
}

// ── SYNC: Yerel SQLite ile Belleği Senkronize Et ────────────────────
async function syncMemoryToSqlite() {
    await sqliteRun('BEGIN TRANSACTION');
    try {
        for (const email in db.users) {
            const u = db.users[email];
            if (!u.userId) {
                u.userId = 'AGN-' + Math.floor(1000 + Math.random() * 9000) + '-' + Math.floor(1000 + Math.random() * 9000);
            }
            await sqliteRun(
                `INSERT INTO users (email, username, password, userId, publicKey, avatar)
                 VALUES (?, ?, ?, ?, ?, ?)
                 ON CONFLICT(email) DO UPDATE SET
                    username=excluded.username, password=excluded.password,
                    userId=excluded.userId, publicKey=excluded.publicKey, avatar=excluded.avatar`,
                [u.email, u.username, u.password, u.userId,
                 u.publicKey ? JSON.stringify(u.publicKey) : null, u.avatar || null]
            );
        }
        const emails = Object.keys(db.users);
        if (emails.length > 0) {
            const placeholders = emails.map(() => '?').join(',');
            await sqliteRun(`DELETE FROM users WHERE email NOT IN (${placeholders})`, emails);
        } else {
            await sqliteRun(`DELETE FROM users`);
        }
        await sqliteRun(`DELETE FROM queue`);
        for (const targetId in db.queue) {
            const packets = db.queue[targetId] || [];
            for (const p of packets) {
                await sqliteRun(
                    `INSERT INTO queue (targetId, packet, timestamp) VALUES (?, ?, ?)`,
                    [targetId, JSON.stringify(p), p.timestamp || Date.now()]
                );
            }
        }
        await sqliteRun('COMMIT');
    } catch (e) {
        try { await sqliteRun('ROLLBACK'); } catch (_) {}
        throw e;
    }
}

// ── ANA SYNC FONKSİYONU (mod seçici) ────────────────────────────────
async function syncMemoryToSql() {
    if (USE_TURSO || tursoClient) {
        await syncMemoryToTurso();
    } else {
        await syncMemoryToSqlite();
    }
}

// ── KAYIT İŞLEMLERİ ─────────────────────────────────────────────────
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

// ── TURSO BAŞLATMA ───────────────────────────────────────────────────
async function initTurso() {
    console.log('[+] TURSO BULUT VERİTABANI BAĞLANIYOR...');
    const { createClient } = require('@libsql/client');
    tursoClient = createClient({ url: TURSO_URL, authToken: TURSO_TOKEN });

    // Tabloları oluştur (yoksa)
    await tursoClient.execute(`
        CREATE TABLE IF NOT EXISTS users (
            email TEXT PRIMARY KEY,
            username TEXT NOT NULL,
            password TEXT NOT NULL,
            userId TEXT UNIQUE NOT NULL,
            publicKey TEXT,
            avatar TEXT,
            createdAt INTEGER DEFAULT (unixepoch())
        )
    `);
    await tursoClient.execute(`
        CREATE TABLE IF NOT EXISTS queue (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            targetId TEXT NOT NULL,
            packet TEXT NOT NULL,
            timestamp INTEGER NOT NULL,
            FOREIGN KEY (targetId) REFERENCES users(userId) ON DELETE CASCADE
        )
    `);
    await tursoClient.execute(`CREATE INDEX IF NOT EXISTS idx_queue_targetId ON queue(targetId)`);
    await tursoClient.execute(`CREATE INDEX IF NOT EXISTS idx_queue_timestamp ON queue(timestamp)`);
    await tursoClient.execute(`CREATE INDEX IF NOT EXISTS idx_users_userId ON users(userId)`);

    // Verileri belleğe yükle
    const userResult = await tursoClient.execute('SELECT * FROM users');
    for (const key in db.users) delete db.users[key];
    for (const row of userResult.rows) {
        const obj = {};
        userResult.columns.forEach((col, i) => { obj[col] = row[i]; });
        db.users[obj.email] = {
            email: obj.email,
            username: obj.username,
            password: obj.password,
            userId: obj.userId,
            publicKey: obj.publicKey ? JSON.parse(obj.publicKey) : null,
            avatar: obj.avatar
        };
    }

    const queueResult = await tursoClient.execute('SELECT * FROM queue');
    for (const key in db.queue) delete db.queue[key];
    for (const row of queueResult.rows) {
        const obj = {};
        queueResult.columns.forEach((col, i) => { obj[col] = row[i]; });
        if (!db.queue[obj.targetId]) db.queue[obj.targetId] = [];
        db.queue[obj.targetId].push(JSON.parse(obj.packet));
    }

    await rebuildUserIdIndex();
    console.log(`[+] TURSO BAĞLANTISI BAŞARILI! ${Object.keys(db.users).length} kullanıcı yüklendi.`);
}

// ── YERELSQLite BAŞLATMA ─────────────────────────────────────────────
async function initSqlite() {
    await new Promise((resolve, reject) => {
        sqliteDb = new sqlite3.Database(dbPath, (err) => {
            if (err) reject(err);
            else resolve();
        });
    });
    await sqliteRun('PRAGMA journal_mode = WAL;');

    await sqliteRun(`CREATE TABLE IF NOT EXISTS users (
        email TEXT PRIMARY KEY, username TEXT NOT NULL, password TEXT NOT NULL,
        userId TEXT UNIQUE NOT NULL, publicKey TEXT, avatar TEXT,
        createdAt INTEGER DEFAULT (unixepoch())
    )`);
    await sqliteRun(`CREATE TABLE IF NOT EXISTS queue (
        id INTEGER PRIMARY KEY AUTOINCREMENT, targetId TEXT NOT NULL,
        packet TEXT NOT NULL, timestamp INTEGER NOT NULL,
        FOREIGN KEY (targetId) REFERENCES users(userId) ON DELETE CASCADE
    )`);
    await sqliteRun(`CREATE INDEX IF NOT EXISTS idx_queue_targetId ON queue(targetId)`);
    await sqliteRun(`CREATE INDEX IF NOT EXISTS idx_queue_timestamp ON queue(timestamp)`);
    await sqliteRun(`CREATE INDEX IF NOT EXISTS idx_users_userId ON users(userId)`);

    // Eski JSON'dan Migration (tek seferlik)
    const row = await sqliteGet(`SELECT COUNT(*) AS count FROM users`);
    const userCount = row ? row.count : 0;
    if (userCount === 0 && fs.existsSync(legacyJsonPath)) {
        try {
            const fileContent = fs.readFileSync(legacyJsonPath, 'utf8');
            if (fileContent && fileContent.trim() !== '') {
                const parsed = JSON.parse(fileContent);
                await sqliteRun('BEGIN TRANSACTION');
                for (const email in (parsed.users || {})) {
                    const u = parsed.users[email];
                    if (!u.userId) u.userId = 'AGN-' + Math.floor(1000 + Math.random() * 9000) + '-' + Math.floor(1000 + Math.random() * 9000);
                    await sqliteRun(`INSERT INTO users (email, username, password, userId, publicKey, avatar) VALUES (?, ?, ?, ?, ?, ?)`,
                        [u.email || email, u.username || 'User', u.password || '', u.userId,
                         u.publicKey ? JSON.stringify(u.publicKey) : null, u.avatar || null]);
                }
                for (const targetId in (parsed.queue || {})) {
                    for (const p of (parsed.queue[targetId] || [])) {
                        await sqliteRun(`INSERT INTO queue (targetId, packet, timestamp) VALUES (?, ?, ?)`,
                            [targetId, JSON.stringify(p), p.timestamp || Date.now()]);
                    }
                }
                await sqliteRun('COMMIT');
                console.log("[+] Eski database.json verileri SQLite'ye aktarıldı.");
            }
            fs.renameSync(legacyJsonPath, backupJsonPath);
        } catch (e) {
            console.error("[!] Migration hatası:", e);
            try { await sqliteRun('ROLLBACK'); } catch (_) {}
        }
    }

    const userRows = await sqliteAll(`SELECT * FROM users`);
    for (const key in db.users) delete db.users[key];
    for (const r of userRows) {
        db.users[r.email] = {
            email: r.email, username: r.username, password: r.password,
            userId: r.userId, publicKey: r.publicKey ? JSON.parse(r.publicKey) : null, avatar: r.avatar
        };
    }
    const queueRows = await sqliteAll(`SELECT * FROM queue`);
    for (const key in db.queue) delete db.queue[key];
    for (const r of queueRows) {
        if (!db.queue[r.targetId]) db.queue[r.targetId] = [];
        db.queue[r.targetId].push(JSON.parse(r.packet));
    }
    await rebuildUserIdIndex();
}

// ── ANA BAŞLATMA (mod seçici) ────────────────────────────────────────
async function initDB() {
    if (USE_TURSO || tursoClient) {
        await initTurso();
    } else {
        await initSqlite();
    }
}

// ── ÇÖP TOPLAYICI (Garbage Collector) ───────────────────────────────
function startGarbageCollector() {
    setInterval(async () => {
        try {
            const expireTime = Date.now() - MAX_PACKET_AGE_MS;
            await queryRun(`DELETE FROM queue WHERE timestamp < ?`, [expireTime]);
            console.log(`[PERİYODİK TEMİZLİK] Eski paketler temizlendi.`);
            const queueRows = await queryAll(`SELECT * FROM queue`);
            for (const key in db.queue) delete db.queue[key];
            for (const r of queueRows) {
                if (!db.queue[r.targetId]) db.queue[r.targetId] = [];
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
    MAX_PACKET_AGE_MS,
    _internals: {
        sqliteRun,
        sqliteGet,
        sqliteAll,
        tursoRun,
        tursoGet,
        tursoAll,
        queryRun,
        queryGet,
        queryAll,
        syncMemoryToTurso,
        syncMemoryToSqlite,
        syncMemoryToSql,
        initTurso,
        initSqlite,
        setSqliteDb: (instance) => { sqliteDb = instance; },
        getSqliteDb: () => sqliteDb,
        setTursoClient: (client) => { tursoClient = client; },
        getTursoClient: () => tursoClient,
        legacyJsonPath,
        backupJsonPath
    }
};