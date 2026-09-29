/**
 * @file ui.js
 * @module UIManager
 * @description Kullanıcı Arayüzü, State Yönetimi ve DOM İşlemleri Modülü.
 * Sohbet akışı, bildirim toast sistemi, kişi yönetimi, E2EE şifreli mesaj gösterimi,
 * medya ve PDF önizleme, TTL mesaj imha zamanlayıcıları ve CSP uyumlu olay bağlayıcılarını yönetir.
 */

// === POLYFILL ===
/**
 * requestIdleCallback polyfill'i (Desteklemeyen ortamlarda setTimeout ile çalışır).
 * @type {function(function): number}
 */
const idleCallback = window.requestIdleCallback
    ? window.requestIdleCallback.bind(window)
    : (cb) => setTimeout(() => cb({ timeRemaining: () => 1, didTimeout: false }), 1);

// === GLOBAL STATE ===

/**
 * Aktif Socket.IO istemci soketi örneği.
 * @type {Object|null}
 */
let socket = null;

/**
 * Gönderilmek üzere seçilen dosyanın Base64 verisi.
 * @type {string|null}
 */
let activeFileBase64 = null;

/**
 * Gönderilmek üzere seçilen dosyanın adı.
 * @type {string|null}
 */
let activeFileName = null;

/**
 * Ortak anahtarın arayüzde görünür olup olmadığını belirten bayrak.
 * @type {boolean}
 */
let keyRevealed = false;

/**
 * Kimlik doğrulama penceresindeki aktif sekme ('login' | 'register').
 * @type {'login'|'register'}
 */
let currentAuthTab = 'login'; 

/**
 * Giriş yapmış mevcut kullanıcı profili.
 * @type {Object|null}
 */
let currentUser = null;

/**
 * Şu anda sohbet edilmekte olan aktif hedef kişi.
 * @type {Object|null}
 */
let activeTarget = null;

/**
 * Kullanıcının kişi listesi.
 * @type {Array<Object>}
 */
let myContacts = []; 

/**
 * Kişilere göre okunmamış mesaj sayaçları (userId -> count).
 * @type {Object.<string, number>}
 */
let unreadCounts = {}; 

/**
 * Sohbet oturumu boyunca alınan görsellerin Base64 dizisi (Galeri görünümü için).
 * @type {string[]}
 */
window.receivedImages = [];

/**
 * Arayüz yazı tipi ölçek çarpanı.
 * @type {number}
 */
let currentScale = 1.15;

/**
 * Yerel yazıyor durumu zaman aşımı sayacı.
 * @type {NodeJS.Timeout|null}
 */
let localTypingTimeout = null;

/**
 * Kullanıcının şu an yazmakta olduğunu belirten durum bayrağı.
 * @type {boolean}
 */
let isCurrentlyTyping = false;

// === YARDIMCI FONKSİYONLAR ===

/**
 * Soket bağlantısı aktifse olay yayınlar (emit). Bağlantı yoksa sessizce görmezden gelir.
 * @function safeEmit
 * @param {string} event - Gönderilecek olay adı.
 * @param {*} data - Olay yükü.
 * @param {Function} [callback] - Sunucu yanıtı geri çağırma fonksiyonu.
 * @returns {void}
 */
function safeEmit(event, data, callback) {
    if (!socket || !socket.connected) return;
    if (callback) socket.emit(event, data, callback);
    else socket.emit(event, data);
}

/**
 * Electron ortamındaysa masaüstü bildirimi tetikler.
 * @function triggerDesktopNotification
 * @param {string} title - Bildirim başlığı.
 * @param {string} body - Bildirim gövde metni.
 * @returns {void}
 */
function triggerDesktopNotification(title, body) {
    if (window.siberBridge && typeof window.siberBridge.showNotification === 'function') {
        window.siberBridge.showNotification(title, body);
    }
}

// === ONAY MODALI ===

/**
 * Özel temalı onay (Confirm) modalını açar. ESC ve dış tıklama ile kapanmayı destekler.
 * @function showCustomConfirm
 * @param {string} message - Kullanıcıya gösterilecek onay sorusu.
 * @param {Function} onConfirmCallback - Kullanıcı 'Evet' butonuna tıkladığında çalışacak fonksiyon.
 * @returns {void}
 */
function showCustomConfirm(message, onConfirmCallback) {
    playSound('error');
    const modal = document.getElementById('cyberConfirmModal');
    const msgEl = document.getElementById('cyberConfirmMsg');
    const btnYes = document.getElementById('cyberConfirmBtnYes');
    const btnNo = document.getElementById('cyberConfirmBtnNo');
    
    // [GÜVENLİK FIX] innerHTML yerine textContent — XSS engellenir
    msgEl.textContent = message;
    modal.classList.remove('hidden');

    const cleanUp = () => {
        modal.classList.add('hidden');
        btnYes.onclick = null;
        btnNo.onclick = null;
        document.removeEventListener('keydown', handleKeyDown);
        modal.removeEventListener('click', handleBackdropClick);
    };

    const handleKeyDown = (e) => {
        if (e.key === 'Escape') cleanUp();
    };

    const handleBackdropClick = (e) => {
        if (e.target === modal) cleanUp();
    };

    document.addEventListener('keydown', handleKeyDown);
    modal.addEventListener('click', handleBackdropClick);

    btnYes.onclick = () => { playSound('success'); cleanUp(); onConfirmCallback(); };
    btnNo.onclick = () => { playSound('type'); cleanUp(); };
}

/**
 * Belirtilen DOM öğesini karartma ve küçültme animasyonuyla DOM'dan kaldırır.
 * @function fadeOutAndRemoveElement
 * @param {HTMLElement|null} element - Kaldırılacak DOM öğesi.
 * @param {Function} [onComplete] - Kaldırma işlemi tamamlandığında çağrılacak fonksiyon.
 * @returns {void}
 */
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

/**
 * Sohbet penceresi boşken yer tutucu (placeholder) simgesi ve mesajı oluşturur.
 * @function renderLogPlaceholder
 * @param {HTMLElement} logBox - Hedef sohbet kapsayıcı elementi.
 * @param {string|null} icon - Gösterilecek simge karakteri.
 * @param {string} message - Gösterilecek açıklama metni.
 * @param {boolean} [spinner=true] - Dönen yükleniyor animasyonu gösterilsin mi.
 * @returns {void}
 */
function renderLogPlaceholder(logBox, icon, message, spinner = true) {
    logBox.innerHTML = `<div class="chat-placeholder flex flex-col items-center justify-center h-full opacity-50 mt-4 sm:mt-10">
        ${spinner ? '<div class="w-10 h-10 sm:w-16 sm:h-16 border-2 sm:border-4 border-dashed border-green-500/50 animate-[spin_4s_linear_infinite] rounded-full mb-2 sm:mb-4"></div>' : `<span class="text-2xl sm:text-4xl mb-1 sm:mb-2">${icon}</span>`}
        <div class="text-green-500 text-[9px] sm:text-xs font-mono tracking-normal uppercase text-center">${message}</div>
    </div>`;
}

// === SES SİSTEMİ (DEVRE DIŞI) ===
/**
 * Ses efektlerini çalar (Sessiz modda devre dışı bırakılmıştır).
 * @function playSound
 * @param {string} type - Ses türü ('error'|'success'|'transit'|'type'|'destroy').
 * @returns {void}
 */
function playSound(type) { /* Ses özellikleri devre dışı bırakıldı */ }

