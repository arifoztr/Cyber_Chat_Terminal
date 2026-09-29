import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import http from 'http';
const dbManager = require('../src/database.js');
import serverModule from '../src/server.js';
const { app, isOriginAllowed, gracefulShutdown, startServer } = serverModule;

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

        it('should enforce strict CSP script-src without unsafe-inline (SEC-13)', () => {
            const { req, res } = createMockReqRes('/test');
            const next = vi.fn();
            const middleware = app._router.stack.find(s => s.name === '<anonymous>' && s.handle.length === 3).handle;
            middleware(req, res, next);
            expect(res.setHeader).toHaveBeenCalledWith('Content-Security-Policy', expect.stringContaining("script-src 'self'"));
            const cspCall = res.setHeader.mock.calls.find(c => c[0] === 'Content-Security-Policy');
            const csp = cspCall[1];
            const scriptSrcPart = csp.split(';').find(p => p.trim().startsWith('script-src'));
            expect(scriptSrcPart).not.toContain('unsafe-inline');
            expect(scriptSrcPart).not.toContain('cdn.tailwindcss.com');
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

    describe('HTTP Rate Limiting, Error Handling, and Route Edge Cases', () => {
        it('HTTP rate limiter: bypasses /socket.io/ and blocks requests when limit exceeds 120/min', () => {
            const rateLimitMiddleware = app._router.stack.find(s => s.name === '<anonymous>' && s.handle.length === 3 && s.handle.toString().includes('httpRateLimits')).handle;

            // 1. /socket.io/ bypass
            const nextSocket = vi.fn();
            rateLimitMiddleware({ url: '/socket.io/?EIO=4' }, {}, nextSocket);
            expect(nextSocket).toHaveBeenCalled();

            // 2. Normal requests under limit
            const ip = '198.51.100.55';
            const mockReq = { url: '/api/v1/test', ip };
            for (let i = 0; i < 120; i++) {
                const nextFn = vi.fn();
                rateLimitMiddleware(mockReq, {}, nextFn);
                expect(nextFn).toHaveBeenCalled();
            }

            // 3. 120th request exceeds limit -> 429 status
            let statusCode = null;
            let jsonPayload = null;
            const mockRes = {
                status: (c) => {
                    statusCode = c;
                    return { json: (b) => { jsonPayload = b; } };
                }
            };
            rateLimitMiddleware(mockReq, mockRes, () => {});
            expect(statusCode).toBe(429);
            expect(jsonPayload).toEqual({ error: 'Çok fazla istek yapıldı. Lütfen bir dakika bekleyin.' });
        });

        it('HTTP rate limiter: periodic interval cleans up expired entries', async () => {
            vi.useFakeTimers();
            const rateLimitMiddleware = app._router.stack.find(s => s.name === '<anonymous>' && s.handle.length === 3 && s.handle.toString().includes('httpRateLimits')).handle;
            const ip = '198.51.100.77';
            rateLimitMiddleware({ url: '/test-exp', ip }, {}, () => {});

            // Advance timers by 65 seconds to trigger interval and delete expired record
            await vi.advanceTimersByTimeAsync(65000);
            vi.useRealTimers();
        });

        it('GET /health route handler: executes and returns status 200 with timestamp', () => {
            const healthLayer = app._router.stack.find(s => s.route && s.route.path === '/health');
            const handler = healthLayer.route.stack[0].handle;
            let statusCode = null;
            let jsonPayload = null;
            const mockRes = {
                status: (c) => {
                    statusCode = c;
                    return { json: (b) => { jsonPayload = b; } };
                }
            };
            handler({}, mockRes);
            expect(statusCode).toBe(200);
            expect(jsonPayload.status).toBe('ok');
            expect(typeof jsonPayload.timestamp).toBe('string');
        });

        it('GET / route handler: sets Cache-Control no-cache and sends index.html', () => {
            const rootLayer = app._router.stack.find(s => s.route && s.route.path === '/');
            const handler = rootLayer.route.stack[0].handle;
            const mockRes = {
                setHeader: vi.fn(),
                sendFile: vi.fn()
            };
            handler({}, mockRes);
            expect(mockRes.setHeader).toHaveBeenCalledWith('Cache-Control', expect.stringContaining('no-store'));
            expect(mockRes.sendFile).toHaveBeenCalledWith(expect.stringContaining('index.html'));
        });

        it('404 middleware: bypasses /socket.io/ and returns 404 for unknown endpoints', () => {
            const notFoundMiddleware = app._router.stack.find(s => s.name === '<anonymous>' && s.handle.length === 3 && s.handle.toString().includes('Endpoint bulunamadı')).handle;

            const nextSocket = vi.fn();
            notFoundMiddleware({ url: '/socket.io/?EIO=4' }, {}, nextSocket);
            expect(nextSocket).toHaveBeenCalled();

            let statusCode = null;
            let jsonPayload = null;
            const mockRes = {
                status: (c) => {
                    statusCode = c;
                    return { json: (b) => { jsonPayload = b; } };
                }
            };
            notFoundMiddleware({ url: '/non-existent-page' }, mockRes, () => {});
            expect(statusCode).toBe(404);
            expect(jsonPayload).toEqual({ error: 'Endpoint bulunamadı.' });
        });

        it('500 error handler: logs error and returns err.status or 500 json response', () => {
            const errorHandler = app._router.stack.find(s => s.handle.length === 4).handle;
            const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

            // Default 500
            let status500 = null;
            let body500 = null;
            const res500 = {
                status: (c) => {
                    status500 = c;
                    return { json: (b) => { body500 = b; } };
                }
            };
            errorHandler(new Error('Fatal unhandled error'), {}, res500, () => {});
            expect(status500).toBe(500);
            expect(body500).toEqual({ error: 'Sunucu hatası oluştu.' });
            expect(consoleSpy).toHaveBeenCalledWith(expect.stringContaining('Unhandled HTTP Error:'), 'Fatal unhandled error');

            // Custom error status
            let statusCustom = null;
            const resCustom = {
                status: (c) => {
                    statusCustom = c;
                    return { json: () => {} };
                }
            };
            errorHandler({ status: 403, message: 'Forbidden access' }, {}, resCustom, () => {});
            expect(statusCustom).toBe(403);

            consoleSpy.mockRestore();
        });
    });
});
