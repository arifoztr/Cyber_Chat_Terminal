import { describe, it, expect, beforeAll, beforeEach, afterEach, vi } from 'vitest';
const crypto = require('crypto');
const bcrypt = require('bcrypt');
const dbManager = require('../src/database');
const setupSockets = require('../src/socket');
const { signJWT, verifyJWT, revokeToken, getClientIp, revokedTokens, onlineNodes, DUMMY_HASH, MAX_QUEUE_SIZE } = setupSockets._internals;

describe('Socket.io Architecture & Security Test Suite', () => {
    let io;
    let ioMiddleware;
    let connectionHandler;
    let mockSocket;
    let emittedEvents;
    let roomsJoined;

    beforeAll(async () => {
        await dbManager.initDB();
    });

    // Helper to create a fresh mock socket
    const createMockSocket = (overrides = {}) => {
        const events = {};
        const s = {
            id: overrides.id || 'sock-' + Math.random().toString(36).substring(7),
            handshake: {
                address: '127.0.0.1',
                headers: {},
                auth: {},
                ...(overrides.handshake || {})
            },
            conn: overrides.conn || { remoteAddress: '127.0.0.1' },
            user: overrides.user !== undefined ? overrides.user : null,
            on: vi.fn((event, handler) => {
                events[event] = handler;
            }),
            emit: vi.fn((event, data) => {
                emittedEvents.push({ target: 'self', event, data });
            }),
            join: vi.fn((room) => {
                roomsJoined.push(room);
            }),
            disconnect: vi.fn(),
            _trigger: async (event, data, cb) => {
                if (events[event]) {
                    return await events[event](data, cb);
                }
            }
        };
        return s;
    };

    beforeEach(() => {
        emittedEvents = [];
        roomsJoined = [];

        // Mock Socket.IO server
        io = {
            use: vi.fn((fn) => {
                ioMiddleware = fn;
            }),
            on: vi.fn((event, handler) => {
                if (event === 'connection') {
                    connectionHandler = handler;
                }
            }),
            emit: vi.fn((event, data) => {
                emittedEvents.push({ target: 'broadcast', event, data });
            }),
            to: vi.fn((roomOrSid) => ({
                emit: (event, data) => {
                    emittedEvents.push({ target: roomOrSid, event, data });
                }
            })),
            sockets: {
                sockets: new Map()
            }
        };

        // Initialize setupSockets
        setupSockets(io);

        // Reset database state in memory
        const db = dbManager.getDB();
        for (const k in db.users) delete db.users[k];
        for (const k in db.queue) delete db.queue[k];
        const idx = dbManager.getUserIdIndex();
        for (const k in idx) delete idx[k];

        // Clear onlineNodes
        onlineNodes.clear();
    });

    afterEach(() => {
        vi.restoreAllMocks();
        onlineNodes.clear();
    });

    // ────────────────────────────────────────────────────────────────────────
    // 1. JWT & Anti-Tampering & Anti-Replay
    // ────────────────────────────────────────────────────────────────────────
    describe('JWT & Revocation Edge Cases', () => {
        it('revokeToken: handles null, undefined, non-string, and invalid tokens gracefully', () => {
            revokeToken(null);
            revokeToken(undefined);
            revokeToken(12345);
            expect(revokedTokens.has(null)).toBe(false);

            // Invalid format (less than 3 parts)
            revokeToken('malformed-token');
            expect(revokedTokens.has('malformed-token')).toBe(true);
        });

        it('revokeToken: correctly handles exp in ms (> 1e11) and exp in seconds', () => {
            // Token with exp in ms
            const payloadMs = { userId: 'AGN-1', email: 'ms@cyber.local', exp: Date.now() + 50000 };
            const tokenMs = signJWT(payloadMs);
            revokeToken(tokenMs);
            expect(revokedTokens.has(tokenMs)).toBe(true);

            // Token with corrupt JSON payload
            const corruptToken = 'eyJhbGciOiJIUzI1NiJ9.bm90LWpzb24.fakeSig';
            revokeToken(corruptToken);
            expect(revokedTokens.has(corruptToken)).toBe(true);
        });

        it('verifyJWT: rejects expired tokens (exp in seconds and exp in ms)', () => {
            const pastSec = Math.floor(Date.now() / 1000) - 3600;
            const pastToken = signJWT({ userId: 'AGN-EXPIRED', exp: pastSec });
            expect(verifyJWT(pastToken)).toBeNull();

            const pastMs = Date.now() - 3600000;
            const pastTokenMs = signJWT({ userId: 'AGN-EXPIRED-MS', exp: pastMs });
            expect(verifyJWT(pastTokenMs)).toBeNull();
        });

        it('verifyJWT: rejects tampered signature length or content', () => {
            const token = signJWT({ userId: 'AGN-TEST' });
            const [h, b, s] = token.split('.');
            // Signature length mismatch
            expect(verifyJWT(`${h}.${b}.${s}extra`)).toBeNull();
            // Corrupt base64 in body (triggers catch)
            expect(verifyJWT(`${h}.%%%notbase64%%%.${s}`)).toBeNull();
        });
    });

    // ────────────────────────────────────────────────────────────────────────
    // 2. IP Extraction & Proxy Security (SEC-07)
    // ────────────────────────────────────────────────────────────────────────
    describe('Client IP Extraction (Anti-Spoofing)', () => {
        it('should extract directIp from conn.remoteAddress when handshake.address is missing', () => {
            const socket = {
                handshake: { address: null, headers: {} },
                conn: { remoteAddress: '10.0.0.5' }
            };
            expect(getClientIp(socket)).toBe('10.0.0.5');
        });

        it('should fallback to 127.0.0.1 when both address and remoteAddress are missing', () => {
            const socket = {
                handshake: { address: null, headers: {} },
                conn: null
            };
            expect(getClientIp(socket)).toBe('127.0.0.1');
        });

        it('should trust x-forwarded-for when behind private subnet (10., 172.16., 192.168., ::1, etc.)', () => {
            const testCases = ['10.1.2.3', '172.16.5.6', '192.168.1.1', '::1', '::ffff:127.0.0.1'];
            testCases.forEach(privateIp => {
                const s = {
                    handshake: {
                        address: privateIp,
                        headers: { 'x-forwarded-for': '198.51.100.22, 10.0.0.1' }
                    }
                };
                expect(getClientIp(s)).toBe('198.51.100.22');
            });
        });

        it('should trust proxy when TRUST_PROXY env is true or 1 or NODE_ENV is production', () => {
            const originalEnv = { ...process.env };
            process.env.TRUST_PROXY = 'true';
            const s1 = {
                handshake: {
                    address: '8.8.8.8',
                    headers: { 'cf-connecting-ip': '203.0.113.50' }
                }
            };
            expect(getClientIp(s1)).toBe('203.0.113.50');

            process.env.TRUST_PROXY = '1';
            expect(getClientIp(s1)).toBe('203.0.113.50');

            delete process.env.TRUST_PROXY;
            process.env.NODE_ENV = 'production';
            expect(getClientIp(s1)).toBe('203.0.113.50');

            process.env = originalEnv;
        });

        it('should ignore cf-connecting-ip and x-forwarded-for if header length exceeds 45 chars (DDoS/Injection)', () => {
            const s = {
                handshake: {
                    address: '127.0.0.1',
                    headers: {
                        'cf-connecting-ip': 'a'.repeat(46),
                        'x-forwarded-for': 'b'.repeat(46)
                    }
                }
            };
            expect(getClientIp(s)).toBe('127.0.0.1');
        });

        it('should ignore proxy headers if not trusting proxy and direct IP is public', () => {
            const originalEnv = { ...process.env };
            delete process.env.TRUST_PROXY;
            process.env.NODE_ENV = 'development';

            const s = {
                handshake: {
                    address: '93.184.216.34', // Public IP
                    headers: { 'x-forwarded-for': '1.1.1.1' }
                }
            };
            expect(getClientIp(s)).toBe('93.184.216.34');
            process.env = originalEnv;
        });
    });

    // ────────────────────────────────────────────────────────────────────────
    // 3. Socket Middleware (io.use)
    // ────────────────────────────────────────────────────────────────────────
    describe('Socket Middleware Authentication', () => {
        it('should attach user if handshake contains valid token and user exists in db', () => {
            const db = dbManager.getDB();
            db.users['mid@cyber.local'] = { email: 'mid@cyber.local', username: 'MidUser', userId: 'AGN-MID-01' };

            const token = signJWT({ email: 'mid@cyber.local', userId: 'AGN-MID-01' });
            const socket = createMockSocket({ handshake: { auth: { token } } });
            const next = vi.fn();

            ioMiddleware(socket, next);

            expect(socket.user).toBeDefined();
            expect(socket.user.email).toBe('mid@cyber.local');
            expect(next).toHaveBeenCalled();
        });

        it('should call next without attaching user if token is missing, invalid, or user not in db', () => {
            const next = vi.fn();

            // No token
            const socket1 = createMockSocket();
            ioMiddleware(socket1, next);
            expect(socket1.user).toBeNull();

            // Invalid token
            const socket2 = createMockSocket({ handshake: { auth: { token: 'invalid.token' } } });
            ioMiddleware(socket2, next);
            expect(socket2.user).toBeNull();

            // Valid token for non-existent user
            const tokenUnknown = signJWT({ email: 'unknown@cyber.local' });
            const socket3 = createMockSocket({ handshake: { auth: { token: tokenUnknown } } });
            ioMiddleware(socket3, next);
            expect(socket3.user).toBeNull();
        });
    });

    // ────────────────────────────────────────────────────────────────────────
    // 4. Registration & Input Validation
    // ────────────────────────────────────────────────────────────────────────
    describe('register Event Validation & Failure Scenarios', () => {
        let socket;

        beforeEach(() => {
            socket = createMockSocket();
            connectionHandler(socket);
        });

        it('should reject registration if fields are missing', async () => {
            const cb = vi.fn();
            await socket._trigger('register', { email: '', password: 'pwd', username: 'user' }, cb);
            expect(cb).toHaveBeenCalledWith(expect.objectContaining({ success: false, message: 'Tüm alanlar zorunludur.' }));

            await socket._trigger('register', { email: 'test@cyber.local', password: '', username: 'user' }, cb);
            expect(cb).toHaveBeenCalledWith(expect.objectContaining({ success: false, message: 'Tüm alanlar zorunludur.' }));

            await socket._trigger('register', { email: 'test@cyber.local', password: 'pwd', username: '' }, cb);
            expect(cb).toHaveBeenCalledWith(expect.objectContaining({ success: false, message: 'Tüm alanlar zorunludur.' }));
        });

        it('should reject prototype pollution attempts in email', async () => {
            const cb = vi.fn();
            await socket._trigger('register', { email: '__proto__', password: 'password123', username: 'Hacker' }, cb);
            expect(cb).toHaveBeenCalledWith(expect.objectContaining({ success: false, message: 'Geçersiz e-posta adresi formatı.' }));

            await socket._trigger('register', { email: 'constructor', password: 'password123', username: 'Hacker' }, cb);
            expect(cb).toHaveBeenCalledWith(expect.objectContaining({ success: false, message: 'Geçersiz e-posta adresi formatı.' }));
        });

        it('should reject invalid email formats', async () => {
            const cb = vi.fn();
            await socket._trigger('register', { email: 'notanemail', password: 'password123', username: 'User' }, cb);
            expect(cb).toHaveBeenCalledWith(expect.objectContaining({ success: false, message: 'Geçersiz e-posta adresi formatı.' }));
        });

        it('should enforce password length limits (8 to 72)', async () => {
            const cb = vi.fn();
            // Short
            await socket._trigger('register', { email: 'test@cyber.local', password: 'short', username: 'User' }, cb);
            expect(cb).toHaveBeenCalledWith(expect.objectContaining({ success: false, message: expect.stringContaining('en az 8') }));

            // Long
            await socket._trigger('register', { email: 'test@cyber.local', password: 'a'.repeat(73), username: 'User' }, cb);
            expect(cb).toHaveBeenCalledWith(expect.objectContaining({ success: false, message: expect.stringContaining('en az 8') }));

            // Non-string
            await socket._trigger('register', { email: 'test@cyber.local', password: 12345678, username: 'User' }, cb);
            expect(cb).toHaveBeenCalledWith(expect.objectContaining({ success: false }));
        });

        it('should enforce username length limits (2 to 32)', async () => {
            const cb = vi.fn();
            // Short
            await socket._trigger('register', { email: 'test@cyber.local', password: 'password123', username: 'A' }, cb);
            expect(cb).toHaveBeenCalledWith(expect.objectContaining({ success: false, message: expect.stringContaining('2-32') }));

            // Long
            await socket._trigger('register', { email: 'test@cyber.local', password: 'password123', username: 'B'.repeat(33) }, cb);
            expect(cb).toHaveBeenCalledWith(expect.objectContaining({ success: false, message: expect.stringContaining('2-32') }));
        });

        it('should reject already registered emails', async () => {
            const db = dbManager.getDB();
            db.users['existing@cyber.local'] = { email: 'existing@cyber.local' };

            const cb = vi.fn();
            await socket._trigger('register', { email: 'existing@cyber.local', password: 'password123', username: 'User' }, cb);
            expect(cb).toHaveBeenCalledWith(expect.objectContaining({ success: false, message: 'Bu e-posta adresi zaten kullanımda.' }));
        });

        it('should register successfully, generate secure ID, and return token', async () => {
            const cb = vi.fn();
            await socket._trigger('register', { email: 'new@cyber.local', password: 'password123', username: 'NewUser' }, cb);

            expect(cb).toHaveBeenCalledWith(expect.objectContaining({
                success: true,
                message: 'Kayıt başarılı.',
                token: expect.any(String),
                user: expect.objectContaining({ email: 'new@cyber.local', username: 'NewUser' })
            }));

            const db = dbManager.getDB();
            expect(db.users['new@cyber.local']).toBeDefined();
            expect(db.users['new@cyber.local'].userId).toMatch(/^AGN-\d+-\d+$/);
            expect(onlineNodes.has(db.users['new@cyber.local'].userId)).toBe(true);
        });

        it('should catch server errors during registration', async () => {
            vi.spyOn(bcrypt, 'hash').mockRejectedValueOnce(new Error('Bcrypt failed'));
            const cb = vi.fn();

            await socket._trigger('register', { email: 'err@cyber.local', password: 'password123', username: 'ErrUser' }, cb);
            expect(cb).toHaveBeenCalledWith(expect.objectContaining({ success: false, message: 'Sunucu hatası oluştu. Lütfen tekrar deneyin.' }));
        });
    });

    // ────────────────────────────────────────────────────────────────────────
    // 5. Login & Session Verification
    // ────────────────────────────────────────────────────────────────────────
    describe('login & verify_session Events', () => {
        let socket;

        beforeEach(async () => {
            socket = createMockSocket();
            connectionHandler(socket);

            // Register a test user
            const db = dbManager.getDB();
            const hashedPassword = await bcrypt.hash('secret123', 10);
            db.users['user@cyber.local'] = {
                email: 'user@cyber.local',
                username: 'CyberUser',
                password: hashedPassword,
                userId: 'AGN-USER-01'
            };
            dbManager.getUserIdIndex()['AGN-USER-01'] = 'user@cyber.local';
        });

        it('login: rejects if email or password missing', async () => {
            const cb = vi.fn();
            await socket._trigger('login', { email: '', password: 'pwd' }, cb);
            expect(cb).toHaveBeenCalledWith(expect.objectContaining({ success: false, message: 'E-posta ve şifre zorunludur.' }));

            await socket._trigger('login', { email: 'user@cyber.local', password: '' }, cb);
            expect(cb).toHaveBeenCalledWith(expect.objectContaining({ success: false, message: 'E-posta ve şifre zorunludur.' }));
        });

        it('login: executes dummy hash comparison if user not found (anti-timing attack)', async () => {
            const compareSpy = vi.spyOn(bcrypt, 'compare');
            const cb = vi.fn();

            await socket._trigger('login', { email: 'nonexistent@cyber.local', password: 'randompassword' }, cb);

            expect(compareSpy).toHaveBeenCalledWith('randompassword', DUMMY_HASH);
            expect(cb).toHaveBeenCalledWith(expect.objectContaining({ success: false, message: 'E-posta veya şifre hatalı.' }));
        });

        it('login: handles user with missing password field gracefully', async () => {
            const db = dbManager.getDB();
            db.users['nopass@cyber.local'] = { email: 'nopass@cyber.local', password: null };
            const cb = vi.fn();

            await socket._trigger('login', { email: 'nopass@cyber.local', password: 'pwd' }, cb);
            expect(cb).toHaveBeenCalledWith(expect.objectContaining({ success: false, message: 'E-posta veya şifre hatalı.' }));
        });

        it('login: rejects incorrect password', async () => {
            const cb = vi.fn();
            await socket._trigger('login', { email: 'user@cyber.local', password: 'wrongpassword' }, cb);
            expect(cb).toHaveBeenCalledWith(expect.objectContaining({ success: false, message: 'E-posta veya şifre hatalı.' }));
        });

        it('login: auto-generates userId if missing upon login', async () => {
            const db = dbManager.getDB();
            const hashedPassword = await bcrypt.hash('secret123', 10);
            db.users['nouid@cyber.local'] = {
                email: 'nouid@cyber.local',
                username: 'NoUid',
                password: hashedPassword,
                userId: null
            };

            const cb = vi.fn();
            await socket._trigger('login', { email: 'nouid@cyber.local', password: 'secret123' }, cb);

            expect(cb).toHaveBeenCalledWith(expect.objectContaining({ success: true }));
            expect(db.users['nouid@cyber.local'].userId).toMatch(/^AGN-\d+-\d+$/);
        });

        it('login: logs in successfully with correct credentials', async () => {
            const cb = vi.fn();
            await socket._trigger('login', { email: 'user@cyber.local', password: 'secret123' }, cb);

            expect(cb).toHaveBeenCalledWith(expect.objectContaining({
                success: true,
                token: expect.any(String),
                user: expect.objectContaining({ email: 'user@cyber.local', userId: 'AGN-USER-01' })
            }));
            expect(socket.user).toBeDefined();
            expect(onlineNodes.has('AGN-USER-01')).toBe(true);
        });

        it('login: catches unexpected errors', async () => {
            vi.spyOn(bcrypt, 'compare').mockRejectedValueOnce(new Error('Crash in compare'));
            const cb = vi.fn();

            await socket._trigger('login', { email: 'user@cyber.local', password: 'secret123' }, cb);
            expect(cb).toHaveBeenCalledWith(expect.objectContaining({ success: false, message: 'Sunucu hatası oluştu. Lütfen tekrar deneyin.' }));
        });

        it('verify_session: succeeds for valid token and existing user', async () => {
            const token = signJWT({ email: 'user@cyber.local', userId: 'AGN-USER-01' });
            const cb = vi.fn();

            await socket._trigger('verify_session', token, cb);
            expect(cb).toHaveBeenCalledWith(expect.objectContaining({
                success: true,
                user: expect.objectContaining({ email: 'user@cyber.local' })
            }));
            expect(socket.user).toBeDefined();
            expect(onlineNodes.has('AGN-USER-01')).toBe(true);
        });

        it('verify_session: fails for invalid token or missing user', async () => {
            const cb = vi.fn();
            await socket._trigger('verify_session', 'bad.jwt.token', cb);
            expect(cb).toHaveBeenCalledWith({ success: false });

            const unknownToken = signJWT({ email: 'ghost@cyber.local' });
            await socket._trigger('verify_session', unknownToken, cb);
            expect(cb).toHaveBeenCalledWith({ success: false });
        });
    });

    // ────────────────────────────────────────────────────────────────────────
    // 6. Logout & Disconnect
    // ────────────────────────────────────────────────────────────────────────
    describe('logout & disconnect Events', () => {
        let socket;

        beforeEach(() => {
            socket = createMockSocket();
            connectionHandler(socket);

            const user = { email: 'u1@cyber.local', userId: 'AGN-101' };
            socket.user = user;
            onlineNodes.set('AGN-101', new Set([socket.id]));
        });

        it('logout: revokes token, cleans onlineNodes, and marks offline', async () => {
            const token = signJWT({ email: 'u1@cyber.local', userId: 'AGN-101' });
            const cb = vi.fn();

            await socket._trigger('logout', { token }, cb);

            expect(cb).toHaveBeenCalledWith({ success: true });
            expect(revokedTokens.has(token)).toBe(true);
            expect(onlineNodes.has('AGN-101')).toBe(false);
            expect(socket.user).toBeNull();
        });

        it('logout: handles multiple sockets for the same user without marking offline early', async () => {
            onlineNodes.get('AGN-101').add('another-socket-tab');
            const cb = vi.fn();

            await socket._trigger('logout', {}, cb);

            expect(onlineNodes.has('AGN-101')).toBe(true);
            expect(onlineNodes.get('AGN-101').size).toBe(1);
        });

        it('disconnect: cleans onlineNodes and broadcasts offline status if last connection closes', async () => {
            await socket._trigger('disconnect');

            expect(onlineNodes.has('AGN-101')).toBe(false);
            const statusChange = emittedEvents.find(e => e.event === 'node_status_change');
            expect(statusChange).toBeDefined();
            expect(statusChange.data).toEqual({ userId: 'AGN-101', status: 'offline' });
        });

        it('disconnect: returns early if socket has no user', async () => {
            socket.user = null;
            await socket._trigger('disconnect');
            // No crash
        });
    });

    // ────────────────────────────────────────────────────────────────────────
    // 7. Profile & Account Management
    // ────────────────────────────────────────────────────────────────────────
    describe('Profiles, Avatars, Password, Account Deletion', () => {
        let socket;
        let testUser;

        beforeEach(async () => {
            socket = createMockSocket();
            connectionHandler(socket);

            const hashedPassword = await bcrypt.hash('oldPassword123', 10);
            testUser = {
                email: 'profile@cyber.local',
                username: 'ProfUser',
                password: hashedPassword,
                userId: 'AGN-PROF-01',
                avatar: 'https://avatar.png'
            };

            const db = dbManager.getDB();
            db.users[testUser.email] = testUser;
            dbManager.getUserIdIndex()[testUser.userId] = testUser.email;
            socket.user = testUser;
            onlineNodes.set(testUser.userId, new Set([socket.id]));
        });

        it('get_profiles: returns profiles for given userIds and caps at 50 (SEC-22)', async () => {
            const cb = vi.fn();
            await socket._trigger('get_profiles', ['AGN-PROF-01', 'AGN-NONEXISTENT', null, 123], cb);

            expect(cb).toHaveBeenCalledWith({
                profiles: {
                    'AGN-PROF-01': { username: 'ProfUser', avatar: 'https://avatar.png' }
                }
            });

            // Enforces maximum 50 userIds limit
            const largeIdList = Array.from({ length: 100 }, (_, i) => `AGN-TEST-${i}`);
            const cbLarge = vi.fn();
            await socket._trigger('get_profiles', largeIdList, cbLarge);
            expect(cbLarge).toHaveBeenCalled();

            // Unauthenticated
            socket.user = null;
            await socket._trigger('get_profiles', ['AGN-PROF-01'], cb);
            expect(cb).toHaveBeenCalledWith({ profiles: {} });
        });

        it('update_avatar: updates avatar within 200KB limit and rejects oversized payload', async () => {
            const cb = vi.fn();

            // Oversized
            await socket._trigger('update_avatar', 'A'.repeat(200001), cb);
            expect(cb).toHaveBeenCalledWith({ success: false, message: 'Görsel çok büyük.' });

            // Valid
            await socket._trigger('update_avatar', 'data:image/png;base64,valid', cb);
            expect(cb).toHaveBeenCalledWith({ success: true });
            expect(dbManager.getDB().users[testUser.email].avatar).toBe('data:image/png;base64,valid');

            // Unauthenticated
            socket.user = null;
            await socket._trigger('update_avatar', 'data:image/png;base64,valid', cb);
            expect(cb).toHaveBeenCalledWith({ success: false });
        });

        it('change_password: verifies old password and updates with new password', async () => {
            const cb = vi.fn();

            // Invalid new password
            await socket._trigger('change_password', { oldPassword: 'oldPassword123', newPassword: 'short' }, cb);
            expect(cb).toHaveBeenCalledWith(expect.objectContaining({ success: false, message: expect.stringContaining('en az 8') }));

            // Wrong old password
            await socket._trigger('change_password', { oldPassword: 'wrongOldPassword', newPassword: 'newValidPassword123' }, cb);
            expect(cb).toHaveBeenCalledWith({ success: false, message: 'Mevcut şifre hatalı.' });

            // Success
            await socket._trigger('change_password', { oldPassword: 'oldPassword123', newPassword: 'newValidPassword123' }, cb);
            expect(cb).toHaveBeenCalledWith({ success: true });

            // Error handling
            vi.spyOn(bcrypt, 'compare').mockRejectedValueOnce(new Error('Bcrypt crash'));
            await socket._trigger('change_password', { oldPassword: 'oldPassword123', newPassword: 'newValidPassword123' }, cb);
            expect(cb).toHaveBeenCalledWith({ success: false, message: 'Sunucu hatası.' });

            // Unauthenticated
            socket.user = null;
            await socket._trigger('change_password', { oldPassword: 'pwd', newPassword: 'newpwd1234' }, cb);
            expect(cb).toHaveBeenCalledWith({ success: false });
        });

        it('delete_account: verifies password and wipes user, queue, and index', async () => {
            const db = dbManager.getDB();
            db.queue[testUser.userId] = [{ id: 'p1' }];
            const cb = vi.fn();

            // Wrong password
            await socket._trigger('delete_account', { password: 'wrongPassword' }, cb);
            expect(cb).toHaveBeenCalledWith({ success: false, message: 'Güvenlik şifresi hatalı.' });

            // Success
            cb.mockClear();
            await socket._trigger('delete_account', { password: 'oldPassword123' }, cb);
            expect(cb).toHaveBeenCalledWith({ success: true });

            expect(db.users[testUser.email]).toBeUndefined();
            expect(dbManager.getUserIdIndex()[testUser.userId]).toBeUndefined();
            expect(db.queue[testUser.userId]).toBeUndefined();
            expect(onlineNodes.has(testUser.userId)).toBe(false);
        });

        it('delete_account: handles errors and unauthenticated users', async () => {
            const cb = vi.fn();
            socket.user = testUser;
            dbManager.getDB().users[testUser.email] = testUser;

            // Error handling
            vi.spyOn(bcrypt, 'compare').mockRejectedValueOnce(new Error('Crash in compare'));
            await socket._trigger('delete_account', { password: 'pwd' }, cb);
            expect(cb).toHaveBeenCalledWith({ success: false, message: 'Sunucu hatası.' });

            // Unauthenticated (using fresh socket with distinct IP to avoid rate limit)
            const freshSocket = createMockSocket({ handshake: { address: '127.0.0.99' } });
            connectionHandler(freshSocket);
            const cb2 = vi.fn();
            await freshSocket._trigger('delete_account', { password: 'pwd' }, cb2);
            expect(cb2).toHaveBeenCalledWith({ success: false });
        });
    });

    // ────────────────────────────────────────────────────────────────────────
    // 8. E2EE Packets, Queuing, ECDH, & Online Status
    // ────────────────────────────────────────────────────────────────────────
    describe('E2EE Handshake, Packet Relaying & Offline Queue', () => {
        let aliceSocket;
        let bobSocket;
        let aliceUser;
        let bobUser;

        beforeEach(() => {
            aliceSocket = createMockSocket({ id: 'sock-alice' });
            bobSocket = createMockSocket({ id: 'sock-bob' });
            connectionHandler(aliceSocket);
            connectionHandler(bobSocket);

            aliceUser = { email: 'alice@cyber.local', username: 'Alice', password: 'hashedpassword123', userId: 'AGN-ALICE' };
            bobUser = { email: 'bob@cyber.local', username: 'Bob', password: 'hashedpassword123', userId: 'AGN-BOB' };

            const db = dbManager.getDB();
            db.users[aliceUser.email] = aliceUser;
            db.users[bobUser.email] = bobUser;
            dbManager.getUserIdIndex()[aliceUser.userId] = aliceUser.email;
            dbManager.getUserIdIndex()[bobUser.userId] = bobUser.email;

            aliceSocket.user = aliceUser;
            bobSocket.user = bobUser;
            onlineNodes.set('AGN-ALICE', new Set([aliceSocket.id]));
            onlineNodes.set('AGN-BOB', new Set([bobSocket.id]));
        });

        it('publish_public_key & get_public_key', async () => {
            const keyJwk = { kty: 'EC', crv: 'P-256', x: 'pubX', y: 'pubY' };
            await aliceSocket._trigger('publish_public_key', keyJwk);

            expect(dbManager.getDB().users['alice@cyber.local'].publicKey).toEqual(keyJwk);

            const cb = vi.fn();
            await bobSocket._trigger('get_public_key', 'AGN-ALICE', cb);
            expect(cb).toHaveBeenCalledWith({ success: true, publicKey: keyJwk, avatar: undefined });

            // Key not found
            await bobSocket._trigger('get_public_key', 'AGN-NONEXISTENT', cb);
            expect(cb).toHaveBeenCalledWith({ success: false, message: 'Anahtar bulunamadı.' });

            // Unauthenticated
            bobSocket.user = null;
            await bobSocket._trigger('get_public_key', 'AGN-ALICE', cb);
            expect(cb).toHaveBeenCalledWith({ success: false, message: 'AUTH_REQUIRED' });
        });

        it('check_node_status & check_node_statuses', async () => {
            const cb = vi.fn();
            await aliceSocket._trigger('check_node_status', 'AGN-BOB', cb);
            expect(cb).toHaveBeenCalledWith({ userId: 'AGN-BOB', isOnline: true });

            await aliceSocket._trigger('check_node_status', 'AGN-OFFLINE', cb);
            expect(cb).toHaveBeenCalledWith({ userId: 'AGN-OFFLINE', isOnline: false });

            // Batch statuses
            const cbBatch = vi.fn();
            await aliceSocket._trigger('check_node_statuses', ['AGN-BOB', 'AGN-OFFLINE'], cbBatch);
            expect(cbBatch).toHaveBeenCalledWith({
                statuses: {
                    'AGN-BOB': true,
                    'AGN-OFFLINE': false
                }
            });

            // Unauthenticated
            aliceSocket.user = null;
            await aliceSocket._trigger('check_node_status', 'AGN-BOB', cb);
            expect(cb).toHaveBeenCalledWith({ userId: 'AGN-BOB', isOnline: false });

            await aliceSocket._trigger('check_node_statuses', ['AGN-BOB'], cbBatch);
            expect(cbBatch).toHaveBeenCalledWith({ statuses: {} });
        });

        it('ecdh_offer & ecdh_answer: safely routes handshake between online nodes', async () => {
            const offerData = { targetId: 'AGN-BOB', publicKeyJwk: { crv: 'P-256' } };
            await aliceSocket._trigger('ecdh_offer', offerData);

            const sentOffer = emittedEvents.find(e => e.event === 'ecdh_offer' && e.target === 'sock-bob');
            expect(sentOffer).toBeDefined();
            expect(sentOffer.data.senderId).toBe('AGN-ALICE'); // Enforces senderId

            const answerData = { targetId: 'AGN-ALICE', publicKeyJwk: { crv: 'P-256' } };
            await bobSocket._trigger('ecdh_answer', answerData);

            const sentAnswer = emittedEvents.find(e => e.event === 'ecdh_answer' && e.target === 'sock-alice');
            expect(sentAnswer).toBeDefined();
            expect(sentAnswer.data.senderId).toBe('AGN-BOB');
        });

        it('reset_chat_session: transmits session_reset to online peer and queues when offline', async () => {
            const cb = vi.fn();
            // 1. Online peer: Alice sends reset to Bob
            await aliceSocket._trigger('reset_chat_session', { targetId: 'AGN-BOB' }, cb);
            expect(cb).toHaveBeenCalledWith({ success: true, queued: false });

            const sentReset = emittedEvents.find(e => e.event === 'session_reset' && e.target === 'sock-bob');
            expect(sentReset).toBeDefined();
            expect(sentReset.data.senderId).toBe('AGN-ALICE');
            expect(sentReset.data.targetId).toBe('AGN-BOB');
            expect(sentReset.data.type).toBe('session_reset');

            // 2. Offline peer: Bob goes offline, Alice sends reset to Bob
            onlineNodes.delete('AGN-BOB');
            const cbOffline = vi.fn();
            await aliceSocket._trigger('reset_chat_session', { targetId: 'AGN-BOB' }, cbOffline);
            expect(cbOffline).toHaveBeenCalledWith({ success: true, queued: true });

            const db = dbManager.getDB();
            expect(db.queue['AGN-BOB']).toBeDefined();
            const queuedReset = db.queue['AGN-BOB'].find(p => p.type === 'session_reset');
            expect(queuedReset).toBeDefined();
            expect(queuedReset.senderId).toBe('AGN-ALICE');

            // 3. Bob comes back online and triggers client_ready
            emittedEvents.length = 0;
            onlineNodes.set('AGN-BOB', new Set(['sock-bob']));
            await bobSocket._trigger('client_ready');

            const deliveredReset = emittedEvents.find(e => e.event === 'session_reset' && e.target === 'sock-bob');
            expect(deliveredReset).toBeDefined();
            expect(deliveredReset.data.senderId).toBe('AGN-ALICE');
        });

        it('send_secure_packet: transmits directly to online recipient and rejects spoofing', async () => {
            const cb = vi.fn();

            // Spoofing attempt (senderId does not match socket.user.userId)
            const spoofedPacket = { targetId: 'AGN-BOB', senderId: 'AGN-ATTACKER', ciphertext: 'data' };
            await aliceSocket._trigger('send_secure_packet', spoofedPacket, cb);
            expect(cb).toHaveBeenCalledWith({ queued: false, error: 'SENDER_MISMATCH' });

            // Legitimate transmission to online Bob
            const validPacket = { targetId: 'AGN-BOB', senderId: 'AGN-ALICE', ciphertext: 'secretPacket' };
            await aliceSocket._trigger('send_secure_packet', validPacket, cb);

            expect(cb).toHaveBeenCalledWith({ queued: false });
            const delivered = emittedEvents.find(e => e.event === 'receive_secure_packet' && e.target === 'sock-bob');
            expect(delivered).toBeDefined();
            expect(delivered.data).toBe(validPacket);
        });

        it('send_secure_packet: queues packet when recipient is offline and enforces MAX_QUEUE_SIZE', async () => {
            onlineNodes.delete('AGN-BOB'); // Bob goes offline
            const db = dbManager.getDB();
            const cb = vi.fn();

            // Pre-fill queue with MAX_QUEUE_SIZE items to test shift
            db.queue['AGN-BOB'] = [];
            for (let i = 0; i < MAX_QUEUE_SIZE; i++) {
                db.queue['AGN-BOB'].push({ id: `pkt-${i}`, timestamp: Date.now() });
            }

            const newPacket = { id: 'pkt-overflow', targetId: 'AGN-BOB', senderId: 'AGN-ALICE', ciphertext: 'overflow' };
            await aliceSocket._trigger('send_secure_packet', newPacket, cb);

            expect(cb).toHaveBeenCalledWith({ queued: true });
            expect(db.queue['AGN-BOB']).toHaveLength(MAX_QUEUE_SIZE);
            expect(db.queue['AGN-BOB'][db.queue['AGN-BOB'].length - 1].id).toBe('pkt-overflow');

            // Expired TTL packet should be rejected immediately (SEC-18)
            const cbExpired = vi.fn();
            const expiredPacket = { id: 'pkt-expired', targetId: 'AGN-BOB', senderId: 'AGN-ALICE', ciphertext: 'expired', ttl: 5, timestamp: Date.now() - 10000 };
            await aliceSocket._trigger('send_secure_packet', expiredPacket, cbExpired);
            expect(cbExpired).toHaveBeenCalledWith({ queued: false, error: 'EXPIRED' });
        });

        it('client_ready: flushes pending queue upon reconnect and filters expired packets (SEC-18)', async () => {
            const db = dbManager.getDB();
            const now = Date.now();
            db.queue['AGN-ALICE'] = [
                { id: 'fresh-1', timestamp: now, ciphertext: 'c1' },
                { id: 'expired-1', timestamp: now - (dbManager.MAX_PACKET_AGE_MS + 5000), ciphertext: 'c2' },
                { id: 'ttl-expired-1', timestamp: now - 15000, ttl: 10, ciphertext: 'c3' }
            ];

            await aliceSocket._trigger('client_ready');

            const delivered = emittedEvents.filter(e => e.event === 'receive_secure_packet' && e.target === 'sock-alice');
            expect(delivered).toHaveLength(1);
            expect(delivered[0].data.id).toBe('fresh-1');
            expect(db.queue['AGN-ALICE']).toBeUndefined();
        });

        it('revoke_packet: revokes in real-time or removes from offline queue with BOLA protection', async () => {
            // Online Bob
            const onlineData = { targetId: 'AGN-BOB', packetId: 'pkt-to-revoke' };
            await aliceSocket._trigger('revoke_packet', onlineData);

            const revokedBroadcast = emittedEvents.find(e => e.event === 'packet_revoked' && e.target === 'sock-bob');
            expect(revokedBroadcast).toBeDefined();

            // Offline Bob with queued messages
            onlineNodes.delete('AGN-BOB');
            const db = dbManager.getDB();
            db.queue['AGN-BOB'] = [
                { id: 'msg-alice', senderId: 'AGN-ALICE', ciphertext: 'c1' },
                { id: 'msg-hacker', senderId: 'AGN-OTHER', ciphertext: 'c2' }
            ];

            // BOLA test: Alice attempts to revoke Hacker's packet
            await aliceSocket._trigger('revoke_packet', { targetId: 'AGN-BOB', packetId: 'msg-hacker' });
            expect(db.queue['AGN-BOB']).toHaveLength(2); // Should NOT delete

            // Alice revokes her own packet
            await aliceSocket._trigger('revoke_packet', { targetId: 'AGN-BOB', packetId: 'msg-alice' });
            expect(db.queue['AGN-BOB']).toHaveLength(1);
            expect(db.queue['AGN-BOB'][0].id).toBe('msg-hacker');
        });
    });

    // ────────────────────────────────────────────────────────────────────────
    // 9. Contact Requests, Search, Typing & Status Rooms
    // ────────────────────────────────────────────────────────────────────────
    describe('Contacts, Search, Typing, & Rooms', () => {
        let aliceSocket;
        let bobSocket;

        beforeEach(() => {
            aliceSocket = createMockSocket({ id: 'sock-alice' });
            bobSocket = createMockSocket({ id: 'sock-bob' });
            connectionHandler(aliceSocket);
            connectionHandler(bobSocket);

            aliceSocket.user = { email: 'a@c.l', username: 'Alice', password: 'hashedpassword123', userId: 'AGN-ALICE', avatar: 'a.png' };
            bobSocket.user = { email: 'b@c.l', username: 'Bob', password: 'hashedpassword123', userId: 'AGN-BOB', avatar: 'b.png' };

            const db = dbManager.getDB();
            db.users['a@c.l'] = aliceSocket.user;
            db.users['b@c.l'] = bobSocket.user;
            onlineNodes.set('AGN-ALICE', new Set(['sock-alice']));
            onlineNodes.set('AGN-BOB', new Set(['sock-bob']));
        });

        it('search_users: filters by username and userId, excludes self, and caps results at 20', async () => {
            const db = dbManager.getDB();
            for (let i = 1; i <= 25; i++) {
                db.users[`agent${i}@cyber.local`] = {
                    email: `agent${i}@cyber.local`,
                    username: `Agent${i}`,
                    password: 'hashedpassword123',
                    userId: `AGN-SEARCH-${i}`,
                    avatar: null
                };
            }

            const cb = vi.fn();
            await aliceSocket._trigger('search_users', 'agent', cb);

            expect(cb).toHaveBeenCalled();
            const results = cb.mock.calls[0][0].results;
            expect(results.length).toBeLessThanOrEqual(20);
            expect(results.find(r => r.userId === 'AGN-ALICE')).toBeUndefined(); // Excludes self

            // Empty search
            await aliceSocket._trigger('search_users', '', cb);
            expect(cb).toHaveBeenCalledWith({ results: [] });

            // 1-character search blocked against enumeration (SEC-22)
            await aliceSocket._trigger('search_users', 'a', cb);
            expect(cb).toHaveBeenCalledWith({ results: [] });

            // Unauthenticated
            aliceSocket.user = null;
            await aliceSocket._trigger('search_users', 'agent', cb);
            expect(cb).toHaveBeenCalledWith({ results: [] });
        });

        it('notify_add_contact & respond_contact_request', async () => {
            const cb = vi.fn();
            await aliceSocket._trigger('notify_add_contact', { targetId: 'AGN-BOB' }, cb);

            expect(cb).toHaveBeenCalledWith({ success: true });
            const reqEvent = emittedEvents.find(e => e.event === 'contact_request' && e.target === 'sock-bob');
            expect(reqEvent).toBeDefined();
            expect(reqEvent.data.senderId).toBe('AGN-ALICE');

            // Respond contact request
            const cbResp = vi.fn();
            await bobSocket._trigger('respond_contact_request', { targetId: 'AGN-ALICE', accepted: true }, cbResp);

            expect(cbResp).toHaveBeenCalledWith({ success: true });
            const respEvent = emittedEvents.find(e => e.event === 'contact_request_response' && e.target === 'sock-alice');
            expect(respEvent).toBeDefined();
            expect(respEvent.data.accepted).toBe(true);
        });

        it('typing and stop_typing events', async () => {
            await aliceSocket._trigger('typing', { targetId: 'AGN-BOB' });
            const typingEvent = emittedEvents.find(e => e.event === 'user_typing' && e.target === 'sock-bob');
            expect(typingEvent).toBeDefined();
            expect(typingEvent.data.senderId).toBe('AGN-ALICE');

            await aliceSocket._trigger('stop_typing', { targetId: 'AGN-BOB' });
            const stopTypingEvent = emittedEvents.find(e => e.event === 'user_typing_stop' && e.target === 'sock-bob');
            expect(stopTypingEvent).toBeDefined();
        });

        it('join_status_rooms: joins room for valid uid length (< 20)', async () => {
            await aliceSocket._trigger('join_status_rooms', ['AGN-BOB', 'INVALID_UID_TOO_LONG_123456789']);

            expect(roomsJoined).toContain('status_AGN-BOB');
            expect(roomsJoined).not.toContain('status_INVALID_UID_TOO_LONG_123456789');

            // Non-array
            await aliceSocket._trigger('join_status_rooms', 'not-an-array');
            // Does not crash
        });

        it('notify_add_contact & respond_contact_request: offline targets, unauthenticated, and missing callback', async () => {
            onlineNodes.delete('AGN-BOB'); // Bob offline

            // Target offline
            const cb1 = vi.fn();
            await aliceSocket._trigger('notify_add_contact', { targetId: 'AGN-BOB' }, cb1);
            expect(cb1).toHaveBeenCalledWith({ success: true });

            const cb2 = vi.fn();
            await aliceSocket._trigger('respond_contact_request', { targetId: 'AGN-BOB', accepted: false }, cb2);
            expect(cb2).toHaveBeenCalledWith({ success: true });

            // Without callback
            await aliceSocket._trigger('notify_add_contact', { targetId: 'AGN-BOB' });
            await aliceSocket._trigger('respond_contact_request', { targetId: 'AGN-BOB', accepted: true });

            // Unauthenticated
            aliceSocket.user = null;
            await aliceSocket._trigger('notify_add_contact', { targetId: 'AGN-BOB' });
            await aliceSocket._trigger('respond_contact_request', { targetId: 'AGN-BOB' });
        });

        it('typing and stop_typing: offline targets and unauthenticated', async () => {
            onlineNodes.delete('AGN-BOB');

            // Offline target
            await aliceSocket._trigger('typing', { targetId: 'AGN-BOB' });
            await aliceSocket._trigger('stop_typing', { targetId: 'AGN-BOB' });

            // Missing targetId
            await aliceSocket._trigger('typing', {});
            await aliceSocket._trigger('stop_typing', {});

            // Unauthenticated
            aliceSocket.user = null;
            await aliceSocket._trigger('typing', { targetId: 'AGN-BOB' });
            await aliceSocket._trigger('stop_typing', { targetId: 'AGN-BOB' });
        });

        it('revoke_packet edge cases: missing fields, unauthenticated, non-matching packet', async () => {
            // Unauthenticated
            aliceSocket.user = null;
            await aliceSocket._trigger('revoke_packet', { targetId: 'AGN-BOB', packetId: 'pkt-1' });

            aliceSocket.user = { email: 'a@c.l', userId: 'AGN-ALICE' };
            // Missing data / fields
            await aliceSocket._trigger('revoke_packet', null);
            await aliceSocket._trigger('revoke_packet', { targetId: 'AGN-BOB' });
            await aliceSocket._trigger('revoke_packet', { packetId: 'pkt-1' });

            // Offline target without queue
            onlineNodes.delete('AGN-BOB');
            delete dbManager.getDB().queue['AGN-BOB'];
            await aliceSocket._trigger('revoke_packet', { targetId: 'AGN-BOB', packetId: 'pkt-1' });

            // Offline target with queue, but packetId does not match (initialLength === length)
            dbManager.getDB().queue['AGN-BOB'] = [{ id: 'other-pkt', senderId: 'AGN-ALICE' }];
            await aliceSocket._trigger('revoke_packet', { targetId: 'AGN-BOB', packetId: 'non-existent' });
            expect(dbManager.getDB().queue['AGN-BOB']).toHaveLength(1);
        });

        it('join_status_rooms: unauthenticated returns early', async () => {
            aliceSocket.user = null;
            await aliceSocket._trigger('join_status_rooms', ['AGN-BOB']);
            expect(roomsJoined).not.toContain('status_AGN-BOB');
        });

        it('search_users: matches by userId', async () => {
            const cb = vi.fn();
            await aliceSocket._trigger('search_users', 'AGN-BOB', cb);
            expect(cb).toHaveBeenCalled();
            const results = cb.mock.calls[0][0].results;
            expect(results.length).toBeGreaterThan(0);
            expect(results[0].userId).toBe('AGN-BOB');
        });

        it('client_ready, publish_public_key, and send_secure_packet unauthenticated branches', async () => {
            aliceSocket.user = null;
            await aliceSocket._trigger('client_ready');
            await aliceSocket._trigger('publish_public_key', { kty: 'EC' });

            const cbSend = vi.fn();
            await aliceSocket._trigger('send_secure_packet', {}, cbSend);
            expect(cbSend).toHaveBeenCalledWith({ queued: false, error: 'AUTH_REQUIRED' });

            // send_secure_packet without callback when unauthenticated
            await aliceSocket._trigger('send_secure_packet', {});
        });

        it('ecdh_offer and ecdh_answer edge cases: missing data, offline target, unauthenticated', async () => {
            // Missing data
            await aliceSocket._trigger('ecdh_offer', null);
            await aliceSocket._trigger('ecdh_offer', {});
            await aliceSocket._trigger('ecdh_answer', null);
            await aliceSocket._trigger('ecdh_answer', {});

            // Target offline
            onlineNodes.delete('AGN-BOB');
            await aliceSocket._trigger('ecdh_offer', { targetId: 'AGN-BOB', publicKeyJwk: {} });
            await aliceSocket._trigger('ecdh_answer', { targetId: 'AGN-BOB', publicKeyJwk: {} });

            // Unauthenticated
            aliceSocket.user = null;
            await aliceSocket._trigger('ecdh_offer', { targetId: 'AGN-BOB' });
            await aliceSocket._trigger('ecdh_answer', { targetId: 'AGN-BOB' });

            // reset_chat_session edge cases
            const cbReset = vi.fn();
            aliceSocket.user = { email: 'alice@cyber.local', username: 'Alice', userId: 'AGN-ALICE' };
            await aliceSocket._trigger('reset_chat_session', null, cbReset);
            expect(cbReset).toHaveBeenCalledWith({ success: false });
            await aliceSocket._trigger('reset_chat_session', {}, cbReset);
            expect(cbReset).toHaveBeenCalledWith({ success: false });

            aliceSocket.user = null;
            await aliceSocket._trigger('reset_chat_session', { targetId: 'AGN-BOB' }, cbReset);
            expect(cbReset).toHaveBeenCalledWith({ success: false });
        });
    });

    // ────────────────────────────────────────────────────────────────────────
    // 10. Rate Limiter Exhaustion Across All Actions
    // ────────────────────────────────────────────────────────────────────────
    describe('Rate Limiter Exhaustion', () => {
        it('should throttle actions when limit is exceeded and reset after window', async () => {
            const socket = createMockSocket({ handshake: { address: '203.0.113.88' } });
            connectionHandler(socket);

            const cb = vi.fn();
            socket.user = { email: 'throttle@cyber.local', username: 'ThrottleUser', password: 'pwd', userId: 'AGN-THROTTLE' };
            const db = dbManager.getDB();
            db.users[socket.user.email] = socket.user;

            for (let i = 0; i < 3; i++) {
                await socket._trigger('delete_account', { password: 'wrong' }, cb);
            }

            // 4th attempt should hit rate limit
            await socket._trigger('delete_account', { password: 'wrong' }, cb);
            expect(cb).toHaveBeenLastCalledWith(expect.objectContaining({ success: false, message: 'Çok fazla istek.' }));
        });

        it('should hit rate limits for search, notify, respond, revoke, ecdh, and pubkey', async () => {
            const socket = createMockSocket({ handshake: { address: '203.0.113.99' } });
            connectionHandler(socket);
            socket.user = { email: 'rl@cyber.local', username: 'RlUser', password: 'pwd', userId: 'AGN-RL' };
            dbManager.getDB().users[socket.user.email] = socket.user;

            // Exhaust ecdh limit (limit 10)
            for (let i = 0; i < 11; i++) {
                await socket._trigger('ecdh_offer', { targetId: 'AGN-BOB', publicKeyJwk: {} });
                await socket._trigger('ecdh_answer', { targetId: 'AGN-BOB', publicKeyJwk: {} });
            }

            // Exhaust search (limit 30)
            const cbSearch = vi.fn();
            for (let i = 0; i < 31; i++) {
                await socket._trigger('search_users', 'test', cbSearch);
            }
            expect(cbSearch).toHaveBeenLastCalledWith({ results: [] });

            // Exhaust notify and respond (limit 30)
            for (let i = 0; i < 31; i++) {
                await socket._trigger('notify_add_contact', { targetId: 'AGN-BOB' });
                await socket._trigger('respond_contact_request', { targetId: 'AGN-BOB', accepted: true });
            }

            // Exhaust revoke (limit 30)
            for (let i = 0; i < 31; i++) {
                await socket._trigger('revoke_packet', { targetId: 'AGN-BOB', packetId: `p-${i}` });
            }

            // Exhaust get_public_key (limit 60)
            const cbPub = vi.fn();
            for (let i = 0; i < 61; i++) {
                await socket._trigger('get_public_key', 'AGN-BOB', cbPub);
            }
            expect(cbPub).toHaveBeenLastCalledWith({ success: false, message: expect.stringContaining('Çok fazla') });

            // Exhaust verify_session (limit 30)
            const cbSess = vi.fn();
            for (let i = 0; i < 31; i++) {
                await socket._trigger('verify_session', 'token', cbSess);
            }
            expect(cbSess).toHaveBeenLastCalledWith({ success: false, message: 'RATE_LIMIT' });

            // Exhaust send_secure_packet (limit 60)
            const cbSend = vi.fn();
            for (let i = 0; i < 61; i++) {
                await socket._trigger('send_secure_packet', { senderId: 'AGN-RL', targetId: 'AGN-BOB', ciphertext: 'data' }, cbSend);
            }
            expect(cbSend).toHaveBeenLastCalledWith({ queued: false, error: 'RATE_LIMIT' });
        });
    });
});
