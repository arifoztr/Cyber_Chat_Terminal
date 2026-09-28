import { describe, it, expect, beforeEach } from 'vitest';
import cryptoModule from '../public/crypto.js';
const {
    hexToBytes,
    bufferToBase64,
    base64ToBuffer,
    encryptGCM,
    decryptGCM,
    deriveSharedSecret,
    generateKeyFingerprint,
    generateSafetyNumber,
    setMyEcdhKeyPair
} = cryptoModule;

describe('Crypto & E2EE Unit Tests', () => {
    const testSecret = '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef';

    describe('Hex & Base64 Helpers', () => {
        it('hexToBytes should convert hex string to Uint8Array', () => {
            const hex = '00ff10a5';
            const bytes = hexToBytes(hex);
            expect(bytes).toBeInstanceOf(Uint8Array);
            expect(bytes.length).toBe(4);
            expect(bytes[0]).toBe(0x00);
            expect(bytes[1]).toBe(0xff);
            expect(bytes[2]).toBe(0x10);
            expect(bytes[3]).toBe(0xa5);
        });

        it('bufferToBase64 and base64ToBuffer should roundtrip successfully', () => {
            const originalBytes = new Uint8Array([10, 20, 30, 40, 50, 255, 0, 128]);
            const base64 = bufferToBase64(originalBytes);
            expect(typeof base64).toBe('string');
            const recoveredBytes = base64ToBuffer(base64);
            expect(Array.from(recoveredBytes)).toEqual(Array.from(originalBytes));
        });

        it('bufferToBase64 should handle large buffers exceeding 8192 chunk boundary', () => {
            const largeBytes = new Uint8Array(20000);
            for (let i = 0; i < largeBytes.length; i++) {
                largeBytes[i] = i % 256;
            }
            const b64 = bufferToBase64(largeBytes);
            const recovered = base64ToBuffer(b64);
            expect(recovered.length).toBe(largeBytes.length);
            expect(recovered[10000]).toBe(largeBytes[10000]);
        });
    });

    describe('AES-256-GCM Encryption / Decryption', () => {
        it('should encrypt and decrypt plaintext successfully', () => {
            return encryptGCM('Merhaba Cyber Chat!', testSecret).then(async (ciphertext) => {
                expect(typeof ciphertext).toBe('string');
                expect(ciphertext.length).toBeGreaterThan(0);

                const decrypted = await decryptGCM(ciphertext, testSecret);
                expect(decrypted).toBe('Merhaba Cyber Chat!');
            });
        });

        it('should correctly handle Turkish characters and emojis', async () => {
            const specialText = 'Gizli İstihbarat: Şemsi Paşa Pasajı 🚀🔐 🇹🇷 - Özel İzinli Veri #123';
            const encrypted = await encryptGCM(specialText, testSecret);
            const decrypted = await decryptGCM(encrypted, testSecret);
            expect(decrypted).toBe(specialText);
        });

        it('should generate different ciphertexts for the same plaintext due to random IV', async () => {
            const msg = 'Aynı metin farklı IV';
            const enc1 = await encryptGCM(msg, testSecret);
            const enc2 = await encryptGCM(msg, testSecret);
            expect(enc1).not.toBe(enc2);

            expect(await decryptGCM(enc1, testSecret)).toBe(msg);
            expect(await decryptGCM(enc2, testSecret)).toBe(msg);
        });

        it('should fail decryption if wrong secret key is used', async () => {
            const encrypted = await encryptGCM('Top Secret', testSecret);
            const wrongSecret = 'abcdef0123456789abcdef0123456789abcdef0123456789abcdef0123456789';

            await expect(decryptGCM(encrypted, wrongSecret)).rejects.toThrow();
        });

        it('should fail decryption if ciphertext is tampered with', async () => {
            const encrypted = await encryptGCM('Bozulacak mesaj', testSecret);
            const buffer = base64ToBuffer(encrypted);
            // Manipulate the last byte of ciphertext tag
            buffer[buffer.length - 1] ^= 0xff;
            const tamperedB64 = bufferToBase64(buffer);

            await expect(decryptGCM(tamperedB64, testSecret)).rejects.toThrow();
        });
    });

    describe('Key Fingerprint & Safety Numbers', () => {
        const dummyKeyA = { crv: 'P-256', kty: 'EC', x: 'dummy_x_coordinate_A', y: 'dummy_y_coordinate_A' };
        const dummyKeyB = { crv: 'P-256', kty: 'EC', x: 'dummy_x_coordinate_B', y: 'dummy_y_coordinate_B' };

        it('should generate deterministic 4-character chunked fingerprint', async () => {
            const fp1 = await generateKeyFingerprint(dummyKeyA);
            const fp2 = await generateKeyFingerprint(dummyKeyA);
            expect(fp1).toBe(fp2);
            expect(fp1).toMatch(/^([0-9A-F]{4}\s?)+$/);
        });

        it('should generate different fingerprints for different keys', async () => {
            const fpA = await generateKeyFingerprint(dummyKeyA);
            const fpB = await generateKeyFingerprint(dummyKeyB);
            expect(fpA).not.toBe(fpB);
        });

        it('should generate identical safety numbers regardless of user ordering', async () => {
            const snAB = await generateSafetyNumber(dummyKeyA, dummyKeyB);
            const snBA = await generateSafetyNumber(dummyKeyB, dummyKeyA);
            expect(snAB).toBe(snBA);
            expect(typeof snAB).toBe('string');
            expect(snAB.length).toBeGreaterThan(0);
        });
    });

    describe('ECDH Key Exchange & Shared Secret Derivation', () => {
        it('Alice and Bob should derive the exact same shared secret', async () => {
            // Alice keys
            const alicePair = await crypto.subtle.generateKey(
                { name: 'ECDH', namedCurve: 'P-256' },
                true,
                ['deriveKey', 'deriveBits']
            );
            const alicePubJwk = await crypto.subtle.exportKey('jwk', alicePair.publicKey);

            // Bob keys
            const bobPair = await crypto.subtle.generateKey(
                { name: 'ECDH', namedCurve: 'P-256' },
                true,
                ['deriveKey', 'deriveBits']
            );
            const bobPubJwk = await crypto.subtle.exportKey('jwk', bobPair.publicKey);

            // Alice derives Bob's secret
            setMyEcdhKeyPair(alicePair);
            const aliceDerivedSecret = await deriveSharedSecret(bobPubJwk);

            // Bob derives Alice's secret
            setMyEcdhKeyPair(bobPair);
            const bobDerivedSecret = await deriveSharedSecret(alicePubJwk);

            expect(aliceDerivedSecret).toHaveLength(64); // 256-bit in hex
            expect(aliceDerivedSecret).toBe(bobDerivedSecret);

            // Test full E2EE loop: Alice encrypts with derived secret, Bob decrypts
            const secretMessage = 'Merhaba Bob, bu mesaj Alice tarafından şifrelendi!';
            const encrypted = await encryptGCM(secretMessage, aliceDerivedSecret);
            const decrypted = await decryptGCM(encrypted, bobDerivedSecret);
            expect(decrypted).toBe(secretMessage);
        });

        it('getMyEcdhKeyPair and setMyEcdhKeyPair should get and set keypair', () => {
            const mockPair = { privateKey: 'priv', publicKey: 'pub' };
            cryptoModule.setMyEcdhKeyPair(mockPair);
            expect(cryptoModule.getMyEcdhKeyPair()).toBe(mockPair);
        });

        it('setMyPublicKeyJwk and getMyPublicKeyJwk should get and set JWK', () => {
            const mockJwk = { crv: 'P-256', kty: 'EC' };
            cryptoModule.setMyPublicKeyJwk(mockJwk);
            expect(cryptoModule.getMyPublicKeyJwk()).toBe(mockJwk);
        });

        it('setDerivedSecrets and getDerivedSecrets should get and set secrets map', () => {
            const secrets = { 'user-1': 'secret-123' };
            cryptoModule.setDerivedSecrets(secrets);
            expect(cryptoModule.getDerivedSecrets()).toEqual(secrets);
        });
    });

    describe('Key Cache & Fallbacks', () => {
        it('getAesGcmKey should reuse cached key on subsequent calls', async () => {
            const key1 = await cryptoModule.getAesGcmKey(testSecret);
            const key2 = await cryptoModule.getAesGcmKey(testSecret);
            expect(key1).toBe(key2);
            expect(cryptoModule._aesKeyCache[testSecret]).toBe(key1);
        });

        it('bufferToBase64 and base64ToBuffer fallback branches (window / btoa / Buffer)', () => {
            const bytes = new Uint8Array([1, 2, 3, 4, 5]);

            // Test with window.btoa and window.atob
            const originalWindow = globalThis.window;
            globalThis.window = {
                btoa: (str) => Buffer.from(str, 'binary').toString('base64'),
                atob: (b64) => Buffer.from(b64, 'base64').toString('binary')
            };

            const b64 = cryptoModule.bufferToBase64(bytes);
            const recovered = cryptoModule.base64ToBuffer(b64);
            expect(Array.from(recovered)).toEqual([1, 2, 3, 4, 5]);

            // Test without window
            delete globalThis.window;
            const b64NoWindow = cryptoModule.bufferToBase64(bytes);
            const recoveredNoWindow = cryptoModule.base64ToBuffer(b64NoWindow);
            expect(Array.from(recoveredNoWindow)).toEqual([1, 2, 3, 4, 5]);

            if (originalWindow) globalThis.window = originalWindow;
        });

        it('generateKeyFingerprint and generateSafetyNumber should return null for falsy keys', async () => {
            expect(await cryptoModule.generateKeyFingerprint(null)).toBeNull();
            expect(await cryptoModule.generateKeyFingerprint(undefined)).toBeNull();
            expect(await cryptoModule.generateSafetyNumber(null, {})).toBeNull();
            expect(await cryptoModule.generateSafetyNumber({}, null)).toBeNull();
            expect(await cryptoModule.generateSafetyNumber(null, null)).toBeNull();
        });
    });

    describe('Vault & Handshake Management (initEcdhKeys, ensureSharedSecret, etc.)', () => {
        let mockLocalStorage;
        let mockSessionStorage;

        beforeEach(() => {
            mockLocalStorage = {};
            mockSessionStorage = {};

            globalThis.localStorage = {
                getItem: (k) => mockLocalStorage[k] || null,
                setItem: (k, v) => { mockLocalStorage[k] = String(v); },
                removeItem: (k) => { delete mockLocalStorage[k]; }
            };

            globalThis.sessionStorage = {
                getItem: (k) => mockSessionStorage[k] || null,
                setItem: (k, v) => { mockSessionStorage[k] = String(v); },
                removeItem: (k) => { delete mockSessionStorage[k]; }
            };

            globalThis.currentUser = { userId: 'AGN-TEST-USER' };
            globalThis.myContacts = [];
            globalThis.saveContactsToVault = () => {};
            globalThis.renderContactsSidebarDebounced = () => {};
            globalThis.showToast = () => {};
        });

        afterEach(() => {
            delete globalThis.localStorage;
            delete globalThis.sessionStorage;
            delete globalThis.currentUser;
            delete globalThis.myContacts;
            delete globalThis.saveContactsToVault;
            delete globalThis.renderContactsSidebarDebounced;
            delete globalThis.showToast;
            delete globalThis.loadCryptoKeyFromVault;
            delete globalThis.saveCryptoKeyToVault;
            delete globalThis.safeEmit;
            delete globalThis.socket;
        });

        it('initEcdhKeys: branch 1 - loads CryptoKey with existing publicKey from IndexedDB vault', async () => {
            const pair = await crypto.subtle.generateKey({ name: 'ECDH', namedCurve: 'P-256' }, true, ['deriveKey', 'deriveBits']);
            const jwk = await crypto.subtle.exportKey('jwk', pair.publicKey);

            globalThis.loadCryptoKeyFromVault = async () => ({
                privateKey: pair.privateKey,
                publicKey: pair.publicKey,
                publicJwk: jwk
            });

            await cryptoModule.initEcdhKeys();
            expect(cryptoModule.getMyEcdhKeyPair().privateKey).toBe(pair.privateKey);
            expect(cryptoModule.getMyPublicKeyJwk()).toBe(jwk);
        });

        it('initEcdhKeys: branch 1b - loads CryptoKey without publicKey from IndexedDB and imports JWK', async () => {
            const pair = await crypto.subtle.generateKey({ name: 'ECDH', namedCurve: 'P-256' }, true, ['deriveKey', 'deriveBits']);
            const jwk = await crypto.subtle.exportKey('jwk', pair.publicKey);

            globalThis.loadCryptoKeyFromVault = async () => ({
                privateKey: pair.privateKey,
                publicKey: null,
                publicJwk: jwk
            });

            await cryptoModule.initEcdhKeys();
            expect(cryptoModule.getMyEcdhKeyPair().publicKey).toBeDefined();
            expect(cryptoModule.getMyPublicKeyJwk()).toBe(jwk);
        });

        it('initEcdhKeys: branch 1 catch - handles error in loadCryptoKeyFromVault', async () => {
            globalThis.loadCryptoKeyFromVault = async () => { throw new Error('DB error'); };
            globalThis.saveCryptoKeyToVault = async () => {};

            await cryptoModule.initEcdhKeys();
            expect(cryptoModule.getMyEcdhKeyPair()).toBeDefined();
        });

        it('initEcdhKeys: branch 2 - migrates legacy key from localStorage', async () => {
            const pair = await crypto.subtle.generateKey({ name: 'ECDH', namedCurve: 'P-256' }, true, ['deriveKey', 'deriveBits']);
            const privJwk = await crypto.subtle.exportKey('jwk', pair.privateKey);
            const pubJwk = await crypto.subtle.exportKey('jwk', pair.publicKey);

            globalThis.loadCryptoKeyFromVault = async () => null;
            let savedToVault = null;
            globalThis.saveCryptoKeyToVault = async (userId, data) => { savedToVault = data; };

            mockLocalStorage['ecdh_keypair_AGN-TEST-USER'] = JSON.stringify({
                privateJwk: privJwk,
                publicJwk: pubJwk
            });

            await cryptoModule.initEcdhKeys();
            expect(savedToVault).toBeDefined();
            expect(mockLocalStorage['ecdh_keypair_AGN-TEST-USER']).toBeUndefined();
        });

        it('initEcdhKeys: branch 2 catch - handles corrupt legacy JSON in localStorage', async () => {
            globalThis.loadCryptoKeyFromVault = async () => null;
            globalThis.saveCryptoKeyToVault = async () => {};
            mockLocalStorage['ecdh_keypair_AGN-TEST-USER'] = 'corrupt-json{';

            await cryptoModule.initEcdhKeys();
            expect(cryptoModule.getMyEcdhKeyPair()).toBeDefined();
        });

        it('initEcdhKeys: branch 3 - generates new keypair when no stored key exists', async () => {
            globalThis.loadCryptoKeyFromVault = async () => null;
            let savedToVault = null;
            globalThis.saveCryptoKeyToVault = async (userId, data) => { savedToVault = data; };

            await cryptoModule.initEcdhKeys();
            expect(savedToVault).toBeDefined();
            expect(cryptoModule.getMyEcdhKeyPair()).toBeDefined();
            expect(cryptoModule.getMyPublicKeyJwk()).toBeDefined();
        });

        it('saveSecretsToVault and loadSecretsFromVault should manage in-memory secrets (no sessionStorage)', () => {
            cryptoModule.setDerivedSecrets({ 'target-123': 'abc' });
            cryptoModule.saveSecretsToVault();
            // [GÜVENLİK] sessionStorage'a artık sır YAZILMIYOR — sırlar sadece bellekte tutulur
            expect(mockSessionStorage['derived_secrets_AGN-TEST-USER']).toBeUndefined();

            // loadSecretsFromVault sırları sıfırlar (her oturumda ECDHE ile yeniden türetilir)
            cryptoModule.setDerivedSecrets({ 'target-456': 'xyz' });
            cryptoModule.loadSecretsFromVault();
            expect(cryptoModule.getDerivedSecrets()).toEqual({});

            // Without currentUser
            globalThis.currentUser = null;
            cryptoModule.saveSecretsToVault();
            cryptoModule.loadSecretsFromVault();
        });

        it('initiateEcdhHandshake: returns early if missing key or socket', async () => {
            cryptoModule.setMyPublicKeyJwk(null);
            globalThis.socket = null;
            let emitted = null;
            globalThis.safeEmit = (ev, d) => { emitted = { ev, d }; };

            // Anahtar veya soket yoksa erken çıkmalı
            await cryptoModule.initiateEcdhHandshake('peer-1');
            expect(emitted).toBeNull();

            // Not: Tam ECDHE el sıkışma testi Web Crypto API gerektirdiği için
            // burada yalnızca erken çıkış davranışı doğrulanır.
            // Tam entegrasyon testi tarayıcı ortamında yapılmalıdır.
        });

        it('ensureSharedSecret: returns true immediately if secret already cached', async () => {
            cryptoModule.setDerivedSecrets({ 'peer-cached': 'secret123' });
            const result = await cryptoModule.ensureSharedSecret('peer-cached');
            expect(result).toBe(true);
        });

        it('ensureSharedSecret: handles successful key fetch, MITM detection, contact update', async () => {
            cryptoModule.setDerivedSecrets({});

            // Generate Alice and Bob keys
            const alicePair = await crypto.subtle.generateKey({ name: 'ECDH', namedCurve: 'P-256' }, true, ['deriveKey', 'deriveBits']);
            cryptoModule.setMyEcdhKeyPair(alicePair);

            const bobPair = await crypto.subtle.generateKey({ name: 'ECDH', namedCurve: 'P-256' }, true, ['deriveKey', 'deriveBits']);
            const bobJwk = await crypto.subtle.exportKey('jwk', bobPair.publicKey);

            // Set up contact and toast mock
            let toastCalled = false;
            globalThis.showToast = () => { toastCalled = true; };
            globalThis.myContacts = [{ id: 'peer-bob', key: null, ecdhStatus: 'pending' }];

            // Simulate previous different fingerprint in localStorage to trigger MITM warning
            mockLocalStorage['cyber_fp_AGN-TEST-USER_peer-bob'] = 'OLD_DIFFERENT_FP';

            globalThis.safeEmit = (event, targetId, callback) => {
                callback({ success: true, publicKey: bobJwk, avatar: 'avatar.png' });
            };

            const result = await cryptoModule.ensureSharedSecret('peer-bob');
            expect(result).toBe(true);
            expect(toastCalled).toBe(true);
            expect(globalThis.myContacts[0].key).toBeDefined();
            expect(globalThis.myContacts[0].ecdhStatus).toBe('established');
            expect(globalThis.myContacts[0].avatar).toBe('avatar.png');
        });

        it('ensureSharedSecret: handles unsuccessful key fetch', async () => {
            cryptoModule.setDerivedSecrets({});
            globalThis.safeEmit = (event, targetId, callback) => {
                callback({ success: false });
            };
            const result = await cryptoModule.ensureSharedSecret('peer-unreachable');
            expect(result).toBe(false);
        });

        it('ensureSharedSecret: handles exception during derivation', async () => {
            cryptoModule.setDerivedSecrets({});
            globalThis.safeEmit = (event, targetId, callback) => {
                callback({ success: true, publicKey: { invalid: 'jwk' } });
            };
            const result = await cryptoModule.ensureSharedSecret('peer-broken');
            expect(result).toBe(false);
        });

        it('ensureSharedSecret: handles target not in myContacts and no avatar', async () => {
            cryptoModule.setDerivedSecrets({});
            const alicePair = await crypto.subtle.generateKey({ name: 'ECDH', namedCurve: 'P-256' }, true, ['deriveKey', 'deriveBits']);
            cryptoModule.setMyEcdhKeyPair(alicePair);

            const bobPair = await crypto.subtle.generateKey({ name: 'ECDH', namedCurve: 'P-256' }, true, ['deriveKey', 'deriveBits']);
            const bobJwk = await crypto.subtle.exportKey('jwk', bobPair.publicKey);

            globalThis.myContacts = []; // no contact
            delete globalThis.showToast; // no showToast function

            // Stored FP matches bobJwk fingerprint
            const fp = await cryptoModule.generateKeyFingerprint(bobJwk);
            mockLocalStorage['cyber_fp_AGN-TEST-USER_peer-no-contact'] = fp;

            globalThis.safeEmit = (event, targetId, callback) => {
                callback({ success: true, publicKey: bobJwk, avatar: null });
            };

            const result = await cryptoModule.ensureSharedSecret('peer-no-contact');
            expect(result).toBe(true);
        });

        it('initEcdhKeys: vault returns object missing privateKey or publicJwk', async () => {
            globalThis.loadCryptoKeyFromVault = async () => ({ privateKey: null, publicJwk: null });
            globalThis.saveCryptoKeyToVault = async () => {};

            await cryptoModule.initEcdhKeys();
            expect(cryptoModule.getMyEcdhKeyPair()).toBeDefined();
        });

        it('verifyContactFingerprint: returns failure if public key fetch fails', async () => {
            globalThis.safeEmit = (event, targetId, callback) => {
                callback({ success: false });
            };
            const res = await cryptoModule.verifyContactFingerprint('peer-x');
            expect(res.verified).toBe(false);
            expect(res.reason).toBe('Açık anahtar alınamadı.');
        });

        it('verifyContactFingerprint: first time, match, and MITM warning branches', async () => {
            const pair = await crypto.subtle.generateKey({ name: 'ECDH', namedCurve: 'P-256' }, true, ['deriveKey', 'deriveBits']);
            const jwk = await crypto.subtle.exportKey('jwk', pair.publicKey);
            const fp = await cryptoModule.generateKeyFingerprint(jwk);

            globalThis.safeEmit = (event, targetId, callback) => {
                callback({ success: true, publicKey: jwk });
            };

            // First time
            const res1 = await cryptoModule.verifyContactFingerprint('peer-y');
            expect(res1.verified).toBe(true);
            expect(res1.firstTime).toBe(true);
            expect(res1.fingerprint).toBe(fp);

            // Second time (matches)
            const res2 = await cryptoModule.verifyContactFingerprint('peer-y');
            expect(res2.verified).toBe(true);
            expect(res2.firstTime).toBe(false);

            // Third time: altered stored fingerprint (mismatch)
            mockLocalStorage['cyber_fp_AGN-TEST-USER_peer-y'] = 'TAMPERED_FP';
            const res3 = await cryptoModule.verifyContactFingerprint('peer-y');
            expect(res3.verified).toBe(false);
            expect(res3.previousFingerprint).toBe('TAMPERED_FP');
            expect(res3.reason).toContain('UYARI');
        });

        it('acceptNewFingerprint: saves new fingerprint to localStorage', () => {
            cryptoModule.acceptNewFingerprint('peer-z', 'NEW_FP_1234');
            expect(mockLocalStorage['cyber_fp_AGN-TEST-USER_peer-z']).toBe('NEW_FP_1234');

            // Missing args does nothing
            globalThis.currentUser = null;
            cryptoModule.acceptNewFingerprint(null, null);
        });
    });
});

