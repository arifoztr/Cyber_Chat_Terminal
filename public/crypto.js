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


async function initEcdhKeys() {
    // 1. Önce IndexedDB'den CryptoKey nesnesi olarak yüklemeyi dene
    try {
        const vaultKey = await loadCryptoKeyFromVault(currentUser.userId);
        if (vaultKey && vaultKey.privateKey && vaultKey.publicJwk) {
            let pubKey = vaultKey.publicKey;
            if (!pubKey) {
                pubKey = await crypto.subtle.importKey('jwk', vaultKey.publicJwk, { name: 'ECDH', namedCurve: 'P-256' }, true, []);
            }
            myEcdhKeyPair = {
                privateKey: vaultKey.privateKey,
                publicKey: pubKey
            };
            myPublicKeyJwk = vaultKey.publicJwk;
            // Güvenlik: localStorage'da eski anahtar kalmışsa temizle
            localStorage.removeItem('ecdh_keypair_' + currentUser.userId);
            return;
        }
    } catch(e) {
        console.warn('[!] IndexedDB anahtar okuma hatası:', e);
    }

    // 2. Geriye dönük uyumluluk: localStorage'da eski anahtar varsa IndexedDB'ye taşı ve localStorage'dan sil
    const legacyStored = localStorage.getItem('ecdh_keypair_' + currentUser.userId);
    if (legacyStored) {
        try {
            const parsed = JSON.parse(legacyStored);
            const privKey = await crypto.subtle.importKey('jwk', parsed.privateJwk, { name: 'ECDH', namedCurve: 'P-256' }, true, ['deriveKey', 'deriveBits']);
            const pubKey = await crypto.subtle.importKey('jwk', parsed.publicJwk, { name: 'ECDH', namedCurve: 'P-256' }, true, []);
            
            myEcdhKeyPair = { privateKey: privKey, publicKey: pubKey };
            myPublicKeyJwk = parsed.publicJwk;

            // IndexedDB'ye güvenle kaydet
            await saveCryptoKeyToVault(currentUser.userId, {
                privateKey: privKey,
                publicKey: pubKey,
                publicJwk: myPublicKeyJwk
            });

            // localStorage'dan derhal temizle (Artık düz metin JWK tutulmaz)
            localStorage.removeItem('ecdh_keypair_' + currentUser.userId);
            console.log('[+] Eski ECDH anahtarı IndexedDB kasasına taşındı ve localStorage temizlendi.');
            return;
        } catch(e) {
            console.warn('[!] Eski anahtar taşıma hatası:', e);
        }
    }

    // 3. Hiç anahtar yoksa yeni ECDH çifti oluştur ve doğrudan IndexedDB'ye kaydet
    myEcdhKeyPair = await crypto.subtle.generateKey({ name: 'ECDH', namedCurve: 'P-256' }, true, ['deriveKey', 'deriveBits']);
    myPublicKeyJwk = await crypto.subtle.exportKey('jwk', myEcdhKeyPair.publicKey);
    
    await saveCryptoKeyToVault(currentUser.userId, {
        privateKey: myEcdhKeyPair.privateKey,
        publicKey: myEcdhKeyPair.publicKey,
        publicJwk: myPublicKeyJwk
    });

    // Garanti olarak localStorage'da herhangi bir kalıntı olmadığından emin ol
    localStorage.removeItem('ecdh_keypair_' + currentUser.userId);
    console.log('[+] Yeni ECDH anahtar çifti IndexedDB kasasında güvenle oluşturuldu.');
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
                    derivedSecrets[targetId] = secret;
                    saveSecretsToVault();
                    
                    let contact = myContacts.find(c => c.id === targetId);
                    if (contact) {
                        contact.key = secret;
                        contact.ecdhStatus = 'established';
                        if (res.avatar) contact.avatar = res.avatar;
                        saveContactsToVault();
                        renderContactsSidebarDebounced();
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