// === TOAST BİLDİRİM SİSTEMİ ===

let _toastTimer = null;
let _toastProgressTimer = null;

/**
 * Ekranda zaman ayarlı toast bildirim balonu görüntüler.
 * @function showToast
 * @param {string} message - Bildirim mesajı.
 * @param {'info'|'success'|'error'|'warning'|'system'} [type='info'] - Bildirim türü.
 * @returns {void}
 */
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

/**
 * Kimlik doğrulama ekranında hata/bilgi uyarı kutusunu gösterir veya gizler.
 * Güvenli DOM API kullanarak XSS saldırılarını engeller.
 * @function setAuthAlert
 * @param {string|null} message - Gösterilecek uyarı iletisi (null ise gizler).
 * @param {'error'|'info'|'success'} [type='error'] - Uyarı türü.
 * @returns {void}
 */
function setAuthAlert(message, type = 'error') {
    const alertEl = document.getElementById('authAlert');
    if (!alertEl) return;
    if (!message) {
        alertEl.className = 'hidden auth-alert';
        alertEl.textContent = '';
        return;
    }
    const icons = {
        error: '⚠️',
        info: '🔄',
        success: '✅'
    };
    alertEl.className = `auth-alert auth-alert-${type}`;
    // [GÜVENLİK FIX] innerHTML yerine güvenli DOM API — sunucu mesajlarından XSS engellenir
    alertEl.textContent = '';
    const iconSpan = document.createElement('span');
    iconSpan.textContent = icons[type] || 'ℹ️';
    const msgSpan = document.createElement('span');
    msgSpan.textContent = message;
    alertEl.appendChild(iconSpan);
    alertEl.appendChild(msgSpan);
    alertEl.classList.remove('hidden');
}

/**
 * Kimlik doğrulama ekranındaki tüm hata uyarılarını ve input çerçeve stillerini temizler.
 * @function clearAuthAlert
 * @returns {void}
 */
function clearAuthAlert() {
    setAuthAlert(null);
    ['serverIp', 'authUsername', 'authEmail', 'authPassword', 'authPasswordConfirm'].forEach(id => {
        const el = document.getElementById(id);
        if (el) el.classList.remove('input-error');
    });
}

/**
 * Giriş (login) ve Kayıt (register) form sekmeleri arasında geçiş yapar.
 * @function switchAuthTab
 * @param {'login'|'register'} tab - Geçilecek sekme adı.
 * @returns {void}
 */
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

/**
 * Giriş veya Kayıt formunun gönderilmesini yönetir.
 * Alan doğrulaması yapar, Socket bağlantısını başlatır ve ilgili sunucu olayını tetikler.
 * @function handleAuthSubmit
 * @returns {void}
 */
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

/**
 * Sayfa ilk yüklendiğinde localStorage üzerinde kayıtlı JWT varsa otomatik giriş yapmayı dener.
 * @function autoLoginAttempt
 * @returns {void}
 */
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

/**
 * Bağlantı koptuğunda tam ekran yeniden bağlanma katmanını (overlay) gösterir.
 * @function showReconnectOverlay
 * @returns {void}
 */
function showReconnectOverlay() {
    const overlay = document.getElementById('reconnectOverlay');
    if (overlay) overlay.classList.remove('hidden');
}

/**
 * Yeniden bağlanma katmanını (overlay) gizler.
 * @function hideReconnectOverlay
 * @returns {void}
 */
function hideReconnectOverlay() {
    const overlay = document.getElementById('reconnectOverlay');
    if (overlay) overlay.classList.add('hidden');
}

/**
 * Yeniden bağlanma durumu açıklama metnini günceller.
 * @function updateReconnectStatus
 * @param {string} text - Gösterilecek durum metni.
 * @returns {void}
 */
function updateReconnectStatus(text) {
    const el = document.getElementById('reconnectStatus');
    if (el) el.innerText = text;
}

/**
 * Merkezi socket olay yöneticisi. Bağlantı, kopma ve yeniden bağlanma yaşam döngüsünü yönetir.
 * @function setupSocketEvents
 * @param {Object} sock - Yapılandırılacak soket nesnesi.
 * @returns {void}
 */
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

/**
 * Kullanıcı manuel olarak 'Yeniden Bağlan' butonuna bastığında soketi yeniden bağlar.
 * @function forceReconnect
 * @returns {void}
 */
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

/**
 * Kullanıcının profil avatarını arayüz bileşeninde günceller.
 * @function updateMyAvatarUI
 * @returns {void}
 */
function updateMyAvatarUI() {
    const container = document.getElementById('myProfileAvatarContainer');
    if (currentUser && currentUser.avatar) {
        container.innerHTML = `<img src="${currentUser.avatar}" class="w-full h-full object-cover">`;
    } else {
        container.innerHTML = `<span class="text-blue-300 font-black  text-[10px] sm:text-xs">OP</span>`;
    }
}

/**
 * Giriş veya kayıt sonrasında ana terminal arayüzünü başlatır, kriptografik anahtarları yükler
 * ve kişi listesini senkronize eder.
 * @function finishLoginSetup
 * @returns {void}
 */
