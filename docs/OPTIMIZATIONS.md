# OPTİMİZASYON VE GÜVENLİK KILAVUZU (OPTIMIZATIONS)

**Sürüm:** v1.0 (Deneysel / Portfolio Sürümü)  
**Son Güncelleme:** 2026-10-21  

> [!WARNING]
> **Eğitim ve Portfolyo Uyarısı:** Bu proje bağımsız bir kriptografik güvenlik denetiminden geçmemiştir. Aşağıdaki güvenlik mekanizmaları eğitim ve mimari demonstrasyon amaçlıdır; gerçek hassas konuşmalarda kullanılmamalıdır.

---

## 📌 Temel Güvenlik İlkeleri ve Tehdit Modeli

### 1. Kör İletim Sunucusu (Blind Relay / Content-Oblivious)
Backend sunucusu (`src/server.js`, `src/socket.js`) yalnızca signaling ve paket iletim (relay) görevi görür.
- **İçerik Körlüğü:** Sunucu katmanında `textPayload` veya `filePayload` içerikleri **asla** çözülmez, parse edilmez, incelenmez veya loglanmaz. Şifreleme/çözme yalnızca uç noktalarda (istemcilerde) gerçekleşir.
- **Metadata Sınırı:** Sunucu mesaj içeriğini göremez; ancak **iletişim üst verileri (metadata)** — hangi kullanıcının (Ajan ID) hangi hedefle ne zaman iletişime geçtiği, IP adresi ve paket boyutu — sunucu tarafından bilinir. Tor / Onion yönlendirmesi veya cover-traffic mekanizmaları bulunmadığından metadata gizliliği garanti edilmez.
- Şifreli paketler sunucu belleğinde veya veritabanında yalnızca alıcı çevrimdışı olduğunda geçici olarak tutulur (7 günlük GC ve teslim sonrası silinme).

### 2. İstemci Tarafı Depolama İzolasyonu
- Sohbet geçmişi, kişi listesi ve oturum durumları **yalnızca** istemcinin IndexedDB kasasında (`cyber_vault_db`) saklanır.
- Kriptografik anahtarlar veya şifresi çözülmüş ham metinler **asla** sunucuya iletilmez.

### 3. Standart Web Crypto API, ECDHE ve KDF Ratchet
- Tüm şifreleme ve anahtar türetme işlemleri W3C standartlarında `window.crypto.subtle` API'si üzerinden gerçekleştirilir.
- **ECDHE (P-256):** Oturum başına tek kullanımlık geçici anahtar çiftleri üretilerek **İleriye Dönük Gizlilik (Forward Secrecy - PFS)** sağlanır; el sıkışma sonrası geçici özel anahtar referansı silinir.
- **KDF Ratchet Zinciri (HKDF-SHA256):** Her tekil ileti için tek yönlü HKDF zinciri ile tek kullanımlık `messageKey` türetilir. Bu mekanizma geçmiş mesajların korunmasını (Forward Secrecy) garanti eder.
  - *Post-Compromise Security (PCS) Ayrımı:* Mevcut mimaride periyodik Diffie-Hellman ratchet (Double Ratchet) yer almadığından, bir saldırgan mevcut zincir durumunu ele geçirirse yeni bir el sıkışma olana kadar sonraki mesajları da türetebilir. Gerçek PCS için gelecekte periyodik DH ratchet entegrasyonu planlanmaktadır.
- **Dışa Aktarılamaz Anahtarlar (`extractable: false`):** Kriptografik özel anahtarlar Web Crypto katmanında kilitlenir; doğrudan JS katmanından JWK/raw olarak dışa aktarılması engellenir.
- **JavaScript Bellek Sıfırlama (`fill(0)`) Sınırları:** Ara bayt dizileri `Uint8Array.fill(0)` ile sıfırlanmaya çalışılır. Ancak V8 motoru ve otomatik çöp toplayıcı (Garbage Collector) nedeniyle RAM'de geçici kopya sayfaları kalabilir. Bu nedenle `fill(0)` C/Rust düzeyinde kesin bir zeroization (`explicit_bzero`) değil, "en iyi çaba" (best-effort) savunma derinliği adımı olarak kabul edilmelidir.
- **İşletim Sistemi Kasası (Electron safeStorage):** Masaüstü istemcisinde IndexedDB anahtarları ve oturum belirteçleri Windows DPAPI, macOS Keychain veya Linux Secret Service ile işletim sistemi düzeyinde şifrelenir.

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
- `X-XSS-Protection`: `0` (Modern tarayıcı standardı: Eski hatalı XSS filtresi kapatılır, korumayı CSP devralır).

