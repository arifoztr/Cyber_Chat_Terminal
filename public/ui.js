// ============================================================
// ui.js — Kullanıcı Arayüzü, State Yönetimi ve DOM İşlemleri
// Toast, Render, Auth, Settings, Sniffer, Matrix Rain, Mobile
// ============================================================

// === POLYFILL ===
const idleCallback = window.requestIdleCallback
    ? window.requestIdleCallback.bind(window)
    : (cb) => setTimeout(() => cb({ timeRemaining: () => 1, didTimeout: false }), 1);

// === GLOBAL STATE ===
let socket = null;
let activeFileBase64 = null;
let audioEnabled = true;
let snifferActive = true;
let keyRevealed = false;
let currentAuthTab = 'login'; 

let currentUser = null;
let activeTarget = null;
let myContacts = []; 

let unreadCounts = {}; 
window.receivedImages = [];
let currentScale = 1.15;
let localTypingTimeout = null;
let isCurrentlyTyping = false;

// === YARDIMCI FONKSİYONLAR ===

function safeEmit(event, data, callback) {
    if (!socket || !socket.connected) return;
    if (callback) socket.emit(event, data, callback);
    else socket.emit(event, data);
}

function triggerDesktopNotification(title, body) {
    if (window.siberBridge && typeof window.siberBridge.showNotification === 'function') {
        window.siberBridge.showNotification(title, body);
    }
}

// === ONAY MODALI ===

function showCustomConfirm(message, onConfirmCallback) {
    playSound('error');
    const modal = document.getElementById('cyberConfirmModal');
    const msgEl = document.getElementById('cyberConfirmMsg');
    const btnYes = document.getElementById('cyberConfirmBtnYes');
    const btnNo = document.getElementById('cyberConfirmBtnNo');
    
    msgEl.innerHTML = message.replace(/\\n/g, '<br>');
    modal.classList.remove('hidden');

    const cleanUp = () => {
        modal.classList.add('hidden');
        btnYes.onclick = null;
        btnNo.onclick = null;
    };

    btnYes.onclick = () => { playSound('success'); cleanUp(); onConfirmCallback(); };
    btnNo.onclick = () => { playSound('type'); cleanUp(); };
}

function glitchAndRemoveElement(element, onComplete) {
    if (!element) return;
    playSound('destroy');
    element.classList.add('glitch-active');
    const chars = '01X_ #$@&%';
    element.querySelectorAll('span, div').forEach(node => {
        if (node.children.length === 0 && node.textContent.trim()) {
            node.textContent = Array.from(node.textContent).map(() => chars[Math.floor(Math.random() * chars.length)]).join('');
        }
    });
    setTimeout(() => { element.remove(); if (onComplete) onComplete(); }, 600);
}

function renderLogPlaceholder(logBox, icon, message, spinner = true) {
    logBox.innerHTML = `<div class="chat-placeholder flex flex-col items-center justify-center h-full opacity-50 mt-4 sm:mt-10">
        ${spinner ? '<div class="w-10 h-10 sm:w-16 sm:h-16 border-2 sm:border-4 border-dashed border-green-500/50 animate-[spin_4s_linear_infinite] rounded-full mb-2 sm:mb-4"></div>' : `<span class="text-2xl sm:text-4xl mb-1 sm:mb-2">${icon}</span>`}
        <div class="text-green-500 text-[9px] sm:text-xs font-mono tracking-widest uppercase text-center">${message}</div>
    </div>`;
}

// === SES SİSTEMİ ===

let audioCtx = null;
function getAudioCtx() { if (!audioCtx) audioCtx = new (window.AudioContext || window.webkitAudioContext)(); return audioCtx; }
function playSound(type) {
    if (!audioEnabled) return;
    try {
        const ctx = getAudioCtx(); if (ctx.state === 'suspended') ctx.resume();
        const osc = ctx.createOscillator(); const gain = ctx.createGain();
        osc.connect(gain); gain.connect(ctx.destination);
        if (type === 'type') { osc.type = 'square'; osc.frequency.setValueAtTime(800, ctx.currentTime); gain.gain.setValueAtTime(0.01, ctx.currentTime); osc.start(); osc.stop(ctx.currentTime + 0.05); } 
        else if (type === 'transit') { osc.type = 'sawtooth'; osc.frequency.setValueAtTime(200, ctx.currentTime); osc.frequency.exponentialRampToValueAtTime(1500, ctx.currentTime + 0.3); gain.gain.setValueAtTime(0.02, ctx.currentTime); osc.start(); osc.stop(ctx.currentTime + 0.3); } 
        else if (type === 'success') { osc.type = 'sine'; osc.frequency.setValueAtTime(600, ctx.currentTime); osc.frequency.exponentialRampToValueAtTime(1200, ctx.currentTime + 0.2); gain.gain.setValueAtTime(0.03, ctx.currentTime); osc.start(); osc.stop(ctx.currentTime + 0.2); } 
        else if (type === 'error') { osc.type = 'square'; osc.frequency.setValueAtTime(100, ctx.currentTime); osc.frequency.exponentialRampToValueAtTime(80, ctx.currentTime + 0.4); gain.gain.setValueAtTime(0.05, ctx.currentTime); osc.start(); osc.stop(ctx.currentTime + 0.4); } 
        else if (type === 'destroy') { osc.type = 'sawtooth'; osc.frequency.setValueAtTime(800, ctx.currentTime); osc.frequency.exponentialRampToValueAtTime(50, ctx.currentTime + 0.5); gain.gain.setValueAtTime(0.04, ctx.currentTime); osc.start(); osc.stop(ctx.currentTime + 0.5); }
    } catch (e) {}
}

// === TOAST BİLDİRİM SİSTEMİ ===

let _toastTimer = null;
let _toastProgressTimer = null;

function showToast(message, type = 'info') {
    const toast = document.getElementById('toastNotification');
    const msgEl = document.getElementById('toastMessage');
    const labelEl = document.getElementById('toastLabel');
    const iconEl = document.getElementById('toastIcon');
    const progressBar = document.getElementById('toastProgressBar');

    if (!toast || !msgEl) return;

    // Önceki timer'ları iptal et
    if (_toastTimer) clearTimeout(_toastTimer);
    if (_toastProgressTimer) clearTimeout(_toastProgressTimer);

    // Tip konfigürasyonu
    const config = {
        success: { label: 'BAŞARI',      icon: '✓',  cls: 'toast-success',  color: 'var(--neon-green)'  },
        error:   { label: 'KRİTİK HATA', icon: '✕',  cls: 'toast-error',    color: 'var(--neon-pink)'   },
        warning: { label: 'UYARI',       icon: '⚠',  cls: 'toast-warning',  color: 'var(--neon-amber)'  },
        info:    { label: 'BİLGİ',       icon: 'ℹ',  cls: 'toast-info',     color: 'var(--neon-cyan)'   },
        system:  { label: 'SİSTEM',      icon: '⚡', cls: 'toast-system',   color: 'var(--neon-purple)' },
    };
    const cfg = config[type] || config.info;

    msgEl.innerText = message;
    if (labelEl) labelEl.textContent = cfg.label;
    if (iconEl)  { iconEl.textContent = cfg.icon; iconEl.style.borderColor = cfg.color; iconEl.style.color = cfg.color; iconEl.style.boxShadow = `0 0 8px ${cfg.color}`; }

    // Sınıf güncelle
    toast.className = '';
    toast.classList.add(cfg.cls, 'toast-visible');

    // Progress bar animasyonu
    const DURATION = 3500;
    if (progressBar) {
        progressBar.style.background = `linear-gradient(90deg, ${cfg.color}, ${cfg.color})`;
        progressBar.style.boxShadow = `0 0 6px ${cfg.color}`;
        progressBar.style.transition = 'none';
        progressBar.style.transform = 'scaleX(1)';
        void progressBar.offsetWidth;
        progressBar.style.transition = `transform ${DURATION}ms linear`;
        progressBar.style.transform = 'scaleX(0)';
    }

    _toastTimer = setTimeout(() => {
        toast.classList.remove('toast-visible');
        toast.className = '';
    }, DURATION);
}

// === KİMLİK DOĞRULAMA (AUTH) ===

function switchAuthTab(tab) {
    playSound('type'); currentAuthTab = tab;
    const regContainer = document.getElementById('regUsernameContainer');
    const tabLoginBtn = document.getElementById('tabLoginBtn');
    const tabRegisterBtn = document.getElementById('tabRegisterBtn');
    const authSubmitBtn = document.getElementById('authSubmitBtn');
    const activeClass = "flex-1 py-1.5 sm:py-2 bg-cyan-500/20 border border-cyan-400 text-cyan-300 font-bold tracking-widest clip-corners-sm transition-all text-[10px] sm:text-xs";
    const inactiveClass = "flex-1 py-1.5 sm:py-2 bg-transparent border border-gray-600 text-gray-500 font-bold tracking-widest clip-corners-sm hover:border-cyan-500/50 hover:text-cyan-400 transition-all text-[10px] sm:text-xs";
    if (tab === 'login') {
        regContainer.classList.add('hidden');
        tabLoginBtn.className = activeClass; tabRegisterBtn.className = inactiveClass;
        authSubmitBtn.innerText = "[ BAĞLANTIYI BAŞLAT ]";
    } else {
        regContainer.classList.remove('hidden');
        tabRegisterBtn.className = activeClass; tabLoginBtn.className = inactiveClass;
        authSubmitBtn.innerText = "[ YENİ KİMLİK OLUŞTUR ]";
    }
}

