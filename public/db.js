/**
 * @file db.js
 * @module VaultDB
 * @description İstemci tarafı kalıcı veri saklama ve kasa (vault) katmanı.
 * IndexedDB üzerinde şifreli mesaj paketleri (packets) ve özel/açık kriptografik anahtarları (cryptoKeys)
 * güvenle saklar. TTL yaşam döngüsü temizliği, BOLA/IDOR korumalı paket silme ve
 * kişi listesi (contacts) yerel depolama yönetimini sağlar.
 */

/**
 * IndexedDB veritabanı adı.
 * @constant {string}
 */
const DB_NAME = 'CyberVaultDB';

/**
 * IndexedDB şema sürümü.
 * @constant {number}
 */
const DB_VERSION = 2;

/**
 * Aktif IndexedDB bağlantı örneği önbelleği.
 * @type {IDBDatabase|null}
 * @private
 */
let _idbInstance = null;

/**
 * CyberVaultDB IndexedDB veritabanı bağlantısını açar veya mevcut bağlantıyı döner.
 * 'packets' (id, peerId, timestamp indeksli) ve 'cryptoKeys' (userId indeksli) nesne depolarını hazırlar.
 * @function openVaultDB
 * @returns {Promise<IDBDatabase>} Açık IndexedDB veritabanı örneği.
 */
function openVaultDB() {
    return new Promise((resolve, reject) => {
        if (_idbInstance) return resolve(_idbInstance);
        const request = indexedDB.open(DB_NAME, DB_VERSION);
        request.onerror = (e) => reject(e.target.error);
        request.onsuccess = (e) => { _idbInstance = e.target.result; resolve(_idbInstance); };
        request.onupgradeneeded = (e) => {
            const db = e.target.result;
            if (!db.objectStoreNames.contains('packets')) {
                const store = db.createObjectStore('packets', { keyPath: 'id' });
                store.createIndex('peerId', 'peerId', { unique: false });
                store.createIndex('timestamp', 'timestamp', { unique: false });
            }
            if (!db.objectStoreNames.contains('cryptoKeys')) {
                db.createObjectStore('cryptoKeys', { keyPath: 'userId' });
            }
        };
    });
}

/**
 * Eski sistemde localStorage üzerinde tutulan sohbet paketlerini IndexedDB kasasına taşır
 * ve localStorage'daki eski kayıtları temizler.
 * @async
 * @function migrateLocalStorageToIndexedDB
 * @returns {Promise<void>}
 */
async function migrateLocalStorageToIndexedDB() {
    if (!currentUser) return;
    const prefix = `cyber_history_idx_${currentUser.userId}_`;
    let migratedCount = 0;
    for (let i = 0; i < localStorage.length; i++) {
        const key = localStorage.key(i);
        if (key && key.startsWith(prefix)) {
            const targetId = key.substring(prefix.length);
            const index = JSON.parse(localStorage.getItem(key) || '[]');
            for (const pktId of index) {
                const pktKey = `cyber_pkt_${currentUser.userId}_${targetId}_${pktId}`;
                const pktData = localStorage.getItem(pktKey);
                if (pktData) {
                    try {
                        const packet = JSON.parse(pktData);
                        await savePacketToVault(targetId, packet);
                        localStorage.removeItem(pktKey);
                        migratedCount++;
                    } catch(e) {}
                }
            }
            localStorage.removeItem(key);
        }
    }
    if (migratedCount > 0) console.log(`[+] GÖÇ BAŞARILI: ${migratedCount} paket taşındı.`);
}

/**
 * Mesaj paketini IndexedDB kasasına (packets store) kaydeder.
 * TTL süresi dolmuş paketleri kaydetmez.
 * @async
 * @function savePacketToVault
 * @param {string} peerId - Sohbet edilen kişinin userId'si.
 * @param {Object} packet - Kaydedilecek paket nesnesi ({ id, senderId, targetId, payload, timestamp, ttl, ... }).
 * @returns {Promise<void>}
 */
