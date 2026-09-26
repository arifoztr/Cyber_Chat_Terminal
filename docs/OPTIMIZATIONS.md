# OPTİMİZASYON VE GÜVENLİK KILAVUZU (OPTIMIZATIONS)

**Sürüm:** v10 (Cyber-HUD Edition — Production Ready)  
**Son Güncelleme:** 2026-09-26  

---

## 📌 Temel Güvenlik İlkeleri (Sıfır-Güven / Zero-Knowledge)

### 1. Sıfır-Bilgi Backend (Zero-Knowledge Signaling)
Backend sunucusu (`src/server.js`, `src/socket.js`) yalnızca signaling ve relay görevi görür.
- Sunucu mantığında `textPayload` veya `filePayload` içerikleri **asla** çözülmez, parse edilmez, incelenmez veya loglanmaz.
- Şifreli paketler sunucu belleğinde veya veritabanında yalnızca alıcı çevrimiçi olana kadar tutulur ve teslim edildikten/süresi dolduktan sonra silinir.

### 2. İstemci Tarafı Depolama İzolasyonu
- Sohbet geçmişi, kişi listesi ve türetilmiş simetrik oturum anahtarları (ECDH shared secrets) **yalnızca** tarayıcının IndexedDB kasasında (`cyber_vault_db`) saklanır.
- Kriptografik anahtarlar veya şifresi çözülmüş metinler **asla** sunucuya iletilmez.

### 3. Standart Web Crypto API
- Tüm şifreleme ve anahtar türetme işlemleri W3C standartlarında `window.crypto.subtle` API'si üzerinden AES-256-GCM, ECDH (P-256) ve PBKDF2 ile gerçekleştirilir.

---

## 🔒 Güvenlik Sertleştirmeleri (Security Hardening)

### 1. CSWSH (Cross-Site WebSocket Hijacking) Savunması
- `src/server.js` içerisindeki `isOriginAllowed` fonksiyonu, Socket.IO el sıkışması sırasında gelen `Origin` başlığını doğrular.
- Tarayıcı harici yetkisiz kaynaklardan veya sahte sitelerden gelen WebSocket bağlantı istekleri sunucu düzeyinde anında reddedilir.

### 2. Sıkı HTTP Güvenlik Başlıkları & CSP
- `Content-Security-Policy`: `default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; connect-src 'self' ...`
- `Strict-Transport-Security` (HSTS): 1 yıl zorunlu HTTPS (alt alan adları dahil).
- `X-Content-Type-Options`: `nosniff`.
- `X-Frame-Options`: `DENY` (Clickjacking saldırılarına karşı tam koruma).
- `X-XSS-Protection`: `1; mode=block`.

### 3. Inline Olay Dinleyicilerinin Temizlenmesi (`SEC-13`)
- CSP kurallarına tam uyum sağlamak için HTML içerisindeki tüm `onclick`, `onsubmit` gibi inline nitelikler kaldırılmış; [public/ui.js](file:///c:/Users/Arifo/OneDrive/Masa%C3%BCst%C3%BC/cyber/public/ui.js) içerisinde `initAppEvents()` ve `initAuthEvents()` fonksiyonları aracılığıyla güvenli `addEventListener` yapısına geçirilmiştir.

### 4. Güvenli DOM API'si ve Dosya XSS Koruması
- Mesaj akışında gelen dosya adları ve bağlantılar asla `innerHTML` ile yazdırılmaz.
- `renderMessageTextWithLinks` fonksiyonu ve PDF/resim kartları `document.createElement` ve `textContent` ile oluşturulur; böylece dosya adı enjeksiyonu kaynaklı XSS açıkları engellenmiştir.

### 5. Kesin TTL Zaman Aşımı ve Sekme Dönüş Kontrolü (`SEC-18`)
- Kendi kendini imha eden (TTL) mesajlar hem `setTimeout` hem de `setInterval` ile garantiye alınmıştır.
- Tarayıcı sekmesi arka plana atıldığında timer gecikmelerinden dolayı süresi dolan mesajların ekranda kalmaması için `document.addEventListener('visibilitychange')` dinleyicisi eklenmiş; sekme tekrar aktif olduğunda süresi biten tüm mesajlar DOM ve IndexedDB'den anında silinmektedir.

### 6. BOLA / IDOR Savunması (`revoke_packet`)
- Mesaj iptal etme / geri çekme işleminde istemciden gelen `senderId` parametresi sunucu tarafında dikkate alınmaz. Sunucu, işlemi gerçekleştiren soketin doğrulanmış oturum kimliğini (`socket.user.userId`) zorunlu kılar. Böylece kullanıcıların başkasının mesajını silmesi engellenir.

### 7. Güvenilir IP Tespiti ve Spoofing Savunması
- `getClientIp` fonksiyonu, ters vekiller (Cloudflare, yerel proxy) haricinde sahte `x-forwarded-for` başlıklarını yok sayar ve doğrudan soket soket adresi (`socket.handshake.address`) üzerinden güvenilir IP doğrulaması yapar.

---

## ⚡ İstek Sınırlandırma (Rate Limiting)

DDoS ve brute-force saldırılarına karşı IP bazlı dinamik hız sınırları:

| İşlem (Action) | İzin Verilen Limit | Zaman Penceresi |
|----------------|-------------------|-----------------|
| `register` | 3 istek | 60 saniye |
| `login` | 5 istek | 60 saniye |
| `send_secure_packet` | 60 paket | 60 saniye |
| `ecdh_offer` / `ecdh_answer` | 10 istek | 60 saniye |
| `get_public_key` | 60 istek | 60 saniye |
| `search_users` | 30 istek | 60 saniye |
| `update_avatar` | 10 istek | 60 saniye |
| `change_password` | 5 istek | 60 saniye |
| `delete_account` | 3 istek | 60 saniye |
| `revoke_packet` | 30 istek | 60 saniye |

---

## 🗄️ Veritabanı ve Çevrimdışı Kuyruk Mimarisi

- **Hibrit Motor:** SQLite3 (WAL modu) veya Cloud Turso (`@libsql/client`).
- **Debounced / Eşzamanlı Kilit:** Veritabanı yazma operasyonları bellek içi önbellek (`cache`) ve `withLock` asenkron eşzamanlama kilidiyle koordine edilir.
- **Otomatik Çöp Toplayıcı (Garbage Collector):** Her saat başı çalışarak süresi dolmuş veya 7 günden eski teslim edilmemiş çevrimdışı paketleri temizler.

---

## 🖥️ Masaüstü Güvenliği (Electron Isolation)

- `nodeIntegration: false`, `contextIsolation: true`, `sandbox: true`.
- Renderer süreci Node.js API'lerine doğrudan erişemez; yalnızca `preload.js` üzerinden sınırlandırılmış güvenli kanallara erişebilir.
- Dış bağlantılar `shell.openExternal` ile sistem varsayılan tarayıcısında açılır; pencere içi yetkisiz yönlendirmeler engellenir.

---

**Son Güncelleme:** 2026-09-26