### 3. Inline Olay Dinleyicilerinin Temizlenmesi (`SEC-13`)
- CSP kurallarına tam uyum sağlamak için HTML içerisindeki tüm `onclick`, `onsubmit` gibi inline nitelikler kaldırılmış; `public/ui.js` içerisinde `initAppEvents()` ve `initAuthEvents()` fonksiyonları aracılığıyla güvenli `addEventListener` yapısına geçirilmiştir.

### 4. Güvenli DOM API'si ve Dosya XSS Koruması
- Mesaj akışında gelen dosya adları ve bağlantılar asla `innerHTML` ile yazdırılmaz.
- `renderMessageTextWithLinks` fonksiyonu ve PDF/resim kartları `document.createElement` ve `textContent` ile oluşturulur; böylece dosya adı enjeksiyonu kaynaklı XSS açıkları engellenmiştir.

### 5. Kesin TTL Zaman Aşımı ve Sekme Dönüş Kontrolü (`SEC-18`)
- Kendi kendini imha eden (TTL) mesajlar hem `setTimeout` hem de `setInterval` ile garantiye alınmıştır.
- Tarayıcı sekmesi arka plana atıldığında timer gecikmelerinden dolayı süresi dolan mesajların ekranda kalmaması için `document.addEventListener('visibilitychange')` dinleyicisi eklenmiş; sekme tekrar aktif olduğunda süresi biten tüm mesajlar DOM ve IndexedDB'den anında silinmektedir.

### 6. BOLA / IDOR Savunması (`revoke_packet`)
- Mesaj iptal etme / geri çekme işleminde istemciden gelen `senderId` parametresi sunucu tarafında dikkate alınmaz. Sunucu, işlemi gerçekleştiren soketin doğrulanmış oturum kimliğini (`socket.user.userId`) zorunlu kılar. Böylece kullanıcıların başkasının mesajını silmesi engellenir.

### 7. Güvenilir IP Tespiti ve Spoofing Savunması
- `getClientIp` fonksiyonu, ters vekiller (Cloudflare, yerel proxy) haricinde sahte `x-forwarded-for` başlıklarını yok sayar ve doğrudan soket adresi (`socket.handshake.address`) üzerinden güvenilir IP doğrulaması yapar.

---

## ⚡ İstek Sınırlandırma (Rate Limiting)

DDoS ve brute-force saldırılarına karşı IP bazlı dinamik hız sınırları:

| İşlem (Action) | İzin Verilen Limit | Zaman Penceresi |
|----------------|-------------------|-----------------|
| HTTP Genel İstekler | 120 istek | 60 saniye |
| `register` | 20 istek | 60 saniye |
| `login` | 30 istek (Maks. 5 başarısız deneme) | 60 saniye |
| `verify_session` | 30 istek | 60 saniye |
| `send_secure_packet` | 60 paket | 60 saniye |
| `ecdh_offer` / `ecdh_answer` | 10 istek | 60 saniye |
| `get_public_key` | 60 istek | 60 saniye |
| `get_profiles` | 60 istek (Maks. 50 ID/sorgu) | 60 saniye |
| `check_node_status` / `statuses` | 60 istek | 60 saniye |
| `search_users` | 30 istek | 60 saniye |
| `notify_add_contact` / `respond` | 30 istek | 60 saniye |
| `reset_chat_session` | 30 istek | 60 saniye |
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

**Son Güncelleme:** 2026-10-21