function handleAuthSubmit() {
    const serverUrl = document.getElementById('serverIp').value.trim();
    const email = document.getElementById('authEmail').value.trim();
    const password = document.getElementById('authPassword').value.trim();
    const username = document.getElementById('authUsername').value.trim();

    if (!serverUrl || !email || !password || (currentAuthTab === 'register' && !username)) {
        playSound('error'); showToast("HATA: PARAMETRELER EKSİK!", 'error'); return;
    }

    // Loading animasyonu
    const btn = document.getElementById('authSubmitBtn');
    const originalText = btn.innerText;
    btn.classList.add('btn-loading');
    btn.innerText = '[ VERİ AKIŞI... ]';
    btn.disabled = true;

    const restoreBtn = () => {
        btn.classList.remove('btn-loading');
        btn.innerText = originalText;
        btn.disabled = false;
    };

    showToast("SİSTEME BAĞLANILIYOR...", 'info');

    const connectAndRun = () => {
        if (currentAuthTab === 'register') {
            socket.emit('register', { email, password, username }, (res) => {
                restoreBtn();
                if (res && res.success) {
                    playSound('success'); showToast("KİMLİK OLUŞTURULDU! OTURUM AÇILIYOR...", 'success');
                    switchAuthTab('login'); document.getElementById('authEmail').value = email; document.getElementById('authPassword').value = password; handleAuthSubmit(); 
                } else { playSound('error'); showToast(`KAYIT HATASI: ${res ? res.message : 'Yanıt alınamadı'}`, 'error'); }
            });
        } else {
            socket.emit('login', { email, password }, (res) => {
                restoreBtn();
                if (res && res.success) {
                    if (res.token) { localStorage.setItem('cyber_jwt', res.token); socket.auth = { token: res.token }; }
                    currentUser = res.user; finishLoginSetup();
                } else { playSound('error'); showToast(`GİRİŞ HATASI: ${res ? res.message : 'Yanıt alınamadı'}`, 'error'); }
            });
        }
    };

    if (!socket || socket.io.uri !== serverUrl || socket.disconnected) {
        if (socket) socket.disconnect();
        socket = io(serverUrl, { transports: ['polling', 'websocket'], upgrade: true, reconnectionAttempts: 10, timeout: 15000, forceNew: true });
        socket.on('connect_error', (err) => { restoreBtn(); playSound('error'); showToast(`AĞ HATASI! ${err.message}`, 'error'); });
        socket.on('disconnect', () => { handleDisconnectUI(); });
    }
    if (socket.connected) connectAndRun(); else socket.once('connect', connectAndRun);
}

function autoLoginAttempt() {
    const token = localStorage.getItem('cyber_jwt');
    if (!token) return;
    
    const serverUrl = document.getElementById('serverIp').value;
    showToast("OTURUM DOĞRULANIYOR...", 'info');
    
    socket = io(serverUrl, { transports: ['polling', 'websocket'], auth: { token } });
    
    socket.on('disconnect', () => { handleDisconnectUI(); });

    socket.once('connect', () => {
        socket.emit('verify_session', token, (res) => {
            if (res && res.success) {
                currentUser = res.user;
                finishLoginSetup();
            } else {
                localStorage.removeItem('cyber_jwt');
                socket.disconnect();
                showToast("OTURUM GEÇERSSİZ, LÜTFEN TEKRAR GİRİŞ YAPIN.", 'error');
            }
        });
    });
}

// === GİRİŞ SONRASI KURULUM ===

function updateMyAvatarUI() {
    const container = document.getElementById('myProfileAvatarContainer');
    if (currentUser && currentUser.avatar) {
        container.innerHTML = `<img src="${currentUser.avatar}" class="w-full h-full object-cover">`;
    } else {
        container.innerHTML = `<span class="text-cyan-300 font-black tech-font text-[10px] sm:text-xs">OP</span>`;
    }
}

function finishLoginSetup() {
    playSound('success'); showToast("DOĞRULAMA BAŞARILI! KRİPTOLAR YÜKLENİYOR.", 'success');
    // Scroll-to-bottom FAB başlat
    setTimeout(initScrollToBottomFab, 200); // DOM hazır olunca bağla
    loadContactsFromVault(); loadSecretsFromVault();
    initEcdhKeys().then(() => { socket.emit('publish_public_key', myPublicKeyJwk); });
    
    if (myContacts.length > 0) {
        safeEmit('join_status_rooms', myContacts.map(c => c.id));
        safeEmit('get_profiles', myContacts.map(c => c.id), (res) => {
            if (res && res.profiles) {
                myContacts.forEach(c => { if (res.profiles[c.id]) c.avatar = res.profiles[c.id].avatar; });
                saveContactsToVault(); renderContactsSidebarDebounced();
            }
        });
    }

    document.getElementById('profileUsername').innerText = currentUser.username;
    document.getElementById('profileUserId').innerText = currentUser.userId;
    calculateFingerprint(myPublicKeyJwk).then(fp => {
        const fpEl = document.getElementById('profileUserFingerprint');
        if (fpEl) fpEl.innerText = fp;
    });
    updateMyAvatarUI();

    document.getElementById('authGateway').classList.add('hidden');
    document.getElementById('chatTerminalWrapper').classList.remove('hidden');
    document.getElementById('snifferToggleBtn').classList.remove('hidden');
    
    renderContactsSidebar(); bindSocketEvents(); checkOnlineStatuses();
    migrateLocalStorageToIndexedDB();

    const messageInput =  document.getElementById('messageInput');
    if (messageInput) {
        messageInput.oninput = () => {
            if (activeTarget) {
                if (!isCurrentlyTyping) {
                    isCurrentlyTyping = true;
                    socket.emit('typing', { targetId: activeTarget.id });
                }
                
                clearTimeout(localTypingTimeout);
                localTypingTimeout = setTimeout(() => {
                    if (activeTarget) {
                        socket.emit('stop_typing', { targetId: activeTarget.id });
                    }
                    isCurrentlyTyping = false;
                }, 3000);
            }
        };
    }

    socket.emit('client_ready');
    updateMobileLayout();
}

// === BAĞLANTI KESİLME ===

function handleDisconnectUI() {
    document.getElementById('chatTerminalWrapper').classList.add('hidden'); 
    document.getElementById('snifferToggleBtn').classList.add('hidden');
    document.getElementById('authGateway').classList.remove('hidden');
    document.getElementById('clearChatBtn').classList.add('hidden');
    renderLogPlaceholder(document.getElementById('chatLog'), null, "// BAĞLANTI KESİLDİ //", true);
    document.getElementById('snifferLog').innerHTML = `<div class="flex flex-col items-center justify-center h-full opacity-60"><span class="text-lg sm:text-2xl mb-1 sm:mb-2">🔌</span><div class="text-pink-500 text-center tracking-[0.1em] sm:tracking-[0.2em] uppercase text-[9px] sm:text-[10px]">Sistem çevrimdışı...</div></div>`;
    document.getElementById('packetSizeDisplay').innerText = "KASA: BOŞ";
    
    Object.keys(_activeTimers).forEach(id => { clearInterval(_activeTimers[id]); delete _activeTimers[id]; });
    Object.keys(_aesKeyCache).forEach(k => delete _aesKeyCache[k]);
    if (localTypingTimeout) { clearTimeout(localTypingTimeout); localTypingTimeout = null; }
    isCurrentlyTyping = false;
    window.receivedImages = []; currentUser = null; activeTarget = null; myContacts = []; unreadCounts = {}; derivedSecrets = {}; myEcdhKeyPair = null; myPublicKeyJwk = null; socket = null;
    updateMobileLayout();
}

function disconnectFromServer() { 
    if (socket) { 
        playSound('error'); socket.disconnect(); showToast("OTURUM SONLANDIRILDI.", 'warning'); 
        localStorage.removeItem('cyber_jwt'); handleDisconnectUI(); 
    } 
}

// === KİŞİ LİSTESİ / DURUM ===

function updateContactStatusUI(userId, isOnline) {
    const contact = myContacts.find(c => c.id === userId);
    if (contact) contact.isOnline = isOnline;
    const dot = document.getElementById(`status_dot_${userId}`);
    if (dot) dot.className = `w-1.5 h-1.5 sm:w-2 sm:h-2 rounded-full shadow-[0_0_8px_currentColor] flex-shrink-0 ${isOnline ? 'bg-[#00ff66] text-[#00ff66] animate-pulse' : 'bg-gray-600 text-gray-600 opacity-50'}`;
    
    if (activeTarget && activeTarget.id === userId) {
        const headerDot = document.getElementById('chatStatusDot');
        if (headerDot) headerDot.className = `w-2 h-2 sm:w-2.5 sm:h-2.5 rounded-full shadow-[0_0_10px_currentColor] flex-shrink-0 ${isOnline ? 'bg-[#00ff66] text-[#00ff66] animate-pulse' : 'bg-gray-600 text-gray-600 opacity-50'}`;
    }
}

function checkOnlineStatuses() {
    if (myContacts.length === 0) return;
    const ids = myContacts.map(c => c.id);
    safeEmit('check_node_statuses', ids, (res) => {
        if (!res || !res.statuses) return;
        for (const userId in res.statuses) updateContactStatusUI(userId, res.statuses[userId]);
    });
}

let _renderContactsTimer = null;
function renderContactsSidebarDebounced() {
    if (_renderContactsTimer) return;
    _renderContactsTimer = setTimeout(() => { _renderContactsTimer = null; renderContactsSidebar(); }, 50);
}