async function finishLoginSetup() {
    playSound('success'); showToast("Doğrulama başarılı!", 'success');
    // Scroll-to-bottom FAB başlat
    setTimeout(initScrollToBottomFab, 200); // DOM hazır olunca bağla
    loadContactsFromVault(); loadSecretsFromVault();
    try {
        await initEcdhKeys();
        if (myPublicKeyJwk) socket.emit('publish_public_key', myPublicKeyJwk);
    } catch (e) {
        console.error('[!] initEcdhKeys hatası:', e);
    }
    
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

/**
 * Bağlantı koptuğunda veya çıkış yapıldığında oturum durumunu sıfırlar ve arayüzü giriş ekranına döndürür.
 * @function handleDisconnectUI
 * @returns {void}
 */
function handleDisconnectUI() {
    hideReconnectOverlay();
    document.getElementById('chatTerminalWrapper').classList.add('hidden'); 
    document.getElementById('authGateway').classList.remove('hidden');
    document.getElementById('clearChatBtn').classList.add('hidden');
    renderLogPlaceholder(document.getElementById('chatLog'), null, "Bağlantı kesildi", true);
    document.getElementById('packetSizeDisplay').innerText = "";
    
    Object.keys(_activeTimers).forEach(id => { clearInterval(_activeTimers[id]); delete _activeTimers[id]; });
    // [GÜVENLİK] Tüm kriptografik durumu bellekten güvenle temizle (ratchet zincirleri, geçici anahtarlar, AES önbellek)
    if (typeof wipeAllCryptoState === 'function') wipeAllCryptoState();
    Object.keys(_aesKeyCache).forEach(k => delete _aesKeyCache[k]);
    if (localTypingTimeout) { clearTimeout(localTypingTimeout); localTypingTimeout = null; }
    isCurrentlyTyping = false;
    window.receivedImages = []; currentUser = null; activeTarget = null; myContacts = []; unreadCounts = {}; derivedSecrets = {}; myEcdhKeyPair = null; myPublicKeyJwk = null; socket = null;
    updateMobileLayout();
}

/**
 * Kullanıcı oturumunu güvenle sonlandırır, sunucuya logout bildirir ve yerel token'ı temizler.
 * @function disconnectFromServer
 * @returns {void}
 */
function disconnectFromServer() { 
    if (socket) { 
        playSound('error');
        const token = localStorage.getItem('cyber_jwt');
        if (token) {
            try { socket.emit('logout', { token }); } catch (e) {}
        }
        socket.disconnect();
        showToast("Çıkış yapıldı.", 'warning'); 
        localStorage.removeItem('cyber_jwt');
        handleDisconnectUI(); 
    } 
}

// === KİŞİ LİSTESİ / DURUM ===

/**
 * Belirtilen kişinin çevrimiçi/çevrimdışı durum göstergesini (yeşil/gri nokta) günceller.
 * @function updateContactStatusUI
 * @param {string} userId - Güncellenecek kişinin ID'si.
 * @param {boolean} isOnline - Çevrimiçi ise true, değilse false.
 * @returns {void}
 */
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

/**
 * Kişi listesindeki tüm kişilerin çevrimiçi durumlarını sunucudan toplu sorgular.
 * @function checkOnlineStatuses
 * @returns {void}
 */
function checkOnlineStatuses() {
    if (myContacts.length === 0) return;
    const ids = myContacts.map(c => c.id);
    safeEmit('check_node_statuses', ids, (res) => {
        if (!res || !res.statuses) return;
        for (const userId in res.statuses) updateContactStatusUI(userId, res.statuses[userId]);
    });
}

let _contactSearchTerm = '';

/**
 * Yan paneldeki kişi listesini arama terimine göre filtreler.
 * @function filterContactsList
 * @param {string} term - Arama filtresi metni.
 * @returns {void}
 */
function filterContactsList(term) {
    _contactSearchTerm = (term || '').trim().toLowerCase();
    renderContactsSidebar();
}

let _renderContactsTimer = null;

/**
 * Yan paneldeki kişi listesini 50ms debounce ile yeniden çizer (aşırı DOM güncellemelerini önler).
 * @function renderContactsSidebarDebounced
 * @returns {void}
 */
function renderContactsSidebarDebounced() {
    if (_renderContactsTimer) return;
    _renderContactsTimer = setTimeout(() => { _renderContactsTimer = null; renderContactsSidebar(); }, 50);
}

/**
 * Yan paneldeki kişi listesini (myContacts) avatar, durum noktası, okunmamış rozetleri
 * ve silme aksiyonları ile birlikte DOM'a çizer.
 * @function renderContactsSidebar
 * @returns {void}
 */
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
        item.className = `group flex items-center gap-3 p-2.5 rounded-xl cursor-pointer transition-all duration-200 border relative ${
            isActive 
                ? 'bg-[--surface-hover] border-[--border-active] shadow-sm' 
                : 'hover:bg-[--surface-hover]/50 border-transparent'
        }`;
        // [GÜVENLİK FIX] CSP uyumlu olay dinleyici — inline onclick engellenir
        item.addEventListener('click', (event) => {
            if (event.target.closest('button')) return;
            selectTarget(contact.id);
        });

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
        deleteBtn.type = 'button';
        deleteBtn.className = 'w-6 h-6 flex items-center justify-center rounded-md hover:bg-[--error]/15 text-[--text-muted] hover:text-[--error] text-xs transition-all cursor-pointer opacity-70 md:opacity-0 md:group-hover:opacity-100 shrink-0';
        deleteBtn.title = 'Sohbeti Sil';
        deleteBtn.setAttribute('aria-label', 'Sohbeti Sil');
        deleteBtn.textContent = '✕';
        deleteBtn.addEventListener('click', (event) => {
            event.stopPropagation();
            event.preventDefault();
            removeContact(contact.id, event);
        });
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

/**
 * Belirtilen kişiyi listeden kaldırır, ilgili kasadaki tüm mesajları ve türetilmiş sırları kalıcı olarak siler.
 * @function removeContact
 * @param {string} targetId - Silinecek kişinin ID'si.
 * @param {Event} [event] - Olay nesnesi.
 * @returns {void}
 */
function removeContact(targetId, event) {
    if (event) {
        event.stopPropagation();
        event.preventDefault();
    }
    const contact = myContacts.find(c => c.id === targetId);
    const displayName = contact && contact.username ? `${contact.username} (${targetId})` : targetId;
    
    showCustomConfirm(`${displayName} kişisine ait tüm sohbet geçmişi ve şifreleme anahtarları silinecektir. Bu işlem geri alınamaz.`, async () => {
        // 1. myContacts listesinden kaldır ve kasaya kaydet
        myContacts = myContacts.filter(c => c.id !== targetId);
        saveContactsToVault();

        // 2. Okunmamış sayaçları temizle
        if (unreadCounts[targetId]) delete unreadCounts[targetId];

        // 3. Kasadaki (IndexedDB) tüm mesajları sil
        await clearPeerPacketsFromVault(targetId);

        // 4. Varsa legacy localStorage geçmişini temizle
        if (currentUser) {
            try {
                localStorage.removeItem(`cyber_history_idx_${currentUser.userId}_${targetId}`);
            } catch (_) {}
        }

        // 5. Türetilmiş ECDH şifreleme anahtarlarını ve ratchet zincirini güvenle sil
        if (typeof wipeTargetCryptoState === 'function') {
            wipeTargetCryptoState(targetId);
        } else if (derivedSecrets[targetId]) {
            delete derivedSecrets[targetId];
            saveSecretsToVault();
        }

        // [GÜVENLİK FIX] Karşı tarafın da eski oturum anahtarlarını silmesi için iki taraflı sıfırlama sinyali gönder
        safeEmit('reset_chat_session', { targetId: targetId });

        // 6. Eğer aktif sohbet buysa ekranı sıfırla
        if (activeTarget && activeTarget.id === targetId) {
            activeTarget = null;
            updateChatHeaderUI();
            const clearChatBtn = document.getElementById('clearChatBtn');
            if (clearChatBtn) clearChatBtn.classList.add('hidden');
            disableChatUI();
            const chatLog = document.getElementById('chatLog');
            if (chatLog) renderLogPlaceholder(chatLog, '🔒', 'Bir sohbet seçin', false);
            updateMobileLayout();
        }

        // 7. Sidebar'ı yeniden çiz ve bildirim ver
        renderContactsSidebar();
        playSound('destroy');
        showToast(`${displayName} kişi listenizden ve sohbet geçmişinizden silindi.`, 'warning');
    });
}

// === SOHBET ALANI ===

/**
 * Sohbet başlığındaki hedef kişi adı, kullanıcı ID'si ve durum bilgilerini günceller.
 * @function updateChatHeaderUI
 * @returns {void}
 */
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

/**
 * Mesaj giriş kutusunu ve gönder butonunu aktif (etkin) hale getirir.
 * @function enableChatUI
 * @returns {void}
 */
function enableChatUI() {
    document.getElementById('messageInput').disabled = false; document.getElementById('messageInput').placeholder = "Mesaj yazın...";
    document.getElementById('sendPacketBtn').disabled = false;
    document.getElementById('sendPacketBtn').className = "px-4 sm:px-8 py-2 sm:py-0 bg-green-500/20 text-green-500 font-black border-2 border-[#00ff66] text-[10px] sm:text-sm  transition-all duration-300 uppercase tracking-normal hover:bg-green-500 hover:text-black   flex-shrink-0";
}

/**
 * Mesaj giriş kutusunu ve gönder butonunu devre dışı bırakır (şifreleme kanalı kurulurken).
 * @function disableChatUI
 * @returns {void}
 */
function disableChatUI() {
    document.getElementById('messageInput').disabled = true; document.getElementById('messageInput').placeholder = "Bağlantı bekleniyor...";
    document.getElementById('sendPacketBtn').disabled = true;
    document.getElementById('sendPacketBtn').className = "px-4 sm:px-8 py-2 sm:py-0 bg-gray-900 text-gray-600 font-black border border-gray-700 text-[10px] sm:text-sm  transition-all duration-300 uppercase tracking-normal flex-shrink-0";
}

/**
 * Sohbet edilecek hedef kişiyi seçer, geçmiş mesajları kasadan (IndexedDB) yükler
 * ve şifreli kanalı doğrular.
 * @async
 * @function selectTarget
 * @param {string} targetId - Hedef kişinin kullanıcı ID'si.
 * @returns {Promise<void>}
 */
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

/**
 * Aktif açık olan sohbetin mesaj geçmişini yerel kasadan siler ve ekranı temizler.
 * @function clearActiveChat
 * @returns {void}
 */
function clearActiveChat() {
    if (!activeTarget) return;
    const targetId = activeTarget.id;
    const displayName = activeTarget.username ? `${activeTarget.username} (${activeTarget.id})` : activeTarget.id;
    showCustomConfirm(`${displayName} ile olan sohbet geçmişi silinecektir. Bu işlem geri alınamaz.`, async () => {
        await clearPeerPacketsFromVault(targetId);
        if (currentUser) {
            try {
                localStorage.removeItem(`cyber_history_idx_${currentUser.userId}_${targetId}`);
            } catch (_) {}
        }

        // [GÜVENLİK FIX] İki taraflı kriptografik oturum sıfırlama
        if (typeof wipeTargetCryptoState === 'function') {
            wipeTargetCryptoState(targetId);
        }
        if (typeof derivedSecrets !== 'undefined' && derivedSecrets[targetId]) {
            delete derivedSecrets[targetId];
        }
        activeTarget.key = null;
        activeTarget.ecdhStatus = 'pending';
        let contact = myContacts.find(c => c.id === targetId);
        if (contact) {
            contact.key = null;
            contact.ecdhStatus = 'pending';
            saveContactsToVault();
            renderContactsSidebarDebounced();
        }
        updateChatHeaderUI();

        // Karşı tarafa da oturumu sıfırlaması için sinyal gönder
        safeEmit('reset_chat_session', { targetId: targetId });

        renderLogPlaceholder(document.getElementById('chatLog'), '📭', '// BELLEK SIFIRLANDI //', false);
        showToast("Sohbet geçmişi ve oturum anahtarları sıfırlandı.", 'success');
        playSound('destroy');

        // Yeni el sıkışma için hazırla
        if (typeof initiateEcdhHandshake === 'function' && activeTarget.isOnline) {
            initiateEcdhHandshake(targetId);
        }
    });
}

// === KİŞİ EKLEME MODALI ===

/**
 * Manuel kişi ekleme modal penceresini açar.
 * @function showContactConfigModal
 * @returns {void}
 */
function showContactConfigModal() { playSound('type'); const modal = document.getElementById('contactConfigModal'); document.getElementById('modalTargetId').value = ''; modal.classList.remove('hidden'); }

/**
 * Manuel kişi ekleme modal penceresini kapatır.
 * @function hideContactConfigModal
 * @returns {void}
 */
function hideContactConfigModal() { playSound('type'); document.getElementById('contactConfigModal').classList.add('hidden'); }

// === YENİ AJAN EKLEME (REUSABLE) ===

/**
 * Kişi listesine yeni bir kullanıcı ekler, durum odalarına katılır ve ECDH el sıkışmasını başlatır.
 * @function addContact
 * @param {string} targetId - Eklenecek kullanıcının ID'si.
 * @param {string|null} [username=null] - Kullanıcının görünen adı.
 * @returns {boolean} Yeni kişi eklendiyse true, zaten varsa veya geçersizse false.
 */
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

/**
 * Kullanıcı arama modal penceresini açar ve arama alanını odaklar.
 * @function showSearchModal
 * @returns {void}
 */
function showSearchModal() {
    playSound('type');
    const modal = document.getElementById('searchModal');
    document.getElementById('searchQuery').value = '';
    document.getElementById('searchResultsList').innerHTML = 'Arama yapmak için bir şeyler yazın...';
    modal.classList.remove('hidden');
}

/**
 * Kullanıcı arama modal penceresini kapatır.
 * @function hideSearchModal
 * @returns {void}
 */
function hideSearchModal() {
    playSound('type');
    document.getElementById('searchModal').classList.add('hidden');
}

/**
 * Sunucuya arama terimi göndererek kullanıcıları sorgular ve sonuçları listeler.
 * @function performSearch
 * @returns {void}
 */
function performSearch() {
    const query = document.getElementById('searchQuery').value.trim();
    const resultsList = document.getElementById('searchResultsList');
    if (!query || query.length < 2) {
        resultsList.innerHTML = 'Arama yapmak için en az 2 karakter girin...';
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

/**
 * Karşı tarafa kişi listesine eklendiğini haber verir (bildirim gönderir).
 * @function notifyContactAddition
 * @param {string} targetId - Eklenen kullanıcının ID'si.
 * @returns {void}
 */
function notifyContactAddition(targetId) {
    safeEmit('notify_add_contact', { targetId });
}

/**
 * Başka bir kullanıcıdan gelen bağlantı / arkadaşlık isteği bildirimini modal olarak gösterir.
 * @function showContactRequest
 * @param {Object} data - İstek verisi ({ senderId: string, username: string, avatar: string|null }).
 * @returns {void}
 */
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

/**
 * Bağlantı isteğine verilen yanıtı (kabul/red) sunucuya iletir.
 * @function handleContactRequestResponse
 * @param {boolean} accepted - İstek kabul edildiyse true, reddedildiyse false.
 * @returns {void}
 */
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

/**
 * Gönderdiğimiz bağlantı isteğine karşı tarafın verdiği yanıtı ekranda görüntüler.
 * @function showContactRequestResponse
 * @param {Object} data - Yanıt ({ senderId: string, username: string, avatar: string|null, accepted: boolean }).
 * @returns {void}
 */
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

/**
 * Manuel kişi ekleme modalından girilen ID'yi doğrular, ekler ve hedefi seçer.
 * @function handleContactSubmit
 * @returns {void}
 */
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

/**
 * Aktif hedef kişiye uçtan uca AES-256-GCM ile şifrelenmiş mesaj veya dosya paketi gönderir.
 * Ortak gizli anahtarı doğrular, TTL (kendi kendini imha) süresini ekler ve Socket.IO üzerinden iletir.
 * @async
 * @function sendSecurePacket
 * @returns {Promise<void>}
 */
async function sendSecurePacket() {
    if (!activeTarget) return;
    let sharedSecret = derivedSecrets[activeTarget.id];
    if (!sharedSecret) {
        if (typeof ensureSharedSecret === 'function') {
            await ensureSharedSecret(activeTarget.id);
            sharedSecret = derivedSecrets[activeTarget.id];
        }
    }
    if (!sharedSecret) {
        if (typeof initiateEcdhHandshake === 'function' && activeTarget.isOnline) {
            initiateEcdhHandshake(activeTarget.id);
        }
        playSound('error');
        showToast("Şifreleme anahtarı oluşturuluyor, lütfen birkaç saniye sonra tekrar deneyin...", 'warning');
        return;
    }
    
    
    activeTarget.key = sharedSecret; playSound('type');
    
    const msgInput = document.getElementById('messageInput');
    const rawText = msgInput.value.trim(); const hasFile = activeFileBase64 !== null;
    const ttl = parseInt(document.getElementById('messageTtl').value); 
    if (!rawText && !hasFile) return;
    msgInput.value = '';

    let encryptedText = null; let encryptedFile = null;
    let msgIndex = null; // KDF Ratchet mesaj indeksi
    try {
        // [ECDHE] KDF Ratchet aktifse mesaj bazlı anahtar rotasyonu kullan
        if (typeof hasRatchetSession === 'function' && hasRatchetSession(activeTarget.id)) {
            if (rawText) {
                const result = await encryptWithRatchet(rawText, activeTarget.id);
                if (result) { encryptedText = result.ciphertext; msgIndex = result.messageIndex; }
            }
            if (hasFile) {
                const result = await encryptWithRatchet(activeFileBase64, activeTarget.id);
                if (result) { encryptedFile = result.ciphertext; if (msgIndex === null) msgIndex = result.messageIndex; }
            }
        } else {
            // Geriye uyumluluk: Eski statik anahtar ile şifreleme
            if (rawText) encryptedText = await encryptGCM(rawText, activeTarget.key);
            if (hasFile) encryptedFile = await encryptGCM(activeFileBase64, activeTarget.key);
        }
    } catch (e) { playSound('error'); showToast("Şifreleme hatası oluştu.", 'error'); return; }

    const packetId = crypto.randomUUID().replace(/-/g, '').substring(0, 12).toUpperCase();
    const packet = { 
        id: packetId, 
        senderId: currentUser.userId, 
        targetId: activeTarget.id, 
        textPayload: encryptedText, 
        filePayload: encryptedFile, 
        fileName: activeFileName || null, 
        ttl: ttl > 0 ? ttl : null, 
        timestamp: new Date().getTime(), 
        messageIndex: msgIndex,
        cachedText: rawText || null,
        cachedFile: activeFileBase64 || null
    };
    
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
    
    const wirePacket = {
        id: packet.id,
        senderId: packet.senderId,
        targetId: packet.targetId,
        textPayload: packet.textPayload,
        filePayload: packet.filePayload,
        fileName: packet.fileName,
        ttl: packet.ttl,
        timestamp: packet.timestamp,
        messageIndex: packet.messageIndex
    };

    safeEmit('send_secure_packet', wirePacket, (res) => { 
        if (res && res.queued) showToast("Kişi çevrimdışı, mesaj kuyruğa eklendi.", 'warning');
        else if (res && res.error === "RATE_LIMIT") { playSound('error'); showToast("Çok hızlı mesaj gönderiyorsunuz, lütfen bekleyin.", 'error'); }
    });
    
    const pSize = new Blob([JSON.stringify(wirePacket)]).size;
    document.getElementById('packetSizeDisplay').innerText = `[(${(pSize / 1024).toFixed(1)} KB)]`;
    if (hasFile) clearFileInput();
}

/**
 * Şifreli paketi alıcı veya gönderici ortak gizli anahtarı ile deşifre eder.
 * TTL süresi dolmuşsa mesajı kasadan kaldırır ve null döner.
 * @async
 * @function decryptPacketForDisplay
 * @param {Object} packet - Şifrelenmiş paket verisi ({ id, senderId, targetId, textPayload, filePayload, fileName, ttl, timestamp }).
 * @param {Object} [contactInfo] - Kişi nesnesi bilgisi.
 * @returns {Promise<Object|null>} Çözülmüş mesaj veri nesnesi veya geçersizse/süresi dolmuşsa null.
 */
async function decryptPacketForDisplay(packet, contactInfo) {
    const isMine = packet.senderId === currentUser.userId;
    const peerId = isMine ? packet.targetId : packet.senderId;

    let remainingTtl = null;
    if (packet.ttl) {
        const elapsedSeconds = Math.round((Date.now() - packet.timestamp) / 1000);
        remainingTtl = packet.ttl - elapsedSeconds;
        if (remainingTtl <= 0) {
            await removePacketFromVault(isMine ? packet.targetId : packet.senderId, packet.id);
            return null; 
        }
    }

    const senderLabel = isMine ? 'SEN' : packet.senderId;

    // 1. Kasada daha önce çözülmüş / saklanmış düz metin varsa doğrudan kullan
    if (packet.cachedText !== undefined || packet.cachedFile !== undefined) {
        return { 
            id: packet.id, 
            sender: senderLabel, 
            text: packet.cachedText || null, 
            file: packet.cachedFile || null, 
            fileName: packet.fileName || null, 
            isMine, 
            isError: false, 
            ttl: remainingTtl, 
            timestamp: packet.timestamp 
        };
    }

    let decryptedText = null; let decryptedFile = null; let hasError = false;
    let cryptoKey = derivedSecrets[peerId] || (contactInfo ? contactInfo.key : null);

    if (!cryptoKey && typeof ensureSharedSecret === 'function') {
        await ensureSharedSecret(peerId);
        cryptoKey = derivedSecrets[peerId] || (contactInfo ? contactInfo.key : null);
    }

    if (!cryptoKey || cryptoKey.trim() === '') { 
        hasError = 'no_key'; 
    } else {
        try {
            // [ECDHE] KDF Ratchet: Karşı tarafın mesajı ise ve messageIndex varsa ratchet ile deşifre et
            const useRatchet = !isMine && typeof decryptWithRatchet === 'function' 
                && packet.messageIndex !== null && packet.messageIndex !== undefined
                && hasRatchetSession(peerId);
            
            if (useRatchet) {
                if (packet.textPayload) { 
                    decryptedText = await decryptWithRatchet(packet.textPayload, peerId, packet.messageIndex); 
                }
                if (packet.filePayload) { 
                    const fileIndex = packet.textPayload ? (packet.messageIndex + 1) : packet.messageIndex;
                    decryptedFile = await decryptWithRatchet(packet.filePayload, peerId, fileIndex); 
                }
                // Ratchet başarısız olduysa veya null döndüyse statik anahtar ile fallback dene
                if ((packet.textPayload && !decryptedText) || (packet.filePayload && !decryptedFile)) {
                    if (packet.textPayload && !decryptedText) {
                        decryptedText = await decryptGCM(packet.textPayload, cryptoKey).catch(() => null);
                    }
                    if (packet.filePayload && !decryptedFile) {
                        decryptedFile = await decryptGCM(packet.filePayload, cryptoKey).catch(() => null);
                    }
                }
            } else if (!isMine && packet.messageIndex !== null && packet.messageIndex !== undefined && !hasRatchetSession(peerId)) {
                // [GÜVENLİK FIX] Karşı taraf ratchet oturumuyla şifrelemiş fakat bu tarafta oturum sıfırlanmış / silinmiş
                hasError = 'session_desync';
                if (typeof initiateEcdhHandshake === 'function') {
                    initiateEcdhHandshake(peerId);
                }
                if (typeof safeEmit === 'function') {
                    safeEmit('reset_chat_session', { targetId: peerId });
                }
            } else {
                // Statik anahtar ile deşifreleme
                if (packet.textPayload) { 
                    decryptedText = await decryptGCM(packet.textPayload, cryptoKey); 
                }
                if (packet.filePayload) { 
                    decryptedFile = await decryptGCM(packet.filePayload, cryptoKey); 
                }
            }

            if (packet.textPayload && decryptedText === null) {
                hasError = true;
            }
            if (packet.filePayload) {
                if (!decryptedFile || (!decryptedFile.startsWith("data:image") && !decryptedFile.startsWith("data:application/pdf"))) {
                    hasError = true;
                }
            }

            // Başarıyla çözüldüyse kasada önbelleğe al
            if (!hasError && (decryptedText !== null || decryptedFile !== null)) {
                packet.cachedText = decryptedText;
                packet.cachedFile = decryptedFile;
                savePacketToVault(peerId, packet).catch(() => {});
            }
        } catch (e) { 
            hasError = true; 
        }
    }

    return { id: packet.id, sender: senderLabel, text: decryptedText, file: decryptedFile, fileName: packet.fileName || null, isMine, isError: hasError, ttl: remainingTtl, timestamp: packet.timestamp };
}

/**
 * Alınan yeni şifreli paketi çözer ve geçerliyse sohbet arayüzüne ekler.
 * @async
 * @function processIncomingPacket
 * @param {Object} packet - Gelen şifreli paket nesnesi.
 * @param {Object} [contactInfo] - İlgili kişi bilgileri.
 * @returns {Promise<void>}
 */
async function processIncomingPacket(packet, contactInfo) {
    const data = await decryptPacketForDisplay(packet, contactInfo);
    if (data) appendMessageToUI(data.id, data.sender, data.text, data.file, data.isMine, data.isError, data.ttl, data.timestamp, data.fileName);
}

/**
 * Mesaj paketini hem yerel kasadan siler hem de karşı taraftan silinmesi için geri çekme isteği gönderir.
 * @function revokeMessage
 * @param {string} packetId - Geri çekilecek paketin benzersiz ID'si.
 * @returns {void}
 */
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

/**
 * Sohbet alanı yukarı kaydırıldığında en alta inme butonunu (FAB) görünür kılan dinleyiciyi başlatır.
 * @function initScrollToBottomFab
 * @returns {void}
 */
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

/**
 * Sohbet log alanını pürüzsüzce en aşağıya kaydırır ve okunmamış bildirim noktasını kaldırır.
 * @function scrollChatToBottom
 * @returns {void}
 */
function scrollChatToBottom() {
    const chatLog = document.getElementById('chatLog');
    const dot = document.getElementById('fabNewMsgDot');
    if (chatLog) chatLog.scrollTo({ top: chatLog.scrollHeight, behavior: 'smooth' });
    if (dot) dot.classList.remove('has-new');
    document.getElementById('scrollToBottomBtn')?.classList.remove('visible');
}

// === MESAJ UI RENDERLAMA ===

/**
 * Mesaj metnindeki URL bağlantılarını tespit eder ve güvenli target="_blank" rel="noopener noreferrer" <a> etiketleri olarak DOM'a ekler.
 * @function renderMessageTextWithLinks
 * @param {HTMLElement} container - Bağlantı ve metinlerin ekleneceği taşıyıcı DOM öğesi.
 * @param {string} text - İşlenecek ham mesaj metni.
 * @param {boolean} isMine - Mesajın kullanıcıya ait olup olmadığı (stil belirleme için).
 * @returns {void}
 */
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

/**
 * Sohbet akışında son oluşturulan tarih ayırıcısının etiketi.
 * @type {string|null}
 */
let _lastDateLabel = null;

/**
 * Sohbet akışına yeni bir mesaj baloncuğu, tarih ayırıcısı, dosya/PDF kartı veya resim öğesi ekler.
 * @function appendMessageToUI
 * @param {string} packetId - Mesaj paket ID'si.
 * @param {string} sender - Gönderen kullanıcı adı veya etiketi ('SEN' ya da karşı taraf).
 * @param {string|null} text - Çözülmüş mesaj metni.
 * @param {string|null} fileSrc - Base64 kodlu dosya/resim içeriği.
 * @param {boolean} isMine - Mesajın mevcut kullanıcıya ait olup olmadığı.
 * @param {boolean|string} isError - Hata durumu (ör. 'no_key' veya bozuk bütünlük).
 * @param {number|null} ttl - Kalan TTL süresi (saniye).
 * @param {number} timestamp - Mesaj oluşturulma zaman damgası (ms).
 * @param {string|null} [fileName=null] - Ekli dosyanın orijinal adı.
 * @returns {void}
 */
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
    } else if (isError === 'session_desync') {
        const errDiv = document.createElement('div'); errDiv.className = 'border-l-4 border-amber-500 bg-amber-950/40 p-2 sm:p-3 text-[10px] sm:text-xs text-amber-400 my-1 max-w-[90%] sm:max-w-sm    font-bold tracking-wider'; errDiv.innerText = '[!] UYARI: OTURUM SIFIRLANMIŞ / YENİDEN EL SIKIŞMA BAŞLATILDI.'; msgDiv.appendChild(errDiv);
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
                // [GÜVENLİK FIX] innerHTML yerine güvenli DOM API — dosya adı XSS engellenir
                const iconWrap = document.createElement('div');
                iconWrap.className = 'w-10 h-10 rounded-lg bg-red-500/20 border border-red-500/50 flex items-center justify-center text-red-400 text-xl shrink-0 shadow-inner';
                iconWrap.textContent = '📄';
                cardHeader.appendChild(iconWrap);
                const infoWrap = document.createElement('div');
                infoWrap.className = 'flex flex-col min-w-0 flex-1';
                const nameSpan = document.createElement('span');
                nameSpan.className = 'text-xs text-gray-200 font-semibold truncate';
                nameSpan.title = safeFileName;
                nameSpan.textContent = safeFileName;
                infoWrap.appendChild(nameSpan);
                const sizeSpan = document.createElement('span');
                sizeSpan.className = 'text-[10px] text-gray-400 font-mono tracking-wider';
                sizeSpan.textContent = sizeMB + ' MB • PDF';
                infoWrap.appendChild(sizeSpan);
                cardHeader.appendChild(infoWrap);
                pdfCard.appendChild(cardHeader);

                const cardActions = document.createElement('div');
                cardActions.className = 'flex items-center gap-2 pt-2 border-t border-gray-800/80';

                const downloadBtn = document.createElement('button');
                downloadBtn.type = 'button';
                downloadBtn.className = 'flex-1 py-1.5 px-2 rounded-lg bg-red-500/15 hover:bg-red-500/25 border border-red-500/40 text-red-400 hover:text-red-300 text-[11px] font-bold transition-all flex items-center justify-center gap-1.5 active:scale-95 cursor-pointer';
                downloadBtn.textContent = '📥 İndir';
                downloadBtn.onclick = () => downloadPdf(fileSrc, safeFileName);
                cardActions.appendChild(downloadBtn);

                const viewBtn = document.createElement('button');
                viewBtn.type = 'button';
                viewBtn.className = 'flex-1 py-1.5 px-2 rounded-lg bg-white/5 hover:bg-white/10 border border-gray-700 text-gray-300 hover:text-white text-[11px] font-bold transition-all flex items-center justify-center gap-1.5 active:scale-95 cursor-pointer';
                viewBtn.textContent = '👁 Görüntüle';
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

/**
 * Aktif TTL kendi kendini imha sayaçlarının ve aralıklarının referans tablosu.
 * @type {Object.<string, {interval: number, timeout: number, expiresAt: number, targetUser: string}>}
 */
const _activeTimers = {};

/**
 * Mesaj paketi için kendi kendini imha (TTL) sayacını başlatır.
 * Kalan süreyi arayüzde gösterir, süre bitiminde mesajı DOM'dan ve vault veritabanından kalıcı olarak siler.
 * @function startSelfDestructTimer
 * @param {string} packetId - İmha edilecek paket ID'si.
 * @param {number} duration - Süre (saniye cinsinden).
 * @param {string} targetUser - İlgili sohbet hedef kullanıcısı ID'si.
 * @returns {void}
 */
function startSelfDestructTimer(packetId, duration, targetUser) {
    if (_activeTimers[packetId]) {
        if (_activeTimers[packetId].interval) clearInterval(_activeTimers[packetId].interval);
        if (_activeTimers[packetId].timeout) clearTimeout(_activeTimers[packetId].timeout);
        delete _activeTimers[packetId];
    }
    const expiresAt = Date.now() + (duration * 1000);
    const badge = document.getElementById(`ttl-badge-${packetId}`);

    const destroyMessage = () => {
        if (_activeTimers[packetId]) {
            if (_activeTimers[packetId].interval) clearInterval(_activeTimers[packetId].interval);
            if (_activeTimers[packetId].timeout) clearTimeout(_activeTimers[packetId].timeout);
            delete _activeTimers[packetId];
        }
        const msgElement = document.getElementById(`msg-${packetId}`);
        if (msgElement) {
            fadeOutAndRemoveElement(msgElement, () => removePacketFromVault(targetUser, packetId));
        } else {
            removePacketFromVault(targetUser, packetId);
        }
    };

    // [GÜVENLİK FIX - SEC-18] Kesin süre bitimi için garantili timeout
    const timeout = setTimeout(destroyMessage, duration * 1000);

    const interval = setInterval(() => {
        const remainingMs = expiresAt - Date.now();
        const secondsLeft = Math.max(0, Math.ceil(remainingMs / 1000));
        if (badge) badge.innerText = `TTL:${secondsLeft}s`;
        if (remainingMs <= 0) {
            destroyMessage();
        }
    }, 1000);

    _activeTimers[packetId] = { interval, timeout, expiresAt, targetUser };
}

// [GÜVENLİK FIX - SEC-18] Sekme arka plandan döndüğünde süresi dolmuş tüm TTL mesajlarını derhal imha et
document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') {
        const now = Date.now();
        for (const packetId of Object.keys(_activeTimers)) {
            const timerObj = _activeTimers[packetId];
            if (timerObj && timerObj.expiresAt <= now) {
                if (timerObj.interval) clearInterval(timerObj.interval);
                if (timerObj.timeout) clearTimeout(timerObj.timeout);
                delete _activeTimers[packetId];
                const msgElement = document.getElementById(`msg-${packetId}`);
                if (msgElement) fadeOutAndRemoveElement(msgElement, () => removePacketFromVault(timerObj.targetUser, packetId));
                else removePacketFromVault(timerObj.targetUser, packetId);
            }
        }
    }
});

