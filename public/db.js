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
        const tx = db.transaction('packets', 'readonly');
        const store = tx.objectStore('packets');
        const index = store.index('peerId');
        const request = index.getAll(peerId);
        return new Promise((resolve, reject) => {
            request.onsuccess = () => {
                let packets = request.result || [];
                packets = packets.filter(p => p.ownerId === currentUser.userId);
                packets.sort((a, b) => a.timestamp - b.timestamp);
                resolve(packets);
            };
            request.onerror = () => reject(request.error);
        });
    } catch (e) { return []; }
}

async function removePacketFromVault(peerId, packetId) {
    if (!currentUser) return;
    try {
        const db = await openVaultDB();
        const tx = db.transaction('packets', 'readwrite');
        const store = tx.objectStore('packets');
        store.delete(packetId);
    } catch (e) {}
}

// Kişi listesinin yerel depoya kaydı / yüklenmesi
function saveContactsToVault() { if(currentUser) localStorage.setItem('cyber_contacts_' + currentUser.userId, JSON.stringify(myContacts)); }
function loadContactsFromVault() {
    if(currentUser) {
        const data = localStorage.getItem('cyber_contacts_' + currentUser.userId);
        myContacts = data ? JSON.parse(data) : [];
        myContacts.forEach(contact => {
            delete contact.fingerprintVerified;
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