function renderContactsSidebar() {
    const listContainer = document.getElementById('contactsList');
    if (myContacts.length === 0) {
        listContainer.replaceChildren();
        const emptyDiv = document.createElement('div');
        emptyDiv.className = 'text-cyan-700/50 text-[9px] sm:text-[10px] text-center italic mt-2 sm:mt-6 border border-dashed border-cyan-800/30 p-3 bg-black/20 clip-corners-sm font-mono tracking-widest leading-relaxed';
        emptyDiv.innerHTML = '📡<br>// REHBER BOŞ.<br><span class="text-cyan-600">SİSTEME AJAN_ID GİRİN.</span>';
        listContainer.appendChild(emptyDiv); return;
    }

    const fragment = document.createDocumentFragment();
    myContacts.forEach(contact => {
        const isActive = activeTarget && activeTarget.id === contact.id;
        const unreadCount = unreadCounts[contact.id] || 0;
        const hasSecret = !!derivedSecrets[contact.id];
        
        const card = document.createElement('div');
        card.setAttribute('onclick', `selectTarget('${contact.id}')`);
        // Aktif kart özel animasyonlu sınıf, pasif kart normal hover
        card.className = `contact-card p-2 sm:p-3 border clip-corners-sm cursor-pointer transition-all duration-300 flex flex-col justify-between relative overflow-hidden ${
            isActive
                ? 'contact-card-active border-cyan-400/60'
                : 'bg-black/50 border-cyan-500/20 hover:bg-cyan-900/15 hover:border-cyan-500/50'
        }`;

        const topRow = document.createElement('div'); topRow.className = 'flex justify-between items-center z-10 relative';
        const leftWrap = document.createElement('div'); leftWrap.className = 'flex items-center gap-1.5 sm:gap-2 min-w-0';
        
        // Avatar
        const avatarDiv = document.createElement('div');
        const avatarBorder = isActive ? 'border-cyan-400 shadow-[0_0_8px_rgba(0,240,255,0.5)]' : 'border-cyan-700';
        avatarDiv.className = `w-6 h-6 sm:w-8 sm:h-8 rounded-full border-2 ${avatarBorder} flex items-center justify-center overflow-hidden flex-shrink-0 bg-cyan-950 transition-all`;
        if (contact.avatar) {
            const img = document.createElement('img'); img.src = contact.avatar; img.className = 'w-full h-full object-cover'; avatarDiv.appendChild(img);
        } else {
            const initial = contact.id ? contact.id.charAt(4) || 'A' : 'A';
            const spn = document.createElement('span'); spn.className = 'text-[8px] sm:text-[10px] text-cyan-300 font-bold'; spn.innerText = initial; avatarDiv.appendChild(spn);
        }
        leftWrap.appendChild(avatarDiv);

        const idCol = document.createElement('div'); idCol.className = 'flex flex-col min-w-0';
        const idSpan = document.createElement('span');
        idSpan.className = `font-black font-mono text-[9px] sm:text-[10px] truncate ${isActive ? 'text-white neon-text-cyan' : 'text-cyan-400'}`;
        idSpan.textContent = contact.id;

        const subLine = document.createElement('span');
        subLine.className = `text-[7px] font-mono truncate ${hasSecret ? 'text-green-500' : 'text-yellow-600 animate-pulse'}`;
        subLine.textContent = hasSecret ? '🔐 TÜNEL AKTİF' : '⏳ ANAHTAR BEKLENİYOR';
        
        const fpSpan = document.createElement('span');
        fpSpan.className = `text-[7px] font-mono truncate ${contact.fingerprintVerified ? 'text-green-400' : 'text-yellow-500/80 animate-pulse'}`;
        const fpText = contact.fingerprint ? `FP: ${contact.fingerprint}` : 'FP: BEKLENİYOR';
        const fpStatus = contact.fingerprint ? (contact.fingerprintVerified ? ' ✅' : ' ⚠️') : '';
        fpSpan.textContent = fpText + fpStatus;

        idCol.appendChild(idSpan);
        idCol.appendChild(subLine);
        idCol.appendChild(fpSpan);

        if (unreadCount > 0) {
            const badge = document.createElement('span');
            badge.className = 'unread-badge bg-[#ff0055] text-white text-[7px] sm:text-[8px] px-1.5 py-0.5 rounded-sm ml-1 uppercase tracking-wider font-black inline-block';
            badge.textContent = `+${unreadCount}`;
            idCol.appendChild(badge);
        }
        leftWrap.appendChild(idCol);
        topRow.appendChild(leftWrap);

        // Sağ taraf: durum noktası + sil butonu
        const rightActions = document.createElement('div'); rightActions.className = 'flex items-center gap-2 flex-shrink-0 ml-1';
        
        const statusDot = document.createElement('span'); statusDot.id = `status_dot_${contact.id}`;
        statusDot.className = `w-2 h-2 rounded-full shadow-[0_0_6px_currentColor] flex-shrink-0 ${contact.isOnline ? 'bg-[#00ff66] text-[#00ff66] animate-pulse' : 'bg-gray-600 text-gray-600 opacity-40'}`;
        statusDot.title = contact.isOnline ? 'Çevrimiçi' : 'Çevrimdışı';
        
        const removeBtn = document.createElement('button');
        removeBtn.setAttribute('onclick', `removeContact('${contact.id}', event)`);
        removeBtn.className = 'text-gray-600 hover:text-red-500 hover:border-red-500/50 border border-transparent px-0.5 py-0.5 transition-all text-[10px] font-bold rounded';
        removeBtn.title = 'Sil'; removeBtn.textContent = '✕';
        
        rightActions.appendChild(statusDot); rightActions.appendChild(removeBtn);
        topRow.appendChild(rightActions);

        card.appendChild(topRow); fragment.appendChild(card);
    });
    listContainer.replaceChildren(fragment);
}

function removeContact(targetId, event) {
    event.stopPropagation();
    showCustomConfirm(`DİKKAT: [${targetId}] kodlu ajan ile\nolan tüm kriptografik bağı ve yerel geçmişi\nkalıcı olarak SİLMEK üzeresiniz.\n\nEmin misiniz?`, async () => {
        myContacts = myContacts.filter(c => c.id !== targetId); saveContactsToVault();
        try {
            const db = await openVaultDB();
            const tx = db.transaction('packets', 'readwrite');
            const store = tx.objectStore('packets');
            const index = store.index('peerId');
            const request = index.getAllKeys(targetId);
            request.onsuccess = () => { request.result.forEach(key => store.delete(key)); };
        } catch(e) {}
        if (derivedSecrets[targetId]) { delete derivedSecrets[targetId]; saveSecretsToVault(); }
        if (activeTarget && activeTarget.id === targetId) {
            activeTarget = null; document.getElementById('chatTargetHeader').innerText = "AJAN SEÇİNİZ";
            document.getElementById('chatTargetFingerprint').innerText = "FP: -----";
            updateFingerprintHeaderUI();
            document.getElementById('clearChatBtn').classList.add('hidden'); disableChatUI();
            renderLogPlaceholder(document.getElementById('chatLog'), null, "// GÜVENLİ TÜNEL BEKLENİYOR //", true);
            updateMobileLayout();
        }
        renderContactsSidebar(); playSound('destroy'); showToast(`[${targetId}] SİSTEMDEN SİLİNDİ!`, 'warning');
    });
}

// === SOHBET ALANI ===

function enableChatUI() {
    document.getElementById('messageInput').disabled = false; document.getElementById('messageInput').placeholder = "[ AĞA VERİ YAZ ]_";
    document.getElementById('sendPacketBtn').disabled = false;
    document.getElementById('sendPacketBtn').className = "px-4 sm:px-8 py-2 sm:py-0 bg-[#00ff66]/20 text-[#00ff66] font-black border-2 border-[#00ff66] text-[10px] sm:text-sm clip-corners transition-all duration-300 uppercase tracking-[0.2em] hover:bg-[#00ff66] hover:text-black shadow-[0_0_20px_rgba(0,255,102,0.4)] cyber-button-hover flex-shrink-0";
}

function disableChatUI() {
    document.getElementById('messageInput').disabled = true; document.getElementById('messageInput').placeholder = "ANAHTAR BEKLENİYOR...";
    document.getElementById('sendPacketBtn').disabled = true;
    document.getElementById('sendPacketBtn').className = "px-4 sm:px-8 py-2 sm:py-0 bg-gray-900 text-gray-600 font-black border border-gray-700 text-[10px] sm:text-sm clip-corners transition-all duration-300 uppercase tracking-[0.2em] flex-shrink-0";
}