// === YARDIMCI UI FONKSİYONLARI ===

/**
 * Kullanıcı arayüzü yazı tipi ölçeğini (CSS değişkeni --font-scale) artırır veya azaltır.
 * @function changeFontSize
 * @param {number} delta - Değişim miktarı (ör. +0.1 veya -0.1).
 * @returns {void}
 */
function changeFontSize(delta) {
    currentScale = Math.max(0.8, Math.min(1.8, currentScale + delta));
    document.documentElement.style.setProperty('--font-scale', currentScale);
    const fontDisplay = document.getElementById('fontScaleDisplay');
    if (fontDisplay) fontDisplay.innerText = Math.round(currentScale * 100) + '%';
    playSound('type');
}

/**
 * Oturum açmış kullanıcının benzersiz ID'sini panoya kopyalar.
 * Panoya erişim izni yoksa geçici bir input öğesi oluşturarak kopyalama gerçekleştirir.
 * @function copyMyId
 * @returns {void}
 */
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

/**
 * Profil panelinde aktif hedefin paylaşılan simetrik anahtarının görünürlüğünü açıp kapatır (gizler/gösterir).
 * @function toggleKeyReveal
 * @returns {void}
 */
function toggleKeyReveal() {
    if (!activeTarget) return; playSound('type');
    const keyText = document.getElementById('profileKey'); 
    if (keyText) {
        keyRevealed = !keyRevealed;
        keyText.innerText = keyRevealed ? activeTarget.key : "••••••••••••••••";
    }
}

