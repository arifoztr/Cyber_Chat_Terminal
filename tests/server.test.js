import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import http from 'http';
const dbManager = require('../src/database');
const { app, isOriginAllowed, gracefulShutdown, startServer } = require('../src/server');

describe('Server & Express Infrastructure Tests', () => {
    const originalEnv = { ...process.env };

    afterEach(() => {
        process.env = { ...originalEnv };
        vi.restoreAllMocks();
    });

    describe('isOriginAllowed (CORS & CSWSH Defense)', () => {
        it('should allow empty, null, undefined, or file:// origins', () => {
            const cb1 = vi.fn();
            isOriginAllowed(null, cb1);
            expect(cb1).toHaveBeenCalledWith(null, true);

            const cb2 = vi.fn();
            isOriginAllowed('', cb2);
            expect(cb2).toHaveBeenCalledWith(null, true);

            const cb3 = vi.fn();
            isOriginAllowed(undefined, cb3);
            expect(cb3).toHaveBeenCalledWith(null, true);

            const cb4 = vi.fn();
            isOriginAllowed('file:///path/to/electron/app', cb4);
            expect(cb4).toHaveBeenCalledWith(null, true);
        });

        it('should reject string "null" origin to defend against sandboxed iframes', () => {
            const cb = vi.fn();
            isOriginAllowed('null', cb);
            expect(cb).toHaveBeenCalledWith(expect.any(Error));
            expect(cb.mock.calls[0][0].message).toContain('CSWSH Savunması: "null" origin');
        });

        it('should respect CORS_ORIGIN whitelist when environment variable is present', () => {
            process.env.CORS_ORIGIN = 'https://cyber.local, https://secure.chat';

            const cbAllowed = vi.fn();
            isOriginAllowed('https://cyber.local', cbAllowed);
            expect(cbAllowed).toHaveBeenCalledWith(null, true);

            const cbDisallowed = vi.fn();
            isOriginAllowed('https://evil.com', cbDisallowed);
            expect(cbDisallowed).toHaveBeenCalledWith(expect.any(Error));
            expect(cbDisallowed.mock.calls[0][0].message).toContain('CORS Savunması: Yetkisiz Origin');
        });

        it('should allow localhost, 127.0.0.1, and 0.0.0.0 when CORS_ORIGIN is not set', () => {
            delete process.env.CORS_ORIGIN;

            const cb1 = vi.fn();
            isOriginAllowed('http://localhost:3000', cb1);
            expect(cb1).toHaveBeenCalledWith(null, true);

            const cb2 = vi.fn();
            isOriginAllowed('http://127.0.0.1:8080', cb2);
            expect(cb2).toHaveBeenCalledWith(null, true);

            const cb3 = vi.fn();
            isOriginAllowed('http://0.0.0.0:5000', cb3);
            expect(cb3).toHaveBeenCalledWith(null, true);
        });

        it('should reject unknown remote origin when CORS_ORIGIN is not set', () => {
            delete process.env.CORS_ORIGIN;

            const cb = vi.fn();
            isOriginAllowed('https://malicious.example.com', cb);
            expect(cb).toHaveBeenCalledWith(expect.any(Error));
            expect(cb.mock.calls[0][0].message).toContain('CSWSH Savunması: Bilinmeyen Origin');
        });

        it('should reject unparseable/malformed origin gracefully', () => {
            delete process.env.CORS_ORIGIN;

            const cb = vi.fn();
            isOriginAllowed('::not a valid url::', cb);
            expect(cb).toHaveBeenCalledWith(expect.any(Error));
            expect(cb.mock.calls[0][0].message).toContain('CSWSH Savunması: Bilinmeyen Origin');
        });
    });

    describe('Express Middleware & Security Headers', () => {
        const createMockReqRes = (url = '/', method = 'GET') => {
            const headers = {};
            const req = {
                url,
                method
            };
            const res = {
                setHeader: vi.fn((key, value) => { headers[key.toLowerCase()] = value; }),
                getHeader: (key) => headers[key.toLowerCase()],
                _headers: headers
            };
            return { req, res };
        };

        it('should set production HSTS header when NODE_ENV is production', () => {
            process.env.NODE_ENV = 'production';
            const { req, res } = createMockReqRes('/test');
            const next = vi.fn();

            // First middleware in app._router.stack
            const middleware = app._router.stack.find(s => s.name === '<anonymous>' && s.handle.length === 3).handle;
            middleware(req, res, next);

            expect(res.setHeader).toHaveBeenCalledWith('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
            expect(res.setHeader).toHaveBeenCalledWith('X-Content-Type-Options', 'nosniff');
            expect(res.setHeader).toHaveBeenCalledWith('X-Frame-Options', 'DENY');
            expect(res.setHeader).toHaveBeenCalledWith('X-XSS-Protection', '0');
            expect(res.setHeader).toHaveBeenCalledWith('Content-Security-Policy', expect.stringContaining("default-src 'self'"));
            expect(res.setHeader).toHaveBeenCalledWith('Cache-Control', expect.stringContaining('no-store'));
            expect(next).toHaveBeenCalled();
        });

        it('should not set HSTS when NODE_ENV is development', () => {
            process.env.NODE_ENV = 'development';
            const { req, res } = createMockReqRes('/test');
            const next = vi.fn();

            const middleware = app._router.stack.find(s => s.name === '<anonymous>' && s.handle.length === 3).handle;
            middleware(req, res, next);

            expect(res._headers['strict-transport-security']).toBeUndefined();
            expect(next).toHaveBeenCalled();
        });

        it('should log HTTP requests when URL does not contain /socket.io/', () => {
            const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
            const { req, res } = createMockReqRes('/api/data', 'GET');
            const next = vi.fn();

            const middleware = app._router.stack.find(s => s.name === '<anonymous>' && s.handle.length === 3).handle;
            middleware(req, res, next);

            expect(consoleSpy).toHaveBeenCalledWith('[HTTP GET] /api/data');
            consoleSpy.mockRestore();
        });

        it('should suppress log when URL includes /socket.io/', () => {
            const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
            const { req, res } = createMockReqRes('/socket.io/?EIO=4&transport=polling', 'GET');
            const next = vi.fn();

            const middleware = app._router.stack.find(s => s.name === '<anonymous>' && s.handle.length === 3).handle;
            middleware(req, res, next);

            expect(consoleSpy).not.toHaveBeenCalled();
            consoleSpy.mockRestore();
        });
    });

    describe('Endpoints & HTTP Lifecycle', () => {
        let server;
        let port;

        beforeEach(async () => {
            await new Promise((resolve) => {
                server = app.listen(0, '127.0.0.1', () => {
                    port = server.address().port;
                    resolve();
                });
            });
        });

        afterEach(async () => {
            if (server) {
                await new Promise((resolve) => server.close(resolve));
            }
        });

        it('GET /health should return 200 with status ok and timestamp', async () => {
            const responseData = await new Promise((resolve, reject) => {
                http.get(`http://127.0.0.1:${port}/health`, (res) => {
                    let data = '';
                    res.on('data', chunk => { data += chunk; });
                    res.on('end', () => {
                        resolve({ statusCode: res.statusCode, body: JSON.parse(data) });
                    });
                }).on('error', reject);
            });

            expect(responseData.statusCode).toBe(200);
            expect(responseData.body.status).toBe('ok');
            expect(typeof responseData.body.timestamp).toBe('string');
        });

        it('GET / should serve index.html with no-cache headers', async () => {
            const responseData = await new Promise((resolve, reject) => {
                http.get(`http://127.0.0.1:${port}/`, (res) => {
                    let data = '';
                    res.on('data', chunk => { data += chunk; });
                    res.on('end', () => {
                        resolve({
                            statusCode: res.statusCode,
                            headers: res.headers,
                            body: data
                        });
                    });
                }).on('error', reject);
            });

            expect(responseData.statusCode).toBe(200);
            expect(responseData.headers['cache-control']).toContain('no-store');
            expect(responseData.body).toContain('<!DOCTYPE html>');
        });
    });

    describe('startServer and gracefulShutdown', () => {
        it('startServer should initialize DB, start garbage collector, and listen', async () => {
            const initDbSpy = vi.spyOn(dbManager, 'initDB').mockResolvedValue(true);
            const gcSpy = vi.spyOn(dbManager, 'startGarbageCollector').mockImplementation(() => {});

            const listeningServer = await startServer(0);
            expect(initDbSpy).toHaveBeenCalled();
            expect(gcSpy).toHaveBeenCalled();
            expect(listeningServer).toBeDefined();

            await new Promise((resolve) => listeningServer.close(resolve));
        });

        it('gracefulShutdown should save database immediately and exit process', async () => {
            const saveImmediateSpy = vi.spyOn(dbManager, 'saveDatabaseImmediate').mockResolvedValue();
            const exitSpy = vi.spyOn(process, 'exit').mockImplementation(() => {});
            const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {});

            await gracefulShutdown('SIGTERM');

            expect(saveImmediateSpy).toHaveBeenCalled();
            expect(exitSpy).toHaveBeenCalledWith(0);
            consoleSpy.mockRestore();
        });
    });
});