async function selectTarget(targetId) {
    const selected = myContacts.find(c => c.id === targetId); if (!selected) return;
    
    if (activeTarget && isCurrentlyTyping) {
        clearTimeout(localTypingTimeout);
        socket.emit('stop_typing', { targetId: activeTarget.id });
        isCurrentlyTyping = false;
    }
    
    playSound('success'); activeTarget = selected; unreadCounts[targetId] = 0; renderContactsSidebar();
    
    document.getElementById('chatTargetHeader').innerText = `AJAN: ${activeTarget.id}`;
    document.getElementById('chatTargetFingerprint').innerText = activeTarget.fingerprint ? `FP: ${activeTarget.fingerprint}` : `FP: BEKLENİYOR`;
    updateFingerprintHeaderUI();
    document.getElementById('clearChatBtn').classList.remove('hidden'); keyRevealed = false;

    const hasSecret = !!derivedSecrets[selected.id];
    if (hasSecret) enableChatUI(); 
    else {
        disableChatUI(); const success = await ensureSharedSecret(selected.id);
        if (success) { if (activeTarget && activeTarget.id === selected.id) { enableChatUI(); showToast(`🔑 ECDH BAŞARILI!`); } renderContactsSidebar(); } 
        else setTimeout(() => initiateEcdhHandshake(selected.id), 300);
    }
    safeEmit('check_node_status', activeTarget.id, (res) => { updateContactStatusUI(res.userId, res.isOnline); });
    
    const logBox = document.getElementById('chatLog'); logBox.innerHTML = ''; window.receivedImages = [];
    const history = await loadHistoryFromVault(activeTarget.id);
    
    if (history.length > 0) {
        const topBanner = document.createElement('div');
        topBanner.className = 'text-green-500/50 text-center tracking-[0.1em] sm:tracking-[0.2em] uppercase font-bold text-[8px] sm:text-[10px] my-2 sm:my-4 border-b border-green-500/20 pb-1 sm:pb-2 drop-shadow-md';
        topBanner.innerText = '/// GÜVENLİ YEREL BELLEK GERİ YÜKLENDİ (IDB) ///';
        logBox.appendChild(topBanner);

        const INITIAL_LOAD = 20; const first = history.slice(-INITIAL_LOAD); const rest  = history.slice(0, -INITIAL_LOAD);
        const decryptedFirst = await Promise.all(first.map(p => decryptPacketForDisplay(p, activeTarget)));
        for (const data of decryptedFirst) { if (data) appendMessageToUI(data.id, data.sender, data.text, data.file, data.isMine, data.isError, data.ttl, data.timestamp); }
        logBox.scrollTop = logBox.scrollHeight;
        
        if (rest.length > 0) {
            let i = 0;
            function processRest() { 
                if (i >= rest.length) return; 
                decryptPacketForDisplay(rest[i++], activeTarget).then((data) => { 
                    if(data) appendMessageToUI(data.id, data.sender, data.text, data.file, data.isMine, data.isError, data.ttl, data.timestamp);
                    idleCallback(processRest); 
                }); 
            }
            idleCallback(processRest);
        }
    } else renderLogPlaceholder(logBox, '📭', '// GEÇMİŞ VERİ YOK //', false);
    updateMobileLayout();
    const chatLogBox = document.getElementById('chatLog');
    if (chatLogBox) chatLogBox.scrollTop = chatLogBox.scrollHeight;
}

function clearActiveChat() {
    if (!activeTarget) return;
    showCustomConfirm(`BELLEK SİLME UYARISI:\nSadece ${activeTarget.id} ile olan YEREL sohbet\ngeçmişi kalıcı olarak silinecektir.\n\nOnaylıyor musunuz?`, async () => {
        try {
            const db = await openVaultDB(); const tx = db.transaction('packets', 'readwrite'); const store = tx.objectStore('packets');
            const index = store.index('peerId'); const request = index.getAllKeys(activeTarget.id);
            request.onsuccess = () => {
                request.result.forEach(key => store.delete(key));
                renderLogPlaceholder(document.getElementById('chatLog'), '📭', '// BELLEK SIFIRLANDI //', false);
                showToast("BELLEĞ BAŞARIYLA TEMİZLENDİ!", 'success'); playSound('destroy');
            };
        } catch(e) {}
    });
}

// === KİŞİ EKLEME MODALI ===

function showContactConfigModal() { playSound('type'); const modal = document.getElementById('contactConfigModal'); document.getElementById('modalTargetId').value = ''; modal.classList.remove('hidden'); }
function hideContactConfigModal() { playSound('type'); document.getElementById('contactConfigModal').classList.add('hidden'); }

// === YENİ AJAN EKLEME (REUSABLE) ===

function addContact(targetId) {
    if (!targetId) return false;
    targetId = targetId.toUpperCase();
    if (targetId === currentUser.userId) return false;
    
    let existing = myContacts.find(c => c.id === targetId);
    if (!existing) {
        myContacts.push({ id: targetId, key: null, fingerprint: null, fingerprintVerified: false, ecdhStatus: 'pending', isOnline: false, avatar: null });
        saveContactsToVault();
        showToast(`[+] DÜĞÜM ${targetId} EKLENDİ.`, 'success');
        safeEmit('join_status_rooms', [targetId]); 
        safeEmit('check_node_status', targetId, (res) => { if (res) updateContactStatusUI(res.userId, res.isOnline); });
        safeEmit('get_profiles', [targetId], (res) => {
            if (res && res.profiles && res.profiles[targetId]) {
                const c = myContacts.find(x => x.id === targetId);
                if (c) {
                    c.avatar = res.profiles[targetId].avatar;
                    saveContactsToVault();
                    renderContactsSidebarDebounced();
                }
            }
        });
        
        // Ekleme başarılı olunca karşıya bildirim gönder
        notifyContactAddition(targetId);
        
        // ECDH tüneli otomatik başlat
        ensureSharedSecret(targetId);
        
        return true;
    }
    return false;
}

// === KİŞİ ARAMA MODAL İŞLEMLERİ ===

function showSearchModal() {
    playSound('type');
    const modal = document.getElementById('searchModal');
    document.getElementById('searchQuery').value = '';
    document.getElementById('searchResultsList').innerHTML = 'Arama yapmak için bir şeyler yazın...';
    modal.classList.remove('hidden');
}

function hideSearchModal() {
    playSound('type');
    document.getElementById('searchModal').classList.add('hidden');
}

function performSearch() {
    const query = document.getElementById('searchQuery').value.trim();
    const resultsList = document.getElementById('searchResultsList');
    if (!query) {
        resultsList.innerHTML = 'Arama yapmak için bir şeyler yazın...';
        return;
    }
    safeEmit('search_users', query, (res) => {
        if (!res || !res.results) {
            resultsList.innerHTML = '<span class="text-red-500">// ARAMA BAŞARISIZ //</span>';
            return;
        }
        if (res.results.length === 0) {
            resultsList.innerHTML = '<span class="text-gray-400">// SONUÇ BULUNAMADI //</span>';
            return;
        }
        resultsList.replaceChildren();
        res.results.forEach(user => {
            const item = document.createElement('div');
            item.className = 'flex items-center justify-between p-2 bg-purple-950/20 border border-purple-500/20 clip-corners-sm text-xs font-mono mb-2';

            const left = document.createElement('div');
            left.className = 'flex items-center gap-2 min-w-0';

            const dot = document.createElement('span');
            dot.className = `w-2 h-2 rounded-full ${user.isOnline ? 'bg-green-500 shadow-[0_0_8px_rgba(34,197,94,0.8)]' : 'bg-gray-600'} flex-shrink-0`;
            left.appendChild(dot);

            const avatar = document.createElement('div');
            avatar.className = 'w-6 h-6 rounded-full border border-purple-500/40 flex items-center justify-center overflow-hidden bg-purple-950/40 flex-shrink-0';
            if (user.avatar) {
                const img = document.createElement('img');
                img.src = user.avatar;
                img.className = 'w-full h-full object-cover';
                avatar.appendChild(img);
            } else {
                const initial = user.userId.charAt(4) || 'A';
                const spn = document.createElement('span');
                spn.className = 'text-[8px] font-bold text-purple-300';
                spn.innerText = initial;
                avatar.appendChild(spn);
            }
            left.appendChild(avatar);

            const info = document.createElement('div');
            info.className = 'flex flex-col text-left min-w-0';
            const username = document.createElement('span');
            username.className = 'text-white font-bold truncate';
            username.innerText = user.username;
            const userId = document.createElement('span');
            userId.className = 'text-purple-400 text-[9px] font-bold';
            userId.innerText = user.userId;
            info.appendChild(username);
            info.appendChild(userId);
            left.appendChild(info);

            item.appendChild(left);

            const isAlreadyAdded = myContacts.some(c => c.id === user.userId);
            const btn = document.createElement('button');
            if (isAlreadyAdded) {
                btn.disabled = true;
                btn.className = 'px-3 py-1.5 border border-purple-500/30 text-purple-500/40 text-[10px] font-black clip-corners-sm uppercase tracking-wider cursor-not-allowed';
                btn.innerText = 'EKLI';
            } else {
                btn.className = 'px-3 py-1.5 bg-purple-500 text-black hover:bg-white hover:text-black font-black border border-purple-400 text-[10px] clip-corners-sm uppercase tracking-wider transition-all cursor-pointer';
                btn.innerText = 'EKLE';
                btn.onclick = () => {
                    const added = addContact(user.userId);
                    if (added) {
                        playSound('success');
                        btn.disabled = true;
                        btn.className = 'px-3 py-1.5 border border-purple-500/30 text-purple-500/40 text-[10px] font-black clip-corners-sm uppercase tracking-wider cursor-not-allowed';
                        btn.innerText = 'EKLI';
                        renderContactsSidebar();
                    }
                };
            }
            item.appendChild(btn);
            resultsList.appendChild(item);
        });
    });
}

// === KARŞILIKLI BAĞLANTI / BİLDİRİM İŞLEMLERİ ===

let pendingContactRequest = null;

function notifyContactAddition(targetId) {
    safeEmit('notify_add_contact', { targetId });
}

