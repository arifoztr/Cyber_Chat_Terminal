import { describe, it, expect } from 'vitest';

// Test ortamı için geçerli uzunlukta bir JWT_SECRET tanımlayarak uyarıyı temizliyoruz
process.env.JWT_SECRET = 'cyber-chat-terminal-super-secure-jwt-test-key-32chars';
const setupSockets = require('../src/socket.js');
const { signJWT, verifyJWT, revokeToken, getClientIp, revokedTokens } = setupSockets._internals;

describe('Authentication & JWT Security Unit Tests', () => {
    const samplePayload = {
        email: 'operator@cyber.local',
        userId: 'AGN-1337-4242',
        username: 'Operator1337'
    };

    it('should sign and successfully verify a valid JWT', () => {
        const token = signJWT(samplePayload);
        expect(typeof token).toBe('string');
        expect(token.split('.')).toHaveLength(3);

        const decoded = verifyJWT(token);
        expect(decoded).not.toBeNull();
        expect(decoded.email).toBe(samplePayload.email);
        expect(decoded.userId).toBe(samplePayload.userId);
        expect(decoded.username).toBe(samplePayload.username);
        expect(decoded.exp).toBeGreaterThan(Math.floor(Date.now() / 1000));
    });

    it('should reject a JWT with an altered payload or signature (tampering)', () => {
        const token = signJWT(samplePayload);
        const [header, body, signature] = token.split('.');

        // Tamper payload (e.g. change userId to admin)
        const parsedBody = JSON.parse(Buffer.from(body, 'base64url').toString());
        parsedBody.userId = 'AGN-ADMIN-9999';
        const tamperedBody = Buffer.from(JSON.stringify(parsedBody)).toString('base64url');
        const tamperedToken = `${header}.${tamperedBody}.${signature}`;

        expect(verifyJWT(tamperedToken)).toBeNull();
    });

    it('should reject a JWT with a corrupt signature', () => {
        const token = signJWT(samplePayload);
        const [header, body, signature] = token.split('.');
        const badSignature = signature.slice(0, -4) + 'zzzz';
        const tamperedToken = `${header}.${body}.${badSignature}`;

        expect(verifyJWT(tamperedToken)).toBeNull();
    });

    it('should reject malformed or non-string tokens gracefully', () => {
        expect(verifyJWT(null)).toBeNull();
        expect(verifyJWT(undefined)).toBeNull();
        expect(verifyJWT('')).toBeNull();
        expect(verifyJWT('random.string.without.valid.format')).toBeNull();
        expect(verifyJWT(12345)).toBeNull();
    });

    it('should immediately revoke token and reject subsequent verification', () => {
        const token = signJWT(samplePayload);
        expect(verifyJWT(token)).not.toBeNull();

        revokeToken(token);
        expect(verifyJWT(token)).toBeNull();
    });

    describe('Client IP Extraction (Anti-Spoofing)', () => {
        it('should extract direct IP for standard connection', () => {
            const mockSocket = {
                handshake: {
                    address: '192.168.1.50',
                    headers: {}
                }
            };
            const ip = getClientIp(mockSocket);
            expect(ip).toBe('192.168.1.50');
        });

        it('should trust cf-connecting-ip when behind private proxy', () => {
            const mockSocket = {
                handshake: {
                    address: '127.0.0.1',
                    headers: {
                        'cf-connecting-ip': '203.0.113.195'
                    }
                }
            };
            const ip = getClientIp(mockSocket);
            expect(ip).toBe('203.0.113.195');
        });
    });
});
