/**
 * @file socket-handlers.js
 * @module ClientSocketHandlers
 * @description İstemci tarafı Socket.IO olay dinleyicileri modülü.
 * Sunucudan gelen durum değişiklikleri (node_status_change), yazıyor animasyonları (user_typing/stop),
 * ECDH teklif/yanıtları (ecdh_offer/answer), şifreli paket teslimatı (receive_secure_packet),
 * mesaj iptalleri (packet_revoked) ve kişi isteklerini (contact_request/response) karşılar.
 */

/**
 * Socket.IO istemci soketine tüm olay dinleyicilerini bağlar (idempotent; eski dinleyicileri kaldırıp yenilerini bağlar).
 * @function bindSocketEvents
 * @returns {void}
 */
function bindSocketEvents() {
    socket.off('node_status_change');
    /**
     * Kullanıcı çevrimiçi/çevrimdışı durum değişikliğini dinler.
     * @param {Object} data - Durum verisi ({ userId: string, status: 'online'|'offline' }).
     */
    socket.on('node_status_change', (data) => {
        const exists = myContacts.find((c) => c.id === data.userId);
        if (exists) {
            updateContactStatusUI(data.userId, data.status === 'online');
            if (data.status === 'online') {
                if (!derivedSecrets[data.userId]) {
                    ensureSharedSecret(data.userId).then((success) => {
                        if (
                            success &&
                            activeTarget &&
                            activeTarget.id === data.userId
                        )
                            enableChatUI();
                    });
                }
                // Aktif sohbetteki kişi çevrimiçi olduğunda PFS + KDF Ratchet için ECDHE el sıkışması başlat
                if (
                    activeTarget &&
                    activeTarget.id === data.userId &&
                    typeof hasRatchetSession === 'function' &&
                    !hasRatchetSession(data.userId) &&
                    typeof initiateEcdhHandshake === 'function'
                ) {
                    setTimeout(() => {
                        if (
                            exists.isOnline &&
                            !hasRatchetSession(data.userId)
                        ) {
                            initiateEcdhHandshake(data.userId);
                        }
                    }, 300);
                }
            } else if (data.status === 'offline') {
                // Karşı taraf çevrimdışı olduğunda bellekteki geçici ratchet zincirini temizle
                // (Çevrimdışı mesajlar statik ECDH anahtarı ile şifrelenmeye devam eder)
                if (typeof clearRatchetState === 'function') {
                    clearRatchetState(data.userId);
                    renderContactsSidebarDebounced();
                }
            }
        }
    });

    const typingDiv = document.getElementById('user_typing');

    socket.off('user_typing');
    /**
     * Karşı tarafın mesaj yazmakta olduğunu gösteren bildirim dinleyicisi.
     * Güvenli DOM API kullanarak XSS zafiyetini engeller.
     * @param {Object} data - Yazma bildirimi ({ senderId: string }).
     */
    socket.on('user_typing', (data) => {
        if (typingDiv && activeTarget && activeTarget.id === data.senderId) {
            const senderName = activeTarget.username
                ? `${activeTarget.username}`
                : data.senderId;
            // [GÜVENLİK FIX] innerHTML yerine güvenli DOM API — XSS engellenir
            typingDiv.textContent = '';
            const textNode = document.createTextNode(
                senderName + ' yazıyor... ',
            );
            typingDiv.appendChild(textNode);
            const dotsSpan = document.createElement('span');
            dotsSpan.className = 'typing-dots';
            for (let i = 0; i < 3; i++) {
                const dot = document.createElement('span');
                dot.className = 'typing-dot';
                dotsSpan.appendChild(dot);
            }
            typingDiv.appendChild(dotsSpan);
        }
    });

    socket.off('user_typing_stop');
    /**
     * Karşı tarafın yazmayı bıraktığını gösteren bildirim dinleyicisi.
     * @param {Object} data - Durdurma bildirimi ({ senderId: string }).
     */
    socket.on('user_typing_stop', (data) => {
        if (typingDiv && activeTarget && activeTarget.id === data.senderId) {
            typingDiv.textContent = '';
        }
    });

    socket.off('ecdh_offer');
    /**
     * Karşı taraftan gelen ECDHE anahtar anlaşması teklifini (offer) işler.
     * Kişi listede yoksa ekler, geçici anahtar üretip ortak sırrı türetir,
     * KDF Ratchet zincirini başlatır ve ecdh_answer ile yanıt döner.
     * Geriye dönük uyumluluk: ephemeralPublicKeyJwk yoksa eski statik ECDH protokolünü kullanır.
     * @async
     * @param {Object} data - Teklif bilgileri ({ senderId, publicKeyJwk, ephemeralPublicKeyJwk? }).
     */
    socket.on('ecdh_offer', async (data) => {
        let contact = myContacts.find((c) => c.id === data.senderId);
        if (!contact) {
            contact = {
                id: data.senderId,
                username: null,
                key: null,
                ecdhStatus: 'pending',
                isOnline: true,
                avatar: null,
            };
            myContacts.push(contact);
            saveContactsToVault();
            safeEmit('join_status_rooms', [data.senderId]);
            triggerDesktopNotification(
                'Yeni kişi',
                `${data.senderId} bağlandı.`,
            );
            safeEmit('check_node_status', data.senderId, (res) => {
                updateContactStatusUI(res.userId, res.isOnline);
            });
            safeEmit('get_profiles', [data.senderId], (res) => {
                if (res && res.profiles && res.profiles[data.senderId]) {
                    if (res.profiles[data.senderId].avatar)
                        contact.avatar = res.profiles[data.senderId].avatar;
                    if (res.profiles[data.senderId].username)
                        contact.username = res.profiles[data.senderId].username;
                    saveContactsToVault();
                    renderContactsSidebarDebounced();
                    if (activeTarget && activeTarget.id === data.senderId)
                        updateChatHeaderUI();
                }
            });
        } else {
            updateContactStatusUI(data.senderId, true);
        }
        try {
            const result = await handleEcdhOffer(data);
            if (!result) return; // Glare durumunda kendi teklifimizin yanıtı beklenir
            derivedSecrets[data.senderId] = result.secret;
            contact.key = result.secret;
            contact.ecdhStatus = 'established';
            saveContactsToVault();
            renderContactsSidebarDebounced();
            safeEmit('ecdh_answer', result.answerData);
            if (activeTarget && activeTarget.id === data.senderId) {
                enableChatUI();
            }
        } catch (e) {
            console.error('[!] ECDHE offer işleme hatası:', e);
        }
    });

    socket.off('ecdh_answer');
    /**
     * Bizim gönderdiğimiz ECDHE teklifine karşı tarafın verdiği yanıtı (answer) işler.
     * Geçici anahtarlardan ortak sırrı türetir, KDF Ratchet zincirini başlatır ve sohbet arayüzünü aktif hale getirir.
     * @async
     * @param {Object} data - Yanıt bilgileri ({ senderId, publicKeyJwk, ephemeralPublicKeyJwk? }).
     */
    socket.on('ecdh_answer', async (data) => {
        try {
            const secret = await handleEcdhAnswer(data);
            if (!secret) return;
            derivedSecrets[data.senderId] = secret;
            let contact = myContacts.find((c) => c.id === data.senderId);
            if (contact) {
                contact.key = secret;
                contact.ecdhStatus = 'established';
                updateContactStatusUI(data.senderId, true);
                saveContactsToVault();
                renderContactsSidebarDebounced();
            }

            if (activeTarget && activeTarget.id === data.senderId) {
                enableChatUI();
                showToast(
                    `${data.senderId} ile şifreli bağlantı kuruldu!`,
                    'success',
                );
            }
        } catch (e) {
            console.error('[!] ECDHE answer işleme hatası:', e);
        }
    });

    socket.off('receive_secure_packet');
    /**
     * Gelen şifreli mesaj paketini karşılar.
     * Ortak sırrın varlığını denetler, paketi IndexedDB kasasına yazar ve aktif ekranda ise deşifre edip görüntüler.
     * @async
     * @param {Object} packet - Şifreli mesaj paketi ({ senderId, targetId, payload, timestamp, ttl, ... }).
     */
    socket.on('receive_secure_packet', async (packet) => {
        let senderContact = myContacts.find((c) => c.id === packet.senderId);
        if (!senderContact) {
            senderContact = {
                id: packet.senderId,
                username: null,
                key: null,
                ecdhStatus: 'pending',
                isOnline: true,
                avatar: null,
            };
            myContacts.push(senderContact);
            saveContactsToVault();
            safeEmit('join_status_rooms', [packet.senderId]);
            triggerDesktopNotification('YENİ VERİ', `${packet.senderId}`);
            safeEmit('check_node_status', packet.senderId, (res) => {
                updateContactStatusUI(res.userId, res.isOnline);
            });
            safeEmit('get_profiles', [packet.senderId], (res) => {
                if (res && res.profiles && res.profiles[packet.senderId]) {
                    if (res.profiles[packet.senderId].avatar)
                        senderContact.avatar =
                            res.profiles[packet.senderId].avatar;
                    if (res.profiles[packet.senderId].username)
                        senderContact.username =
                            res.profiles[packet.senderId].username;
                    saveContactsToVault();
                    renderContactsSidebarDebounced();
                    if (activeTarget && activeTarget.id === packet.senderId)
                        updateChatHeaderUI();
                }
            });
        }
        await ensureSharedSecret(packet.senderId);
        senderContact = myContacts.find((c) => c.id === packet.senderId);

        if (activeTarget && activeTarget.id === packet.senderId) {
            playSound('transit');
            await processIncomingPacket(packet, senderContact);
        } else {
            if (typeof decryptPacketForDisplay === 'function') {
                await decryptPacketForDisplay(packet, senderContact);
            }
            playSound('success');
            unreadCounts[packet.senderId] =
                (unreadCounts[packet.senderId] || 0) + 1;
            const notifSender =
                senderContact && senderContact.username
                    ? `${senderContact.username} (${packet.senderId})`
                    : packet.senderId;
            renderContactsSidebar();
            showToast(`${notifSender} yeni mesaj gönderdi.`, 'info');
        }
        await savePacketToVault(packet.senderId, packet);
    });

    socket.off('packet_revoked');
    /**
     * Karşı tarafın geri çektiği/sildiği mesaj paketini karşılar.
     * Paketi IndexedDB kasasından siler ve ekrandan animasyonla kaldırır.
     * @async
     * @param {Object} data - İptal bilgileri ({ senderId: string, packetId: string }).
     */
    socket.on('packet_revoked', async (data) => {
        if (!data || !data.senderId || !data.packetId) return;
        const deleted = await removePacketFromVault(
            data.senderId,
            data.packetId,
        );
        if (deleted) {
            const msgElement = document.getElementById(`msg-${data.packetId}`);
            if (msgElement)
                fadeOutAndRemoveElement(msgElement, () =>
                    showToast(`Bir mesaj silindi.`, 'warning'),
                );
        }
    });

    socket.off('contact_request');
    /**
     * Gelen yeni sohbet/kişi ekleme bildirimini karşılar.
     * Onay modalı göstermeden kişiyi otomatik olarak listeye ekler, şifreleme tünelini kurar ve kabul yanıtı döner.
     * @param {Object} data - İstek verisi ({ senderId: string, username: string, avatar: string|null }).
     */
    socket.on('contact_request', (data) => {
        if (!data || !data.senderId) return;
        addContact(data.senderId, data.username);
        let contact = myContacts.find((c) => c.id === data.senderId);
        if (contact) {
            contact.isOnline = true;
            if (data.avatar) contact.avatar = data.avatar;
            saveContactsToVault();
        }
        renderContactsSidebar();
        ensureSharedSecret(data.senderId).then(() => {
            if (
                typeof hasRatchetSession === 'function' &&
                !hasRatchetSession(data.senderId) &&
                typeof initiateEcdhHandshake === 'function'
            ) {
                initiateEcdhHandshake(data.senderId);
            }
        });
        safeEmit('respond_contact_request', {
            targetId: data.senderId,
            accepted: true,
        });
        const name = data.username
            ? `${data.username} (${data.senderId})`
            : data.senderId;
        showToast(`${name} sizinle sohbet başlattı.`, 'info');
        playSound('transit');
    });

    socket.off('contact_request_response');
    /**
     * Kişi isteğimize verilen yanıtı karşılar ve sonucu toast/arayüz olarak bildirir.
     * @param {Object} data - Yanıt verisi ({ senderId: string, username: string, avatar: string|null, accepted: boolean }).
     */
    socket.on('contact_request_response', (data) => {
        showContactRequestResponse(data);
    });

    socket.off('session_reset');
    /**
     * Karşı tarafın sohbet geçmişini veya şifreleme anahtarlarını sildiğini karşılar.
     * Asimetrik durum ve paket bütünlüğü hatalarını önlemek için yerel kriptografik oturumu sıfırlar.
     * @param {Object} data - Sıfırlama bilgileri ({ senderId: string, timestamp: number }).
     */
    socket.on('session_reset', (data) => {
        if (!data || !data.senderId) return;
        const peerId = data.senderId;

        // 1. Kriptografik durumu bellekten güvenle sil
        if (typeof wipeTargetCryptoState === 'function') {
            wipeTargetCryptoState(peerId);
        }
        if (typeof derivedSecrets !== 'undefined' && derivedSecrets[peerId]) {
            delete derivedSecrets[peerId];
        }

        // 2. Kişi listesindeki ecdhStatus durumunu 'pending' ve anahtarı null yap
        let contact = myContacts.find((c) => c.id === peerId);
        if (contact) {
            contact.key = null;
            contact.ecdhStatus = 'pending';
            saveContactsToVault();
            renderContactsSidebarDebounced();
        }

        // Statik yedek anahtarı yeniden hazırla
        if (typeof ensureSharedSecret === 'function') {
            ensureSharedSecret(peerId);
        }

        // 3. Eğer şu an açık olan sohbet buysa başlığı ve arayüzü güncelle
        if (activeTarget && activeTarget.id === peerId) {
            activeTarget.key = null;
            activeTarget.ecdhStatus = 'pending';
            updateChatHeaderUI();
            const name =
                contact && contact.username
                    ? `${contact.username} (${peerId})`
                    : peerId;
            showToast(
                `${name} sohbet oturumunu sıfırladı. Yeni mesajda anahtar yeniden anlaşılacak.`,
                'info',
            );
            playSound('destroy');

            // Karşı tarafın teklifi gelmezse yedek olarak yeni el sıkışma başlat
            if (
                typeof initiateEcdhHandshake === 'function' &&
                activeTarget.isOnline
            ) {
                setTimeout(() => {
                    if (
                        typeof hasRatchetSession === 'function' &&
                        !hasRatchetSession(peerId)
                    ) {
                        initiateEcdhHandshake(peerId);
                    }
                }, 400);
            }
        }
    });

    socket.off('session_invalidated');
    /**
     * Başka bir oturumdan şifre değiştirildiğinde mevcut oturumu güvenli şekilde sonlandırır.
     * @param {Object} data - Bildirim verisi ({ message: string }).
     */
    socket.on('session_invalidated', (data) => {
        const msg =
            data && data.message
                ? data.message
                : 'Şifreniz değiştirildiği için oturumunuz sonlandırıldı.';
        if (typeof clearJwtToken === 'function') clearJwtToken();
        if (typeof disconnectFromServer === 'function') {
            disconnectFromServer(msg);
        } else {
            showToast(msg, 'warning');
        }
    });

    socket.off('token_refreshed');
    /**
     * Şifre değişimi sonrasında mevcut aktif oturumun yenilenen JWT token'ını günceller.
     * @param {Object} data - Yeni token verisi ({ token: string }).
     */
    socket.on('token_refreshed', async (data) => {
        if (data && data.token) {
            if (typeof saveJwtToken === 'function') {
                await saveJwtToken(data.token);
            } else {
                localStorage.setItem('cyber_jwt', data.token);
            }
            socket.auth = { token: data.token };
        }
    });
}