function showContactRequest(data) {
    playSound('transit');
    pendingContactRequest = data;
    
    const modal = document.getElementById('contactRequestModal');
    const avatarContainer = document.getElementById('crModalAvatar');
    const nameEl = document.getElementById('crModalName');
    const idEl = document.getElementById('crModalId');
    
    avatarContainer.innerHTML = '';
    if (data.avatar) {
        const img = document.createElement('img');
        img.src = data.avatar;
        img.className = 'w-full h-full object-cover';
        avatarContainer.appendChild(img);
    } else {
        const initial = data.senderId.charAt(4) || 'A';
        const spn = document.createElement('span');
        spn.className = 'text-xs font-bold text-cyan-300';
        spn.innerText = initial;
        avatarContainer.appendChild(spn);
    }
    
    nameEl.innerText = data.username;
    idEl.innerText = data.senderId;
    modal.classList.remove('hidden');
}

function handleContactRequestResponse(accepted) {
    if (!pendingContactRequest) return;
    const targetId = pendingContactRequest.senderId;
    
    safeEmit('respond_contact_request', { targetId, accepted }, (res) => {
        if (accepted) {
            addContact(targetId);
            renderContactsSidebar();
            selectTarget(targetId);
        }
        playSound(accepted ? 'success' : 'destroy');
        document.getElementById('contactRequestModal').classList.add('hidden');
        pendingContactRequest = null;
    });
}

function showContactRequestResponse(data) {
    if (data.accepted) {
        showToast(`[${data.senderId}] BAĞLANTI İSTEĞİNİ KABUL ETTİ!`, 'success');
        playSound('success');
        ensureSharedSecret(data.senderId);
    } else {
        showToast(`[${data.senderId}] BAĞLANTI İSTEĞİNİ REDDETTİ.`, 'error');
        playSound('destroy');
    }
}

// === PARMAK İZİ MODALI VE DOĞRULAMA ===

let fingerprintTargetContact = null;
let qrCodeInstance = null;

function updateFingerprintHeaderUI() {
    const verifyBtn = document.getElementById('verifyFingerprintBtn');
    if (!verifyBtn) return;
    if (activeTarget && activeTarget.fingerprint) {
        verifyBtn.classList.remove('hidden');
        if (activeTarget.fingerprintVerified) {
            verifyBtn.innerText = "✅ DOĞRULANDI";
            verifyBtn.className = "px-2 py-1 text-[8px] sm:text-[10px] font-bold clip-corners-sm border border-green-500 text-green-400 bg-green-500/10 cursor-pointer transition-all";
        } else {
            verifyBtn.innerText = "🔐 DOĞRULA";
            verifyBtn.className = "px-2 py-1 text-[8px] sm:text-[10px] font-bold clip-corners-sm border border-yellow-500 text-yellow-400 bg-yellow-500/10 hover:bg-yellow-500/30 hover:text-white cursor-pointer transition-all";
        }
    } else {
        verifyBtn.classList.add('hidden');
    }
}

function showFingerprintModal(contact) {
    if (!contact) return;
    playSound('type');
    fingerprintTargetContact = contact;
    
    document.getElementById('fpModalContactId').innerText = contact.id;
    document.getElementById('fpModalValue').innerText = contact.fingerprint || 'UNKNOWN';
    
    calculateFingerprint(myPublicKeyJwk).then(fp => {
        const myFpEl = document.getElementById('fpModalMyValue');
        if (myFpEl) myFpEl.innerText = fp;
    });
    
    const qrContainer = document.getElementById('fpModalQRCode');
    qrContainer.innerHTML = '';
    
    if (contact.fingerprint) {
        try {
            qrCodeInstance = new QRCode(qrContainer, {
                text: contact.fingerprint,
                width: 128,
                height: 128,
                colorDark: "#00f0ff",
                colorLight: "#000000",
                correctLevel: QRCode.CorrectLevel.M
            });
            setTimeout(() => {
                const qrImg = qrContainer.querySelector('img');
                if (qrImg) qrImg.className = "mx-auto border border-cyan-500/40 p-1 bg-black";
                const qrCanvas = qrContainer.querySelector('canvas');
                if (qrCanvas) qrCanvas.className = "mx-auto border border-cyan-500/40 p-1 bg-black";
            }, 50);
        } catch (err) {
            console.error("QR Code generation error:", err);
        }
    }
    
    document.getElementById('fingerprintModal').classList.remove('hidden');
}

function hideFingerprintModal() {
    playSound('type');
    document.getElementById('fingerprintModal').classList.add('hidden');
    fingerprintTargetContact = null;
    qrCodeInstance = null;
}

function verifyFingerprint() {
    if (!fingerprintTargetContact) return;
    
    fingerprintTargetContact.fingerprintVerified = true;
    
    const c = myContacts.find(x => x.id === fingerprintTargetContact.id);
    if (c) {
        c.fingerprintVerified = true;
    }
    
    saveContactsToVault();
    renderContactsSidebarDebounced();
    
    if (activeTarget && activeTarget.id === fingerprintTargetContact.id) {
        activeTarget.fingerprintVerified = true;
        updateFingerprintHeaderUI();
    }
    
    hideFingerprintModal();
    playSound('success');
    showToast(`[${fingerprintTargetContact.id}] PARMAK İZİ DOĞRULANDI!`, 'success');
}

function handleContactSubmit() {
    const targetId = document.getElementById('modalTargetId').value.trim().toUpperCase();
    if (!targetId) { playSound('error'); showToast("HATA: ID BOŞ OLAMAZ!", 'error'); return; }
    if (targetId === currentUser.userId) { playSound('error'); showToast("HATA: KENDİNİZİ EKLEYEMEZSİNİZ.", 'error'); return; }
    
    const added = addContact(targetId);
    if (added) {
        playSound('success');
    } else {
        playSound('error');
        showToast("BU AJAN ZATEN EKLİDİR.", 'warning');
    }
    hideContactConfigModal();
    renderContactsSidebar();
    selectTarget(targetId);
}

// === MESAJ GÖNDERME / ALMA ===

async function sendSecurePacket() {
    if (!activeTarget) return;
    const sharedSecret = derivedSecrets[activeTarget.id];
    if (!sharedSecret) { playSound('error'); showToast("KRİPTO ANAHTAR BEKLENİYOR!", 'warning'); return; }
    
    if (!activeTarget.fingerprintVerified) {
        playSound('error');
        showToast("HATA: PARMAK İZİ DOĞRULANMAMIŞ! GÖNDERİM ENGELLENDİ.", 'error');
        return;
    }
    
    activeTarget.key = sharedSecret; playSound('type');
    
    const msgInput = document.getElementById('messageInput');
    const rawText = msgInput.value.trim(); const hasFile = activeFileBase64 !== null;
    const ttl = parseInt(document.getElementById('messageTtl').value); 
    if (!rawText && !hasFile) return;
    msgInput.value = '';

    let encryptedText = null; let encryptedFile = null;
    try {
        if (rawText) encryptedText = await encryptGCM(rawText, activeTarget.key);
        if (hasFile) encryptedFile = await encryptGCM(activeFileBase64, activeTarget.key);
    } catch (e) { playSound('error'); showToast("HATA: ŞİFRELEME MOTORU ÇÖKTÜ!", 'error'); return; }

    const packetId = crypto.randomUUID().replace(/-/g, '').substring(0, 12).toUpperCase();
    const packet = { id: packetId, senderId: currentUser.userId, targetId: activeTarget.id, textPayload: encryptedText, filePayload: encryptedFile, ttl: ttl > 0 ? ttl : null, timestamp: new Date().getTime() };
    
    appendMessageToUI(packetId, 'SEN', rawText, activeFileBase64, true, false, packet.ttl, packet.timestamp);
    await savePacketToVault(activeTarget.id, packet);
    playSound('transit');

    // Paket gönderim animasyonu
    const pLine = document.getElementById('packetSendLine');
    if (pLine) {
        pLine.classList.remove('hidden');
        pLine.style.animation = 'none';
        void pLine.offsetWidth; // reflow
        pLine.style.animation = '';
        pLine.classList.remove('hidden');
        pLine.classList.add('packet-send-line');
        setTimeout(() => pLine.classList.add('hidden'), 600);
    }

    clearTimeout(localTypingTimeout);
    isCurrentlyTyping = false;
    safeEmit('stop_typing', { targetId: activeTarget.id });
    
    safeEmit('send_secure_packet', packet, (res) => { 
        if (res && res.queued) showToast("HEDEF ÇEVRİMDIŞI. KUYRUĞA EKLENDİ.", 'warning');
        else if (res && res.error === "RATE_LIMIT") { playSound('error'); showToast("HATA: ÇOK FAZLA MESAJ! YAVAŞLAYIN.", 'error'); }
    });
    
    const pSize = new Blob([JSON.stringify(packet)]).size;
    document.getElementById('packetSizeDisplay').innerText = `[(${(pSize / 1024).toFixed(1)} KB)]`;
    if (hasFile) clearFileInput();
}

async function decryptPacketForDisplay(packet, contactInfo) {
    let decryptedText = null; let decryptedFile = null; let hasError = false;
    const isMine = packet.senderId === currentUser.userId;
    const peerId = isMine ? packet.targetId : packet.senderId;
    const cryptoKey = derivedSecrets[peerId] || (contactInfo ? contactInfo.key : null);

    if (!cryptoKey || cryptoKey.trim() === '') { hasError = 'no_key'; } 
    else {
        try {
            if (packet.textPayload) { decryptedText = await decryptGCM(packet.textPayload, cryptoKey); if (!decryptedText) hasError = true; }
            if (packet.filePayload) { decryptedFile = await decryptGCM(packet.filePayload, cryptoKey); if (!decryptedFile.startsWith("data:image")) hasError = true; }
        } catch(e) { hasError = true; }
    }

    const senderLabel = isMine ? 'SEN' : packet.senderId;
    let remainingTtl = null;
    if (packet.ttl) {
        const elapsedSeconds = Math.round((Date.now() - packet.timestamp) / 1000);
        remainingTtl = packet.ttl - elapsedSeconds;
        if (remainingTtl <= 0) {
            await removePacketFromVault(isMine ? packet.targetId : packet.senderId, packet.id);
            return null; 
        }
    }
    return { id: packet.id, sender: senderLabel, text: decryptedText, file: decryptedFile, isMine, isError: hasError, ttl: remainingTtl, timestamp: packet.timestamp };
}

