# 🔐 Siber E2EE Sohbet Terminali (v10 Cyber-HUD Edition)

> **Uçtan Uca Şifreli (E2EE) P2P Sohbet Terminali** — Sunucu sadece signaling ve relay görevi görür; şifreli içerikleri asla çözemez, inceleyemez veya loglayamaz.

![Version](https://img.shields.io/badge/version-v10_Cyber--HUD-blueviolet)
![License](https://img.shields.io/badge/license-ISC-green)
![Node](https://img.shields.io/badge/node-%3E%3D18-brightgreen)
![Tests](https://img.shields.io/badge/tests-145%20passed-brightgreen)
![Coverage](https://img.shields.io/badge/coverage-95%25-brightgreen)
![Platforms](https://img.shields.io/badge/platform-Windows%20%7C%20Linux%20%7C%20macOS-lightgrey)
![SQLite](https://img.shields.io/badge/sqlite-WAL_Mode-blue)
![Docker](https://img.shields.io/badge/docker-ready-2496ED)

---

## 📌 Proje Özeti

Bu proje, modern web tarayıcıları ve yerel masaüstü uygulamaları arasında **ECDH (Elliptic-curve Diffie–Hellman)** ile asenkron anahtar takası yapılan, tüm metin ve dosya içeriklerinin **AES-GCM-256** ile istemci tarafında şifrelendiği uçtan uca korumalı bir P2P sohbet platformudur. 

Sunucu mimarisi **Zero-Knowledge (Sıfır Bilgi)** prensibiyle tasarlanmıştır. Sunucu yalnızca relay vazifesi görür; iletilen mesaj paketlerinin veya dosyaların şifresini çözebilecek anahtarlara hiçbir zaman sahip olamaz.

### 🌟 Öne Çıkan Özellikler

- 🔐 **Askeri Düzey E2EE Şifreleme:** İstemciler arası ECDH (P-256) anahtar anlaşması ve her paket için rastgele 12-byte IV (Initialization Vector) ile AES-GCM-256 şifreleme (Tamamen yerel Web Crypto API).
- 🛡️ **Sıfır Dış CDN & Sıkı CSP:** Tüm istemci kütüphaneleri (Tailwind CSS, Socket.IO, QR Code) yerel (`public/vendor/`) olarak barındırılır. Katı Content-Security-Policy kuralları ile üçüncü taraf kaynak ve script enjeksiyonları tamamen engellenmiştir.
- 💻 **Çapraz Platform Masaüstü:** Electron tabanlı güvenli masaüstü istemcisi; **Windows** (`.exe`), **Linux** (`.deb`, `.AppImage`) ve **macOS** (`.dmg`, `.zip`) için optimize derlemeler.
- 👤 **Profil & Hesap Yönetimi:** Kullanıcı avatarı belirleme/güncelleme (200 KB boyut kısıtı), eski şifre doğrulamalı şifre güncelleme ve tüm verileri, kuyrukları anında temizleyen güvenli hesap silme.
- 🔍 **Ajan Arama & Bağlantı Talepleri:** Benzersiz Ajan ID (`AGN-XXXX-XXXX`) veya kullanıcı adı ile arama, onaylı bağlantı isteği (Accept/Reject) akışı.
- 🔗 **Akıllı & Güvenli Bağlantı Tıklama (Smart URL Detection):** Mesajlardaki `http://`, `https://` ve `www.` bağlantıları otomatik algılanır; XSS korumalı güvenli etiketlere (`target="_blank"`, `rel="noopener noreferrer"`) dönüştürülerek açılır.
- 📄 **Uçtan Uca Şifreli Dosya & PDF Aktarımı:** Görseller ve PDF belgeleri (maks. 5 MB) istemcide şifrelenerek güvenle gönderilir; siber kart yapısı üzerinden dahili PDF önizleme ve indirme desteği.
- ⏱️ **TTL (Zaman Ayarlı İmha):** Belirlenen süre (5s, 10s, 30s, 60s) sonunda mesajlar hem arayüzden hem de yerel IndexedDB kasasından otomatik ve kalıcı olarak imha edilir.
- 🗑️ **Revoke Protokolü (Herkesten Sil):** Gönderici dilediği an iletisini iki taraftan birden silebilir (Sunucu tarafı BOLA yetkilendirme doğrulamalı).
- 📴 **Kalıcı Çevrimdışı Kuyruk (Offline Queue):** Karşı taraf çevrimdışı olsa bile paketler SQLite üzerinde güvenle kuyruklanır ve kullanıcı bağlandığında otomatik teslim edilir (7 günlük otomatik çöp toplayıcı GC).
- 🪪 **Parmak İzi (Fingerprint) Doğrulama:** Ortadaki Adam (MITM) saldırılarını engellemek amacıyla ECDH açık anahtarları üzerinden SHA-256 parmak izi ve QR kod doğrulama.
- ⚡ **Yazıyor... & Durum Takibi:** Gerçek zamanlı yazıyor göstergesi, çevrimiçi/çevrimdışı durum takibi ve bağlantı koptuğunda cyberpunk tarzı otomatik yeniden bağlanma (Auto-reconnect) katmanı.
- 🧪 **Kapsamlı Test Altyapısı:** Vitest ve v8 coverage motoru ile koşan 145 birim, entegrasyon ve kripto testi (%95+ kod kapsama oranı).

---

## 🧰 Teknoloji Yığını

| Alan | Teknoloji / Standart | Açıklama |
|------|----------------------|----------|
| **Frontend** | Vanilla JavaScript (ES6+), Tailwind CSS (Yerel) | Framework bağımsız, harici CDN gerektirmeyen, hafif ve ultra hızlı arayüz |
| **Backend** | Node.js, Express, Socket.IO | Asenkron, modüler, olay tabanlı sinyal ve relay sunucusu |
| **Kriptografi** | Web Crypto API (`window.crypto.subtle`) | Tarayıcı yerel ECDH (P-256), AES-GCM-256, SHA-256 |
| **Masaüstü** | Electron 44, electron-builder | Sandbox, Context Isolation ve tekil oturum kilidi (Single Instance Lock) |
| **Kimlik & Oturum** | JWT (HMAC-SHA256) + bcrypt | Bağımlılıksız token imzalama, güvenli şifre hashleme |
| **Veritabanı** | SQLite (WAL Modu) + Turso Bulut SQLite (@libsql/client) | Ortam değişkeniyle yerel SQLite veya bulut veritabanı seçimi; bellek-içi önbellek ve debounced flush |
| **İstemci Depolama** | IndexedDB (Vault) | Mesaj geçmişi ve kriptografik anahtarlar sadece istemcide |
| **Test & Kalite** | Vitest, @vitest/coverage-v8 | 145 test senaryosu, %95+ test kapsamı |
| **Tipografi & Stil** | Inter, JetBrains Mono | Okunabilir modern siber terminal estetiği |

---

## 📁 Proje Dizin Yapısı

```
/
├── .github/                               # GitHub Actions CI/CD iş akışları
│   └── workflows/
│       ├── build-linux.yml                # Linux (.deb, .AppImage) otomatik derleme
│       └── build-mac.yml                  # macOS (.dmg, .zip) otomatik derleme
├── public/                                # İstemci tarafı statik dosyaları
│   ├── index.html                         # Ana web & Electron arayüzü
│   ├── config.js                          # İstemci yapılandırması (Backend URL vb.)
│   ├── style.css                          # Modern siber tema, animasyonlar ve bileşenler
│   ├── crypto.js                          # Web Crypto API tabanlı E2EE kripto motoru
│   ├── db.js                              # IndexedDB yerel kasa (Vault) yönetimi
│   ├── ui.js                              # UI etkileşimi, state yönetimi, render işlemleri
│   ├── socket-handlers.js                 # Socket.IO istemci olay dinleyicileri
│   ├── icon.png                           # Uygulama simgesi
│   └── vendor/                            # Sıfır CDN: Yerel saklanan üçüncü taraf scriptler
│       ├── tailwindcss.js                 # Yerel Tailwind CSS motoru
│       ├── socket.io.min.js               # Yerel Socket.IO istemcisi
│       └── qrcode.min.js                  # Yerel QR kod üretici
├── src/                                   # Backend kaynak kodları
│   ├── server.js                          # Express HTTP sunucusu & güvenlik katmanı (CSP, HSTS)
│   ├── socket.js                          # Socket.IO sunucu olay işleyicileri & relay mantığı
│   ├── database.js                        # SQLite/Turso veritabanı sürücüsü, önbellek ve GC
│   └── database.sqlite                    # Çalışma zamanı SQLite veritabanı (WAL modu)
├── electron/                              # Masaüstü (Electron) kabuğu
│   ├── main.js                            # Electron ana süreç (pencere, IPC, güvenlik sandbox)
│   ├── preload.js                         # Güvenli IPC köprüsü (Context Isolation)
│   └── assets/                            # Uygulama simgeleri (icon.png, icon.jpg)
├── tests/                                 # Kapsamlı otomatik test paketi (Vitest)
│   ├── auth.test.js                       # Kimlik doğrulama, token ve şifreleme testleri
│   ├── crypto.test.js                     # ECDH, AES-GCM ve parmak izi testleri
│   ├── database.test.js                   # SQLite / Turso sürücü ve GC testleri
│   ├── e2ee-message.test.js               # Uçtan uca mesaj yaşam döngüsü testleri
│   ├── server.test.js                     # Express middleware, CSP ve endpoint testleri
│   └── socket.test.js                     # Socket.IO olayları, kuyruk ve hız limiti testleri
├── docs/                                  # Proje teknik belgeleri
│   ├── DEPLOYMENT.md                      # Hibrit bulut dağıtım kılavuzu (Cloudflare + Bulut)
│   ├── OPTIMIZATIONS.md                   # Güvenlik ve performans optimizasyon detayları
│   ├── PROGRESS.md                        # Faz durumu ve sürüm yol haritası
│   └── AGENTS.md                          # AI asistanı ve geliştirici standartları kılavuzu
├── dist/                                  # Masaüstü derleme çıktıları (Setup, Portable, deb, AppImage, dmg)
├── Dockerfile                             # Konteynerize dağıtım dosyası
├── electron-builder.json                  # Çoklu platform masaüstü paketleme yapılandırması
├── vitest.config.mjs                      # Test ortamı ve v8 coverage yapılandırması
├── run_tests.bat                          # Windows için tek tıkla test ve rapor çalıştırma betiği
├── wrangler.toml                          # Cloudflare Pages yapılandırması
├── .env.example                           # Ortam değişkenleri şablonu
├── package.json                           # Proje bağımlılıkları ve npm betikleri
└── README.md                              # Proje dokümantasyonu (Bu dosya)
```

---

## 🚀 Kurulum ve Başlatma

### Gereksinimler
- **Node.js:** v18.0.0 veya üzeri (v20+ önerilir)
- **npm:** v9.0.0 veya üzeri (ya da Docker)

---

### 💻 Yöntem 1: Windows Masaüstü Uygulaması (.exe) Olarak Kurulum

Cyber Chat Terminal, uzaktaki veya yereldeki sunucuya güvenli şekilde bağlanan tam teşekküllü bir Windows uygulaması olarak kullanılabilir.

#### 1. Hazır Kurulum Dosyaları ile Kullanım
GitHub Releases bölümünden veya `dist/` dizininden derlenen dosyalarla:
- **Kurulum Sihirbazı (Setup):** `Cyber Chat Terminal Setup 1.0.0.exe`  
  Çift tıklayıp kurulum sihirbazını tamamlayın. Masaüstünüze ve Başlat Menünüze otomatik kısayol eklenir, Denetim Masası'ndan kaldırılabilir.
- **Taşınabilir Sürüm (Portable):** `Cyber Chat Terminal 1.0.0.exe`  
  Kurulum gerektirmez. Çift tıkladığınız anda doğrudan açılır, USB belleğe atıp her bilgisayarda çalıştırılabilir.

#### 2. Kendi Masaüstü Paketlerinizi (.exe) Derlemek
Projeyi klonladıktan sonra kendi Windows uygulamanızı oluşturmak için:
```bash
# 1. Bağımlılıkları yükleyin
npm install

# 2. Geliştirici modunda test etmek için:
npm run desktop:start

# 3. Windows Installer ve Portable .exe paketlerini üretmek için:
npm run desktop:build
```
> Derleme tamamlandığında dosyalarınız otomatik olarak **`dist/`** klasöründe oluşturulacaktır.

---

### 🐧 Yöntem 2: Linux Masaüstü Uygulaması (`.deb` / `.AppImage`) Olarak Kurulum

Cyber Chat Terminal, GitHub Actions tarafından otomatik derlenen **`.deb`** (Debian/Ubuntu) ve **`.AppImage`** paketleriyle Linux'ta yerel masaüstü uygulaması olarak çalıştırılabilir.

#### Paketi İndirme
GitHub reposundaki **[Releases](https://github.com/Arif8054/Cyber_Chat_Terminal/releases)** sayfasından en güncel `cyber_x.x.x_amd64.deb` veya `Cyber Chat Terminal-x.x.x.AppImage` dosyasını indirin.

#### `.deb` Paketi ile Kurulum (Debian / Ubuntu / Mint)
```bash
sudo dpkg -i cyber_1.0.0_amd64.deb

# Eksik sistem kütüphanesi olursa:
sudo apt-get install -f -y

# Uygulamayı başlat:
cyber
```

#### `.AppImage` ile Kurulum (Tüm Linux Dağıtımları)
```bash
chmod +x "Cyber Chat Terminal-1.0.0.AppImage"
./"Cyber Chat Terminal-1.0.0.AppImage"
```
> [!TIP]
> AppImage çalıştırılırken `FUSE` hatası alırsanız: `sudo apt-get install -y libfuse2` komutunu çalıştırın.

#### Kaynak Koddan Linux Paketi Derleme
```bash
sudo apt-get install -y libfuse2
npm install
npm run desktop:build:linux
```

---

### 🍏 Yöntem 3: macOS Masaüstü Uygulaması (`.dmg` / `.zip`) Olarak Kurulum

Cyber Chat Terminal, Apple macOS sistemleri için hem **Apple Silicon (M1/M2/M3/M4)** hem de **Intel (x64)** mimarilerine optimize edilmiştir.

#### Paketi İndirme
GitHub Releases sayfasından `Cyber Chat Terminal-1.0.0.dmg` veya `Cyber Chat Terminal-1.0.0-mac.zip` dosyasını indirin.

#### Kurulum:
1. `.dmg` dosyasını açın.
2. `Cyber Chat Terminal` simgesini sürükleyerek **Applications (Uygulamalar)** klasörüne bırakın.
3. Uygulamayı Spotlight veya Launchpad üzerinden başlatın.

#### Kaynak Koddan macOS Paketi Derleme:
```bash
npm install
npm run desktop:build:mac
```
> Çıktılar otomatik olarak `dist/` klasöründe `.dmg` ve `.zip` formatında hazırlanır.

---

### 🌐 Yöntem 4: Web / Yerel Node.js Sunucusu Olarak Çalıştırma

#### 1. Depoyu Klonlayın
```bash
git clone https://github.com/Arif8054/Cyber_Chat_Terminal.git
cd Cyber_Chat_Terminal
```

#### 2. Bağımlılıkları Yükleyin
```bash
npm install
```

#### 3. Ortam Değişkenlerini Tanımlayın (`.env`)
Kök dizinde bir `.env` dosyası oluşturun (şablon için [.env.example](.env.example) dosyasını referans alabilirsiniz):
```env
PORT=3000
NODE_ENV=development
JWT_SECRET=super_secret_jwt_passphrase_min_32_chars_long
CORS_ORIGIN=*
DB_PATH=./src/database.sqlite
# İsteğe bağlı — Turso Bulut SQLite:
# TURSO_DATABASE_URL=libsql://your-db.turso.io
# TURSO_AUTH_TOKEN=your_turso_auth_token
```
> ⚠️ **Güvenlik Notu:** Üretim ortamında `JWT_SECRET` değerini en az 32 karakterlik güçlü bir rastgele anahtarla belirleyin.

#### 4. Sunucuyu Başlatın
```bash
npm start        # Üretim modu
# veya
npm run dev      # Geliştirme modu
```

> [!NOTE]
> Windows PowerShell'de `npm.ps1 cannot be loaded because running scripts is disabled` hatası alırsanız komutları `npm.cmd start` veya `npm.cmd run dev` olarak çalıştırabilirsiniz.

Terminalde bağlantı adresleri listelenecektir:
- **Yerel Erişim:** `http://localhost:3000`
- **Sağlık Kontrolü:** `http://localhost:3000/health`

---

### 🐳 Yöntem 5: Docker ile Çalıştırma

Projeyi tek bir komutla Docker üzerinden izole bir şekilde ayağa kaldırabilirsiniz:

```bash
# İmajı derleyin
docker build -t cyber-chat-terminal .

# Konteyneri kalıcı veri diziniyle başlatın
docker run -d -p 3000:3000 -v $(pwd)/data:/app/data -e DB_PATH=/app/data/database.sqlite --name cyber-chat cyber-chat-terminal
```

---

## 🧪 Testler ve Kod Doğrulama (Vitest)

Proje, E2EE el sıkışması, simetrik şifreleme/çözme, veritabanı sürücüsü, rate limiting ve sunucu güvenlik başlıklarını test eden kapsamlı bir test süitine sahiptir:

- **145 Test Senaryosu:** Tamamı bağımsız ve deterministik çalışan birim & entegrasyon testleri.
- **%95+ Kod Kapsamı:** Kritik çekirdek katmanlar (`crypto.js`, `database.js`, `server.js`, `socket.js`) v8 motoruyla izlenir.

```bash
# Tüm testleri çalıştır ve kapsam (coverage) raporu üret
npm test
# (Windows PowerShell için: npm.cmd test)

# Testleri izleme (watch) modunda interaktif çalıştır
npm run test:watch

# Yalnızca kapsam raporunu terminalde ve HTML olarak derle
npm run test:coverage
```

### Windows İçin Tek Tıkla Test:
Windows ortamında doğrudan `run_tests.bat` dosyasını çalıştırabilirsiniz. Testler bittiğinde `coverage/index.html` raporunu otomatik olarak varsayılan tarayıcınızda açar.

---

## 🔐 Güvenlik Mimarisi

| Güvenlik Katmanı | Uygulanan Mekanizma | Korunan Risk |
|------------------|----------------------|--------------|
| **Zero-Knowledge Relay** | Sunucu yalnızca şifreli zarfı (ciphertext + IV) iletir. Anahtarlar hiçbir zaman sunucuya gönderilmez. | Sunucu ihlali veya dinleme durumunda veri sızıntısı |
| **Native Web Crypto** | Harici JS kripto kütüphaneleri kullanılmaz; tarayıcının yerleşik `window.crypto.subtle` API'si kullanılır. | Üçüncü taraf kütüphane arka kapıları (Supply Chain Attacks) |
| **Sıkı CSP & Sıfır Dış CDN** | `script-src 'self'` direktifi; tüm scriptler `public/vendor/` dizininden sunulur. Harici script yüklenemez. | İstemci tarafı XSS ve CDN zehirlenmesi (CDN Compromise) |
| **CSWSH Savunması** | Socket.IO bağlantılarında origin whitelist ve sandboxed `null` origin engelleme uygulanır. | Siteler Arası WebSocket Ele Geçirme (Cross-Site WebSocket Hijacking) |
| **BOLA Koruması** | Mesaj iptal (`revoke_packet`) isteklerinde paket sahibinin kimliği sunucu tarafında doğrulanır. | Başka kullanıcıların mesajlarını yetkisizce silme (Broken Object Level Authorization) |
| **XSS Korumalı Linkleme** | URL'ler ayrıştırılırken DOM String interpolation yerine `document.createTextNode` ve protokol doğrulaması (`http:`, `https:`) kullanılır. | XSS (Cross-Site Scripting) ve sahte protokol enjeksiyonu (`javascript:`) |
| **JWT Doğrulamalı Socket** | Her Socket bağlantısı HMAC-SHA256 JWT oturumu ile ilişkilendirilir. `packet.senderId` sunucu tarafında doğrulanır. | Kimlik sahteciliği (Sender Spoofing) |
| **Gelişmiş Rate Limiting** | IP bazlı giriş, kayıt, mesaj gönderimi, profil güncelleme ve arama isteklerine sınır uygulanır. | Brute-force ve Hizmet Dışı Bırakma (DoS) |
| **HTTP Güvenlik Başlıkları** | HSTS (1 yıl), `X-Content-Type-Options: nosniff`, `X-Frame-Options: DENY`, `X-XSS-Protection: 0`. | Clickjacking, MIME-sniffing, eski tarayıcı XSS filtre zaafiyetleri |
| **MITM Doğrulaması** | Karşılıklı açık anahtarların SHA-256 hash'i (Parmak İzi) QR kod ve metin olarak karşılaştırılabilir. | Araya giren adam (Man-in-the-Middle) saldırıları |
| **Electron Sandbox & İzolasyon** | `nodeIntegration: false`, `contextIsolation: true`, `sandbox: true`, `webSecurity: true`. | Masaüstü kabuğunda yerel dosya ve işletim sistemi komut enjeksiyonu |

---

## 🎮 Kullanım Rehberi

1. **Giriş / Kayıt:**
   - Tarayıcınızda veya masaüstü uygulamasında terminali açın.
   - Kullanıcı adı, e-posta ve şifrenizi girerek kaydolun. Sistem otomatik olarak size özel bir Ajan ID (`AGN-XXXX-XXXX`) üretir.
2. **Profil ve Avatar Özelleştirme:**
   - Sol üstteki profil fotoğrafı alanına veya **Ayarlar (⚙️) -> Profil** sekmesine tıklayarak avatar yükleyin (200 KB güvenlik sınırı).
3. **Bağlantı Kurma & Ajan Arama:**
   - **Doğrudan ID ile:** "➕" butonuna tıklayıp hedef kullanıcının Ajan ID'sini girin.
   - **Arama ile:** "🔍" butonuna basarak kullanıcı adına göre arama yapın ve bağlantı isteği gönderin. Karşı taraf onayladığında E2EE anahtar takası anında tamamlanır.
4. **Güvenli Mesajlaşma & Akıllı Linkler:**
   - Mesaj kutusuna metninizi yazın. Gönderilen mesajlar istemcide AES-GCM ile şifrelenir.
   - Mesaj içinde paylaşılan tüm web adresleri otomatik olarak tıklanabilir güvenli bağlantıya dönüşür.
5. **Şifreli PDF ve Görsel Paylaşımı:**
   - Ataş (📎) ikonuna tıklayarak görsel veya PDF belgesi (maks. 5 MB) seçin.
   - Alınan PDF belgeleri siber kart şeklinde listelenir; **İndir** veya doğrudan **Görüntüle** butonlarıyla incelenebilir.
6. **Zaman Ayarlı İmha (TTL):**
   - Gönderim öncesinde TTL menüsünden (5s, 10s, 30s, 60s) seçim yapın. Süre dolduğunda mesaj her iki taraftan ve yerel IndexedDB kasasından kalıcı olarak silinir.
7. **Herkesten Sil (Revoke):**
   - Gönderdiğiniz iletinin yanındaki **Sil** butonuna basarak mesajı iki taraftan birden silebilirsiniz.
8. **Güvenlik Ayarları (Şifre Değiştirme & Hesap Silme):**
   - **Ayarlar -> Güvenlik** sekmesinden mevcut şifrenizi doğrulayarak şifrenizi değiştirebilir veya hesabınızı, tüm mesaj kuyruklarını ve ilişkili verileri kalıcı olarak silebilirsiniz.

---

## 🗺️ Geliştirme Durumu ve Yol Haritası

Mevcut sürüm: **v10 (Cyber-HUD Edition)**

- [x] **FAZ 1 — Güvenlik Temelleri:** Bağımsız HMAC-SHA256 JWT, IP tabanlı Rate Limiting, Express Güvenlik Başlıkları, Katı CSP (`script-src 'self'`), Parmak İzi (SHA-256 Fingerprint) Doğrulama.
- [x] **FAZ 2 — Backend & Mimari:** SQLite WAL mimarisi, Asenkron kuyruklama, 7 günlük GC, Hibrit Dağıtım (Cloudflare Pages + Docker), Turso Cloud SQLite desteği.
- [x] **FAZ 3 — Masaüstü ve Platformlar:** Electron entegrasyonu, Windows (Setup + Portable), Linux (.deb + .AppImage), macOS (.dmg + .zip) derleme iş akışları.
- [x] **FAZ 4 — Kullanıcı Deneyimi ve Yönetim:** Profil avatarı, şifre değiştirme, güvenli hesap silme, kullanıcı arama, bağlantı onaylama (Request/Accept/Reject) akışı, sıfır dış CDN mimarisi.
- [x] **FAZ 5 — Test & Güvenilirlik:** Vitest test altyapısı, 145 birim/entegrasyon testi, %95+ kod kapsama oranı.
- [ ] **Gelecek Planlar (FAZ 6):** 
  - Double Ratchet protokolü ile her mesaj başına İleriye Dönük Gizlilik (Forward Secrecy).
  - Ed25519 dijital imzaları ile paket bütünlüğü ve kaynak inkar edilemezliği (Non-repudiation).
  - Çoklu katılımcılı şifreli grup sohbetleri.

Ayrıntılı yol haritası için [docs/PROGRESS.md](docs/PROGRESS.md) ve [docs/OPTIMIZATIONS.md](docs/OPTIMIZATIONS.md) belgelerine göz atabilirsiniz.

---

## 🤝 Katkıda Bulunma

Projeye katkıda bulunurken lütfen aşağıdaki temel ilkelere sadık kalın:
- **Dil:** Kod ve API değişkenleri İngilizce; kullanıcı arayüzü metinleri ve toast mesajları Türkçe.
- **Mimari:** Frontend saf Vanilla JS (Framework/Bundler kullanılmaz).
- **Kriptografi:** Yalnızca tarayıcı yerel `window.crypto.subtle` API'si (Harici JS kripto paketleri eklenemez).
- **Güvenlik Politikası:** Dış CDN bağımlılığı eklenmemeli, tüm üçüncü taraf kütüphaneler `public/vendor/` altında yerel barındırılmalıdır.
- **Test Bütünlüğü:** Yapılan her değişiklik sonrası `npm test` ile 145 testin hatasız geçtiği doğrulanmalıdır.

---

## 📄 Lisans

Bu proje [ISC](LICENSE) lisansı altında sunulmaktadır.

---

<div align="center">

**Siber Güvenlik E2EE İletişim Terminali** 🔒  
*"Sunucu göremez. Sunucu çözemez. Sunucu loglayamaz."*

</div>
