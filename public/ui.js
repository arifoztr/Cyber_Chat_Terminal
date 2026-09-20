// ============================================================
// ui.js — Kullanıcı Arayüzü, State Yönetimi ve DOM İşlemleri
// Toast, Render, Auth, Settings, Mobile
// ============================================================

// === POLYFILL ===
const idleCallback = window.requestIdleCallback
    ? window.requestIdleCallback.bind(window)
    : (cb) => setTimeout(() => cb({ timeRemaining: () => 1, didTimeout: false }), 1);

// === GLOBAL STATE ===
let socket = null;
let activeFileBase64 = null;
let activeFileName = null;
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

function fadeOutAndRemoveElement(element, onComplete) {
    if (!element) return;
    element.style.transition = 'opacity 0.4s ease-out, transform 0.4s ease-out';
    element.style.opacity = '0';
    element.style.transform = 'scale(0.95)';
    setTimeout(() => {
        element.remove();
        if (onComplete) onComplete();
    }, 400);
}

function renderLogPlaceholder(logBox, icon, message, spinner = true) {
    logBox.innerHTML = `<div class="chat-placeholder flex flex-col items-center justify-center h-full opacity-50 mt-4 sm:mt-10">
        ${spinner ? '<div class="w-10 h-10 sm:w-16 sm:h-16 border-2 sm:border-4 border-dashed border-green-500/50 animate-[spin_4s_linear_infinite] rounded-full mb-2 sm:mb-4"></div>' : `<span class="text-2xl sm:text-4xl mb-1 sm:mb-2">${icon}</span>`}
        <div class="text-green-500 text-[9px] sm:text-xs font-mono tracking-normal uppercase text-center">${message}</div>
    </div>`;
}

// === SES SİSTEMİ (DEVRE DIŞI) ===
function playSound(type) { /* Ses özellikleri devre dışı bırakıldı */ }

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
        success: { label: 'Başarılı',      icon: '✓',  cls: 'toast-success',  color: 'var(--neon-green)'  },
        error:   { label: 'Hata', icon: '✕',  cls: 'toast-error',    color: 'var(--neon-pink)'   },
        warning: { label: 'Uyarı',       icon: '⚠',  cls: 'toast-warning',  color: 'var(--neon-amber)'  },
        info:    { label: 'Bilgi',       icon: 'ℹ',  cls: 'toast-info',     color: 'var(--neon-cyan)'   },
        system:  { label: 'Sistem',      icon: '⚡', cls: 'toast-system',   color: 'var(--neon-purple)' },
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

function setAuthAlert(message, type = 'error') {
    const alertEl = document.getElementById('authAlert');
    if (!alertEl) return;
    if (!message) {
        alertEl.className = 'hidden auth-alert';
        alertEl.innerHTML = '';
        return;
    }
    const icons = {
        error: '⚠️',
        info: '🔄',
        success: '✅'
    };
    alertEl.className = `auth-alert auth-alert-${type}`;
    alertEl.innerHTML = `<span>${icons[type] || 'ℹ️'}</span><span>${message}</span>`;
    alertEl.classList.remove('hidden');
}

function clearAuthAlert() {
    setAuthAlert(null);
    ['serverIp', 'authUsername', 'authEmail', 'authPassword', 'authPasswordConfirm'].forEach(id => {
        const el = document.getElementById(id);
        if (el) el.classList.remove('input-error');
    });
}

function switchAuthTab(tab) {
    playSound('type');
    currentAuthTab = tab;
    clearAuthAlert();

    const regContainer = document.getElementById('regUsernameContainer');
    const regConfirmContainer = document.getElementById('regPasswordConfirmContainer');
    const tabLoginBtn = document.getElementById('tabLoginBtn');
    const tabRegisterBtn = document.getElementById('tabRegisterBtn');
    const authSubmitBtn = document.getElementById('authSubmitBtn');
    const authTitle = document.getElementById('authTitle');
    const authSubtitle = document.getElementById('authSubtitle');
    const authSwitchPrompt = document.getElementById('authSwitchPrompt');
    const authSwitchLink = document.getElementById('authSwitchLink');

    const activeClass = "flex-1 py-2 bg-[--accent-light] text-[--accent] rounded-lg font-medium transition-colors text-sm shadow-sm";
    const inactiveClass = "flex-1 py-2 bg-transparent text-[--text-secondary] rounded-lg font-medium hover:bg-[--surface-hover] transition-colors text-sm";

    if (tab === 'login') {
        if (regContainer) regContainer.classList.add('hidden');
        if (regConfirmContainer) regConfirmContainer.classList.add('hidden');
        if (tabLoginBtn) tabLoginBtn.className = activeClass;
        if (tabRegisterBtn) tabRegisterBtn.className = inactiveClass;
        if (authSubmitBtn) authSubmitBtn.innerText = "Giriş Yap";
        if (authTitle) authTitle.innerText = "Giriş Yap";
        if (authSubtitle) authSubtitle.innerText = "Uçtan Uca Şifreli Güvenli Bağlantı";
        if (authSwitchPrompt) authSwitchPrompt.innerText = "Hesabınız yok mu?";
        if (authSwitchLink) authSwitchLink.innerText = "Kayıt Olun";

        const emailInput = document.getElementById('authEmail');
        if (emailInput && document.activeElement !== emailInput) emailInput.focus();
    } else {
        if (regContainer) regContainer.classList.remove('hidden');
        if (regConfirmContainer) regConfirmContainer.classList.remove('hidden');
        if (tabRegisterBtn) tabRegisterBtn.className = activeClass;
        if (tabLoginBtn) tabLoginBtn.className = inactiveClass;
        if (authSubmitBtn) authSubmitBtn.innerText = "Kayıt Ol ve Giriş Yap";
        if (authTitle) authTitle.innerText = "Hesap Oluştur";
        if (authSubtitle) authSubtitle.innerText = "Yeni E2EE Güvenlik Kimliği Oluşturma";
        if (authSwitchPrompt) authSwitchPrompt.innerText = "Zaten bir hesabınız var mı?";
        if (authSwitchLink) authSwitchLink.innerText = "Giriş Yapın";

        const userInput = document.getElementById('authUsername');
        if (userInput) userInput.focus();
    }
}