async function processIncomingPacket(packet, contactInfo) {
    const data = await decryptPacketForDisplay(packet, contactInfo);
    if (data) appendMessageToUI(data.id, data.sender, data.text, data.file, data.isMine, data.isError, data.ttl, data.timestamp);
}

function revokeMessage(packetId) {
    if (!activeTarget) return;
    showCustomConfirm("SİBER UYARI: Bu veriyi hem kendi belleğinizden hem de\nkarşı tarafın ekranından SİLMEK üzeresiniz.\n\nOnaylıyor musunuz?", async () => {
        await removePacketFromVault(activeTarget.id, packetId);
        const msgElement = document.getElementById(`msg-${packetId}`);
        glitchAndRemoveElement(msgElement);
        safeEmit('revoke_packet', { targetId: activeTarget.id, packetId: packetId, senderId: currentUser.userId });
        showToast("İMHA PROTOKOLÜ ÇALIŞTIRILDI.", 'warning');
    });
}

// === SCROLL FAB ===

function initScrollToBottomFab() {
    const chatLog = document.getElementById('chatLog');
    const fab = document.getElementById('scrollToBottomBtn');
    const dot = document.getElementById('fabNewMsgDot');
    if (!chatLog || !fab) return;
    chatLog.addEventListener('scroll', () => {
        const threshold = 120;
        const isNearBottom = chatLog.scrollHeight - chatLog.scrollTop - chatLog.clientHeight < threshold;
        if (isNearBottom) {
            fab.classList.remove('visible');
            if (dot) dot.classList.remove('has-new');
        } else {
            fab.classList.add('visible');
        }
    });
}

function scrollChatToBottom() {
    const chatLog = document.getElementById('chatLog');
    const dot = document.getElementById('fabNewMsgDot');
    if (chatLog) chatLog.scrollTo({ top: chatLog.scrollHeight, behavior: 'smooth' });
    if (dot) dot.classList.remove('has-new');
    document.getElementById('scrollToBottomBtn')?.classList.remove('visible');
}

// === MESAJ UI RENDERLAMA ===

let _lastDateLabel = null;

function appendMessageToUI(packetId, sender, text, imageSrc, isMine, isError, ttl, timestamp) {
    const logBox = document.getElementById('chatLog');
    const placeholder = logBox.querySelector('.chat-placeholder');
    if (placeholder) placeholder.remove();

    const elementId = `msg-${packetId}`;
    if (document.getElementById(elementId)) return;

    // Tarih ayırıcı
    const msgDate = timestamp ? new Date(timestamp) : new Date();
    const dateLabel = msgDate.toLocaleDateString('tr-TR', { day: '2-digit', month: 'long', year: 'numeric' });
    if (dateLabel !== _lastDateLabel) {
        _lastDateLabel = dateLabel;
        const divider = document.createElement('div');
        divider.className = 'date-divider';
        divider.innerHTML = `<span>── ${dateLabel} ──</span>`;
        logBox.appendChild(divider);
    }

    const msgDiv = document.createElement('div'); msgDiv.id = elementId;
    msgDiv.className = `flex flex-col ${isMine ? 'items-end msg-mine' : 'items-start msg-theirs'} my-2 sm:my-4 relative`;

    const headerSpan = document.createElement('span');
    headerSpan.className = 'text-[8px] sm:text-[10px] block mb-1 sm:mb-1.5 font-mono tracking-[0.1em] flex items-center bg-black/60 px-1.5 sm:px-2 py-0.5 clip-corners-sm border border-gray-700/60 max-w-[90%] gap-1';
    const timeStr = msgDate.toLocaleTimeString('tr-TR', { hour: '2-digit', minute: '2-digit', second:'2-digit' });
    const senderColor = isMine ? 'text-green-400 neon-text-green' : 'text-[#00f0ff] neon-text-cyan';
    
    if (isMine) {
        const timeSpan = document.createElement('span'); timeSpan.className = 'text-gray-500 mr-1.5 sm:mr-2 flex-shrink-0'; timeSpan.textContent = `[${timeStr}]`; headerSpan.appendChild(timeSpan);
        const senderSpan = document.createElement('span'); senderSpan.className = `font-black ${senderColor} truncate`; senderSpan.textContent = `>_ ${sender}`; headerSpan.appendChild(senderSpan);
        const revokeBtn = document.createElement('button');
        revokeBtn.className = 'ml-2 sm:ml-3 text-red-500 hover:text-white hover:bg-red-500 font-mono text-[7px] sm:text-[9px] border border-red-500/50 px-1 sm:px-1.5 py-0.5 clip-corners-sm transition-all font-bold shadow-[0_0_8px_rgba(255,0,0,0.3)] flex-shrink-0';
        revokeBtn.title = 'Herkesten Sil'; revokeBtn.textContent = 'İMHA ET';
        revokeBtn.addEventListener('click', () => revokeMessage(packetId));
        headerSpan.appendChild(revokeBtn);
    } else {
        const senderSpan = document.createElement('span'); senderSpan.className = `font-black ${senderColor} truncate`; senderSpan.textContent = `<_ ${sender}`; headerSpan.appendChild(senderSpan);
        const timeSpan = document.createElement('span'); timeSpan.className = 'text-gray-500 ml-1.5 sm:ml-2 flex-shrink-0'; timeSpan.textContent = `[${timeStr}]`; headerSpan.appendChild(timeSpan);
    }

    if (ttl && ttl > 0) {
        const ttlBadge = document.createElement('span'); ttlBadge.id = `ttl-badge-${packetId}`;
        ttlBadge.className = 'mx-1.5 sm:mx-2 px-1 sm:px-1.5 py-0.5 bg-red-950/80 border border-red-500 text-red-400 font-mono text-[7px] sm:text-[9px] animate-pulse font-black shadow-[0_0_10px_rgba(255,0,0,0.6)] clip-corners-sm flex-shrink-0';
        ttlBadge.textContent = `TTL:${ttl}s`;
        if (isMine) headerSpan.insertBefore(ttlBadge, headerSpan.firstChild); else headerSpan.appendChild(ttlBadge);
    }
    msgDiv.appendChild(headerSpan);

    if (isError === 'no_key') {
        const errDiv = document.createElement('div'); errDiv.className = 'border-l-4 border-yellow-500 bg-yellow-950/40 p-2 sm:p-3 text-[10px] sm:text-xs text-yellow-400 my-1 max-w-[90%] sm:max-w-sm tech-font shadow-[0_0_15px_rgba(255,200,0,0.2)] clip-corners-sm font-bold tracking-wider'; errDiv.innerText = '[!] UYARI: ANAHTAR EŞLEŞMEDİ.'; msgDiv.appendChild(errDiv);
    } else if (isError) {
        const errDiv = document.createElement('div'); errDiv.className = 'border-l-4 border-red-500 bg-red-950/40 p-2 sm:p-3 text-[10px] sm:text-xs text-red-400 my-1 max-w-[90%] sm:max-w-sm tech-font shadow-[0_0_15px_rgba(255,0,0,0.3)] clip-corners-sm font-bold tracking-wider'; errDiv.innerText = '[!] KRİTİK: PAKET BÜTÜNLÜĞÜ BOZUK!'; msgDiv.appendChild(errDiv);
    } else {
        if (imageSrc) {
            window.receivedImages.push(imageSrc); const imageIndex = window.receivedImages.length - 1;
            const img = document.createElement('img'); img.src = imageSrc;
            img.className = 'w-48 sm:w-56 md:w-72 max-w-[90%] h-auto max-h-48 sm:max-h-64 my-1 sm:my-2 clip-corners border-2 border-cyan-500/40 cursor-pointer hover:border-cyan-400 transition-all shadow-[0_0_20px_rgba(0,240,255,0.15)] opacity-90 hover:opacity-100 object-contain';
            img.title = 'Görüntülemek için Tıkla'; img.onclick = () => showImageModal(imageIndex);
            msgDiv.appendChild(img);
        }
        if (text) {
            const textSpan = document.createElement('div');
            const bubbleClass = isMine ? 'msg-bubble-mine clip-bubble-right text-green-200' : 'msg-bubble-theirs clip-bubble-left text-cyan-200';
            textSpan.className = `px-3 sm:px-5 py-2 sm:py-3 border font-mono text-[11px] sm:text-[13px] leading-relaxed max-w-[95%] sm:max-w-[80%] text-left whitespace-pre-wrap break-words backdrop-blur-sm ${bubbleClass}`;
            textSpan.innerText = text; msgDiv.appendChild(textSpan);
        }
    }

    // Scroll konumuna göre FAB göster
    const threshold = 120;
    const isNearBottom = logBox.scrollHeight - logBox.scrollTop - logBox.clientHeight < threshold;
    logBox.appendChild(msgDiv);
    if (isNearBottom) {
        logBox.scrollTop = logBox.scrollHeight;
    } else if (!isMine) {
        // Yeni mesaj var, FAB üzerinde nokta göster
        const fab = document.getElementById('scrollToBottomBtn');
        const dot = document.getElementById('fabNewMsgDot');
        if (fab) fab.classList.add('visible');
        if (dot) dot.classList.add('has-new');
    }

    if (ttl && ttl > 0) startSelfDestructTimer(packetId, ttl, isMine ? activeTarget.id : sender);
}

