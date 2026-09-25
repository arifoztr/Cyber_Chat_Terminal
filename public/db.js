// ============================================================
// db.js — IndexedDB Kasa (Vault) ve Yerel Veri Yönetimi
// Paket saklama, geçmiş yükleme, kişi listesi persistence
// ============================================================

const DB_NAME = 'CyberVaultDB';
const DB_VERSION = 2;
let _idbInstance = null;

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

// [GÜVENLİK FIX - SEC-18] Arka Plan Kasa Temizliği: Süresi dolan TTL mesajlarını temizler
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

// [GÜVENLİK FIX - SEC-10] BOLA / IDOR Korumalı Paket Silme
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

// Kişi listesinin yerel depoya kaydı / yüklenmesi
// [GÜVENLİK FIX] Simetrik anahtarlar (contact.key) artık localStorage'a yazılmaz — sızıntı riski ortadan kalkar
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

// Kriptografik Anahtar Deposu (IndexedDB CryptoKey Vault)
async function saveCryptoKeyToVault(userId, keyData) {
    try {
        const db = await openVaultDB();
        const tx = db.transaction('cryptoKeys', 'readwrite');
        const store = tx.objectStore('cryptoKeys');
        store.put({ userId, ...keyData });
        return new Promise((resolve, reject) => { tx.oncomplete = () => resolve(); tx.onerror = () => reject(tx.error); });
    } catch (e) {
        console.error('[!] saveCryptoKeyToVault hatası:', e);
    }
}

async function loadCryptoKeyFromVault(userId) {
    try {
        const db = await openVaultDB();
        if (!db.objectStoreNames.contains('cryptoKeys')) return null;
        const tx = db.transaction('cryptoKeys', 'readonly');
        const store = tx.objectStore('cryptoKeys');
        const request = store.get(userId);
        return new Promise((resolve, reject) => {
            request.onsuccess = () => resolve(request.result || null);
            request.onerror = () => reject(request.error);
        });
    } catch (e) {
        console.error('[!] loadCryptoKeyFromVault hatası:', e);
        return null;
    }
}

async function removeCryptoKeyFromVault(userId) {
    try {
        const db = await openVaultDB();
        if (!db.objectStoreNames.contains('cryptoKeys')) return;
        const tx = db.transaction('cryptoKeys', 'readwrite');
        const store = tx.objectStore('cryptoKeys');
        store.delete(userId);
    } catch (e) {}
}