function handleAuthSubmit() {
    clearAuthAlert();

    const serverUrlInput = document.getElementById('serverIp');
    const emailInput = document.getElementById('authEmail');
    const passwordInput = document.getElementById('authPassword');
    const usernameInput = document.getElementById('authUsername');
    const passwordConfirmInput = document.getElementById('authPasswordConfirm');

    const serverUrl = (serverUrlInput ? serverUrlInput.value.trim() : '') || 'http://localhost:3000';
    const email = emailInput ? emailInput.value.trim() : '';
    const password = passwordInput ? passwordInput.value.trim() : '';
    const username = usernameInput ? usernameInput.value.trim() : '';
    const passwordConfirm = passwordConfirmInput ? passwordConfirmInput.value.trim() : '';

    // Validasyon
    if (!email) {
        playSound('error');
        if (emailInput) emailInput.classList.add('input-error');
        setAuthAlert("Lütfen e-posta adresinizi girin.", 'error');
        if (emailInput) emailInput.focus();
        return;
    }

    if (!password) {
        playSound('error');
        if (passwordInput) passwordInput.classList.add('input-error');
        setAuthAlert("Lütfen şifrenizi girin.", 'error');
        if (passwordInput) passwordInput.focus();
        return;
    }

    if (currentAuthTab === 'register') {
        if (!username) {
            playSound('error');
            if (usernameInput) usernameInput.classList.add('input-error');
            setAuthAlert("Lütfen bir kullanıcı adı (kod adı) belirleyin.", 'error');
            if (usernameInput) usernameInput.focus();
            return;
        }

        if (passwordConfirm && password !== passwordConfirm) {
            playSound('error');
            if (passwordConfirmInput) passwordConfirmInput.classList.add('input-error');
            setAuthAlert("Girdiğiniz şifreler birbiriyle eşleşmiyor.", 'error');
            if (passwordConfirmInput) passwordConfirmInput.focus();
            return;
        }

        if (password.length < 4) {
            playSound('error');
            if (passwordInput) passwordInput.classList.add('input-error');
            setAuthAlert("Şifre en az 4 karakter uzunluğunda olmalıdır.", 'error');
            if (passwordInput) passwordInput.focus();
            return;
        }
    }

    // Loading durumu
    const btn = document.getElementById('authSubmitBtn');
    const originalText = btn ? btn.innerText : 'Gönder';
    if (btn) {
        btn.classList.add('opacity-50', 'cursor-not-allowed');
        btn.innerText = currentAuthTab === 'register' ? 'Kayıt Yapılıyor...' : 'Giriş Yapılıyor...';
        btn.disabled = true;
    }

    const restoreBtn = () => {
        if (btn) {
            btn.classList.remove('opacity-50', 'cursor-not-allowed');
            btn.innerText = originalText;
            btn.disabled = false;
        }
    };

    setAuthAlert("Sunucuya bağlanılıyor...", 'info');

    let connectionTimeout = setTimeout(() => {
        restoreBtn();
        playSound('error');
        setAuthAlert(`Sunucuya bağlanılamadı (${serverUrl}). Lütfen Node.js sunucusunun açık olduğundan emin olun.`, 'error');
        showToast("Sunucu bağlantı zaman aşımı.", 'error');
    }, 6000);

    const runAuthAction = () => {
        clearTimeout(connectionTimeout);

        if (currentAuthTab === 'register') {
            setAuthAlert("Hesap oluşturuluyor...", 'info');
            socket.emit('register', { email, password, username }, (res) => {
                restoreBtn();
                if (res && res.success) {
                    playSound('success');
                    if (res.token) {
                        localStorage.setItem('cyber_jwt', res.token);
                        socket.auth = { token: res.token };
                        currentUser = res.user;
                        setAuthAlert("Kayıt başarılı! Güvenli oturum başlatılıyor...", 'success');
                        showToast("Hesap oluşturuldu ve giriş yapıldı!", 'success');
                        finishLoginSetup();
                    } else {
                        setAuthAlert("Hesap oluşturuldu! Giriş yapılıyor...", 'success');
                        showToast("Hesap oluşturuldu! Giriş yapılıyor...", 'success');
                        switchAuthTab('login');
                        if (emailInput) emailInput.value = email;
                        if (passwordInput) passwordInput.value = password;
                        handleAuthSubmit();
                    }
                } else {
                    playSound('error');
                    setAuthAlert(`Kayıt Hatası: ${res ? res.message : 'Sunucudan yanıt alınamadı'}`, 'error');
                    showToast(`Kayıt Hatası: ${res ? res.message : 'Yanıt alınamadı'}`, 'error');
                }
            });
        } else {
            setAuthAlert("Kimlik doğrulanıyor...", 'info');
            socket.emit('login', { email, password }, (res) => {
                restoreBtn();
                if (res && res.success) {
                    if (res.token) {
                        localStorage.setItem('cyber_jwt', res.token);
                        socket.auth = { token: res.token };
                    }
                    currentUser = res.user;
                    setAuthAlert("Doğrulama başarılı! Yönlendiriliyorsunuz...", 'success');
                    finishLoginSetup();
                } else {
                    playSound('error');
                    setAuthAlert(`Giriş Hatası: ${res ? res.message : 'Kullanıcı adı veya şifre hatalı'}`, 'error');
                    showToast(`Giriş Hatası: ${res ? res.message : 'Yanıt alınamadı'}`, 'error');
                }
            });
        }
    };

    // Socket bağlantı kontrolü ve başlatma
    const configuredBackend = (window.APP_CONFIG && window.APP_CONFIG.BACKEND_URL) ? window.APP_CONFIG.BACKEND_URL.trim() : '';
    let targetUrl = serverUrl;
    if (configuredBackend && (!serverUrl || serverUrl === 'http://localhost:3000')) {
        targetUrl = configuredBackend;
    } else if (window.location.origin && window.location.origin !== 'null' && !window.location.origin.startsWith('file://')) {
        if (!serverUrl || serverUrl === 'http://localhost:3000') {
            targetUrl = window.location.origin;
        }
    }

    if (!socket || !socket.connected) {
        if (socket) {
            try { socket.disconnect(); } catch(e) {}
        }
        console.log('[+] Socket bağlantısı kuruluyor:', targetUrl);
        socket = io(targetUrl, {
            transports: ['polling', 'websocket'],
            upgrade: true,
            reconnectionAttempts: 3,
            reconnectionDelay: 1000,
            timeout: 5000,
            forceNew: true
        });
        setupSocketEvents(socket);

        socket.once('connect', () => {
            console.log('[+] Socket bağlantısı başarılı. Socket ID:', socket.id);
            runAuthAction();
        });

        socket.once('connect_error', (err) => {
            console.error('[!] Socket bağlantı hatası:', err);
            clearTimeout(connectionTimeout);
            restoreBtn();
            playSound('error');
            setAuthAlert(`Sunucuya bağlanılamadı (${targetUrl}): ${err.message || 'Bağlantı hatası'}. Backend servisinin açık olduğundan emin olun.`, 'error');
            showToast("Sunucuya bağlanılamadı.", 'error');
        });
    } else {
        runAuthAction();
    }
}

function autoLoginAttempt() {
    const token = localStorage.getItem('cyber_jwt');
    if (!token) return;
    
    const configuredBackend = (window.APP_CONFIG && window.APP_CONFIG.BACKEND_URL) ? window.APP_CONFIG.BACKEND_URL.trim() : '';
    const input = document.getElementById('serverIp');
    const serverUrl = (input && input.value.trim()) || configuredBackend || (window.location.origin && !window.location.origin.startsWith('file://') ? window.location.origin : 'http://localhost:3000');
    
    showToast("Oturum doğrulanıyor...", 'info');
    
    socket = io(serverUrl, { transports: ['polling', 'websocket'], auth: { token }, reconnectionAttempts: 20, reconnectionDelay: 2000 });
    setupSocketEvents(socket);

    socket.once('connect', () => {
        socket.emit('verify_session', token, (res) => {
            if (res && res.success) {
                currentUser = res.user;
                finishLoginSetup();
            } else {
                localStorage.removeItem('cyber_jwt');
                socket.disconnect();
                showToast("Oturum süresi doldu, lütfen tekrar giriş yapın.", 'error');
            }
        });
    });
}

// === YENİDEN BAĞLANMA OVERLAY YÖNETİMİ ===

function showReconnectOverlay() {
    const overlay = document.getElementById('reconnectOverlay');
    if (overlay) overlay.classList.remove('hidden');
}

function hideReconnectOverlay() {
    const overlay = document.getElementById('reconnectOverlay');
    if (overlay) overlay.classList.add('hidden');
}

function updateReconnectStatus(text) {
    const el = document.getElementById('reconnectStatus');
    if (el) el.innerText = text;
}

