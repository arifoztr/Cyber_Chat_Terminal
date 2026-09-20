// ============================================================
// socket-handlers.js — Socket.IO Olay Dinleyicileri
// Tüm socket.on(...) handler'ları bu modülde tanımlanır.
// ============================================================

function bindSocketEvents() {
    socket.off('node_status_change');
    socket.on('node_status_change', (data) => {
        const exists = myContacts.find(c => c.id === data.userId);
        if (exists) {
            updateContactStatusUI(data.userId, data.status === 'online');
            if (data.status === 'online' && !derivedSecrets[data.userId]) {
                ensureSharedSecret(data.userId).then(success => { if(success && activeTarget && activeTarget.id === data.userId) enableChatUI(); });
            }
        }
    });

    const typingDiv = document.getElementById('user_typing');

    socket.off('user_typing');
    socket.on('user_typing', (data) => {
        if (typingDiv && activeTarget && activeTarget.id === data.senderId) {
            const senderName = activeTarget.username ? `${activeTarget.username}` : data.senderId;
            typingDiv.innerHTML = `
                ${senderName} yazıyor...
                <span class="typing-dots">
                    <span class="typing-dot"></span>
                    <span class="typing-dot"></span>
                    <span class="typing-dot"></span>
                </span>`;
        }
    });

    socket.off('user_typing_stop');
    socket.on('user_typing_stop', (data) => {
        if (typingDiv && activeTarget && activeTarget.id === data.senderId) {
            typingDiv.innerHTML = '';
        }
    });

    socket.off('ecdh_offer');
    socket.on('ecdh_offer', async (data) => {
        let contact = myContacts.find(c => c.id === data.senderId);
        if (!contact) {
            contact = { id: data.senderId, username: null, key: null, ecdhStatus: 'pending', isOnline: true, avatar: null };
            myContacts.push(contact); saveContactsToVault();
            safeEmit('join_status_rooms', [data.senderId]); 
            triggerDesktopNotification("Yeni kişi", `${data.senderId} bağlandı.`);
            safeEmit('check_node_status', data.senderId, (res) => { updateContactStatusUI(res.userId, res.isOnline); });
            safeEmit('get_profiles', [data.senderId], (res) => {
                if(res && res.profiles && res.profiles[data.senderId]) { 
                    if (res.profiles[data.senderId].avatar) contact.avatar = res.profiles[data.senderId].avatar;
                    if (res.profiles[data.senderId].username) contact.username = res.profiles[data.senderId].username;
                    saveContactsToVault(); 
                    renderContactsSidebarDebounced(); 
                    if (activeTarget && activeTarget.id === data.senderId) updateChatHeaderUI();
                }
            });
        }
        try {
            const secret = await deriveSharedSecret(data.publicKeyJwk);
            derivedSecrets[data.senderId] = secret; saveSecretsToVault();
            contact.key = secret;
            contact.ecdhStatus = 'established';
            saveContactsToVault();
            renderContactsSidebarDebounced();
        } catch(e) {}
        safeEmit('ecdh_answer', { targetId: data.senderId, senderId: currentUser.userId, publicKeyJwk: myPublicKeyJwk });
    });

    socket.off('ecdh_answer');
    socket.on('ecdh_answer', async (data) => {
        if (derivedSecrets[data.senderId]) return;
        try {
            const secret = await deriveSharedSecret(data.publicKeyJwk);
            derivedSecrets[data.senderId] = secret; saveSecretsToVault();
            let contact = myContacts.find(c => c.id === data.senderId);
            if (contact) {
                contact.key = secret;
                contact.ecdhStatus = 'established';
                saveContactsToVault();
                renderContactsSidebarDebounced();
            }
            
            if (activeTarget && activeTarget.id === data.senderId) { 
                enableChatUI(); showToast(`${data.senderId} ile şifreli bağlantı kuruldu!`, 'success'); 
            }
        } catch(e) {}
    });

    socket.off('receive_secure_packet');
    socket.on('receive_secure_packet', async (packet) => {
        let senderContact = myContacts.find(c => c.id === packet.senderId);
        if (!senderContact) {
            senderContact = { id: packet.senderId, username: null, key: null, ecdhStatus: 'pending', isOnline: true, avatar: null };
            myContacts.push(senderContact); saveContactsToVault();
            safeEmit('join_status_rooms', [packet.senderId]);
            triggerDesktopNotification("YENİ VERİ", `${packet.senderId}`);
            safeEmit('check_node_status', packet.senderId, (res) => { updateContactStatusUI(res.userId, res.isOnline); });
            safeEmit('get_profiles', [packet.senderId], (res) => {
                if (res && res.profiles && res.profiles[packet.senderId]) {
                    if (res.profiles[packet.senderId].avatar) senderContact.avatar = res.profiles[packet.senderId].avatar;
                    if (res.profiles[packet.senderId].username) senderContact.username = res.profiles[packet.senderId].username;
                    saveContactsToVault();
                    renderContactsSidebarDebounced();
                    if (activeTarget && activeTarget.id === packet.senderId) updateChatHeaderUI();
                }
            });
        }
        await ensureSharedSecret(packet.senderId);
        senderContact = myContacts.find(c => c.id === packet.senderId);
        await savePacketToVault(packet.senderId, packet);
        
        if (activeTarget && activeTarget.id === packet.senderId) {
            playSound('transit'); await processIncomingPacket(packet, senderContact);
        } else {
            playSound('success'); unreadCounts[packet.senderId] = (unreadCounts[packet.senderId] || 0) + 1;
            const notifSender = senderContact && senderContact.username ? `${senderContact.username} (${packet.senderId})` : packet.senderId;
            renderContactsSidebar(); showToast(`${notifSender} yeni mesaj gönderdi.`, 'info');
        }
    });

    socket.off('packet_revoked');
    socket.on('packet_revoked', async (data) => {
        await removePacketFromVault(data.senderId, data.packetId);
        const msgElement = document.getElementById(`msg-${data.packetId}`);
        if (msgElement) fadeOutAndRemoveElement(msgElement, () => showToast(`Bir mesaj silindi.`, 'warning'));
    });

    socket.off('contact_request');
    socket.on('contact_request', (data) => {
        showContactRequest(data);
    });

    socket.off('contact_request_response');
    socket.on('contact_request_response', (data) => {
        showContactRequestResponse(data);
    });
}
