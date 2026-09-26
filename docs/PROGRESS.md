# PROJE İLERLEME DURUMU (PROGRESS & ROADMAP)

**Mevcut Sürüm:** v10 (Cyber-HUD Edition — Production Ready)  
**Son Güncelleme:** 2026-09-26  
**Durum:** Kararlı (Stable), 145/145 Test Başarılı (%94+ Kod Kapsamı), Tam JSDoc Dökümante.

---

## 🟢 TAMAMLANAN FAZLAR

### FAZ 1 — Temel Güvenlik ve Kimlik Doğrulama ✅
* **[x] JWT Oturum Güvenliği:** Bağımsız HMAC-SHA256 imzalı JWT oturum yönetimi, güvenli fallback ve geçersiz kılma (`revokeToken`).
* **[x] İstek Hız Sınırlandırması (Rate Limiting):** IP bazlı dinamik rate limiter (`login`, `register`, `send_secure_packet`, `search`, `delete_account` vb.).
* **[x] CSWSH & Güvenlik Başlıkları:** Cross-Site WebSocket Hijacking koruması (`isOriginAllowed`), HSTS, CSP (inline handler'sız), X-Frame-Options.
* **[x] Sahte IP (Spoofing) Koruması:** `getClientIp` ile yalnızca güvenilen ağ/ters vekil başlıklarına güvenilmesi.

### FAZ 2 — Veritabanı ve Çevrimdışı İletişim ✅
* **[x] Hibrit Veritabanı:** Yerel SQLite3 (WAL modu) veya Cloud Turso (`@libsql/client`) entegrasyonu.
* **[x] Asenkron Kilit ve Önbellek:** Veri bütünlüğünü koruyan `withLock` asenkron eşzamanlama kilidi ve bellek içi hızlı önbellek.
* **[x] Çevrimdışı Mesaj Kuyruğu:** Alıcının çevrimdışı olduğu durumlarda şifreli mesajların sunucuda güvenle kuyruğa alınması ve bağlantı kurulduğunda iletilmesi.
* **[x] Otomatik Çöp Toplayıcı (Garbage Collector):** 7 günden eski veya süresi dolan paketlerin otomatik imhası.

### FAZ 3 — Kriptografik Yapı ve İmha Protokolleri ✅
* **[x] Uçtan Uca Şifreleme (E2EE):** İstemci tarafında `window.crypto.subtle` ile AES-256-GCM veri şifreleme/deşifreleme.
* **[x] ECDH Anahtar Takası:** İstemciler arasında P-256 eğrisi üzerinden asenkron paylaşılan gizli anahtar (Shared Secret) türetimi.
* **[x] Parmak İzi & Güvenlik Numarası:** İki tarafın iletişimini doğrulayan SHA-256 Safety Number / Parmak izi üretimi.
* **[x] Geri Çekme (Revoke) Protokolü:** Gönderilen mesajların hem yerel kasadan hem karşı taraftan kalıcı olarak silinmesi (BOLA/IDOR korumalı).
* **[x] Kendi Kendini İmha (TTL):** Zaman ayarlı mesajlar ve sekme arka plandayken süresi dolan paketlerin anında imha edilmesi (`visibilitychange` - SEC-18).

### FAZ 4 — Kullanıcı Deneyimi, Medya ve Profil Yönetimi ✅
* **[x] Profil ve Avatar:** Canvas ile istemci tarafında kırpılan ve sıkıştırılan profil fotoğrafı yönetimi.
* **[x] Şifre ve Hesap Yönetimi:** Doğrulanmış eski şifre ile şifre güncelleme ve kalıcı hesap silme (`delete_account`).
* **[x] Medya ve Dosya Paylaşımı:** 5 MB'a kadar resim (otomatik optimize) ve PDF belgelerinin şifreli aktarımı, indirilmesi ve görüntülenmesi.
* **[x] Güvenli DOM Renderlama:** Dosya adları ve mesaj linklerinin XSS korumalı güvenli DOM API'leri ile oluşturulması.
* **[x] Ses Efektleri:** Web Audio API sentezleyici ile üretilen fütüristik siber ses bildirimleri.
* **[x] Duyarlı HUD Arayüzü:** Mobil ve masaüstü ekran boyutlarına tam uyumlu dinamik terminal arayüzü.

### FAZ 5 — Test, Masaüstü ve Dökümantasyon ✅
* **[x] Kapsamlı Test Paketi:** Vitest ile 6 test dosyasında **145/145 geçen test**, %94+ kod kapsamı (`npm.cmd test`).
* **[x] Masaüstü Uygulaması (Electron):** Güvenli BrowserWindow, ContextBridge preload API, izole sandbox (`npm run desktop:start`).
* **[x] Standart JSDoc Dökümantasyonu:** Tüm backend, client ve Electron modüllerinin Türkçe JSDoc ile etiketlenmesi.
* **[x] Otomatik Dökümantasyon Derlemesi:** `jsdoc.json` ve `npm run docs` ile `docs/api` altında zengin HTML döküman üretimi.

---

## 🟡 GELECEK YOL HARİTASI (PLANLANAN ÖZELLİKLER)

* **[ ] WebRTC Uçtan Uca Sesli / Görüntülü Arama:** Signaling altyapısını kullanarak doğrudan P2P şifreli sesli iletişim.
* **[ ] Çoklu Kullanıcı Şifreli Grup Odaları:** Grup üyeleri arasında eşzamanlı anahtar dağıtımı (Group E2EE / MLS tabanlı).
* **[ ] Çoklu Cihaz Senkronizasyonu:** Kullanıcının birden fazla cihazındaki IndexedDB kasaları arasında QR kod / parola ile güvenli anahtar aktarımı.
* **[ ] İletildi / Okundu Bilgisi (Delivery Receipts):** Mesajların karşı tarafa ulaştığını ve okunduğunu gösteren kriptografik onay sinyalleri.

---

**Son Güncelleme:** 2026-09-26  
**Geliştirici:** Arif8054