// === DOSYA VE BELGE İŞLEMLERİ (RESİM & PDF) ===

/**
 * Base64 kodlu veri URI dizesini ikili Blob nesnesine dönüştürür.
 * @function base64ToBlob
 * @param {string} base64Data - Data URI formatındaki base64 dizesi.
 * @param {string} [contentType='application/pdf'] - Blob MIME türü.
 * @returns {Blob} İkili veri Blob nesnesi.
 */
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

/**
 * Base64 formatındaki PDF belgesini indirilebilir dosya bağlantısı oluşturarak istemciye kaydeder.
 * @function downloadPdf
 * @param {string} fileSrc - PDF verisinin base64 Data URI dizesi.
 * @param {string} fileName - İndirilecek dosyanın adı.
 * @returns {void}
 */
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

/**
 * Base64 formatındaki PDF belgesini yeni bir tarayıcı sekmesinde güvenli şekilde açar.
 * @function openPdfViewer
 * @param {string} fileSrc - PDF verisinin base64 Data URI dizesi.
 * @param {string} fileName - PDF belge adı.
 * @returns {void}
 */
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

/**
 * Kullanıcı dosya seçtiğinde boyutu (maksimum 5 MB) ve türü (PDF veya resim) doğrular.
 * Resim ise canvas üzerinde yeniden boyutlandırarak, PDF ise FileReader ile okuyarak aktarır.
 * @function handleFileSelect
 * @param {HTMLInputElement} input - Dosya seçim input öğesi.
 * @returns {void}
 */
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