// Merkezi socket olay yöneticisi — tüm bağlantı/kesinti/yeniden bağlanma mantığı burada
function setupSocketEvents(sock) {
    sock.on('connect_error', (err) => {
        console.error('[!] Bağlantı hatası:', err.message);
        // Eğer henüz oturum açılmamışsa (auth ekranındayız), toast göster
        if (!currentUser) {
            playSound('error');
            showToast(`AĞ HATASI! ${err.message}`, 'error');
        }
    });

    sock.on('disconnect', (reason) => {
        console.warn(`[!] Bağlantı kesildi: ${reason}`);
        
        // İstemci tarafından istenerek yapılan bağlantı kesimi (logout vb.)
        if (reason === 'io client disconnect') {
            handleDisconnectUI();
            return;
        }
        
        // İstemsiz bağlantı kesimi — oturum açıksa overlay göster, state'i koru
        if (currentUser) {
            showReconnectOverlay();
            updateReconnectStatus('YENİDEN BAĞLANILIYOR...');
            showToast("Bağlantı kesildi, yeniden bağlanılıyor...", 'warning');
        } else {
            handleDisconnectUI();
        }
    });

    sock.io.on('reconnect_attempt', (attempt) => {
        updateReconnectStatus(`DENEME ${attempt}/20...`);
    });

    sock.io.on('reconnect_failed', () => {
        updateReconnectStatus('BAĞLANTI BAŞARISIZ — MANUEL BAĞLAN');
        showToast("OTOMATİK BAĞLANTI BAŞARISIZ. TEKRAR DENEYİN.", 'error');
    });

    sock.on('connect', () => {
        // Yeniden bağlanma — oturum açıksa JWT ile oturumu doğrula
        const token = localStorage.getItem('cyber_jwt');
        if (currentUser && token) {
            sock.emit('verify_session', token, (res) => {
                if (res && res.success) {
                    currentUser = res.user;
                    hideReconnectOverlay();
                    showToast("Bağlantı yeniden kuruldu!", 'success');
                    playSound('success');

                    // Kripto anahtarlarını tekrar yayınla ve durumları senkronize et
                    if (myPublicKeyJwk) sock.emit('publish_public_key', myPublicKeyJwk);
                    if (myContacts.length > 0) {
                        safeEmit('join_status_rooms', myContacts.map(c => c.id));
                    }
                    sock.emit('client_ready');
                    checkOnlineStatuses();
                    bindSocketEvents();
                } else {
                    // Token geçersizleşmiş (sunucu restart vb.)
                    hideReconnectOverlay();
                    localStorage.removeItem('cyber_jwt');
                    handleDisconnectUI();
                    showToast("OTURUM GEÇERSİZLEŞTİ — TEKRAR GİRİŞ GEREKLİ.", 'error');
                }
            });
        }
    });
}

// Manuel yeniden bağlanma butonu
function forceReconnect() {
    if (socket) {
        updateReconnectStatus('BAĞLANTI KURULUYOR...');
        socket.connect();
    } else {
        hideReconnectOverlay();
        handleDisconnectUI();
    }
}

// === GİRİŞ SONRASI KURULUM ===

function updateMyAvatarUI() {
    const container = document.getElementById('myProfileAvatarContainer');
    if (currentUser && currentUser.avatar) {
        container.innerHTML = `<img src="${currentUser.avatar}" class="w-full h-full object-cover">`;
    } else {
        container.innerHTML = `<span class="text-blue-300 font-black  text-[10px] sm:text-xs">OP</span>`;
    }
}

function finishLoginSetup() {
    playSound('success'); showToast("Doğrulama başarılı!", 'success');
    // Scroll-to-bottom FAB başlat
    setTimeout(initScrollToBottomFab, 200); // DOM hazır olunca bağla
    loadContactsFromVault(); loadSecretsFromVault();
    initEcdhKeys().then(() => { socket.emit('publish_public_key', myPublicKeyJwk); });
    
    if (myContacts.length > 0) {
        safeEmit('join_status_rooms', myContacts.map(c => c.id));
        safeEmit('get_profiles', myContacts.map(c => c.id), (res) => {
            if (res && res.profiles) {
                myContacts.forEach(c => { 
                    if (res.profiles[c.id]) {
                        if (res.profiles[c.id].avatar) c.avatar = res.profiles[c.id].avatar;
                        if (res.profiles[c.id].username) c.username = res.profiles[c.id].username;
                    }
                });
                saveContactsToVault(); renderContactsSidebarDebounced();
                if (activeTarget && res.profiles[activeTarget.id]) {
                    if (res.profiles[activeTarget.id].username) activeTarget.username = res.profiles[activeTarget.id].username;
                    if (res.profiles[activeTarget.id].avatar) activeTarget.avatar = res.profiles[activeTarget.id].avatar;
                    updateChatHeaderUI();
                }
            }
        });
    }

    document.getElementById('profileUsername').innerText = currentUser.username;
    document.getElementById('profileUserId').innerText = currentUser.userId;
    updateMyAvatarUI();

    document.getElementById('authGateway').classList.add('hidden');
    document.getElementById('chatTerminalWrapper').classList.remove('hidden');
    
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
    hideReconnectOverlay();
    document.getElementById('chatTerminalWrapper').classList.add('hidden'); 
    document.getElementById('authGateway').classList.remove('hidden');
    document.getElementById('clearChatBtn').classList.add('hidden');
    renderLogPlaceholder(document.getElementById('chatLog'), null, "Bağlantı kesildi", true);
    document.getElementById('packetSizeDisplay').innerText = "";
    
    Object.keys(_activeTimers).forEach(id => { clearInterval(_activeTimers[id]); delete _activeTimers[id]; });
    Object.keys(_aesKeyCache).forEach(k => delete _aesKeyCache[k]);
    if (localTypingTimeout) { clearTimeout(localTypingTimeout); localTypingTimeout = null; }
    isCurrentlyTyping = false;
    window.receivedImages = []; currentUser = null; activeTarget = null; myContacts = []; unreadCounts = {}; derivedSecrets = {}; myEcdhKeyPair = null; myPublicKeyJwk = null; socket = null;
    updateMobileLayout();
}

function disconnectFromServer() { 
    if (socket) { 
        playSound('error'); socket.disconnect(); showToast("Çıkış yapıldı.", 'warning'); 
        localStorage.removeItem('cyber_jwt'); handleDisconnectUI(); 
    } 
}

// === KİŞİ LİSTESİ / DURUM ===