async function savePacketToVault(peerId, packet) {
    if (!currentUser) return;
    // [GÜVENLİK FIX - SEC-18] Süresi dolmuş TTL paketlerini kasaya kaydetme
    if (packet.ttl && typeof packet.ttl === 'number') {
        const elapsed = Date.now() - (packet.timestamp || Date.now());
        if (elapsed >= (packet.ttl * 1000)) return;
    }
    try {
        const db = await openVaultDB();
        const tx = db.transaction('packets', 'readwrite');
        const store = tx.objectStore('packets');
        const packetId = packet.id || packet.packetId;
        const packetToSave = { ...packet, id: packetId, peerId: peerId, ownerId: currentUser.userId };
        store.put(packetToSave);
        return new Promise((resolve, reject) => { tx.oncomplete = () => resolve(); tx.onerror = () => reject(tx.error); });
    } catch (e) {}
}

/**
 * Belirtilen kişi ile olan mesaj geçmişini IndexedDB kasasından yükler.
 * TTL süresi dolmuş mesajları otomatik olarak temizler ve kalanları zaman sırasına göre sıralar.
 * @async
 * @function loadHistoryFromVault
 * @param {string} peerId - Mesaj geçmişi istenen kişinin userId'si.
 * @returns {Promise<Array<Object>>} Geçerli mesaj paketleri listesi.
 */
async function loadHistoryFromVault(peerId) {
    if (!currentUser) return [];
    try {
        const db = await openVaultDB();
        const tx = db.transaction('packets', 'readwrite');
        const store = tx.objectStore('packets');
        const index = store.index('peerId');
        const request = index.getAll(peerId);
        return new Promise((resolve, reject) => {
            request.onsuccess = () => {
                let packets = request.result || [];
                const now = Date.now();
                const validPackets = [];
                for (const p of packets) {
                    if (p.ownerId !== currentUser.userId) continue;
                    // [GÜVENLİK FIX - SEC-18] Kasa yüklemesinde süresi dolmuş TTL mesajlarını temizle
                    if (p.ttl && typeof p.ttl === 'number' && (now - (p.timestamp || 0)) >= (p.ttl * 1000)) {
                        store.delete(p.id);
                        continue;
                    }
                    validPackets.push(p);
                }
                validPackets.sort((a, b) => a.timestamp - b.timestamp);
                resolve(validPackets);
            };
            request.onerror = () => reject(request.error);
        });
    } catch (e) { return []; }
}

/**
 * Arka planda periyodik olarak çalışan TTL temizleyicisi.
 * Süresi dolmuş mesaj paketlerini IndexedDB kasasından kalıcı olarak siler.
 * @async
 * @function purgeExpiredVaultPackets
 * @returns {Promise<void>}
 */
async function purgeExpiredVaultPackets() {
    if (!currentUser) return;
    try {
        const db = await openVaultDB();
        const tx = db.transaction('packets', 'readwrite');
        const store = tx.objectStore('packets');
        const req = store.openCursor();
        const now = Date.now();
        req.onsuccess = (e) => {
            const cursor = e.target.result;
            if (cursor) {
                const pkt = cursor.value;
                if (pkt && pkt.ttl && typeof pkt.ttl === 'number') {
                    if ((now - (pkt.timestamp || 0)) >= (pkt.ttl * 1000)) {
                        cursor.delete();
                    }
                }
                cursor.continue();
            }
        };
    } catch (_) {}
}
setInterval(purgeExpiredVaultPackets, 10000);

/**
 * Belirtilen mesaj paketini BOLA / IDOR korumasıyla IndexedDB kasasından siler.
 * Yalnızca silme talebinde bulunan kişi paketin göndericisi veya konuşmanın tarafı ise silinir.
 * @async
 * @function removePacketFromVault
 * @param {string} peerId - Mesajın ait olduğu karşı tarafın ID'si.
 * @param {string} packetId - Silinecek paketin kimliği.
 * @returns {Promise<boolean>} Paket başarıyla silindiyse true, yetkisiz veya bulunamadıysa false.
 */
