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
    const btoaFn = (typeof window !== 'undefined' && window.btoa) ? window.btoa : (typeof btoa !== 'undefined' ? btoa : (b => Buffer.from(b, 'binary').toString('base64')));
    return btoaFn(chunks.join('')); 
}

function base64ToBuffer(base64) {
    const atobFn = (typeof window !== 'undefined' && window.atob) ? window.atob : (typeof atob !== 'undefined' ? atob : (b => Buffer.from(b, 'base64').toString('binary')));
    const raw = atobFn(base64);
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
    const rawBits = await crypto.subtle.deriveBits({ name: 'ECDH', public: theirKey }, myEcdhKeyPair.privateKey, 256);
    
    // [GÜVENLİK FIX] NIST SP 800-56A: Ham ECDH çıktısını HKDF ile AES anahtarına dönüştür
    // Adım 1: Ham bitleri HKDF giriş anahtar materyali (IKM) olarak import et
    const hkdfKey = await crypto.subtle.importKey('raw', rawBits, 'HKDF', false, ['deriveBits']);
    
    // Adım 2: Sabit salt ve bağlam etiketi ile 256-bit AES anahtarı türet
    const salt = new TextEncoder().encode('CyberChat-E2EE-v1');
    const info = new TextEncoder().encode('AES-GCM-256-SharedKey');
    const derivedBits = await crypto.subtle.deriveBits(
        { name: 'HKDF', hash: 'SHA-256', salt: salt, info: info },
        hkdfKey,
        256
    );
    
    return Array.from(new Uint8Array(derivedBits)).map(b => b.toString(16).padStart(2,'0')).join('');
}