/**
 * Seçili dosya önizlemesini ve aktif dosya değişkenlerini sıfırlar.
 * @function clearFileInput
 * @returns {void}
 */
function clearFileInput() { 
    playSound('error'); 
    activeFileBase64 = null; 
    activeFileName = null;
    document.getElementById('previewContainer').classList.add('hidden'); 
    document.getElementById('fileInput').value = ''; 
}

/**
 * Sohbet akışındaki alınan resimlerden birini tam boyutlu modalda görüntüler.
 * @function showImageModal
 * @param {number} index - receivedImages dizisindeki resim dizin numarası.
 * @returns {void}
 */
function showImageModal(index) { 
    const modal = document.getElementById('imageModal'); 
    const modalImg = document.getElementById('modalImage'); 
    if (window.receivedImages[index]) { 
        playSound('success'); 
        modalImg.src = window.receivedImages[index]; 
        modal.classList.remove('hidden'); 
    } 
}

/**
 * Tam boyutlu resim görüntüleme modalını gizler.
 * @function hideImageModal
 * @returns {void}
 */
function hideImageModal() { 
    playSound('type'); 
    document.getElementById('imageModal').classList.add('hidden'); 
}

// === AYARLAR VE PROFİL ===

/**
 * Ayarlar ve profil yapılandırma modalını görüntüler, profil sekmesini varsayılan olarak açar.
 * @function showSettingsModal
 * @returns {void}
 */