const _activeTimers = {};
function startSelfDestructTimer(packetId, duration, targetUser) {
    if (_activeTimers[packetId]) clearInterval(_activeTimers[packetId]);
    let secondsLeft = duration; const badge = document.getElementById(`ttl-badge-${packetId}`);
    _activeTimers[packetId] = setInterval(() => {
        secondsLeft--; if (badge) badge.innerText = `TTL:${secondsLeft}s`;
        if (secondsLeft <= 0) {
            clearInterval(_activeTimers[packetId]); delete _activeTimers[packetId];
            const msgElement = document.getElementById(`msg-${packetId}`);
            if (msgElement) glitchAndRemoveElement(msgElement, () => removePacketFromVault(targetUser, packetId));
        }
    }, 1000);
}

// === SNİFFER (AĞ İZLEYİCİ) ===

const _sparkValues = [2, 2, 2, 2, 2, 2, 2, 2];
function updateSnifferSparkline() {
    const sparkline = document.getElementById('snifferSparkline');
    if (!sparkline) return;
    _sparkValues.shift();
    _sparkValues.push(Math.floor(Math.random() * 18) + 2);
    const bars = sparkline.querySelectorAll('.spark-bar');
    bars.forEach((bar, i) => { bar.style.height = `${_sparkValues[i]}px`; });
}

function logPacketToSniffer(packet) {
    const sniffer = document.getElementById('snifferLog');
    const placeholder = sniffer.querySelector('.flex-col');
    if (placeholder) placeholder.remove();

    updateSnifferSparkline();

    const fileChunk = packet.filePayload ? `[IMG_GCM]` : '';
    const textChunk = packet.textPayload ? `${packet.textPayload.substring(0,18)}..` : '';
    const ttlLabel  = packet.ttl ? `${packet.ttl}s` : '∞';

    // Dekoratif hex dump
    const hexDump = Array.from({length: 8}, () => Math.floor(Math.random()*256).toString(16).padStart(2,'0')).join(' ');

    const entry = document.createElement('div');
    entry.className = 'sniffer-entry-new border-l-2 border-pink-500/50 bg-pink-950/10 pl-1.5 sm:pl-2 py-1 sm:py-1.5 mb-1 sm:mb-2 hover:bg-pink-900/30 transition-colors font-mono text-[7px] sm:text-[9px] relative overflow-hidden cursor-default';

    const headerRow = document.createElement('div'); headerRow.className = 'flex justify-between items-center mb-0.5 sm:mb-1';
    const pktSpan = document.createElement('span'); pktSpan.className = 'text-white font-bold drop-shadow-[0_0_5px_rgba(255,255,255,0.8)]'; pktSpan.textContent = `PKT_${packet.id.substring(0,8)}`;
    const ttlSpan = document.createElement('span'); ttlSpan.className = 'text-[#ff0055] font-black'; ttlSpan.textContent = `TTL:${ttlLabel}`;
    headerRow.appendChild(pktSpan); headerRow.appendChild(ttlSpan);

    const routeSpan = document.createElement('div');
    routeSpan.className = 'text-pink-400 bg-black/50 px-1 py-0.5 text-[7px] sm:text-[8px] truncate border border-pink-500/20 my-0.5 sm:my-1 font-bold';
    routeSpan.textContent = `${packet.senderId} -> ${packet.targetId}`;

    const payloadDiv = document.createElement('div');
    payloadDiv.className = 'text-pink-300 opacity-80 break-all';
    payloadDiv.textContent = `PAYLOAD: ${textChunk} ${fileChunk}`;

    const hexDiv = document.createElement('div');
    hexDiv.className = 'sniffer-hex mt-0.5';
    hexDiv.textContent = hexDump;

    entry.appendChild(headerRow); entry.appendChild(routeSpan); entry.appendChild(payloadDiv); entry.appendChild(hexDiv);
    while (sniffer.children.length >= 80) sniffer.removeChild(sniffer.firstChild);
    sniffer.appendChild(entry); sniffer.scrollTop = sniffer.scrollHeight;
}

function toggleSniffer() {
    playSound('type'); const sniffer = document.getElementById('snifferContainer'); const toggleBtn = document.getElementById('snifferToggleBtn');
    snifferActive = !snifferActive;
    if (snifferActive) {
        sniffer.classList.remove('hidden'); toggleBtn.innerHTML = '<span class="w-1.5 h-1.5 bg-[#ff0055] rounded-full animate-pulse"></span> SNIFFER';
        toggleBtn.className = "px-2 sm:px-3 py-1 sm:py-1.5 text-[9px] sm:text-[10px] bg-pink-950/40 border border-[#ff0055] text-[#ff0055] hover:bg-[#ff0055]/20 transition-all neon-border-pink clip-corners-sm font-bold tracking-wider flex items-center gap-1";
        showToast("AĞ KODLAYICI AKTİF.", 'success');
    } else {
        sniffer.classList.add('hidden'); toggleBtn.innerHTML = '<span class="w-1.5 h-1.5 bg-gray-500 rounded-full"></span> SNIFFER';
        toggleBtn.className = "px-2 sm:px-3 py-1 sm:py-1.5 text-[9px] sm:text-[10px] bg-black border border-gray-600 text-gray-400 hover:bg-gray-800 transition-all clip-corners-sm font-bold tracking-wider flex items-center gap-1";
        showToast("AĞ KODLAYICI GİZLENDİ.", 'info');
    }
    updateMobileLayout();
}

// === YARDIMCI UI FONKSİYONLARI ===

function changeFontSize(delta) {
    currentScale = Math.max(0.8, Math.min(1.8, currentScale + delta));
    document.documentElement.style.setProperty('--font-scale', currentScale);
    document.getElementById('fontScaleDisplay').innerText = Math.round(currentScale * 100) + '%';
    playSound('type');
}

function copyMyId() {
    if (!currentUser) return;
    navigator.clipboard.writeText(currentUser.userId).then(() => {
        playSound('success'); showToast("AJAN ID PANODA.");
    }).catch(() => {
        const tempInput = document.createElement("input"); tempInput.value = currentUser.userId;
        document.body.appendChild(tempInput); tempInput.select(); document.execCommand("copy"); document.body.removeChild(tempInput);
        playSound('success'); showToast("AJAN ID PANODA.");
    });
}

function toggleKeyReveal() {
    if (!activeTarget) return; playSound('type');
    const keyText = document.getElementById('profileKey'); keyRevealed = !keyRevealed;
    keyText.innerText = keyRevealed ? activeTarget.key : "••••••••••••••••";
}

function toggleAudio() {
    audioEnabled = !audioEnabled; audioBtn.innerText = audioEnabled ? "AUDIO: ON 🔊" : "AUDIO: MUTE 🔇";
    audioBtn.className = audioEnabled ? "px-2 sm:px-3 py-1 sm:py-1.5 text-[9px] sm:text-[10px] border border-green-500/50 text-green-400 hover:bg-green-500/20 transition-all clip-corners-sm font-bold tracking-wider" : "px-2 sm:px-3 py-1 sm:py-1.5 text-[9px] sm:text-[10px] border border-gray-600 text-gray-500 hover:bg-gray-800 transition-all clip-corners-sm font-bold tracking-wider";
}

// === DOSYA İŞLEMLERİ ===

function handleFileSelect(input) {
    const file = input.files[0]; if (!file) return;
    const reader = new FileReader();
    reader.onload = function(e) {
        const img = new Image();
        img.onload = function() {
            const canvas = document.createElement('canvas'); let width = img.width; let height = img.height; const MAX_DIM = 1200;
            if (width > height) { if (width > MAX_DIM) { height *= MAX_DIM / width; width = MAX_DIM; } } else { if (height > MAX_DIM) { width *= MAX_DIM / height; height = MAX_DIM; } }
            canvas.width = width; canvas.height = height; const ctx = canvas.getContext('2d'); ctx.drawImage(img, 0, 0, width, height);
            activeFileBase64 = canvas.toDataURL('image/jpeg', 0.7); canvas.width = 0; canvas.height = 0; 
            const sizeMB = (activeFileBase64.length * 0.75) / (1024 * 1024);
            document.getElementById('fileName').innerText = `DATA_IMG [${sizeMB.toFixed(2)}MB]`; document.getElementById('previewContainer').classList.remove('hidden'); playSound('type');
        }; img.src = e.target.result;
    }; reader.readAsDataURL(file);
}

function clearFileInput() { playSound('error'); activeFileBase64 = null; document.getElementById('previewContainer').classList.add('hidden'); document.getElementById('fileInput').value = ''; }
function showImageModal(index) { const modal = document.getElementById('imageModal'); const modalImg = document.getElementById('modalImage'); if (window.receivedImages[index]) { playSound('success'); modalImg.src = window.receivedImages[index]; modal.classList.remove('hidden'); } }
function hideImageModal() { playSound('type'); document.getElementById('imageModal').classList.add('hidden'); }

// === AYARLAR VE PROFİL ===

function showSettingsModal() { 
    playSound('type'); 
    document.getElementById('settingsModal').classList.remove('hidden'); 
    switchSettingsTab('profile');
    if (currentUser && currentUser.avatar) {
        document.getElementById('settingsAvatarPreview').innerHTML = `<img src="${currentUser.avatar}" class="w-full h-full object-cover">`;
    }
}
function hideSettingsModal() { playSound('type'); document.getElementById('settingsModal').classList.add('hidden'); }