async function ensureSharedSecret(targetId) {
    if (derivedSecrets[targetId]) return true;
      
    return new Promise((resolve) => {
        safeEmit('get_public_key', targetId, async (res) => {
            if (res && res.success && res.publicKey) {
                try {
                    // [GÜVENLİK FIX - SEC-05] Açık anahtar parmak izi kontrolü (MITM tespiti)
                    const fingerprint = await generateKeyFingerprint(res.publicKey);
                    const storedFp = localStorage.getItem('cyber_fp_' + currentUser.userId + '_' + targetId);
                    
                    if (storedFp && storedFp !== fingerprint) {
                        // ⚠️ ANAHTAR DEĞİŞMİŞ — Kullanıcıyı uyar
                        console.warn(`[!] GÜVENLİK UYARISI: ${targetId} açık anahtarı değişmiş!`);
                        if (typeof showToast === 'function') {
                            showToast(`⚠️ ${targetId} açık anahtarı değişti! Olası MITM saldırısı. Güvenlik numaranızı doğrulayın.`, 'warning');
                        }
                    }
                    // Parmak izini kaydet/güncelle
                    localStorage.setItem('cyber_fp_' + currentUser.userId + '_' + targetId, fingerprint);
                    
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

// ============================================================
// [GÜVENLİK FIX - SEC-05] Açık Anahtar Parmak İzi ve Güvenlik Numarası
// MITM (Ortadaki Adam) saldırılarını tespit etmek için kullanıcıların
// birbirlerinin açık anahtarlarını bant dışı doğrulamasını sağlar.
// ============================================================

/**
 * Bir JWK açık anahtarı için SHA-256 parmak izi üretir.
 * Çıktı: "A1B2 C3D4 E5F6 7890 ..." şeklinde okunabilir hex grupları
 */
async function generateKeyFingerprint(publicKeyJwk) {
    if (!publicKeyJwk) return null;
    const keyBytes = new TextEncoder().encode(JSON.stringify(publicKeyJwk));
    const hashBuffer = await crypto.subtle.digest('SHA-256', keyBytes);
    const hashArray = Array.from(new Uint8Array(hashBuffer));
    const hexStr = hashArray.map(b => b.toString(16).padStart(2, '0').toUpperCase()).join('');
    // 4'lü gruplar halinde formatla (okunabilirlik için)
    return hexStr.match(/.{1,4}/g).join(' ');
}

/**
 * İki kullanıcı arasında Güvenlik Numarası (Safety Number) üretir.
 * Her iki tarafın açık anahtarlarının SHA-256 hash'i birleştirilip
 * tekrar hash'lenir. Her iki tarafta da aynı numara çıkmalıdır.
 * Signal protokolündeki "Safety Number" prensibiyle aynıdır.
 */
async function generateSafetyNumber(myPubKeyJwk, theirPubKeyJwk) {
    if (!myPubKeyJwk || !theirPubKeyJwk) return null;
    // Sıralama: her iki tarafta da aynı sonucu üretmek için deterministik sırala
    const myStr = JSON.stringify(myPubKeyJwk);
    const theirStr = JSON.stringify(theirPubKeyJwk);
    const combined = [myStr, theirStr].sort().join('|');
    const hashBuffer = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(combined));
    const hashArray = Array.from(new Uint8Array(hashBuffer));
    // İlk 30 baytı 5'li sayısal gruplara dönüştür (60 haneli güvenlik numarası)
    const numStr = hashArray.slice(0, 30).map(b => b.toString(10).padStart(3, '0')).join('');
    return numStr.match(/.{1,5}/g).join(' ');
}

/**
 * Belirtilen kişi için açık anahtar parmak izini alır ve önbelleğe kaydeder.
 * Anahtar değişikliği tespit edildiğinde kullanıcıya uyarı verir.
 */
async function verifyContactFingerprint(targetId) {
    return new Promise((resolve) => {
        safeEmit('get_public_key', targetId, async (res) => {
            if (!res || !res.success || !res.publicKey) {
                resolve({ verified: false, reason: 'Açık anahtar alınamadı.' });
                return;
            }
            const fingerprint = await generateKeyFingerprint(res.publicKey);
            const storedFp = localStorage.getItem('cyber_fp_' + currentUser.userId + '_' + targetId);
            
            if (!storedFp) {
                // İlk kez görülen anahtar — kaydet
                localStorage.setItem('cyber_fp_' + currentUser.userId + '_' + targetId, fingerprint);
                resolve({ verified: true, fingerprint, firstTime: true });
            } else if (storedFp === fingerprint) {
                // Bilinen anahtar — doğrulandı
                resolve({ verified: true, fingerprint, firstTime: false });
            } else {
                // ⚠️ ANAHTAR DEĞİŞMİŞ — Olası MITM saldırısı!
                resolve({ 
                    verified: false, 
                    fingerprint, 
                    previousFingerprint: storedFp,
                    reason: 'UYARI: Bu kişinin açık anahtarı değişmiş! Olası Ortadaki Adam (MITM) saldırısı.' 
                });
            }
        });
    });
}

/**
 * Anahtar değişikliğini kabul ettikten sonra yeni parmak izini kaydet
 */
function acceptNewFingerprint(targetId, fingerprint) {
    if (currentUser && targetId && fingerprint) {
        localStorage.setItem('cyber_fp_' + currentUser.userId + '_' + targetId, fingerprint);
    }
}

if (typeof module !== 'undefined' && module.exports) {
    module.exports = {
        hexToBytes,
        getAesGcmKey,
        bufferToBase64,
        base64ToBuffer,
        encryptGCM,
        decryptGCM,
        deriveSharedSecret,
        generateKeyFingerprint,
        generateSafetyNumber,
        initEcdhKeys,
        ensureSharedSecret,
        initiateEcdhHandshake,
        saveSecretsToVault,
        loadSecretsFromVault,
        verifyContactFingerprint,
        acceptNewFingerprint,
        _aesKeyCache,
        setMyEcdhKeyPair: (pair) => { myEcdhKeyPair = pair; },
        getMyEcdhKeyPair: () => myEcdhKeyPair,
        setMyPublicKeyJwk: (jwk) => { myPublicKeyJwk = jwk; },
        getMyPublicKeyJwk: () => myPublicKeyJwk,
        setDerivedSecrets: (secrets) => { derivedSecrets = secrets; },
        getDerivedSecrets: () => derivedSecrets
    };
}