async function removePacketFromVault(peerId, packetId) {
    if (!currentUser || !packetId) return false;
    try {
        const db = await openVaultDB();
        const tx = db.transaction('packets', 'readwrite');
        const store = tx.objectStore('packets');
        
        return new Promise((resolve) => {
            const getReq = store.get(packetId);
            getReq.onsuccess = () => {
                const pkt = getReq.result;
                if (!pkt) return resolve(false);

                // Silme talebinde bulunan kişi gerçekten paketin göndericisi mi veya konuşmanın tarafı mı?
                const isAuthorized = (
                    pkt.senderId === peerId || 
                    pkt.peerId === peerId || 
                    (peerId === currentUser.userId && pkt.ownerId === currentUser.userId)
                );

                if (isAuthorized) {
                    store.delete(packetId);
                    resolve(true);
                } else {
                    console.warn('[!] BOLA Engeli: Yetkisiz paket iptal/silme teşebbüsü engellendi:', packetId);
                    resolve(false);
                }
            };
            getReq.onerror = () => resolve(false);
        });
    } catch (e) {
        return false;
    }
}

/**
 * Belirli bir kişiye ait tüm mesaj paketlerini IndexedDB kasasından kalıcı olarak temizler.
 * @async
 * @function clearPeerPacketsFromVault
 * @param {string} peerId - Mesajları temizlenecek kişinin ID'si.
 * @returns {Promise<boolean>} Başarıyla temizlendiyse true, hata oluştuysa false.
 */
async function clearPeerPacketsFromVault(peerId) {
    if (!peerId) return false;
    try {
        const db = await openVaultDB();
        const tx = db.transaction('packets', 'readwrite');
        const store = tx.objectStore('packets');
        const index = store.index('peerId');
        return new Promise((resolve) => {
            const request = index.getAllKeys(peerId);
            request.onsuccess = () => {
                const keys = request.result || [];
                for (const key of keys) {
                    store.delete(key);
                }
            };
            tx.oncomplete = () => resolve(true);
            tx.onerror = () => resolve(false);
        });
    } catch (e) {
        console.error('[!] clearPeerPacketsFromVault hatası:', e);
        return false;
    }
}

/**
 * Kişi listesini (myContacts) localStorage'a kaydeder.
 * Güvenlik: Simetrik anahtarlar (contact.key) disk sızıntısını önlemek için kaydedilmez.
 * @function saveContactsToVault
 * @returns {void}
 */
function saveContactsToVault() {
    if(currentUser) {
        const sanitized = myContacts.map(c => {
            const clone = { ...c };
            delete clone.key; // Simetrik anahtar diske YAZILMAZ — sadece bellekte tutulur
            return clone;
        });
        localStorage.setItem('cyber_contacts_' + currentUser.userId, JSON.stringify(sanitized));
    }
}

/**
 * Kişi listesini localStorage'dan yükler ve oturumdaki derivedSecrets ile anahtarları yeniden bağlar.
 * @function loadContactsFromVault
 * @returns {void}
 */
function loadContactsFromVault() {
    if(currentUser) {
        const data = localStorage.getItem('cyber_contacts_' + currentUser.userId);
        myContacts = data ? JSON.parse(data) : [];
        myContacts.forEach(contact => {
            delete contact.fingerprintVerified;
            // Anahtar, derivedSecrets'tan (sessionStorage) yeniden yüklenir
            if (derivedSecrets[contact.id]) {
                contact.key = derivedSecrets[contact.id];
                contact.ecdhStatus = 'established';
            }
        });
    }
}

/**
 * Kullanıcının CryptoKey nesnelerini (privateKey, publicKey, publicJwk) IndexedDB cryptoKeys kasasına yazar.
 * Electron ortamında publicJwk verisi safeStorage (Windows DPAPI / macOS Keychain) ile şifrelenerek saklanır.
 * @async
 * @function saveCryptoKeyToVault
 * @param {string} userId - Kullanıcı kimliği.
 * @param {Object} keyData - Anahtar verisi ({ privateKey, publicKey, publicJwk }).
 * @returns {Promise<void>}
 */