function showSettingsModal() { 
    playSound('type'); 
    document.getElementById('settingsModal').classList.remove('hidden'); 
    switchSettingsTab('profile');
    if (currentUser && currentUser.avatar) {
        document.getElementById('settingsAvatarPreview').innerHTML = `<img src="${currentUser.avatar}" class="w-full h-full object-cover">`;
    }
}

/**
 * Ayarlar modalını gizler.
 * @function hideSettingsModal
 * @returns {void}
 */
function hideSettingsModal() { playSound('type'); document.getElementById('settingsModal').classList.add('hidden'); }

/**
 * Ayarlar penceresinde 'profile' (profil) ve 'security' (güvenlik) sekmeleri arasında geçiş yapar.
 * @function switchSettingsTab
 * @param {'profile'|'security'} tab - Aktifleştirilecek sekme adı.
 * @returns {void}
 */
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

/**
 * Yüklenmek üzere seçilmiş ancak henüz kaydedilmemiş geçici avatar base64 verisi.
 * @type {string|null}
 */
let pendingAvatarBase64 = null;

/**
 * Ayarlar modalında yeni avatar resmi seçildiğinde resmi okur, kare formatta kırpar ve önizleme sunar.
 * @function handleSettingsAvatarSelect
 * @param {HTMLInputElement} input - Avatar dosya seçim input öğesi.
 * @returns {void}
 */
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