function updateContactStatusUI(userId, isOnline) {
    const contact = myContacts.find(c => c.id === userId);
    if (contact) contact.isOnline = isOnline;
    const dot = document.getElementById(`status_dot_${userId}`);
    if (dot) {
        dot.className = `absolute bottom-0 right-0 w-2.5 h-2.5 rounded-full border-2 border-[--bg-secondary] ${isOnline ? 'bg-[--success]' : 'bg-gray-500/50'}`;
        dot.title = isOnline ? 'Çevrimiçi' : 'Çevrimdışı';
    }
    
    if (activeTarget && activeTarget.id === userId) {
        const headerDot = document.getElementById('chatStatusDot');
        if (headerDot) headerDot.className = `status-dot ${isOnline ? 'status-online' : 'status-offline'} shrink-0`;
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

let _contactSearchTerm = '';
function filterContactsList(term) {
    _contactSearchTerm = (term || '').trim().toLowerCase();
    renderContactsSidebar();
}

let _renderContactsTimer = null;
function renderContactsSidebarDebounced() {
    if (_renderContactsTimer) return;
    _renderContactsTimer = setTimeout(() => { _renderContactsTimer = null; renderContactsSidebar(); }, 50);
}

function renderContactsSidebar() {
    const listContainer = document.getElementById('contactsList');
    if (!listContainer) return;

    let filtered = myContacts;
    if (_contactSearchTerm) {
        filtered = myContacts.filter(c => 
            c.id.toLowerCase().includes(_contactSearchTerm) || 
            (c.username && c.username.toLowerCase().includes(_contactSearchTerm))
        );
    }

    if (filtered.length === 0) {
        listContainer.replaceChildren();
        const emptyDiv = document.createElement('div');
        emptyDiv.className = 'flex flex-col items-center justify-center py-8 px-4 text-center';
        emptyDiv.innerHTML = _contactSearchTerm
            ? '<span class="text-2xl mb-2 opacity-50">🔍</span><div class="text-xs text-[--text-muted]">Sonuç bulunamadı.</div>'
            : '<span class="text-3xl mb-2 opacity-50">💬</span><div class="text-xs text-[--text-secondary] font-medium">Henüz bir sohbet yok</div><div class="text-[11px] text-[--text-muted] mt-1">Yeni kişi ekleyerek güvenli sohbete başlayın.</div>';
        listContainer.appendChild(emptyDiv);
        return;
    }

    const fragment = document.createDocumentFragment();
    filtered.forEach(contact => {
        const isActive = activeTarget && activeTarget.id === contact.id;
        const unreadCount = unreadCounts[contact.id] || 0;
        const hasSecret = !!derivedSecrets[contact.id];

        const item = document.createElement('div');
        item.setAttribute('onclick', `selectTarget('${contact.id}')`);
        item.className = `group flex items-center gap-3 p-2.5 rounded-xl cursor-pointer transition-all duration-200 border relative ${
            isActive 
                ? 'bg-[--surface-hover] border-[--border-active] shadow-sm' 
                : 'hover:bg-[--surface-hover]/50 border-transparent'
        }`;

        // Sol: Avatar + Online Noktası (WhatsApp Tarzı)
        const avatarWrap = document.createElement('div');
        avatarWrap.className = 'relative w-10 h-10 shrink-0 rounded-full bg-[--surface-hover] flex items-center justify-center overflow-hidden border border-[--border]';
        
        if (contact.avatar) {
            const img = document.createElement('img');
            img.src = contact.avatar;
            img.className = 'w-full h-full object-cover';
            avatarWrap.appendChild(img);
        } else {
            const initial = (contact.username || contact.id || '').replace(/^AGN-/, '').charAt(0).toUpperCase() || 'U';
            const spn = document.createElement('span');
            spn.className = 'text-xs font-semibold text-[--text-primary]';
            spn.innerText = initial;
            avatarWrap.appendChild(spn);
        }

        const dot = document.createElement('span');
        dot.id = `status_dot_${contact.id}`;
        dot.className = `absolute bottom-0 right-0 w-2.5 h-2.5 rounded-full border-2 border-[--bg-secondary] ${
            contact.isOnline ? 'bg-[--success]' : 'bg-gray-500/50'
        }`;
        dot.title = contact.isOnline ? 'Çevrimiçi' : 'Çevrimdışı';
        avatarWrap.appendChild(dot);

        // Orta: İsim/ID + Durum Bilgisi
        const infoCol = document.createElement('div');
        infoCol.className = 'flex-1 min-w-0 flex flex-col justify-center';

        const topRow = document.createElement('div');
        topRow.className = 'flex items-center justify-between gap-1 mb-0.5';

        const nameSpan = document.createElement('span');
        nameSpan.className = 'text-xs font-semibold truncate text-[--text-primary]';
        nameSpan.textContent = contact.username ? contact.username : contact.id;

        const e2eeBadge = document.createElement('span');
        e2eeBadge.className = `text-[10px] font-medium shrink-0 ${hasSecret ? 'text-[--success]' : 'text-[--warning]'}`;
        e2eeBadge.textContent = hasSecret ? '🔒 E2EE' : '⏳ Bekliyor';

        topRow.appendChild(nameSpan);
        topRow.appendChild(e2eeBadge);

        const botRow = document.createElement('div');
        botRow.className = 'flex items-center justify-between gap-1';

        const fpSpan = document.createElement('span');
        fpSpan.className = 'text-[10px] text-[--text-muted] font-mono truncate';
        fpSpan.textContent = contact.username ? contact.id : '';

        const rightBadges = document.createElement('div');
        rightBadges.className = 'flex items-center gap-1.5 shrink-0';

        if (unreadCount > 0) {
            const badge = document.createElement('span');
            badge.className = 'bg-[--success] text-white text-[10px] font-bold rounded-full min-w-[18px] h-[18px] flex items-center justify-center px-1';
            badge.textContent = unreadCount;
            rightBadges.appendChild(badge);
        }

        const deleteBtn = document.createElement('button');
        deleteBtn.setAttribute('onclick', `removeContact('${contact.id}', event)`);
        deleteBtn.className = 'opacity-0 group-hover:opacity-100 hover:text-[--error] text-xs p-0.5 text-[--text-muted] transition-all';
        deleteBtn.title = 'Sohbeti Sil';
        deleteBtn.textContent = '✕';
        rightBadges.appendChild(deleteBtn);

        botRow.appendChild(fpSpan);
        botRow.appendChild(rightBadges);

        infoCol.appendChild(topRow);
        infoCol.appendChild(botRow);

        item.appendChild(avatarWrap);
        item.appendChild(infoCol);
        fragment.appendChild(item);
    });

    listContainer.replaceChildren(fragment);
}

function removeContact(targetId, event) {
    event.stopPropagation();
    showCustomConfirm(`${targetId} kişisine ait tüm sohbet geçmişi ve şifreleme anahtarları silinecektir. Bu işlem geri alınamaz.`, async () => {
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
            activeTarget = null;
            updateChatHeaderUI();
            document.getElementById('clearChatBtn').classList.add('hidden'); disableChatUI();
            renderLogPlaceholder(document.getElementById('chatLog'), null, "Uçtan uca şifreli", true);
            updateMobileLayout();
        }
        renderContactsSidebar(); playSound('destroy'); showToast(`${targetId} kişi listenizden silindi.`, 'warning');
    });
}

// === SOHBET ALANI ===

function updateChatHeaderUI() {
    const headerEl = document.getElementById('chatTargetHeader');
    if (!headerEl) return;
    
    if (!activeTarget) {
        headerEl.textContent = "Bir sohbet seçin";
        return;
    }
    
    headerEl.replaceChildren();
    if (activeTarget.username) {
        const nameSpan = document.createElement('span');
        nameSpan.className = 'font-bold text-[--text-primary]';
        nameSpan.textContent = activeTarget.username;
        
        const idSpan = document.createElement('span');
        idSpan.className = 'text-xs font-mono text-[--text-muted] ml-1.5 font-normal';
        idSpan.textContent = `(${activeTarget.id})`;
        
        headerEl.appendChild(nameSpan);
        headerEl.appendChild(idSpan);
    } else {
        headerEl.textContent = activeTarget.id;
    }
}

function enableChatUI() {
    document.getElementById('messageInput').disabled = false; document.getElementById('messageInput').placeholder = "Mesaj yazın...";
    document.getElementById('sendPacketBtn').disabled = false;
    document.getElementById('sendPacketBtn').className = "px-4 sm:px-8 py-2 sm:py-0 bg-green-500/20 text-green-500 font-black border-2 border-[#00ff66] text-[10px] sm:text-sm  transition-all duration-300 uppercase tracking-normal hover:bg-green-500 hover:text-black   flex-shrink-0";
}

function disableChatUI() {
    document.getElementById('messageInput').disabled = true; document.getElementById('messageInput').placeholder = "Bağlantı bekleniyor...";
    document.getElementById('sendPacketBtn').disabled = true;
    document.getElementById('sendPacketBtn').className = "px-4 sm:px-8 py-2 sm:py-0 bg-gray-900 text-gray-600 font-black border border-gray-700 text-[10px] sm:text-sm  transition-all duration-300 uppercase tracking-normal flex-shrink-0";
}

async function selectTarget(targetId) {
    const selected = myContacts.find(c => c.id === targetId); if (!selected) return;
    
    if (activeTarget && isCurrentlyTyping) {
        clearTimeout(localTypingTimeout);
        socket.emit('stop_typing', { targetId: activeTarget.id });
        isCurrentlyTyping = false;
    }
    
    playSound('success'); activeTarget = selected; unreadCounts[targetId] = 0; renderContactsSidebar();
    
    updateChatHeaderUI();
    document.getElementById('clearChatBtn').classList.remove('hidden'); keyRevealed = false;

    // Profil eksikse veya güncel değilse arka planda sorgula
    if (!activeTarget.username || !activeTarget.avatar) {
        safeEmit('get_profiles', [activeTarget.id], (res) => {
            if (res && res.profiles && res.profiles[activeTarget.id]) {
                const prof = res.profiles[activeTarget.id];
                let changed = false;
                if (prof.username && activeTarget.username !== prof.username) {
                    activeTarget.username = prof.username;
                    changed = true;
                }
                if (prof.avatar && activeTarget.avatar !== prof.avatar) {
                    activeTarget.avatar = prof.avatar;
                    changed = true;
                }
                if (changed) {
                    saveContactsToVault();
                    renderContactsSidebarDebounced();
                    updateChatHeaderUI();
                }
            }
        });
    }

    const hasSecret = !!derivedSecrets[selected.id];
    if (hasSecret) enableChatUI(); 
    else {
        disableChatUI(); const success = await ensureSharedSecret(selected.id);
        if (success) { if (activeTarget && activeTarget.id === selected.id) { enableChatUI(); showToast(`Şifreli kanal kuruldu!`); } renderContactsSidebar(); } 
        else setTimeout(() => initiateEcdhHandshake(selected.id), 300);
    }
    safeEmit('check_node_status', activeTarget.id, (res) => { updateContactStatusUI(res.userId, res.isOnline); });
    
    const logBox = document.getElementById('chatLog'); logBox.innerHTML = ''; window.receivedImages = [];
    const history = await loadHistoryFromVault(activeTarget.id);
    
    if (history.length > 0) {
        const topBanner = document.createElement('div');
        topBanner.className = 'text-green-500/50 text-center tracking-[0.1em] sm:tracking-normal uppercase font-bold text-[8px] sm:text-[10px] my-2 sm:my-4 border-b border-green-500/20 pb-1 sm:pb-2 drop-shadow-md';
        topBanner.innerText = '/// GÜVENLİ YEREL BELLEK GERİ YÜKLENDİ (IDB) ///';
        logBox.appendChild(topBanner);

        const INITIAL_LOAD = 20; const first = history.slice(-INITIAL_LOAD); const rest  = history.slice(0, -INITIAL_LOAD);
        const decryptedFirst = await Promise.all(first.map(p => decryptPacketForDisplay(p, activeTarget)));
        for (const data of decryptedFirst) { if (data) appendMessageToUI(data.id, data.sender, data.text, data.file, data.isMine, data.isError, data.ttl, data.timestamp, data.fileName); }
        logBox.scrollTop = logBox.scrollHeight;
        
        if (rest.length > 0) {
            let i = 0;
            function processRest() { 
                if (i >= rest.length) return; 
                decryptPacketForDisplay(rest[i++], activeTarget).then((data) => { 
                    if(data) appendMessageToUI(data.id, data.sender, data.text, data.file, data.isMine, data.isError, data.ttl, data.timestamp, data.fileName);
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
    const displayName = activeTarget.username ? `${activeTarget.username} (${activeTarget.id})` : activeTarget.id;
    showCustomConfirm(`${displayName} ile olan sohbet geçmişi silinecektir. Bu işlem geri alınamaz.`, async () => {
        try {
            const db = await openVaultDB(); const tx = db.transaction('packets', 'readwrite'); const store = tx.objectStore('packets');
            const index = store.index('peerId'); const request = index.getAllKeys(activeTarget.id);
            request.onsuccess = () => {
                request.result.forEach(key => store.delete(key));
                renderLogPlaceholder(document.getElementById('chatLog'), '📭', '// BELLEK SIFIRLANDI //', false);
                showToast("Sohbet geçmişi temizlendi.", 'success'); playSound('destroy');
            };
        } catch(e) {}
    });
}

// === KİŞİ EKLEME MODALI ===

function showContactConfigModal() { playSound('type'); const modal = document.getElementById('contactConfigModal'); document.getElementById('modalTargetId').value = ''; modal.classList.remove('hidden'); }
function hideContactConfigModal() { playSound('type'); document.getElementById('contactConfigModal').classList.add('hidden'); }

// === YENİ AJAN EKLEME (REUSABLE) ===

function addContact(targetId, username = null) {
    if (!targetId) return false;
    targetId = targetId.toUpperCase();
    if (targetId === currentUser.userId) return false;
    
    let existing = myContacts.find(c => c.id === targetId);
    if (!existing) {
        myContacts.push({ 
            id: targetId, 
            username: username || null, 
            key: null, 
            ecdhStatus: 'pending', 
            isOnline: false, 
            avatar: null 
        });
        saveContactsToVault();
        const display = username ? `${username} (${targetId})` : targetId;
        showToast(`${display} kişi listesine eklendi.`, 'success');
        safeEmit('join_status_rooms', [targetId]); 
        safeEmit('check_node_status', targetId, (res) => { if (res) updateContactStatusUI(res.userId, res.isOnline); });
        safeEmit('get_profiles', [targetId], (res) => {
            if (res && res.profiles && res.profiles[targetId]) {
                const c = myContacts.find(x => x.id === targetId);
                if (c) {
                    if (res.profiles[targetId].avatar) c.avatar = res.profiles[targetId].avatar;
                    if (res.profiles[targetId].username) c.username = res.profiles[targetId].username;
                    saveContactsToVault();
                    renderContactsSidebarDebounced();
                    if (activeTarget && activeTarget.id === targetId) updateChatHeaderUI();
                }
            }
        });
        
        // Ekleme başarılı olunca karşıya bildirim gönder
        notifyContactAddition(targetId);
        
        // ECDH tüneli otomatik başlat
        ensureSharedSecret(targetId);
        
        return true;
    } else {
        if (username && !existing.username) {
            existing.username = username;
            saveContactsToVault();
            renderContactsSidebarDebounced();
            if (activeTarget && activeTarget.id === targetId) updateChatHeaderUI();
        }
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
            item.className = 'flex items-center justify-between p-2 bg-purple-950/20 border border-purple-500/20  text-xs font-mono mb-2';

            const left = document.createElement('div');
            left.className = 'flex items-center gap-2 min-w-0';

            const dot = document.createElement('span');
            dot.className = `w-2 h-2 rounded-full ${user.isOnline ? 'bg-green-500 ' : 'bg-gray-600'} flex-shrink-0`;
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
                btn.className = 'px-3 py-1.5 border border-purple-500/30 text-purple-500/40 text-[10px] font-black  uppercase tracking-wider cursor-not-allowed';
                btn.innerText = 'EKLI';
            } else {
                btn.className = 'px-3 py-1.5 bg-purple-500 text-black hover:bg-white hover:text-black font-black border border-purple-400 text-[10px]  uppercase tracking-wider transition-all cursor-pointer';
                btn.innerText = 'EKLE';
                btn.onclick = () => {
                    const added = addContact(user.userId, user.username);
                    if (added) {
                        playSound('success');
                        btn.disabled = true;
                        btn.className = 'px-3 py-1.5 border border-purple-500/30 text-purple-500/40 text-[10px] font-black  uppercase tracking-wider cursor-not-allowed';
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
        spn.className = 'text-xs font-bold text-blue-300';
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
    const username = pendingContactRequest.username;
    
    safeEmit('respond_contact_request', { targetId, accepted }, (res) => {
        if (accepted) {
            addContact(targetId, username);
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
        const c = myContacts.find(x => x.id === data.senderId);
        if (c && data.username) {
            c.username = data.username;
            if (data.avatar) c.avatar = data.avatar;
            saveContactsToVault();
            renderContactsSidebarDebounced();
            if (activeTarget && activeTarget.id === data.senderId) updateChatHeaderUI();
        }
        const name = data.username ? `${data.username} (${data.senderId})` : data.senderId;
        showToast(`${name} bağlantı isteğinizi kabul etti!`, 'success');
        playSound('success');
        ensureSharedSecret(data.senderId);
    } else {
        showToast(`${data.senderId} bağlantı isteğinizi reddetti.`, 'error');
        playSound('destroy');
    }
}



function handleContactSubmit() {
    const targetId = document.getElementById('modalTargetId').value.trim().toUpperCase();
    if (!targetId) { playSound('error'); showToast("Lütfen bir ID girin.", 'error'); return; }
    if (targetId === currentUser.userId) { playSound('error'); showToast("Kendinizi ekleyemezsiniz.", 'error'); return; }
    
    const added = addContact(targetId);
    if (added) {
        playSound('success');
    } else {
        playSound('error');
        showToast("Bu kişi zaten listenizde.", 'warning');
    }
    hideContactConfigModal();
    renderContactsSidebar();
    selectTarget(targetId);
}

// === MESAJ GÖNDERME / ALMA ===

async function sendSecurePacket() {
    if (!activeTarget) return;
    const sharedSecret = derivedSecrets[activeTarget.id];
    if (!sharedSecret) { playSound('error'); showToast("Şifreleme anahtarı bekleniyor...", 'warning'); return; }
    
    if (!activeTarget.fingerprintVerified) {
        playSound('error');
        showToast("Parmak izi doğrulanmamış. Mesaj gönderilemedi.", 'error');
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
    } catch (e) { playSound('error'); showToast("Şifreleme hatası oluştu.", 'error'); return; }

    const packetId = crypto.randomUUID().replace(/-/g, '').substring(0, 12).toUpperCase();
    const packet = { id: packetId, senderId: currentUser.userId, targetId: activeTarget.id, textPayload: encryptedText, filePayload: encryptedFile, fileName: activeFileName || null, ttl: ttl > 0 ? ttl : null, timestamp: new Date().getTime() };
    
    appendMessageToUI(packetId, 'SEN', rawText, activeFileBase64, true, false, packet.ttl, packet.timestamp, activeFileName);
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
        if (res && res.queued) showToast("Kişi çevrimdışı, mesaj kuyruğa eklendi.", 'warning');
        else if (res && res.error === "RATE_LIMIT") { playSound('error'); showToast("Çok hızlı mesaj gönderiyorsunuz, lütfen bekleyin.", 'error'); }
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
            if (packet.filePayload) { 
                decryptedFile = await decryptGCM(packet.filePayload, cryptoKey); 
                if (!decryptedFile.startsWith("data:image") && !decryptedFile.startsWith("data:application/pdf")) hasError = true; 
            }
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
    return { id: packet.id, sender: senderLabel, text: decryptedText, file: decryptedFile, fileName: packet.fileName || null, isMine, isError: hasError, ttl: remainingTtl, timestamp: packet.timestamp };
}

async function processIncomingPacket(packet, contactInfo) {
    const data = await decryptPacketForDisplay(packet, contactInfo);
    if (data) appendMessageToUI(data.id, data.sender, data.text, data.file, data.isMine, data.isError, data.ttl, data.timestamp, data.fileName);
}

function revokeMessage(packetId) {
    if (!activeTarget) return;
    showCustomConfirm("Bu mesaj hem sizden hem de karşı taraftan silinecektir. Devam etmek istiyor musunuz?", async () => {
        await removePacketFromVault(activeTarget.id, packetId);
        const msgElement = document.getElementById(`msg-${packetId}`);
        fadeOutAndRemoveElement(msgElement);
        safeEmit('revoke_packet', { targetId: activeTarget.id, packetId: packetId, senderId: currentUser.userId });
        showToast("Mesaj silindi.", 'warning');
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

function renderMessageTextWithLinks(container, text, isMine) {
    if (!text) return;
    const urlRegex = /(https?:\/\/[^\s]+|www\.[^\s]+)/gi;
    let lastIndex = 0;
    let match;

    while ((match = urlRegex.exec(text)) !== null) {
        if (match.index > lastIndex) {
            container.appendChild(document.createTextNode(text.substring(lastIndex, match.index)));
        }

        let rawUrl = match[0];
        let trailingPunctuation = '';
        const punctMatch = rawUrl.match(/[.,;:!?)]+$/);
        if (punctMatch) {
            trailingPunctuation = punctMatch[0];
            rawUrl = rawUrl.slice(0, -trailingPunctuation.length);
        }

        let href = rawUrl;
        if (!href.startsWith('http://') && !href.startsWith('https://')) {
            href = 'https://' + href;
        }

        let isValid = false;
        try {
            const parsedUrl = new URL(href);
            if (parsedUrl.protocol === 'http:' || parsedUrl.protocol === 'https:') {
                isValid = true;
            }
        } catch (_) {
            isValid = false;
        }

        if (isValid && rawUrl.length > 0) {
            const link = document.createElement('a');
            link.href = href;
            link.target = '_blank';
            link.rel = 'noopener noreferrer';
            link.textContent = rawUrl;
            link.className = isMine
                ? 'text-blue-100 hover:text-white underline underline-offset-2 decoration-blue-300/80 hover:decoration-white font-medium transition-colors break-all cursor-pointer'
                : 'text-cyan-400 hover:text-cyan-300 underline underline-offset-2 decoration-cyan-500/80 hover:decoration-cyan-300 font-medium transition-colors break-all cursor-pointer';
            link.addEventListener('click', (e) => e.stopPropagation());
            container.appendChild(link);
        } else {
            container.appendChild(document.createTextNode(rawUrl));
        }

        if (trailingPunctuation) {
            container.appendChild(document.createTextNode(trailingPunctuation));
        }

        lastIndex = match.index + match[0].length;
    }

    if (lastIndex < text.length) {
        container.appendChild(document.createTextNode(text.substring(lastIndex)));
    }
}

let _lastDateLabel = null;

function appendMessageToUI(packetId, sender, text, fileSrc, isMine, isError, ttl, timestamp, fileName = null) {
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
    headerSpan.className = 'text-[8px] sm:text-[10px] block mb-1 sm:mb-1.5 font-mono tracking-[0.1em] flex items-center bg-black/60 px-1.5 sm:px-2 py-0.5  border border-gray-700/60 max-w-[90%] gap-1';
    const timeStr = msgDate.toLocaleTimeString('tr-TR', { hour: '2-digit', minute: '2-digit', second:'2-digit' });
    const senderColor = isMine ? 'text-blue-400' : 'text-[var(--text-secondary)]';
    
    if (isMine) {
        const timeSpan = document.createElement('span'); timeSpan.className = 'text-gray-500 mr-1.5 sm:mr-2 flex-shrink-0'; timeSpan.textContent = `[${timeStr}]`; headerSpan.appendChild(timeSpan);
        const senderSpan = document.createElement('span'); senderSpan.className = `font-black ${senderColor} truncate`; senderSpan.textContent = `>_ ${sender}`; headerSpan.appendChild(senderSpan);
        const revokeBtn = document.createElement('button');
        revokeBtn.className = 'ml-2 sm:ml-3 text-red-500 hover:text-white hover:bg-red-500 font-mono text-[7px] sm:text-[9px] border border-red-500/50 px-1 sm:px-1.5 py-0.5  transition-all font-bold  flex-shrink-0';
        revokeBtn.title = 'Herkesten Sil'; revokeBtn.textContent = 'Sil';
        revokeBtn.addEventListener('click', () => revokeMessage(packetId));
        headerSpan.appendChild(revokeBtn);
    } else {
        const contact = myContacts.find(c => c.id === sender);
        const displayName = (contact && contact.username) ? `${contact.username} (${sender})` : sender;
        const senderSpan = document.createElement('span'); senderSpan.className = `font-black ${senderColor} truncate`; senderSpan.textContent = displayName; headerSpan.appendChild(senderSpan);
        const timeSpan = document.createElement('span'); timeSpan.className = 'text-gray-500 ml-1.5 sm:ml-2 flex-shrink-0'; timeSpan.textContent = `[${timeStr}]`; headerSpan.appendChild(timeSpan);
    }

    if (ttl && ttl > 0) {
        const ttlBadge = document.createElement('span'); ttlBadge.id = `ttl-badge-${packetId}`;
        ttlBadge.className = 'mx-1.5 sm:mx-2 px-1 sm:px-1.5 py-0.5 bg-red-950/80 border border-red-500 text-red-400 font-mono text-[7px] sm:text-[9px] animate-pulse font-black   flex-shrink-0';
        ttlBadge.textContent = `TTL:${ttl}s`;
        if (isMine) headerSpan.insertBefore(ttlBadge, headerSpan.firstChild); else headerSpan.appendChild(ttlBadge);
    }
    msgDiv.appendChild(headerSpan);

    if (isError === 'no_key') {
        const errDiv = document.createElement('div'); errDiv.className = 'border-l-4 border-yellow-500 bg-yellow-950/40 p-2 sm:p-3 text-[10px] sm:text-xs text-yellow-400 my-1 max-w-[90%] sm:max-w-sm    font-bold tracking-wider'; errDiv.innerText = '[!] UYARI: ANAHTAR EŞLEŞMEDİ.'; msgDiv.appendChild(errDiv);
    } else if (isError) {
        const errDiv = document.createElement('div'); errDiv.className = 'border-l-4 border-red-500 bg-red-950/40 p-2 sm:p-3 text-[10px] sm:text-xs text-red-400 my-1 max-w-[90%] sm:max-w-sm    font-bold tracking-wider'; errDiv.innerText = '[!] KRİTİK: PAKET BÜTÜNLÜĞÜ BOZUK!'; msgDiv.appendChild(errDiv);
    } else {
        if (fileSrc) {
            if (fileSrc.startsWith('data:application/pdf')) {
                const pdfCard = document.createElement('div');
                pdfCard.className = 'my-1 sm:my-2 p-3 bg-black/60 border border-red-500/40 rounded-xl flex flex-col gap-2.5 max-w-[280px] sm:max-w-xs font-mono backdrop-blur-md shadow-xl hover:border-red-400 transition-colors';
                
                const safeFileName = fileName || 'belge.pdf';
                const commaIdx = fileSrc.indexOf(',');
                const approxBytes = (commaIdx !== -1 ? fileSrc.length - commaIdx - 1 : fileSrc.length) * 0.75;
                const sizeMB = (approxBytes / (1024 * 1024)).toFixed(2);
                
                const cardHeader = document.createElement('div');
                cardHeader.className = 'flex items-center gap-3 min-w-0';
                cardHeader.innerHTML = `
                    <div class="w-10 h-10 rounded-lg bg-red-500/20 border border-red-500/50 flex items-center justify-center text-red-400 text-xl shrink-0 shadow-inner">
                        📄
                    </div>
                    <div class="flex flex-col min-w-0 flex-1">
                        <span class="text-xs text-gray-200 font-semibold truncate" title="${safeFileName}">${safeFileName}</span>
                        <span class="text-[10px] text-gray-400 font-mono tracking-wider">${sizeMB} MB • PDF</span>
                    </div>
                `;
                pdfCard.appendChild(cardHeader);

                const cardActions = document.createElement('div');
                cardActions.className = 'flex items-center gap-2 pt-2 border-t border-gray-800/80';

                const downloadBtn = document.createElement('button');
                downloadBtn.type = 'button';
                downloadBtn.className = 'flex-1 py-1.5 px-2 rounded-lg bg-red-500/15 hover:bg-red-500/25 border border-red-500/40 text-red-400 hover:text-red-300 text-[11px] font-bold transition-all flex items-center justify-center gap-1.5 active:scale-95 cursor-pointer';
                downloadBtn.innerHTML = '<span>📥</span> İndir';
                downloadBtn.onclick = () => downloadPdf(fileSrc, safeFileName);
                cardActions.appendChild(downloadBtn);

                const viewBtn = document.createElement('button');
                viewBtn.type = 'button';
                viewBtn.className = 'flex-1 py-1.5 px-2 rounded-lg bg-white/5 hover:bg-white/10 border border-gray-700 text-gray-300 hover:text-white text-[11px] font-bold transition-all flex items-center justify-center gap-1.5 active:scale-95 cursor-pointer';
                viewBtn.innerHTML = '<span>👁</span> Görüntüle';
                viewBtn.onclick = () => openPdfViewer(fileSrc, safeFileName);
                cardActions.appendChild(viewBtn);

                pdfCard.appendChild(cardActions);
                msgDiv.appendChild(pdfCard);
            } else {
                window.receivedImages.push(fileSrc); const imageIndex = window.receivedImages.length - 1;
                const img = document.createElement('img'); img.src = fileSrc;
                img.className = 'w-48 sm:w-56 md:w-72 max-w-[90%] h-auto max-h-48 sm:max-h-64 my-1 sm:my-2  border-2 border-cyan-500/40 cursor-pointer hover:border-cyan-400 transition-all  opacity-90 hover:opacity-100 object-contain rounded-lg';
                img.title = 'Görüntülemek için Tıkla'; img.onclick = () => showImageModal(imageIndex);
                msgDiv.appendChild(img);
            }
        }
        if (text) {
            const textSpan = document.createElement('div');
            const bubbleClass = isMine ? 'msg-bubble-mine bg-blue-600 text-white rounded-2xl rounded-tr-sm' : 'msg-bubble-theirs bg-surface text-gray-200 rounded-2xl rounded-tl-sm';
            textSpan.className = `px-3 sm:px-5 py-2 sm:py-3 border font-mono text-[11px] sm:text-[13px] leading-relaxed max-w-[95%] sm:max-w-[80%] text-left whitespace-pre-wrap break-words backdrop-blur-sm ${bubbleClass}`;
            renderMessageTextWithLinks(textSpan, text, isMine); msgDiv.appendChild(textSpan);
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
            if (msgElement) fadeOutAndRemoveElement(msgElement, () => removePacketFromVault(targetUser, packetId));
        }
    }, 1000);
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
        playSound('success'); showToast("ID kopyalandı.");
    }).catch(() => {
        const tempInput = document.createElement("input"); tempInput.value = currentUser.userId;
        document.body.appendChild(tempInput); tempInput.select(); document.execCommand("copy"); document.body.removeChild(tempInput);
        playSound('success'); showToast("ID kopyalandı.");
    });
}

function toggleKeyReveal() {
    if (!activeTarget) return; playSound('type');
    const keyText = document.getElementById('profileKey'); 
    if (keyText) {
        keyRevealed = !keyRevealed;
        keyText.innerText = keyRevealed ? activeTarget.key : "••••••••••••••••";
    }
}

// === DOSYA VE BELGE İŞLEMLERİ (RESİM & PDF) ===

function base64ToBlob(base64Data, contentType = 'application/pdf') {
    const parts = base64Data.split(';base64,');
    const b64 = parts.length > 1 ? parts[1] : parts[0];
    const binaryStr = window.atob(b64);
    const len = binaryStr.length;
    const bytes = new Uint8Array(len);
    for (let i = 0; i < len; i++) {
        bytes[i] = binaryStr.charCodeAt(i);
    }
    return new Blob([bytes], { type: contentType });
}

function downloadPdf(fileSrc, fileName) {
    try {
        playSound('type');
        const blob = base64ToBlob(fileSrc, 'application/pdf');
        const blobUrl = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = blobUrl;
        a.download = fileName || 'belge.pdf';
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        setTimeout(() => URL.revokeObjectURL(blobUrl), 15000);
        showToast("PDF indiriliyor...", "info");
    } catch (e) {
        console.error("PDF indirme hatası:", e);
        showToast("PDF indirilemedi.", "error");
    }
}

function openPdfViewer(fileSrc, fileName) {
    try {
        playSound('type');
        const blob = base64ToBlob(fileSrc, 'application/pdf');
        const blobUrl = URL.createObjectURL(blob);
        window.open(blobUrl, '_blank');
        setTimeout(() => URL.revokeObjectURL(blobUrl), 60000);
    } catch (e) {
        console.error("PDF görüntüleme hatası:", e);
        showToast("PDF görüntülenemedi.", "error");
    }
}

function handleFileSelect(input) {
    const file = input.files[0]; 
    if (!file) return;
    
    // 5 MB boyut sınırı kontrolü
    const MAX_FILE_SIZE = 5 * 1024 * 1024;
    if (file.size > MAX_FILE_SIZE) {
        playSound('error');
        showToast("Dosya boyutu çok büyük (Maksimum 5 MB).", "error");
        input.value = '';
        return;
    }

    const isPdf = file.type === 'application/pdf' || file.name.toLowerCase().endsWith('.pdf');
    const isImage = file.type.startsWith('image/');

    if (isPdf) {
        const reader = new FileReader();
        reader.onload = function(e) {
            activeFileBase64 = e.target.result;
            activeFileName = file.name;
            const sizeMB = (file.size / (1024 * 1024)).toFixed(2);
            document.getElementById('fileName').innerText = `📄 ${file.name} [${sizeMB}MB]`;
            document.getElementById('previewContainer').classList.remove('hidden');
            playSound('type');
        };
        reader.readAsDataURL(file);
    } else if (isImage) {
        activeFileName = file.name;
        const reader = new FileReader();
        reader.onload = function(e) {
            const img = new Image();
            img.onload = function() {
                const canvas = document.createElement('canvas'); 
                let width = img.width; 
                let height = img.height; 
                const MAX_DIM = 1200;
                if (width > height) { 
                    if (width > MAX_DIM) { height *= MAX_DIM / width; width = MAX_DIM; } 
                } else { 
                    if (height > MAX_DIM) { width *= MAX_DIM / height; height = MAX_DIM; } 
                }
                canvas.width = width; 
                canvas.height = height; 
                const ctx = canvas.getContext('2d'); 
                ctx.drawImage(img, 0, 0, width, height);
                activeFileBase64 = canvas.toDataURL('image/jpeg', 0.7); 
                canvas.width = 0; 
                canvas.height = 0; 
                const sizeMB = (activeFileBase64.length * 0.75) / (1024 * 1024);
                document.getElementById('fileName').innerText = `DATA_IMG [${sizeMB.toFixed(2)}MB]`; 
                document.getElementById('previewContainer').classList.remove('hidden'); 
                playSound('type');
            }; 
            img.src = e.target.result;
        }; 
        reader.readAsDataURL(file);
    } else {
        playSound('error');
        showToast("Desteklenmeyen dosya türü (Sadece resim veya PDF).", "warning");
        input.value = '';
    }
}

function clearFileInput() { 
    playSound('error'); 
    activeFileBase64 = null; 
    activeFileName = null;
    document.getElementById('previewContainer').classList.add('hidden'); 
    document.getElementById('fileInput').value = ''; 
}

function showImageModal(index) { 
    const modal = document.getElementById('imageModal'); 
    const modalImg = document.getElementById('modalImage'); 
    if (window.receivedImages[index]) { 
        playSound('success'); 
        modalImg.src = window.receivedImages[index]; 
        modal.classList.remove('hidden'); 
    } 
}

function hideImageModal() { 
    playSound('type'); 
    document.getElementById('imageModal').classList.add('hidden'); 
}

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
    const activeClass = "flex-1 py-1.5 bg-cyan-500/20 border border-cyan-400 text-blue-300 font-bold tracking-normal  text-[10px] sm:text-xs transition-all";
    const inactiveClass = "flex-1 py-1.5 bg-transparent border border-gray-600 text-gray-500 font-bold tracking-normal  text-[10px] sm:text-xs hover:border-cyan-500/50 hover:text-blue-400 transition-all";
    
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
            updateMyAvatarUI(); showToast("Profil fotoğrafı güncellendi.", 'success'); hideSettingsModal();
        } else { playSound('error'); showToast(`HATA: ${res ? res.message : 'Güncellenemedi'}`, 'error'); }
    });
}

function changeUserPassword() {
    const oldP = document.getElementById('setOldPwd').value; const newP = document.getElementById('setNewPwd').value;
    if(!oldP || !newP) { playSound('error'); showToast("Lütfen şifre alanlarını doldurun.", 'error'); return; }
    safeEmit('change_password', { oldPassword: oldP, newPassword: newP }, (res) => {
        if (res && res.success) {
            playSound('success'); showToast("Şifre değiştirildi.", 'success');
            document.getElementById('setOldPwd').value = ''; document.getElementById('setNewPwd').value = ''; hideSettingsModal();
        } else { playSound('error'); showToast(`HATA: ${res ? res.message : 'Başarısız'}`, 'error'); }
    });
}

function deleteUserAccount() {
    const pwd = document.getElementById('setDelPwd').value;
    if(!pwd) { playSound('error'); showToast("Lütfen onay şifrenizi girin."); return; }
    showCustomConfirm("Hesabınız ve tüm verileriniz kalıcı olarak silinecektir. Bu işlem geri alınamaz.", () => {
        safeEmit('delete_account', { password: pwd }, (res) => {
            if (res && res.success) {
                playSound('destroy'); localStorage.clear(); sessionStorage.clear(); indexedDB.deleteDatabase(DB_NAME);
                showToast("Hesap silindi.", 'system');
                setTimeout(() => window.location.reload(), 2000);
            } else { playSound('error'); showToast(`HATA: ${res ? res.message : 'Silinemedi'}`); }
        });
    });
}

// === MOBİL LAYOUT ===

function updateMobileLayout() {
    const sidebar = document.getElementById('chatSidebar') || document.querySelector('#chatTerminal > section:first-of-type');
    const chatArea = document.getElementById('chatStreamContainer');
    
    if (!sidebar || !chatArea) return;
    
    if (window.innerWidth < 1024) {
        if (activeTarget) {
            sidebar.classList.add('hidden');
            chatArea.classList.remove('hidden');
            chatArea.classList.add('flex-1', 'h-full');
        } else {
            sidebar.classList.remove('hidden');
            sidebar.classList.add('flex-1', 'h-full');
            chatArea.classList.add('hidden');
        }
    } else {
        sidebar.classList.remove('hidden', 'flex-1');
        sidebar.classList.add('h-full');
        chatArea.classList.remove('hidden');
        chatArea.classList.add('flex-1', 'h-full');
    }
}

function mobileGoBack() {
    activeTarget = null;
    updateMobileLayout();
    renderContactsSidebar();
    
    // reset chat ui header & content
    updateChatHeaderUI();
    document.getElementById('clearChatBtn').classList.add('hidden');
    disableChatUI();
    renderLogPlaceholder(document.getElementById('chatLog'), null, "// GÜVENLİ TÜNEL BEKLENİYOR //", true);
}

window.addEventListener('resize', () => {
    updateMobileLayout();
});

// === OTOMATİK BAŞLATMA VE OLAY BAĞLAYICILARI ===

function initAuthEvents() {
    const tabLoginBtn = document.getElementById('tabLoginBtn');
    const tabRegisterBtn = document.getElementById('tabRegisterBtn');
    const authSwitchLink = document.getElementById('authSwitchLink');
    const authForm = document.getElementById('authForm');

    if (tabLoginBtn) {
        tabLoginBtn.addEventListener('click', (e) => {
            e.preventDefault();
            switchAuthTab('login');
        });
    }

    if (tabRegisterBtn) {
        tabRegisterBtn.addEventListener('click', (e) => {
            e.preventDefault();
            switchAuthTab('register');
        });
    }

    if (authSwitchLink) {
        authSwitchLink.addEventListener('click', (e) => {
            e.preventDefault();
            switchAuthTab(currentAuthTab === 'login' ? 'register' : 'login');
        });
    }

    if (authForm) {
        authForm.addEventListener('submit', (e) => {
            e.preventDefault();
            handleAuthSubmit();
        });
    }

    // Input değiştiğinde hataları temizleme
    ['serverIp', 'authUsername', 'authEmail', 'authPassword', 'authPasswordConfirm'].forEach(id => {
        const input = document.getElementById(id);
        if (input) {
            input.addEventListener('input', () => {
                input.classList.remove('input-error');
                const alertEl = document.getElementById('authAlert');
                if (alertEl && alertEl.classList.contains('auth-alert-error')) {
                    alertEl.classList.add('hidden');
                }
            });
        }
    });
}

function toggleServerConfig() {
    const input = document.getElementById('serverIp');
    if (input) {
        input.classList.toggle('hidden');
        if (!input.classList.contains('hidden')) {
            input.focus();
        }
    }
}

function autoFillServerUrl() {
    const input = document.getElementById('serverIp');
    const toggleBtn = document.getElementById('serverIpToggleBtn');
    const configuredBackend = (window.APP_CONFIG && window.APP_CONFIG.BACKEND_URL) 
        ? window.APP_CONFIG.BACKEND_URL.trim() 
        : '';

    if (input) {
        if (configuredBackend) {
            input.value = configuredBackend;
            // Backend tanımlı olduğunda teknik input'u varsayılan olarak gizle, toggle butonunu göster
            input.classList.add('hidden');
            if (toggleBtn) toggleBtn.classList.remove('hidden');
        } else {
            const origin = window.location.origin;
            if (origin && origin !== 'null' && !origin.startsWith('file://')) {
                input.value = origin;
            } else if (!input.value) {
                input.value = 'http://localhost:3000';
            }
        }
    }
    initAuthEvents();
    setTimeout(autoLoginAttempt, 100);
}

if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', autoFillServerUrl);
} else {
    autoFillServerUrl();
}

