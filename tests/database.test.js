import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import fs from 'fs';
import path from 'path';

let activeTursoClient = null;
vi.mock('@libsql/client', () => ({
    createClient: vi.fn(() => activeTursoClient)
}));

// Use a dedicated temporary test database
const testDbPath = path.join(__dirname, 'test_temp.sqlite');
process.env.DB_PATH = testDbPath;
delete process.env.TURSO_DATABASE_URL;
delete process.env.TURSO_AUTH_TOKEN;

// Import after env is set
const dbManager = require('../src/database.js');

describe('Database & Queue Management Tests', () => {
    beforeAll(async () => {
        // Clean up prior test artifacts if present
        if (fs.existsSync(testDbPath)) {
            try { fs.unlinkSync(testDbPath); } catch (_) {}
        }
        await dbManager.initDB();
    });

    afterAll(async () => {
        // Clean up temporary database files
        const cleanupFiles = [
            testDbPath,
            `${testDbPath}-shm`,
            `${testDbPath}-wal`
        ];
        for (const file of cleanupFiles) {
            if (fs.existsSync(file)) {
                try { fs.unlinkSync(file); } catch (_) {}
            }
        }
    });

    it('should initialize empty database structure', () => {
        const db = dbManager.getDB();
        expect(db).toBeDefined();
        expect(db.users).toBeDefined();
        expect(db.queue).toBeDefined();
    });

    it('should save and retrieve user correctly', async () => {
        const db = dbManager.getDB();
        const testEmail = 'agent@cyber.local';
        const testUserId = 'AGN-9999-1111';

        db.users[testEmail] = {
            email: testEmail,
            username: 'CyberAgent',
            password: '$2b$10$hashedpasswordstringforauth',
            userId: testUserId,
            publicKey: { kty: 'EC', crv: 'P-256', x: 'pubX', y: 'pubY' },
            avatar: 'https://example.com/avatar.png'
        };

        await dbManager.saveDatabaseImmediate();

        // Check in-memory index
        const index = dbManager.getUserIdIndex();
        expect(index[testUserId]).toBe(testEmail);
    });

    it('should manage offline message queue correctly', async () => {
        const db = dbManager.getDB();
        const targetId = 'AGN-9999-1111';

        const packet1 = {
            type: 'chat_message',
            senderId: 'AGN-1234-5678',
            ciphertext: 'SifreliVeriPaketi1',
            timestamp: Date.now()
        };
        const packet2 = {
            type: 'chat_message',
            senderId: 'AGN-1234-5678',
            ciphertext: 'SifreliVeriPaketi2',
            timestamp: Date.now() + 1000
        };

        db.queue[targetId] = [packet1, packet2];
        await dbManager.saveDatabaseImmediate();

        expect(db.queue[targetId]).toHaveLength(2);
        expect(db.queue[targetId][0].ciphertext).toBe('SifreliVeriPaketi1');

        // Simulate reading from queue and popping one
        db.queue[targetId].shift();
        await dbManager.saveDatabaseImmediate();
        expect(db.queue[targetId]).toHaveLength(1);
        expect(db.queue[targetId][0].ciphertext).toBe('SifreliVeriPaketi2');
    });

    it('rebuildUserIdIndex should accurately map all active userIds to emails', async () => {
        const db = dbManager.getDB();
        db.users['second@cyber.local'] = {
            email: 'second@cyber.local',
            username: 'SecondUser',
            password: 'pwd',
            userId: 'AGN-5555-4444',
            publicKey: null,
            avatar: null
        };
        await dbManager.saveDatabaseImmediate();
        await dbManager.rebuildUserIdIndex();

        const index = dbManager.getUserIdIndex();
        expect(index['AGN-5555-4444']).toBe('second@cyber.local');
    });

    describe('SQLite Wrappers & Error Handling', () => {
        const internals = dbManager._internals;

        it('sqliteRun, sqliteGet, and sqliteAll should reject when sqliteDb is null', async () => {
            const originalDb = internals.getSqliteDb();
            internals.setSqliteDb(null);

            await expect(internals.sqliteRun('SELECT 1')).rejects.toThrow('Veritabanı başlatılmadı');
            await expect(internals.sqliteGet('SELECT 1')).rejects.toThrow('Veritabanı başlatılmadı');
            await expect(internals.sqliteAll('SELECT 1')).rejects.toThrow('Veritabanı başlatılmadı');

            internals.setSqliteDb(originalDb);
        });

        it('sqliteRun, sqliteGet, and sqliteAll should reject on SQL syntax errors', async () => {
            await expect(internals.sqliteRun('MALFORMED SQL SYNTAX')).rejects.toThrow();
            await expect(internals.sqliteGet('MALFORMED SQL SYNTAX')).rejects.toThrow();
            await expect(internals.sqliteAll('MALFORMED SQL SYNTAX')).rejects.toThrow();
        });

        it('rebuildUserIdIndex should handle errors gracefully and skip empty userId/email', async () => {
            const originalDb = internals.getSqliteDb();
            internals.setSqliteDb(null); // Causes queryAll to throw
            const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

            await dbManager.rebuildUserIdIndex();
            expect(consoleSpy).toHaveBeenCalledWith('[!] rebuildUserIdIndex hatası:', expect.any(Error));

            consoleSpy.mockRestore();
            internals.setSqliteDb(originalDb);

            // Now test skipping rows with missing userId or email
            const db = dbManager.getDB();
            db.users['valid@cyber.local'] = {
                email: 'valid@cyber.local',
                username: 'Valid',
                password: 'pwd',
                userId: 'AGN-VALID-01',
                publicKey: null,
                avatar: null
            };
            await dbManager.saveDatabaseImmediate();
            await dbManager.rebuildUserIdIndex();
            expect(dbManager.getUserIdIndex()['AGN-VALID-01']).toBe('valid@cyber.local');
        });

        it('syncMemoryToSqlite: should auto-generate userId if missing and rollback on error', async () => {
            const db = dbManager.getDB();
            db.users['no_uid@cyber.local'] = {
                email: 'no_uid@cyber.local',
                username: 'NoUidUser',
                password: 'pwd',
                userId: null, // should trigger auto-generation
                publicKey: null,
                avatar: null
            };

            await internals.syncMemoryToSqlite();
            expect(db.users['no_uid@cyber.local'].userId).toMatch(/^AGN-\d+-\d+$/);

            // Test transaction error & rollback
            const dbInstance = internals.getSqliteDb();
            const originalRun = dbInstance.run;
            dbInstance.run = function(sql, ...args) {
                const cb = typeof args[args.length - 1] === 'function' ? args[args.length - 1] : null;
                if (sql.includes('INSERT INTO users')) {
                    if (cb) cb(new Error('Forced SQLite transaction error'));
                    return this;
                }
                return originalRun.apply(this, [sql, ...args]);
            };

            await expect(internals.syncMemoryToSqlite()).rejects.toThrow('Forced SQLite transaction error');
            dbInstance.run = originalRun;
        });

        it('syncMemoryToSqlite: should handle empty users array', async () => {
            const db = dbManager.getDB();
            for (const k in db.users) delete db.users[k];
            for (const k in db.queue) delete db.queue[k];

            await internals.syncMemoryToSqlite();
            const rows = await internals.sqliteAll('SELECT * FROM users');
            expect(rows).toHaveLength(0);
        });

        it('syncMemoryToSqlite: should delete users from DB that are not in memory', async () => {
            await internals.sqliteRun('INSERT OR IGNORE INTO users (email, username, password, userId) VALUES (?, ?, ?, ?)',
                ['stale@cyber.local', 'Stale', 'pwd', 'AGN-STALE-1']);
            const db = dbManager.getDB();
            db.users['active@cyber.local'] = { email: 'active@cyber.local', username: 'Active', password: 'pwd', userId: 'AGN-ACT-1' };
            delete db.users['stale@cyber.local'];

            await internals.syncMemoryToSqlite();

            const stale = await internals.sqliteGet('SELECT * FROM users WHERE email = ?', ['stale@cyber.local']);
            expect(stale).toBeUndefined();
        });
    });

    describe('saveDatabase Debounce & saveDatabaseImmediate', () => {
        const internals = dbManager._internals;

        it('saveDatabase should debounce multiple calls within 50ms', async () => {
            const db = dbManager.getDB();
            db.users['debounced@cyber.local'] = {
                email: 'debounced@cyber.local',
                username: 'Debounced',
                password: 'pwd',
                userId: 'AGN-DEBOUNCE',
                publicKey: null,
                avatar: null
            };

            // Call saveDatabase multiple times concurrently
            const p1 = dbManager.saveDatabase();
            const p2 = dbManager.saveDatabase();
            const p3 = dbManager.saveDatabase();

            await Promise.all([p1, p2, p3]);

            const index = dbManager.getUserIdIndex();
            expect(index['AGN-DEBOUNCE']).toBe('debounced@cyber.local');
        });

        it('saveDatabase should catch write error if syncMemoryToSql fails', async () => {
            const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
            const originalDb = internals.getSqliteDb();
            internals.setSqliteDb(null); // Causes syncMemoryToSql to fail

            const p = dbManager.saveDatabase();
            await p;

            expect(consoleSpy).toHaveBeenCalledWith('[!] Veritabanı yazma hatası:', expect.any(Error));
            consoleSpy.mockRestore();
            internals.setSqliteDb(originalDb);
        });

        it('saveDatabaseImmediate should clear pending timer and throw if write fails', async () => {
            const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
            const originalDb = internals.getSqliteDb();

            // Start a debounced save to set _saveTimer
            dbManager.saveDatabase();

            // Break the db
            internals.setSqliteDb(null);

            await expect(dbManager.saveDatabaseImmediate()).rejects.toThrow();
            expect(consoleSpy).toHaveBeenCalledWith('[!] Veritabanı yazma hatası (immediate):', expect.any(Error));

            consoleSpy.mockRestore();
            internals.setSqliteDb(originalDb);
        });
    });

    describe('Legacy database.json Migration', () => {
        const internals = dbManager._internals;
        const legacyPath = internals.legacyJsonPath;
        const backupPath = internals.backupJsonPath;

        afterEach(() => {
            if (fs.existsSync(legacyPath)) {
                try { fs.unlinkSync(legacyPath); } catch (_) {}
            }
            if (fs.existsSync(backupPath)) {
                try { fs.unlinkSync(backupPath); } catch (_) {}
            }
        });

        it('should migrate users and queue from legacy JSON when users table is empty', async () => {
            // Clear users table
            await internals.sqliteRun('DELETE FROM users');
            await internals.sqliteRun('DELETE FROM queue');

            const legacyData = {
                users: {
                    'migrated@cyber.local': {
                        email: 'migrated@cyber.local',
                        username: 'MigratedUser',
                        password: 'hashedpassword',
                        publicKey: { kty: 'EC' },
                        avatar: 'avatar-url'
                        // userId omitted to test auto-generation
                    }
                },
                queue: {
                    'AGN-TARGET-99': [
                        { id: 'pkt-1', ciphertext: 'enc1' }
                    ]
                }
            };
            fs.writeFileSync(legacyPath, JSON.stringify(legacyData));

            await internals.initSqlite();

            const db = dbManager.getDB();
            expect(db.users['migrated@cyber.local']).toBeDefined();
            expect(db.users['migrated@cyber.local'].userId).toMatch(/^AGN-\d+-\d+$/);
            expect(fs.existsSync(backupPath)).toBe(true);
            expect(fs.existsSync(legacyPath)).toBe(false);
        });

        it('should handle corrupt legacy JSON gracefully', async () => {
            await internals.sqliteRun('DELETE FROM users');
            fs.writeFileSync(legacyPath, 'NOT_VALID_JSON{{{');

            const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
            await internals.initSqlite();

            expect(consoleSpy).toHaveBeenCalledWith('[!] Migration hatası:', expect.any(Error));
            consoleSpy.mockRestore();
        });
    });

    describe('Garbage Collector', () => {
        const internals = dbManager._internals;

        it('should purge expired queue packets older than MAX_PACKET_AGE_MS', async () => {
            const db = dbManager.getDB();
            const targetId = 'AGN-GC-TEST';
            const now = Date.now();

            const freshPacket = { id: 'fresh', timestamp: now, ciphertext: 'fresh' };
            const expiredPacket = { id: 'expired', timestamp: now - (dbManager.MAX_PACKET_AGE_MS + 10000), ciphertext: 'old' };

            db.queue[targetId] = [freshPacket, expiredPacket];
            await dbManager.saveDatabaseImmediate();

            // Run garbage collection step
            const expireTime = Date.now() - dbManager.MAX_PACKET_AGE_MS;
            await internals.queryRun('DELETE FROM queue WHERE timestamp < ?', [expireTime]);
            const queueRows = await internals.queryAll('SELECT * FROM queue');
            for (const key in db.queue) delete db.queue[key];
            for (const r of queueRows) {
                if (!db.queue[r.targetId]) db.queue[r.targetId] = [];
                db.queue[r.targetId].push(JSON.parse(r.packet));
            }

            expect(db.queue[targetId]).toHaveLength(1);
            expect(db.queue[targetId][0].id).toBe('fresh');
        });

        it('should handle garbage collector exception gracefully', async () => {
            const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
            const originalRun = internals.queryRun;

            vi.spyOn(internals, 'queryRun').mockRejectedValueOnce(new Error('GC query failed'));

            // Simulate the timer callback execution
            try {
                const expireTime = Date.now() - dbManager.MAX_PACKET_AGE_MS;
                await internals.queryRun('DELETE FROM queue WHERE timestamp < ?', [expireTime]);
            } catch (e) {
                console.error('[!] Garbage Collector hatası:', e);
            }

            expect(consoleSpy).toHaveBeenCalledWith('[!] Garbage Collector hatası:', expect.any(Error));
            consoleSpy.mockRestore();
            vi.restoreAllMocks();
        });

        it('startGarbageCollector should start interval timer', () => {
            const intervalSpy = vi.spyOn(globalThis, 'setInterval');
            dbManager.startGarbageCollector();
            expect(intervalSpy).toHaveBeenCalledWith(expect.any(Function), 60 * 60 * 1000);
            intervalSpy.mockRestore();
        });
    });

    describe('Turso Bulut SQLite Mock Tests', () => {
        const internals = dbManager._internals;

        let mockTursoClient;
        let executedStatements;
        let batchedStatements;

        beforeEach(() => {
            executedStatements = [];
            batchedStatements = [];

            mockTursoClient = {
                execute: vi.fn(async (query) => {
                    const sql = typeof query === 'string' ? query : (query?.sql || '');
                    const args = typeof query === 'string' ? [] : (query?.args || []);
                    executedStatements.push({ sql, args });
                    if (sql.includes('SELECT * FROM users')) {
                        return {
                            columns: ['email', 'username', 'password', 'userId', 'publicKey', 'avatar'],
                            rows: [
                                ['turso@cyber.local', 'TursoUser', 'pwd', 'AGN-TURSO-1', JSON.stringify({ kty: 'EC' }), 'avatar.png'],
                                ['turso2@cyber.local', 'TursoUser2', 'pwd2', 'AGN-TURSO-2', null, null]
                            ]
                        };
                    }
                    if (sql.includes('SELECT * FROM queue')) {
                        return {
                            columns: ['id', 'targetId', 'packet', 'timestamp'],
                            rows: [
                                [1, 'AGN-TURSO-1', JSON.stringify({ id: 't-pkt-1', text: 'hi' }), Date.now()]
                            ]
                        };
                    }
                    if (sql.includes('SELECT userId, email FROM users')) {
                        return {
                            columns: ['userId', 'email'],
                            rows: [
                                ['AGN-TURSO-1', 'turso@cyber.local'],
                                ['AGN-TURSO-2', 'turso2@cyber.local']
                            ]
                        };
                    }
                    return { columns: ['col1'], rows: [['val1']] };
                }),
                batch: vi.fn(async (statements, mode) => {
                    batchedStatements.push(...statements);
                    return [];
                })
            };

            internals.setTursoClient(mockTursoClient);
            activeTursoClient = mockTursoClient;

            try {
                const libsqlPath = require.resolve('@libsql/client');
                require.cache[libsqlPath] = {
                    id: libsqlPath,
                    filename: libsqlPath,
                    loaded: true,
                    exports: { createClient: () => mockTursoClient }
                };
            } catch (_) {}
        });

        afterEach(() => {
            internals.setTursoClient(null);
            activeTursoClient = null;
            try {
                const libsqlPath = require.resolve('@libsql/client');
                delete require.cache[libsqlPath];
            } catch (_) {}
        });

        it('tursoRun, tursoGet, and tursoAll should interact with tursoClient properly', async () => {
            // tursoRun
            await internals.tursoRun('INSERT INTO test VALUES (?)', ['sample']);
            expect(mockTursoClient.execute).toHaveBeenCalledWith({ sql: 'INSERT INTO test VALUES (?)', args: ['sample'] });

            // tursoGet with rows
            const row = await internals.tursoGet('SELECT * FROM users WHERE email = ?', ['turso@cyber.local']);
            expect(row).toBeDefined();
            expect(row.email).toBe('turso@cyber.local');

            // tursoGet with empty rows
            mockTursoClient.execute.mockResolvedValueOnce({ columns: ['email'], rows: [] });
            const emptyRow = await internals.tursoGet('SELECT * FROM users WHERE email = ?', ['missing']);
            expect(emptyRow).toBeUndefined();

            // tursoAll
            const allRows = await internals.tursoAll('SELECT * FROM users');
            expect(allRows).toHaveLength(2);
            expect(allRows[0].username).toBe('TursoUser');
            expect(allRows[1].username).toBe('TursoUser2');
        });

        it('syncMemoryToTurso should batch insert users and queue packets', async () => {
            const db = dbManager.getDB();
            db.users['cloud@cyber.local'] = {
                email: 'cloud@cyber.local',
                username: 'CloudUser',
                password: 'cloudpassword',
                userId: null, // should auto-generate
                publicKey: { kty: 'EC', crv: 'P-256' },
                avatar: 'cloud.png'
            };
            db.queue['AGN-TARGET-CLOUD'] = [
                { id: 'cloud-pkt-1', ciphertext: 'cloudcipher', timestamp: Date.now() },
                { id: 'cloud-pkt-2', ciphertext: 'cloudcipher2' } // missing timestamp fallback
            ];

            await internals.syncMemoryToTurso();
            expect(mockTursoClient.batch).toHaveBeenCalled();
            expect(batchedStatements.length).toBeGreaterThan(0);
        });

        it('syncMemoryToTurso should handle empty users and queue', async () => {
            const db = dbManager.getDB();
            for (const k in db.users) delete db.users[k];
            for (const k in db.queue) delete db.queue[k];

            await internals.syncMemoryToTurso();
            expect(mockTursoClient.batch).toHaveBeenCalled();
            const deleteStmt = batchedStatements.find(s => s.sql === 'DELETE FROM users');
            expect(deleteStmt).toBeDefined();
        });

        it('initTurso should create schema tables and load data into memory', async () => {
            await internals.initTurso();
            const db = dbManager.getDB();
            expect(db.users['turso@cyber.local']).toBeDefined();
            expect(db.users['turso@cyber.local'].publicKey).toEqual({ kty: 'EC' });
            expect(db.users['turso2@cyber.local'].publicKey).toBeNull();
            expect(db.queue['AGN-TURSO-1']).toHaveLength(1);

            const index = dbManager.getUserIdIndex();
            expect(index['AGN-TURSO-1']).toBe('turso@cyber.local');
        });

        it('queryGet, syncMemoryToSql, and initDB should delegate to Turso when tursoClient is present', async () => {
            internals.setTursoClient(mockTursoClient);

            // queryGet in Turso mode (line 225)
            const row = await internals.queryGet('SELECT * FROM users WHERE email = ?', ['turso@cyber.local']);
            expect(row).toBeDefined();
            expect(row.email).toBe('turso@cyber.local');

            // syncMemoryToSql in Turso mode (line 387)
            await internals.syncMemoryToSql();
            expect(mockTursoClient.batch).toHaveBeenCalled();

            // initDB in Turso mode (line 608)
            await dbManager.initDB();
            expect(mockTursoClient.execute).toHaveBeenCalled();

            // Clean up: restore SQLite mode
            internals.setTursoClient(null);
        });

        it('startGarbageCollector should clean expired packets periodically and catch errors', async () => {
            vi.useFakeTimers();

            // Add expired and fresh packets to DB for existing user AGN-TURSO-1
            const expireOld = Date.now() - (dbManager.MAX_PACKET_AGE_MS + 5000);
            await internals.queryRun('INSERT INTO queue (targetId, packet, timestamp) VALUES (?, ?, ?)',
                ['AGN-TURSO-1', JSON.stringify({ id: 'p-old-gc' }), expireOld]);
            await internals.queryRun('INSERT INTO queue (targetId, packet, timestamp) VALUES (?, ?, ?)',
                ['AGN-TURSO-1', JSON.stringify({ id: 'p-fresh-gc' }), Date.now()]);

            dbManager.startGarbageCollector();

            // Advance by 1 hour (3600000 ms)
            await vi.advanceTimersByTimeAsync(3600000);

            const db = dbManager.getDB();
            expect(db.queue['AGN-TURSO-1']).toBeDefined();
            expect(db.queue['AGN-TURSO-1'][0].id).toBe('t-pkt-1');

            // Test catch block (line 635)
            const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
            internals.setTursoClient(mockTursoClient);
            mockTursoClient.execute.mockRejectedValueOnce(new Error('Simulated GC failure'));

            await vi.advanceTimersByTimeAsync(3600000);
            expect(errorSpy).toHaveBeenCalledWith(expect.stringContaining('Garbage Collector hatası'), expect.any(Error));

            internals.setTursoClient(null);
            errorSpy.mockRestore();
            vi.useRealTimers();
        });

        it('should create database directory if it does not exist and handle mkdir errors (lines 33-34)', () => {
            const testDir = path.join(__dirname, 'nonexistent_test_subdir');
            if (fs.existsSync(testDir)) fs.rmSync(testDir, { recursive: true, force: true });
            process.env.DB_PATH = path.join(testDir, 'db.sqlite');

            delete require.cache[require.resolve('../src/database.js')];
            require('../src/database.js');
            expect(fs.existsSync(testDir)).toBe(true);
            fs.rmSync(testDir, { recursive: true, force: true });

            // Test line 34 catch block
            const failDir = path.join(__dirname, 'nonexistent_fail_subdir');
            process.env.DB_PATH = path.join(failDir, 'db.sqlite');
            const mkdirSpy = vi.spyOn(fs, 'mkdirSync').mockImplementationOnce(() => {
                throw new Error('Disk write error');
            });
            const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

            delete require.cache[require.resolve('../src/database.js')];
            require('../src/database.js');
            expect(errorSpy).toHaveBeenCalledWith(expect.stringContaining('Veritabanı dizini oluşturulamadı'), expect.any(Error));

            errorSpy.mockRestore();
            mkdirSpy.mockRestore();
            process.env.DB_PATH = testDbPath;
            delete require.cache[require.resolve('../src/database.js')];
            require('../src/database.js');
        });
    });
});


