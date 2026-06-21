// ============================================================
// crypto.js — Kriptografi ve Anahtar Yönetimi Modülü
// ECDH, AES-GCM-256, SHA-256 Fingerprint, Key Cache
// ============================================================

const _aesKeyCache = {};
let myEcdhKeyPair = null;
let myPublicKeyJwk = null;
let derivedSecrets = {};

function hexToBytes(hex) {
    const bytes = new Uint8Array(hex.length / 2);
    for (let i = 0; i < bytes.length; i++) {
        bytes[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16);
    }
    return bytes;
}

async function getAesGcmKey(hexSecret) {
    if (_aesKeyCache[hexSecret]) return _aesKeyCache[hexSecret];
    const rawKey = hexToBytes(hexSecret);
    const key = await crypto.subtle.importKey("raw", rawKey, "AES-GCM", false, ["encrypt", "decrypt"]);
    _aesKeyCache[hexSecret] = key;
    return key;
}

function bufferToBase64(buffer) {      //Buffer bilgisayarın hafızasında duran ham veriye verilen addır.
    const bytes = new Uint8Array(buffer);
    const chunks = [];
    for (let i = 0; i < bytes.length; i += 8192) {
        chunks.push(String.fromCharCode(...bytes.subarray(i, i + 8192)));
    }
    return window.btoa(chunks.join(''));
}

function base64ToBuffer(base64) {
    const raw = atob(base64);
    return Uint8Array.from(raw, c => c.charCodeAt(0));
}

async function encryptGCM(text, hexSecret) {
    const key = await getAesGcmKey(hexSecret);
    const iv = crypto.getRandomValues(new Uint8Array(12));
    const encoded = new TextEncoder().encode(text);
    const ciphertext = await crypto.subtle.encrypt({ name: "AES-GCM", iv: iv }, key, encoded);
    
    const combined = new Uint8Array(iv.length + ciphertext.byteLength);
    combined.set(iv, 0);
    combined.set(new Uint8Array(ciphertext), iv.length);
    
    return bufferToBase64(combined);
}

async function decryptGCM(base64Data, hexSecret) {
    const key = await getAesGcmKey(hexSecret);
    const rawData = base64ToBuffer(base64Data);
    const iv = rawData.slice(0, 12);
    const data = rawData.slice(12);
    
    const decrypted = await crypto.subtle.decrypt({ name: "AES-GCM", iv: iv }, key, data);
    return new TextDecoder().decode(decrypted);
}

async function calculateFingerprint(publicKeyJwk) {
    if (!publicKeyJwk || !publicKeyJwk.x || !publicKeyJwk.y) return 'UNKNOWN';
    try {
        const data = new TextEncoder().encode(publicKeyJwk.x + "|" + publicKeyJwk.y);
        const hash = await crypto.subtle.digest('SHA-256', data);
        const hex = Array.from(new Uint8Array(hash)).map(b => b.toString(16).padStart(2, '0')).join('').toUpperCase();
        return hex.substring(0, 8);
    } catch(e) { return 'ERROR'; }
}

async function initEcdhKeys() {
    const stored = localStorage.getItem('ecdh_keypair_' + currentUser.userId);
    if (stored) {
        try {
            const parsed = JSON.parse(stored);
            myEcdhKeyPair = {
                privateKey: await crypto.subtle.importKey('jwk', parsed.privateJwk, { name: 'ECDH', namedCurve: 'P-256' }, true, ['deriveKey', 'deriveBits']),
                publicKey:  await crypto.subtle.importKey('jwk', parsed.publicJwk,  { name: 'ECDH', namedCurve: 'P-256' }, true, [])
            };
            myPublicKeyJwk = parsed.publicJwk;
            return;
        } catch(e) {}
    }
    myEcdhKeyPair = await crypto.subtle.generateKey({ name: 'ECDH', namedCurve: 'P-256' }, true, ['deriveKey', 'deriveBits']);
    myPublicKeyJwk = await crypto.subtle.exportKey('jwk', myEcdhKeyPair.publicKey);
    const privateJwk = await crypto.subtle.exportKey('jwk', myEcdhKeyPair.privateKey);
    localStorage.setItem('ecdh_keypair_' + currentUser.userId, JSON.stringify({ publicJwk: myPublicKeyJwk, privateJwk }));
}

async function deriveSharedSecret(theirPublicJwk) {
    const theirKey = await crypto.subtle.importKey('jwk', theirPublicJwk, { name: 'ECDH', namedCurve: 'P-256' }, false, []);
    const bits = await crypto.subtle.deriveBits({ name: 'ECDH', public: theirKey }, myEcdhKeyPair.privateKey, 256);
    return Array.from(new Uint8Array(bits)).map(b => b.toString(16).padStart(2,'0')).join('');
}

async function ensureSharedSecret(targetId) {
    if (derivedSecrets[targetId]) return true;
      
    return new Promise((resolve) => {
        safeEmit('get_public_key', targetId, async (res) => {
            if (res && res.success && res.publicKey) {
                try {
                    const secret = await deriveSharedSecret(res.publicKey);
                    const fp = await calculateFingerprint(res.publicKey);
                    derivedSecrets[targetId] = secret;
                    saveSecretsToVault();
                    
                    let contact = myContacts.find(c => c.id === targetId);
                    if (contact) {
                        contact.key = secret;
                        if (contact.fingerprint !== fp) {
                            contact.fingerprint = fp;
                            contact.fingerprintVerified = false;
                        } else if (contact.fingerprintVerified === undefined) {
                            contact.fingerprintVerified = false;
                        }
                        contact.ecdhStatus = 'established';
                        if (res.avatar) contact.avatar = res.avatar;
                        saveContactsToVault();
                        renderContactsSidebarDebounced();
                        if (activeTarget && activeTarget.id === targetId) {
                            document.getElementById('chatTargetFingerprint').innerText = `FP: ${fp}`;
                            updateFingerprintHeaderUI();
                        }
                    }
                    resolve(true);
                } catch(e) { resolve(false); }
            } else {
                resolve(false);
            }
        });
    });
}

function initiateEcdhHandshake(targetId) {
    if (!myPublicKeyJwk || !socket) return;
    safeEmit('ecdh_offer', { targetId: targetId, senderId: currentUser.userId, publicKeyJwk: myPublicKeyJwk });
}

// Kriptografik sırların oturum deposuna kaydı / yüklenmesi
function saveSecretsToVault() { if (currentUser) sessionStorage.setItem('derived_secrets_' + currentUser.userId, JSON.stringify(derivedSecrets)); }
function loadSecretsFromVault() { if (currentUser) { const data = sessionStorage.getItem('derived_secrets_' + currentUser.userId); derivedSecrets = data ? JSON.parse(data) : {}; } }