async function saveCryptoKeyToVault(userId, keyData) {
    try {
        const db = await openVaultDB();
        const tx = db.transaction('cryptoKeys', 'readwrite');
        const store = tx.objectStore('cryptoKeys');
        
        let dataToSave = { userId, ...keyData };
        
        // [GÜVENLİK] Electron ortamında publicJwk'yı safeStorage ile şifrele (DPAPI/Keychain)
        if (typeof window !== 'undefined' && window.electronAPI && window.electronAPI.secureEncrypt) {
            try {
                const isAvailable = await window.electronAPI.isSecureStorageAvailable();
                if (isAvailable && keyData.publicJwk) {
                    const jwkStr = JSON.stringify(keyData.publicJwk);
                    const encrypted = await window.electronAPI.secureEncrypt(jwkStr);
                    if (encrypted) {
                        dataToSave.publicJwkEncrypted = encrypted;
                        dataToSave.publicJwkProtected = true;
                        // Şifresiz JWK'yı kaldır — diske sadece şifreli versiyon yazılır
                        delete dataToSave.publicJwk;
                    }
                }
            } catch (e) {
                console.warn('[!] safeStorage şifreleme hatası, düz metin kaydediliyor:', e);
            }
        }
        
        store.put(dataToSave);
        return new Promise((resolve, reject) => { tx.oncomplete = () => resolve(); tx.onerror = () => reject(tx.error); });
    } catch (e) {
        console.error('[!] saveCryptoKeyToVault hatası:', e);
    }
}

/**
 * Kullanıcının saklanan CryptoKey nesnelerini IndexedDB cryptoKeys deposundan yükler.
 * Electron ortamında safeStorage ile şifrelenmiş publicJwk verisi otomatik olarak çözülür.
 * @async
 * @function loadCryptoKeyFromVault
 * @param {string} userId - Kullanıcı kimliği.
 * @returns {Promise<Object|null>} Saklanan anahtar verisi veya bulunamazsa null.
 */
async function loadCryptoKeyFromVault(userId) {
    try {
        const db = await openVaultDB();
        if (!db.objectStoreNames.contains('cryptoKeys')) return null;
        const tx = db.transaction('cryptoKeys', 'readonly');
        const store = tx.objectStore('cryptoKeys');
        const request = store.get(userId);
        return new Promise((resolve, reject) => {
            request.onsuccess = async () => {
                const result = request.result || null;
                if (!result) return resolve(null);
                
                // [GÜVENLİK] safeStorage ile şifrelenmiş publicJwk'yı çöz
                if (result.publicJwkProtected && result.publicJwkEncrypted) {
                    if (typeof window !== 'undefined' && window.electronAPI && window.electronAPI.secureDecrypt) {
                        try {
                            const decrypted = await window.electronAPI.secureDecrypt(result.publicJwkEncrypted);
                            if (decrypted) {
                                result.publicJwk = JSON.parse(decrypted);
                            }
                        } catch (e) {
                            console.error('[!] safeStorage çözme hatası:', e);
                        }
                    }
                    delete result.publicJwkEncrypted;
                    delete result.publicJwkProtected;
                }
                
                resolve(result);
            };
            request.onerror = () => reject(request.error);
        });
    } catch (e) {
        console.error('[!] loadCryptoKeyFromVault hatası:', e);
        return null;
    }
}

/**
 * Kullanıcının anahtar verilerini IndexedDB cryptoKeys deposundan kalıcı olarak kaldırır.
 * @async
 * @function removeCryptoKeyFromVault
 * @param {string} userId - Kullanıcı kimliği.
 * @returns {Promise<void>}
 */
async function removeCryptoKeyFromVault(userId) {
    try {
        const db = await openVaultDB();
        if (!db.objectStoreNames.contains('cryptoKeys')) return;
        const tx = db.transaction('cryptoKeys', 'readwrite');
        const store = tx.objectStore('cryptoKeys');
        store.delete(userId);
    } catch (e) {}
}