/**
 * Bekleyen avatar seçimini sunucuya ('update_avatar') göndererek profili günceller.
 * @function saveProfileSettings
 * @returns {void}
 */
function saveProfileSettings() {
    if (!pendingAvatarBase64) return;
    safeEmit('update_avatar', pendingAvatarBase64, (res) => {
        if (res && res.success) {
            playSound('success'); currentUser.avatar = pendingAvatarBase64; pendingAvatarBase64 = null;
            updateMyAvatarUI(); showToast("Profil fotoğrafı güncellendi.", 'success'); hideSettingsModal();
        } else { playSound('error'); showToast(`HATA: ${res ? res.message : 'Güncellenemedi'}`, 'error'); }
    });
}

/**
 * Kullanıcının şifresini değiştirmek için eski ve yeni şifreleri sunucuya iletir.
 * @function changeUserPassword
 * @returns {void}
 */
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

/**
 * Kullanıcının hesabını ve yerel veritabanındaki (IndexedDB / localStorage) tüm verileri kalıcı olarak siler.
 * @function deleteUserAccount
 * @returns {void}
 */
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

/**
 * Ekran genişliğine ve aktif hedef seçimine bağlı olarak mobil/masaüstü panel görünürlüklerini günceller.
 * @function updateMobileLayout
 * @returns {void}
 */
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

/**
 * Mobil görünümde sohbet alanından kişi listesi kenar çubuğuna geri döner ve hedefi sıfırlar.
 * @function mobileGoBack
 * @returns {void}
 */
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

/**
 * Kimlik doğrulama formları (giriş/kayıt butonları, sekmeler, submit, hata temizleme) olay dinleyicilerini bağlar.
 * @function initAuthEvents
 * @returns {void}
 */
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

/**
 * Giriş ekranındaki özel sunucu IP/URL giriş kutusunun görünürlüğünü açıp kapatır.
 * @function toggleServerConfig
 * @returns {void}
 */
function toggleServerConfig() {
    const input = document.getElementById('serverIp');
    if (input) {
        input.classList.toggle('hidden');
        if (!input.classList.contains('hidden')) {
            input.focus();
        }
    }
}

// [GÜVENLİK FIX - SEC-13] Tüm DOM Olay Bağlayıcıları (Inline Event Handler Yerine CSP Uyumlu addEventListener)
/**
 * Uygulama genelindeki tüm DOM tıklama, arama, klavye ve dosya olay dinleyicilerini güvenli şekilde bağlar (CSP uyumlu).
 * @function initAppEvents
 * @returns {void}
 */
function initAppEvents() {
    const bindClick = (id, fn) => {
        const el = document.getElementById(id);
        if (el) el.addEventListener('click', fn);
    };

    bindClick('serverIpToggleBtn', toggleServerConfig);
    bindClick('myProfileAvatarContainer', showSettingsModal);
    bindClick('profileCopyIdContainer', copyMyId);
    bindClick('showContactConfigBtn', showContactConfigModal);
    bindClick('showSearchModalBtn', showSearchModal);
    bindClick('showSettingsBtn', showSettingsModal);
    bindClick('disconnectBtn', disconnectFromServer);
    bindClick('chatMobileBackBtn', mobileGoBack);
    bindClick('clearChatBtn', clearActiveChat);
    bindClick('scrollToBottomBtn', scrollChatToBottom);
    bindClick('clearFileInputBtn', clearFileInput);
    bindClick('sendPacketBtn', sendSecurePacket);
    bindClick('closeSettingsBtn', hideSettingsModal);
    bindClick('tabProfileBtn', () => switchSettingsTab('profile'));
    bindClick('tabSecurityBtn', () => switchSettingsTab('security'));
    bindClick('saveProfileBtn', saveProfileSettings);
    bindClick('changePasswordBtn', changeUserPassword);
    bindClick('deleteAccountBtn', deleteUserAccount);
    bindClick('closeContactConfigBtn', hideContactConfigModal);
    bindClick('cancelContactConfigBtn', hideContactConfigModal);
    bindClick('submitContactConfigBtn', handleContactSubmit);
    bindClick('closeSearchModalBtn', hideSearchModal);
    bindClick('crModalRejectBtn', () => handleContactRequestResponse(false));
    bindClick('crModalAcceptBtn', () => handleContactRequestResponse(true));
    bindClick('closeImageModalBtn', hideImageModal);
    bindClick('reconnectBtn', forceReconnect);

    const contactSearch = document.getElementById('contactSearchInput');
    if (contactSearch) {
        contactSearch.addEventListener('input', (e) => filterContactsList(e.target.value));
    }

    const searchQueryInput = document.getElementById('searchQuery');
    if (searchQueryInput) {
        searchQueryInput.addEventListener('input', performSearch);
    }

    const fileInputEl = document.getElementById('fileInput');
    if (fileInputEl) {
        fileInputEl.addEventListener('change', (e) => handleFileSelect(e.target));
    }

    const settingsAvatarEl = document.getElementById('settingsAvatarInput');
    if (settingsAvatarEl) {
        settingsAvatarEl.addEventListener('change', (e) => handleSettingsAvatarSelect(e.target));
    }

    const msgInput = document.getElementById('messageInput');
    if (msgInput) {
        msgInput.addEventListener('keydown', (e) => {
            if (e.key === 'Enter') sendSecurePacket();
        });
    }

    const imageModalEl = document.getElementById('imageModal');
    if (imageModalEl) {
        imageModalEl.addEventListener('click', hideImageModal);
    }

    const modalImgEl = document.getElementById('modalImage');
    if (modalImgEl) {
        modalImgEl.addEventListener('click', (e) => e.stopPropagation());
    }
}

/**
 * Sayfa yüklendiğinde sunucu URL'sini yapılandırmadan veya geçerli kaynaktan otomatik doldurur, olayları başlatır ve otomatik giriş dener.
 * @function autoFillServerUrl
 * @returns {void}
 */
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
    initAppEvents();
    setTimeout(autoLoginAttempt, 100);
}

if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', autoFillServerUrl);
} else {
    autoFillServerUrl();
}

