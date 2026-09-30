# AGENTS.md – Siber E2EE Sohbet Terminali (Developer & AI Agent Kılavuzu)

## 📌 Proje Özeti
Bu proje, uçtan uca şifreli (E2EE) bir P2P sohbet terminalidir. İstemciler (web tarayıcıları ve Electron masaüstü uygulaması) arasında ECDH (P-256) ile asenkron anahtar takası yapılır; tüm mesajlar ve dosyalar (resim, PDF) AES-GCM-256 ile şifrelenir. Sunucu yalnızca signaling ve relay görevi görür; şifreli içerikleri asla çözemez, inceleyemez veya saklayamaz.

Arayüz; modern siber karanlık terminal estetiğinde tasarlanmış olup TTL ile kendini imha eden mesajlar, dosya/belge paylaşımı, çevrimdışı kuyruklama, parmak izi (Safety Number) doğrulaması, ses efektleri ve tamamen istemci tarafında saklanan IndexedDB şifreli kasası içerir.

---

## 🧰 Teknoloji Yığını

| Alan | Teknoloji |
|------|-----------|
| **Frontend** | Vanilla JavaScript (ES6+), Tailwind CSS, Socket.IO Client |
| **Masaüstü (Desktop)** | Electron, ContextBridge API (İzole Preload, Sandbox) |
| **Backend** | Node.js, Express, Socket.IO Server |
| **Şifreleme (E2EE)** | Web Crypto API (`window.crypto.subtle`): AES-256-GCM, ECDH (P-256), SHA-256, PBKDF2 |
| **Kimlik Doğrulama** | Bağımsız JWT (HMAC-SHA256) + bcrypt şifreleme |
| **Veritabanı** | Hibrit: Yerel SQLite3 (WAL modu) veya Cloud Turso (`@libsql/client`) |
| **İstemci Depolama** | IndexedDB (Kasa / Vault) + localStorage yedekleme/taşıma |
| **Test Altyapısı** | Vitest, V8 Coverage (173 Test, %95+ kod kapsamı) |
| **Dökümantasyon** | JSDoc 3, Markdown Eklentisi (`npm run docs`) |
| **Tipografi** | Inter, JetBrains Mono |

---

## 📁 Klasör ve Dosya Yapısı

```text
/
├── electron/
│   ├── main.js                  # Electron ana süreç yaşam döngüsü ve IPC güvenliği
│   └── preload.js               # ContextBridge ile izole API köprüsü (electronAPI)
├── public/
│   ├── config.js                # Dinamik runtime istemci yapılandırması (BACKEND_URL)
│   ├── crypto.js                # Web Crypto API şifreleme, ECDH, PBKDF2 motoru
│   ├── db.js                    # IndexedDB Vault ve yerel kasa depolama yönetimi
│   ├── index.html               # Tek sayfa modern cyber terminal HTML arayüzü
│   ├── socket-handlers.js       # İstemci Socket.IO olay dinleyicileri
│   ├── style.css                # Siber karanlık terminal stilleri ve animasyonlar
│   ├── ui.js                    # UI kontrolcüsü, formlar, mesaj renderlama, sesler
│   └── vendor/                  # Yerel 3. parti kütüphaneler (tailwindcss, socket.io, qrcode)
├── src/
│   ├── database.js              # Turso / SQLite3 hibrit veritabanı, queue ve GC
│   ├── server.js                # Express HTTP sunucusu, CSP/HSTS güvenlik başlıkları
│   └── socket.js                # Socket.IO sunucusu, JWT, rate limit ve 24 olay işleyicisi
├── tests/                       # Vitest birim ve entegrasyon test paketleri
│   ├── auth.test.js
│   ├── crypto.test.js
│   ├── database.test.js
│   ├── e2ee-message.test.js
│   ├── server.test.js
│   └── socket.test.js
├── docs/                        # Proje teknik ve dağıtım dokümanları
│   ├── AGENTS.md                # (Bu dosya) AI Ajan ve Geliştirici Kılavuzu
│   ├── DEPLOYMENT.md            # Cloudflare Pages, Render, Railway, Turso yayına alma
│   ├── OPTIMIZATIONS.md         # Güvenlik politikaları, hız limitleri ve optimizasyonlar
│   ├── PROGRESS.md              # Tamamlanan fazlar ve yol haritası
│   └── api/                     # JSDoc tarafından üretilen HTML API dökümanları
├── jsdoc.json                   # JSDoc derleyici yapılandırma dosyası
├── package.json                 # Proje bağımlılıkları ve npm scriptleri
└── vitest.config.mjs            # Test yapılandırması ve kapsam ayarları
```

---

## 🤖 AI Asistanı ve Geliştiriciler İçin Temel Kurallar

1. **Dil Ayrımı ve JSDoc Standartları:**
   - Kod mimarisi (değişkenler, fonksiyonlar, socket olayları): **İngilizce**.
   - Kullanıcı arayüzü metinleri (etiketler, butonlar, toast bildirimleri): **Türkçe**.
   - Kod yorumları: **Türkçe JSDoc** formatında olmalıdır. TypeScript dinamik `import()` tipi yerine standart Closure tipleri (`{Object}`, `{string}`, `{boolean}`) kullanılmalıdır.

2. **Frontend Katmanı:**
   - **Vanilla JavaScript:** React, Vue veya harici UI derleyicileri kesinlikle kullanılmaz.
   - **Doğal Kriptografi:** Şifreleme işlemleri yalnızca `window.crypto.subtle` API'siyle yapılır. Harici kütüphane eklenmez.
   - **XSS ve CSP Uyumluluğu:** Inline event handler'lar (`onclick=""`) yerine `addEventListener` kullanılır (`SEC-13`). `innerHTML` ile kullanıcı girdisi basılmaz; güvenli DOM API'leri (`textContent`, `createElement`) tercih edilir.

3. **Sıfır-Bilgi Backend (Zero-Knowledge):**
   - Sunucu yalnızca sinyalleşme ve paket yönlendirme yapar.
   - `textPayload` veya `filePayload` içerikleri sunucuda asla deşifre edilmez, parse edilmez, kaydedilmez veya loglanmaz.

4. **Veritabanı ve Çevrimdışı Kuyruk Güvenliği:**
   - Veritabanı hem yerel SQLite3 hem de bulut Turso (`@libsql/client`) ile uyumlu çalışır.
   - Kuyruk yazma işlemlerinde write-lock ve `db.queue[targetId] = db.queue[targetId] || []` yapısı korunmalıdır.
   - Zaman aşımına uğrayan TTL paketleri hem sunucuda (GC) hem de istemcide anında imha edilir.

5. **Test Bütünlüğü:**
   - Kod tabanında yapılan her değişiklik sonrası `npm.cmd test` çalıştırılarak 173 testin tamamının başarılı geçtiği doğrulanmalıdır.

---

## 🧪 Test ve Doğrulama Komutları

```bash
# Birim ve entegrasyon testlerini çalıştırma (Kapsam raporu ile)
npm.cmd test

# JSDoc HTML dökümantasyonunu yeniden üretme
npm.cmd run docs

# Sunucuyu başlatma
npm start

# Masaüstü Electron uygulamasını başlatma
npm run desktop:start
```

---

**Son Güncelleme:** 2026-09-30  
**Sürüm:** v1.0 (Production Ready)  
**Lisans:** ISC