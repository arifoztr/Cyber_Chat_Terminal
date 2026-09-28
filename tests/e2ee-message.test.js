/**
 * ============================================================================
 * E2EE Mesajlaşma ve Soket Güvenlik Birim Testleri (Jest Test Suite)
 * 
 * Bu test dosyası; Jest test runner ile doğrudan çalıştırılmak üzere,
 * Web Crypto (AES-256-GCM), asenkron soket olayları ve çevrimdışı mesaj
 * saklama akışını ağdan ve arayüzden tamamen izole ederek test eder.
 * ============================================================================
 */

// Jest ve Vitest uyumluluğu için mock nesnesi referansı
const jest = globalThis.jest || globalThis.vi;

// Node.js ortamında Web Crypto API desteği garantilenir
const crypto = globalThis.crypto;

// Test edilecek kripto yardımcıları
const {
    hexToBytes,
    bufferToBase64,
    base64ToBuffer,
    encryptGCM,
    decryptGCM,
    _aesKeyCache
} = require('../public/crypto.js');

describe('E2EE Kriptografi ve Soket Mesaj İletim Testleri', () => {
    // 256-bit (64 hex karakter) test anahtarları
    const ALICE_SECRET = '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef';
    const BOB_WRONG_SECRET = 'fedcba9876543210fedcba9876543210fedcba9876543210fedcba9876543210';

    // ────────────────────────────────────────────────────────────────────────
    // MOCK TANIMLARI: Soket ve IndexedDB İzolasyonu
    // ────────────────────────────────────────────────────────────────────────
    let mockSocket;
    let mockVault;
    let socketListeners;

    beforeEach(() => {
        // Her testten önce sıfır durum (clean state)
        socketListeners = {};
        mockVault = new Map();

        // Socket.io istemcisinin ağa çıkmadan izole edilmesi
        mockSocket = {
            connected: true,
            on: jest.fn((event, callback) => {
                if (!socketListeners[event]) socketListeners[event] = [];
                socketListeners[event].push(callback);
            }),
            off: jest.fn((event, callback) => {
                if (!event) {
                    socketListeners = {};
                } else if (!callback) {
                    delete socketListeners[event];
                } else if (socketListeners[event]) {
                    socketListeners[event] = socketListeners[event].filter(cb => cb !== callback);
                }
            }),
            emit: jest.fn((event, data, ackCallback) => {
                if (typeof ackCallback === 'function') {
                    ackCallback({ success: true });
                }
            }),
            disconnect: jest.fn(() => {
                mockSocket.connected = false;
                socketListeners = {};
            })
        };
    });

    afterEach(async () => {
        // [KURAL 3] TEMİZLİK: State zehirlenmesini önlemek için bellek ve mock temizliği
        jest.clearAllMocks();

        // 1. Açık soket bağlantısını kapat
        if (mockSocket && mockSocket.connected) {
            mockSocket.disconnect();
        }

        // 2. Dinleyicileri temizle (test runner'ın asılı kalmaması için)
        if (mockSocket) {
            mockSocket.off();
        }

        // 3. IndexedDB mock kasasını temizle
        if (mockVault) {
            mockVault.clear();
        }

        // 4. Crypto modülündeki AES key cache'i sıfırla
        if (_aesKeyCache) {
            for (const key in _aesKeyCache) {
                delete _aesKeyCache[key];
            }
        }
    });

    // ────────────────────────────────────────────────────────────────────────
    // 1. KRİPTOGRAFİ BİRİM VE EDGE-CASE TESTLERİ
    // ────────────────────────────────────────────────────────────────────────
    describe('AES-256-GCM Şifreleme / Deşifreleme ve Uç Durumlar', () => {
        test('Doğru anahtar ile şifreleme ve deşifreleme başarılı olmalıdır (Happy Path)', async () => {
            const rawPlaintext = 'Gizli Görev Raporu: Saat 03:00 🚀';
            const ciphertext = await encryptGCM(rawPlaintext, ALICE_SECRET);

            expect(typeof ciphertext).toBe('string');
            expect(ciphertext.length).toBeGreaterThan(0);

            const decrypted = await decryptGCM(ciphertext, ALICE_SECRET);
            expect(decrypted).toBe(rawPlaintext);
        });

        test('[EDGE CASE] Yanlış AES anahtarı kullanıldığında işlem hata fırlatmalıdır', async () => {
            const secretMessage = 'Yetkisiz erişim deneniyor!';
            const ciphertext = await encryptGCM(secretMessage, ALICE_SECRET);

            // Yanlış anahtarla çözme girişimi kesinlikle yakalanıp toThrow ile sonuçlanmalıdır
            await expect(decryptGCM(ciphertext, BOB_WRONG_SECRET)).rejects.toThrow();
        });

        test('[EDGE CASE] Manipüle edilmiş (tampered) ciphertext ve bozuk auth tag reddedilmelidir', async () => {
            const message = 'Bütünlüğü bozulacak veri';
            const ciphertext = await encryptGCM(message, ALICE_SECRET);
            const buffer = base64ToBuffer(ciphertext);

            // Şifreli metnin son baytını (GCM Authentication Tag) değiştirerek manipülasyon simülasyonu
            buffer[buffer.length - 1] ^= 0x5a;
            const tamperedCiphertext = bufferToBase64(buffer);

            // GCM etiket doğrulaması başarısız olmalı ve hata fırlatmalıdır
            await expect(decryptGCM(tamperedCiphertext, ALICE_SECRET)).rejects.toThrow();
        });

        test('[EDGE CASE] Eksik IV (12 bayttan kısa veri) verildiğinde hata yakalanmalıdır', async () => {
            // Sadece 4 baytlık geçersiz/kırpılmış veri
            const shortBuffer = new Uint8Array([0x01, 0x02, 0x03, 0x04]);
            const truncatedCiphertext = bufferToBase64(shortBuffer);

            await expect(decryptGCM(truncatedCiphertext, ALICE_SECRET)).rejects.toThrow();
        });

        test('[EDGE CASE] Boş string, null veya undefined şifreli veri verildiğinde çökmeyi önlemelidir', async () => {
            await expect(decryptGCM('', ALICE_SECRET)).rejects.toThrow();
            await expect(decryptGCM(null, ALICE_SECRET)).rejects.toThrow();
            await expect(decryptGCM(undefined, ALICE_SECRET)).rejects.toThrow();
        });
    });

    // ────────────────────────────────────────────────────────────────────────
    // 2. SOKET OLAYLARI VE UÇTAN UCA MESAJ İŞLEME DÖNGÜSÜ
    // ────────────────────────────────────────────────────────────────────────
    describe('Soket Mesaj İletim Döngüsü ve Hata Dayanıklılığı', () => {
        /**
         * Simüle edilen Güvenli Paket İşleme Handler'ı:
         * Gerçek uygulamadaki socket.on('receive_secure_packet') mantığını yansıtır.
         */
        const setupPacketReceiver = (socketInstance, targetVault, secretKey) => {
            socketInstance.on('receive_secure_packet', async (packet) => {
                // Güvenlik doğrulaması: Null/Undefined veya eksik gövde koruması
                if (!packet || typeof packet !== 'object') {
                    return { success: false, error: 'MALFORMED_PACKET' };
                }
                if (!packet.senderId || !packet.ciphertext) {
                    return { success: false, error: 'MISSING_PAYLOAD' };
                }

                try {
                    // Deşifreleme adımı
                    const plaintext = await decryptGCM(packet.ciphertext, secretKey);
                    
                    // Kasaya (Vault) güvenli kayıt
                    const storedMessages = targetVault.get(packet.senderId) || [];
                    storedMessages.push({
                        id: packet.id || 'msg-' + Date.now(),
                        senderId: packet.senderId,
                        text: plaintext,
                        timestamp: packet.timestamp || Date.now()
                    });
                    targetVault.set(packet.senderId, storedMessages);

                    return { success: true, text: plaintext };
                } catch (err) {
                    // Şifre çözme hatası durumunda uygulamanın çökmesi engellenir
                    return { success: false, error: 'DECRYPTION_FAILED', details: err.message };
                }
            });
        };

        test('Soketten gelen geçerli şifreli paket başarıyla çözülüp kasaya yazılmalıdır', async () => {
            setupPacketReceiver(mockSocket, mockVault, ALICE_SECRET);

            const senderId = 'AGN-7777-8888';
            const messageText = 'Karargah, koordinatlar doğrulandı.';
            const encryptedText = await encryptGCM(messageText, ALICE_SECRET);

            const incomingPacket = {
                id: 'packet-101',
                senderId: senderId,
                ciphertext: encryptedText,
                timestamp: Date.now()
            };

            // Soket olayını tetikle
            const handler = socketListeners['receive_secure_packet'][0];
            const result = await handler(incomingPacket);

            expect(result.success).toBe(true);
            expect(result.text).toBe(messageText);

            // Kasaya yazıldığını doğrula
            const savedMessages = mockVault.get(senderId);
            expect(savedMessages).toBeDefined();
            expect(savedMessages.length).toBe(1);
            expect(savedMessages[0].text).toBe(messageText);
        });

        test('[EDGE CASE] Soketten null veya undefined paket geldiğinde uygulama çökmemelidir', async () => {
            setupPacketReceiver(mockSocket, mockVault, ALICE_SECRET);
            const handler = socketListeners['receive_secure_packet'][0];

            // Null ve Undefined yük denemeleri
            const nullResult = await handler(null);
            expect(nullResult.success).toBe(false);
            expect(nullResult.error).toBe('MALFORMED_PACKET');

            const undefinedResult = await handler(undefined);
            expect(undefinedResult.success).toBe(false);
            expect(undefinedResult.error).toBe('MALFORMED_PACKET');

            // Kasaya hiçbir şey yazılmamış olmalıdır
            expect(mockVault.size).toBe(0);
        });

        test('[EDGE CASE] Soketten eksik ciphertext ile gelen paket güvenle reddedilmelidir', async () => {
            setupPacketReceiver(mockSocket, mockVault, ALICE_SECRET);
            const handler = socketListeners['receive_secure_packet'][0];

            const brokenPacket = {
                id: 'packet-999',
                senderId: 'AGN-1234-5678'
                // ciphertext alanı yok
            };

            const result = await handler(brokenPacket);
            expect(result.success).toBe(false);
            expect(result.error).toBe('MISSING_PAYLOAD');
            expect(mockVault.size).toBe(0);
        });

        test('[EDGE CASE] Soketten bozuk/korsan ciphertext geldiğinde uygulama çökmeden hata dönmelidir', async () => {
            setupPacketReceiver(mockSocket, mockVault, ALICE_SECRET);
            const handler = socketListeners['receive_secure_packet'][0];

            const corruptedPacket = {
                id: 'packet-hack-01',
                senderId: 'AGN-ATTACKER',
                ciphertext: 'GecersizBozukBase64Verisi==',
                timestamp: Date.now()
            };

            const result = await handler(corruptedPacket);
            expect(result.success).toBe(false);
            expect(result.error).toBe('DECRYPTION_FAILED');
            expect(mockVault.has('AGN-ATTACKER')).toBe(false);
        });

        test('Karşılıklı mesajlaşma (Alice -> Bob, Bob -> Alice) ve kasa geçmişi hatasız çözülmelidir', async () => {
            const ALICE_ID = 'AGN-1111-2222';
            const BOB_ID = 'AGN-3333-4444';
            const SHARED_KEY = ALICE_SECRET;

            // Alice kasası ve Bob kasası
            const aliceVault = [];
            const bobVault = [];

            // 1. Alice -> Bob: "Selam Bob!"
            const alicePlaintext = "Selam Bob!";
            const cipherAlice = await encryptGCM(alicePlaintext, SHARED_KEY);
            const packetAliceToBob = {
                id: 'pkt-01',
                senderId: ALICE_ID,
                targetId: BOB_ID,
                textPayload: cipherAlice,
                filePayload: null,
                timestamp: Date.now()
            };

            // Alice kendi kasasına kaydeder (gönderici önbelleği ile)
            aliceVault.push({
                ...packetAliceToBob,
                cachedText: alicePlaintext,
                cachedFile: null
            });

            // Bob paketi alır ve deşifre eder
            const bobDecryptedText = await decryptGCM(packetAliceToBob.textPayload, SHARED_KEY);
            expect(bobDecryptedText).toBe(alicePlaintext);

            // Bob kendi kasasına kaydeder (alıcı önbelleği ile)
            bobVault.push({
                ...packetAliceToBob,
                cachedText: bobDecryptedText,
                cachedFile: null
            });

            // 2. Bob -> Alice: "Aleyküm selam Alice!"
            const bobReplyText = "Aleyküm selam Alice!";
            const cipherBob = await encryptGCM(bobReplyText, SHARED_KEY);
            const packetBobToAlice = {
                id: 'pkt-02',
                senderId: BOB_ID,
                targetId: ALICE_ID,
                textPayload: cipherBob,
                filePayload: null,
                timestamp: Date.now() + 100
            };

            // Bob kendi kasasına kaydeder
            bobVault.push({
                ...packetBobToAlice,
                cachedText: bobReplyText,
                cachedFile: null
            });

            // Alice paketi alır ve deşifre eder
            const aliceDecryptedReply = await decryptGCM(packetBobToAlice.textPayload, SHARED_KEY);
            expect(aliceDecryptedReply).toBe(bobReplyText);

            // Alice kendi kasasına kaydeder
            aliceVault.push({
                ...packetBobToAlice,
                cachedText: aliceDecryptedReply,
                cachedFile: null
            });

            // 3. Geçmişi yükleme simülasyonu: Her iki taraf da tüm mesajları hatasız okumalıdır
            for (const pkt of aliceVault) {
                expect(pkt.cachedText).toBeDefined();
                expect(typeof pkt.cachedText).toBe('string');
                expect(pkt.cachedText.length).toBeGreaterThan(0);
            }

            for (const pkt of bobVault) {
                expect(pkt.cachedText).toBeDefined();
                expect(typeof pkt.cachedText).toBe('string');
                expect(pkt.cachedText.length).toBeGreaterThan(0);
            }

            expect(aliceVault[0].cachedText).toBe("Selam Bob!");
            expect(aliceVault[1].cachedText).toBe("Aleyküm selam Alice!");
            expect(bobVault[0].cachedText).toBe("Selam Bob!");
            expect(bobVault[1].cachedText).toBe("Aleyküm selam Alice!");
        });

        test('Yeni sohbet başladığında onay modalı olmadan otomatik ekleme ve yanıt iletimi yapılmalıdır', async () => {
            const addedContacts = [];
            let responseSent = null;

            // İstemci tarafı contact_request işleyicisi simülasyonu
            const handleContactRequest = (data) => {
                if (!data || !data.senderId) return;
                // Otomatik ekleme
                addedContacts.push({ id: data.senderId, username: data.username });
                // Otomatik kabul yanıtı
                mockSocket.emit('respond_contact_request', { targetId: data.senderId, accepted: true }, (res) => {
                    responseSent = { targetId: data.senderId, accepted: true };
                });
            };

            const incomingRequest = {
                senderId: 'AGN-5555-6666',
                username: 'Charlie',
                avatar: null
            };

            handleContactRequest(incomingRequest);

            // Onay istemeden otomatik eklenmiş olmalı
            expect(addedContacts.length).toBe(1);
            expect(addedContacts[0].id).toBe('AGN-5555-6666');
            expect(addedContacts[0].username).toBe('Charlie');

            // respond_contact_request olayının tetiklendiğini doğrula
            expect(mockSocket.emit).toHaveBeenCalledWith(
                'respond_contact_request',
                { targetId: 'AGN-5555-6666', accepted: true },
                expect.any(Function)
            );
        });
    });
});