function switchSettingsTab(tab) {
    playSound('type');
    const tProf = document.getElementById('settingsProfileTab'); const tSec = document.getElementById('settingsSecurityTab');
    const bProf = document.getElementById('tabProfileBtn'); const bSec = document.getElementById('tabSecurityBtn');
    const activeClass = "flex-1 py-1.5 bg-cyan-500/20 border border-cyan-400 text-cyan-300 font-bold tracking-widest clip-corners-sm text-[10px] sm:text-xs transition-all";
    const inactiveClass = "flex-1 py-1.5 bg-transparent border border-gray-600 text-gray-500 font-bold tracking-widest clip-corners-sm text-[10px] sm:text-xs hover:border-cyan-500/50 hover:text-cyan-400 transition-all";
    
    if (tab === 'profile') {
        tProf.classList.remove('hidden'); tSec.classList.add('hidden');
        bProf.className = activeClass; bSec.className = inactiveClass;
    } else {
        tSec.classList.remove('hidden'); tProf.classList.add('hidden');
        bSec.className = activeClass; bProf.className = inactiveClass;
    }
}

let pendingAvatarBase64 = null;
function handleSettingsAvatarSelect(input) {
    const file = input.files[0]; if (!file) return;
    const reader = new FileReader();
    reader.onload = function(e) {
        const img = new Image();
        img.onload = function() {
            const canvas = document.createElement('canvas'); 
            const MAX_DIM = 150; const size = Math.min(img.width, img.height);
            canvas.width = MAX_DIM; canvas.height = MAX_DIM; 
            const ctx = canvas.getContext('2d'); 
            const sx = (img.width - size) / 2; const sy = (img.height - size) / 2;
            ctx.drawImage(img, sx, sy, size, size, 0, 0, MAX_DIM, MAX_DIM);
            pendingAvatarBase64 = canvas.toDataURL('image/jpeg', 0.8); 
            document.getElementById('settingsAvatarPreview').innerHTML = `<img src="${pendingAvatarBase64}" class="w-full h-full object-cover">`;
            playSound('success');
        }; img.src = e.target.result;
    }; reader.readAsDataURL(file);
}

function saveProfileSettings() {
    if (!pendingAvatarBase64) return;
    safeEmit('update_avatar', pendingAvatarBase64, (res) => {
        if (res && res.success) {
            playSound('success'); currentUser.avatar = pendingAvatarBase64; pendingAvatarBase64 = null;
            updateMyAvatarUI(); showToast("KİMLİK GÜNCELLENDİ (AVATAR).", 'success'); hideSettingsModal();
        } else { playSound('error'); showToast(`HATA: ${res ? res.message : 'Güncellenemedi'}`, 'error'); }
    });
}

function changeUserPassword() {
    const oldP = document.getElementById('setOldPwd').value; const newP = document.getElementById('setNewPwd').value;
    if(!oldP || !newP) { playSound('error'); showToast("HATA: ŞİFRELER BOŞ OLAMAZ!", 'error'); return; }
    safeEmit('change_password', { oldPassword: oldP, newPassword: newP }, (res) => {
        if (res && res.success) {
            playSound('success'); showToast("GÜVENLİK ANAHTARI DEĞİŞTİRİLDİ.", 'success');
            document.getElementById('setOldPwd').value = ''; document.getElementById('setNewPwd').value = ''; hideSettingsModal();
        } else { playSound('error'); showToast(`HATA: ${res ? res.message : 'Başarısız'}`, 'error'); }
    });
}

function deleteUserAccount() {
    const pwd = document.getElementById('setDelPwd').value;
    if(!pwd) { playSound('error'); showToast("HATA: ONAY ŞİFRESİ GEREKLİ!"); return; }
    showCustomConfirm("SON UYARI:\nTüm adli kayıtlarınız ve şifreli veri\ntabanınız kalıcı olarak silinecektir!\n\nDevam edilsin mi?", () => {
        safeEmit('delete_account', { password: pwd }, (res) => {
            if (res && res.success) {
                playSound('destroy'); localStorage.clear(); sessionStorage.clear(); indexedDB.deleteDatabase(DB_NAME);
                showToast("KİMLİK İMHA EDİLDİ. SİSTEM KAPATILIYOR.", 'system');
                setTimeout(() => window.location.reload(), 2000);
            } else { playSound('error'); showToast(`HATA: ${res ? res.message : 'Silinemedi'}`); }
        });
    });
}

// === CYBERPUNK DIGITAL RAIN CANVAS ===

let canvas = document.getElementById('bgCanvas'), ctx = canvas.getContext('2d');
let animFrameId; function resizeCanvas() { canvas.width = window.innerWidth; canvas.height = window.innerHeight; }
let resizeTimer; window.addEventListener('resize', () => { clearTimeout(resizeTimer); resizeTimer = setTimeout(resizeCanvas, 200); }); resizeCanvas();
const chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789$+-*/=%\"'#&_(),.;:?!|{}<>[]^~".split('');
const fontSize = 14; let columns = Math.floor(canvas.width / fontSize); let drops = []; for(let x = 0; x < columns; x++) drops[x] = 1; 
const _reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches; const _MATRIX_TARGET_FPS = 30; const _MATRIX_FRAME_MS = 1000 / _MATRIX_TARGET_FPS; let _lastMatrixFrame = 0;
function drawMatrix(timestamp) {
    if (_reducedMotion) return;
    if (timestamp - _lastMatrixFrame < _MATRIX_FRAME_MS) { animFrameId = requestAnimationFrame(drawMatrix); return; }
    _lastMatrixFrame = timestamp;
    if(Math.floor(canvas.width / fontSize) !== columns) { columns = Math.floor(canvas.width / fontSize); drops = []; for(let x = 0; x < columns; x++) drops[x] = 1; }
    ctx.fillStyle = 'rgba(2, 2, 5, 0.05)'; ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.fillStyle = '#00ff66'; ctx.font = fontSize + 'px monospace';
    for(let i = 0; i < drops.length; i++) {
        const text = chars[Math.floor(Math.random() * chars.length)]; ctx.fillText(text, i * fontSize, drops[i] * fontSize);
        if(drops[i] * fontSize > canvas.height && Math.random() > 0.975) drops[i] = 0; drops[i]++;
    }
    animFrameId = requestAnimationFrame(drawMatrix);
}
document.addEventListener('visibilitychange', () => { if (document.hidden) cancelAnimationFrame(animFrameId); else if (!_reducedMotion) drawMatrix(); });
if (!_reducedMotion) drawMatrix();

// === MOBİL LAYOUT ===

function updateMobileLayout() {
    const sidebar = document.querySelector('#chatTerminal > section:first-of-type');
    const chatArea = document.getElementById('chatStreamContainer');
    const sniffer = document.getElementById('snifferContainer');
    
    if (!sidebar || !chatArea || !sniffer) return;
    
    if (window.innerWidth < 1024) {
        if (activeTarget) {
            sidebar.classList.add('hidden');
            chatArea.classList.remove('hidden');
            chatArea.classList.add('flex-1');
            
            if (snifferActive) {
                sniffer.classList.remove('hidden');
                sniffer.classList.remove('lg:col-span-3', 'h-auto', 'lg:min-h-0');
                sniffer.classList.add('h-[15dvh]', 'min-h-[110px]');
            } else {
                sniffer.classList.add('hidden');
            }
        } else {
            sidebar.classList.remove('hidden');
            sidebar.classList.add('flex-1');
            sidebar.classList.remove('h-[22dvh]', 'min-h-[140px]');
            sidebar.classList.add('h-full');
            
            chatArea.classList.add('hidden');
            sniffer.classList.add('hidden');
        }
    } else {
        sidebar.classList.remove('hidden', 'flex-1', 'h-full');
        sidebar.classList.add('h-[22dvh]', 'min-h-[140px]');
        
        chatArea.classList.remove('hidden', 'flex-1');
        
        if (snifferActive) {
            sniffer.classList.remove('hidden');
            sniffer.classList.add('lg:col-span-3');
            sniffer.classList.remove('h-[15dvh]', 'min-h-[110px]');
        } else {
            sniffer.classList.add('hidden');
        }
    }
}

function mobileGoBack() {
    activeTarget = null;
    updateMobileLayout();
    renderContactsSidebar();
    
    // reset chat ui header & content
    document.getElementById('chatTargetHeader').innerText = "AJAN SEÇİNİZ";
    document.getElementById('chatTargetFingerprint').innerText = "FP: -----";
    document.getElementById('clearChatBtn').classList.add('hidden');
    disableChatUI();
    renderLogPlaceholder(document.getElementById('chatLog'), null, "// GÜVENLİ TÜNEL BEKLENİYOR //", true);
}

window.addEventListener('resize', () => {
    updateMobileLayout();
});

// === OTOMATİK BAŞLATMA ===

(function autoFillServerUrl() {
    const origin = window.location.origin;
    const input = document.getElementById('serverIp');
    if (!input) return;
    // Sayfa bir sunucudan yüklendiyse kendi origin'ini kullan,
    // file:// veya null origin ise localhost:3000 varsayılanını kullan
    if (origin && origin !== 'null' && !origin.startsWith('file://')) {
        input.value = origin;
    } else {
        input.value = 'http://localhost:3000';
    }
    setTimeout(autoLoginAttempt, 100);
})();
