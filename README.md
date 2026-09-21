# 🔐 Siber E2EE Sohbet Terminali (v10 Cyber-HUD Edition)

> **Uçtan Uca Şifreli (E2EE) P2P Sohbet Terminali** — Sunucu sadece signaling ve relay görevi görür; şifreli içerikleri asla çözemez, inceleyemez veya loglayamaz.

![Version](https://img.shields.io/badge/version-v10_Cyber--HUD-blueviolet)
![License](https://img.shields.io/badge/license-ISC-green)
![Node](https://img.shields.io/badge/node-%3E%3D18-brightgreen)
![SQLite](https://img.shields.io/badge/sqlite-WAL_Mode-blue)
![Docker](https://img.shields.io/badge/docker-ready-2496ED)

---

## 📌 Proje Özeti

Bu proje, modern web tarayıcıları arasında **ECDH (Elliptic-curve Diffie–Hellman)** ile asenkron anahtar takası yapılan, tüm metin ve dosya içeriklerinin **AES-GCM-256** ile istemci tarafında şifrelendiği uçtan uca korumalı bir P2P sohbet platformudur. 

Sunucu mimarisi **Zero-Knowledge (Sıfır Bilgi)** prensibiyle tasarlanmıştır. Sunucu relay vazifesi görür; iletilen paketlerin şifresini çözebilecek anahtarlara hiçbir zaman sahip olamaz.

### 🌟 Öne Çıkan Özellikler

- 🔐 **Askeri Düzey E2EE Şifreleme:** İstemciler arası ECDH anahtar anlaşması ve her paket için rastgele IV (Initialization Vector) ile AES-GCM-256 şifreleme (Tamamen yerel Web Crypto API).
- 🔗 **Akıllı & Güvenli Bağlantı Tıklama (Smart URL Detection):** Mesajlardaki `http://`, `https://` ve `www.` bağlantıları otomatik olarak algılanır, XSS korumalı güvenli etiketlere (`target="_blank"`, `rel="noopener noreferrer"`) dönüştürülür ve tek tıkla yeni sekmede açılır.
- 📄 **Uçtan Uca Şifreli Dosya & PDF Aktarımı:** Görseller ve PDF belgeleri (maks. 5 MB) uçtan uca şifrelenerek güvenle gönderilir; siber kart yapısı üzerinden dahili PDF önizleme ve indirme desteği.
- ⏱️ **TTL (Zaman Ayarlı İmha):** Belirlenen süre (örn. 5s, 30s, 60s) sonunda mesajlar hem arayüzden hem de yerel IndexedDB kasasından otomatik ve kalıcı olarak imha edilir.
- 🗑️ **Revoke Protokolü (Herkesten Sil):** Gönderici dilediği an bir mesajı veya belgeyi iki taraftan birden silebilir.
- 📴 **Kalıcı Çevrimdışı Kuyruk (Offline Queue):** Karşı taraf çevrimdışı olsa bile mesajlar SQLite üzerinde güvenle kuyruklanır ve kullanıcı oturum açtığında otomatik teslim edilir (7 günlük otomatik çöp toplayıcı GC).
- 👤 **Parmak İzi (Fingerprint) Doğrulama:** Ortadaki Adam (MITM) saldırılarını engellemek amacıyla ECDH açık anahtarları üzerinden SHA-256 parmak izi ve QR kod doğrulama.
- 🎨 **Modern Cyber-Dark Arayüz:** Sadeleştirilmiş, odaklanmayı artıran modern karanlık tema, özel CSS değişkenleri, duyarlı (responsive) mobil/masaüstü görünüm ve ayarlanabilir font ölçekleme.
- 🌐 **Hibrit Dağıtım Desteği:** İster monolitik olarak tek sunucuda, ister **Cloudflare Pages (Frontend) + Render/Railway/VPS (Backend)** hibrit yapısında çalıştırılabilir.

---

## 🧰 Teknoloji Yığını

| Alan | Teknoloji / Standart | Açıklama |
|------|----------------------|----------|
| **Frontend** | Vanilla JavaScript (ES6+), Tailwind CSS (CDN) | Sıfır framework bağımlılığı, hafif ve hızlı |
| **Backend** | Node.js, Express, Socket.IO | Asenkron, olay tabanlı sinyal ve relay sunucusu |
| **Kriptografi** | Web Crypto API (`window.crypto.subtle`) | Tarayıcı yerel ECDH (P-256), AES-GCM-256, SHA-256 |
| **Kimlik & Oturum** | JWT (HMAC-SHA256) + bcrypt | Bağımlılıksız token imzalama, güvenli şifre hashleme |
| **Veritabanı** | SQLite (WAL Modu) + Turso Bulut SQLite (@libsql/client) | Ortam değişkeniyle yerel SQLite veya bulut veritabanı seçimi; bellek-içi önbellek ve debounced flush |
| **İstemci Depolama** | IndexedDB (Vault) | Mesaj geçmişi ve kriptografik anahtarlar sadece istemcide |
| **Tipografi** | Inter, JetBrains Mono | Okunabilir modern siber terminal estetiği |

---

## 📁 Proje Dizin Yapısı

```
/
├── public/                                # İstemci tarafı statik dosyaları
│   ├── index.html                         # Ana web arayüzü
│   ├── config.js                          # İstemci yapılandırması (Backend URL vb.)
│   ├── style.css                          # Modern siber tema, animasyonlar ve bileşenler
│   ├── crypto.js                          # Web Crypto API tabanlı E2EE kripto motoru
│   ├── db.js                              # IndexedDB yerel kasa (Vault) yönetimi
│   ├── ui.js                              # UI etkileşimi, state yönetimi, render işlemleri
│   ├── socket-handlers.js                 # Socket.IO istemci olay dinleyicileri
│   └── icon.png                           # Uygulama simgesi
├── src/                                   # Backend kaynak kodları
│   ├── server.js                          # Express HTTP sunucusu & güvenlik katmanı
│   ├── socket.js                          # Socket.IO sunucu olay işleyicileri & relay mantığı
│   ├── database.js                        # SQLite/Turso veritabanı sürücüsü, önbellek ve GC
│   └── database.sqlite                    # Çalışma zamanı SQLite veritabanı (WAL modu)
├── electron/                              # Masaüstü (Electron) kabuğu
│   ├── main.js                            # Electron ana süreç (pencere, IPC, tek örnek kilidi)
│   ├── preload.js                         # Güvenli IPC köprüsü
│   └── assets/                            # Uygulama simgeleri (icon.png, icon.jpg)
├── docs/                                  # Proje belgeleri
│   ├── DEPLOYMENT.md                      # Hibrit bulut dağıtım kılavuzu (Cloudflare + Bulut)
│   ├── OPTIMIZATIONS.md                   # Güvenlik ve performans optimizasyon detayları
│   ├── PROGRESS.md                        # Faz durumu ve sürüm yol haritası
│   └── AGENTS.md                          # AI asistanı ve geliştirici standartları kılavuzu
├── dist/                                  # Masaüstü derleme çıktıları (Setup + Portable .exe)
├── Dockerfile                             # Konteynerize dağıtım dosyası
├── electron-builder.json                  # Masaüstü paketleme yapılandırması
├── wrangler.toml                          # Cloudflare Pages yapılandırması
├── .env.example                           # Ortam değişkenleri şablonu
├── package.json                           # Proje bağımlılıkları ve scriptler
└── README.md                              # Proje dokümantasyonu (Bu dosya)
```

---

## 🚀 Kurulum ve Başlatma

### Gereksinimler
- **Node.js:** v18.0.0 veya üzeri
- **npm:** v9.0.0 veya üzeri (ya da Docker)

---

### 💻 Yöntem 1: Windows Masaüstü Uygulaması (.exe) Olarak Kurulum

Cyber Chat Terminal, uzaktaki sunucuya güvenli şekilde bağlanan tam teşekküllü bir masaüstü uygulaması olarak kullanılabilir.

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

### Yöntem 2: Web / Yerel Olarak Çalıştırma

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
Kök dizinde `.env` dosyası oluşturun (şablon için [.env.example](.env.example) dosyasına bakabilirsiniz):
```env
PORT=3000
NODE_ENV=development
JWT_SECRET=super_secret_jwt_passphrase_min_32_chars_long
CORS_ORIGIN=*
DB_PATH=./database.sqlite
# İsteğe bağlı — tanımlanırsa yerel SQLite yerine Turso bulut veritabanı kullanılır:
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
Terminalde bağlantı adresleri listelenecektir:
- Yerel Erişim: `http://localhost:3000`
- Sağlık Kontrolü: `http://localhost:3000/health`

---

### Yöntem 3: Docker ile Çalıştırma

Projeyi tek bir komutla Docker üzerinden izole bir şekilde ayağa kaldırabilirsiniz:

```bash
# İmajı derleyin
docker build -t cyber-chat-terminal .

# Konteyneri kalıcı veri diziniyle başlatın
docker run -d -p 3000:3000 -v $(pwd)/data:/app/data -e DB_PATH=/app/data/database.sqlite --name cyber-chat cyber-chat-terminal
```

---

## 🌐 Canlıya Alma (Dağıtım)

Proje, hem tek bir sunucuda hem de modern hibrit mimaride çalışacak şekilde tasarlanmıştır:
- **Frontend:** Cloudflare Pages (Ücretsiz, küresel CDN, anında statik dağıtım)
- **Backend:** Render / Railway / VPS Docker (WebSocket ve SQLite desteği)

Detaylı adım adım rehber için [docs/DEPLOYMENT.md](docs/DEPLOYMENT.md) dosyasını inceleyebilirsiniz.

---

## 🔐 Güvenlik Mimarisi

| Güvenlik Katmanı | Uygulanan Mekanizma | Korunan Risk |
|------------------|----------------------|--------------|
| **Zero-Knowledge Relay** | Sunucu yalnızca şifreli zarfı (ciphertext + IV) iletir. Anahtarlar hiçbir zaman sunucuya gönderilmez. | Sunucu ihlali veya dinleme durumunda veri sızıntısı |
| **Native Web Crypto** | Harici JS kripto kütüphaneleri kullanılmaz; tarayıcının yerleşik `window.crypto.subtle` API'si kullanılır. | Üçüncü taraf kütüphane arka kapıları (Supply Chain Attacks) |
| **XSS Korumalı Linkleme** | URL'ler ayrıştırılırken DOM String interpolation yerine `document.createTextNode` ve protokol doğrulaması (`http:`, `https:`) kullanılır. | XSS (Cross-Site Scripting) ve sahte protokol enjeksiyonu |
| **JWT Doğrulamalı Socket** | Her Socket bağlantısı HMAC-SHA256 JWT oturumu ile ilişkilendirilir. `packet.senderId` sunucu tarafında doğrulanır. | Kimlik sahteciliği (Sender Spoofing) |
| **Gelişmiş Rate Limiting** | IP bazlı giriş, kayıt, mesaj gönderimi ve arama isteklerine sınır uygulanır. | Brute-force ve Hizmet Dışı Bırakma (DoS) |
| **HTTP Güvenlik Başlıkları** | HSTS, X-Content-Type-Options: nosniff, X-Frame-Options: DENY, X-XSS-Protection. | Clickjacking, MIME-sniffing |
| **MITM Doğrulaması** | Karşılıklı açık anahtarların SHA-256 hash'i (Parmak İzi) QR kod ve metin olarak karşılaştırılabilir. | Araya giren adam (Man-in-the-Middle) saldırıları |

---

## 🎮 Kullanım Rehberi

1. **Giriş / Kayıt:**
   - Tarayıcınızda terminali açın.
   - Benzersiz bir kullanıcı adı ve parola belirleyerek yeni bir ajan kimliği oluşturun (`AGN-XXXX-XXXX`).
2. **Bağlantı Kurma (Ajan Ekleme):**
   - "YENİ AJAN BAĞLA" butonuna tıklayıp hedef kullanıcının Ajan ID'sini girin.
   - Karşılıklı ECDH açık anahtarları otomatik takas edilir ve ortak şifreleme sırrı (Shared Secret) türetilir.
3. **Güvenli Mesajlaşma:**
   - Mesaj kutusuna iletinizi yazın. Gönderilen tüm mesajlar istemcide AES-GCM ile şifrelenir.
   - Mesaj içinde paylaşılan tüm web bağlantıları (`https://...`, `www....`) otomatik olarak tıklanabilir güvenli link haline gelir.
4. **Şifreli PDF ve Görsel Paylaşımı:**
   - Ataş ikonuna tıklayarak görsel veya PDF belgesi (5 MB'a kadar) seçin.
   - Alınan PDF belgeleri siber kart şeklinde listelenir; **İndir** veya doğrudan **Görüntüle** butonlarıyla incelenebilir.
5. **Zaman Ayarlı İmha (TTL):**
   - TTL seçeneğiyle (örn. 10 saniye) gönderilen mesajlar süre bitiminde her iki cihazdan ve yerel kasadan otomatik silinir.
6. **Herkesten Sil (Revoke):**
   - Gönderdiğiniz iletinin yanındaki **Sil** butonuna basarak mesajı tüm taraflardan silebilirsiniz.

---

## 🗺️ Geliştirme Durumu ve Yol Haritası

Mevcut sürüm: **v10 (Cyber-HUD Edition)**

- [x] **FAZ 1 — Güvenlik Temelleri:** Bağımsız JWT, Rate Limiting, Güvenlik Başlıkları, Parmak İzi Doğrulama.
- [x] **FAZ 2 — Backend & Mimari:** SQLite WAL mimarisi, Asenkron kuyruklama, 7 günlük GC, Hibrit Dağıtım (Cloudflare Pages + Docker).
- [x] **Kullanıcı Deneyimi:** Tıklanabilir akıllı linkler, PDF görüntüleyici ve indirme kartları, modern cyber-dark teması.
- [ ] **FAZ 3 — Kriptografik Geliştirmeler:** Double Ratchet benzeri Oturum Başına İleriye Dönük Gizlilik (Forward Secrecy), Dijital İmza ile paket bütünlüğü.
- [ ] **FAZ 4 & 5 — Genişletilmiş Özellikler:** Kullanıcı profilleri, gelişmiş loglama ve telemetri.

Ayrıntılı yol haritası için [docs/PROGRESS.md](docs/PROGRESS.md) ve [docs/OPTIMIZATIONS.md](docs/OPTIMIZATIONS.md) belgelerine göz atabilirsiniz.

---

## 🤝 Katkıda Bulunma

Projeye katkıda bulunurken lütfen aşağıdaki temel ilkelere sadık kalın:
- **Dil:** Kod ve API değişkenleri İngilizce; kullanıcı arayüzü metinleri ve toast mesajları Türkçe.
- **Mimari:** Frontend saf Vanilla JS (Framework/Bundler kullanılmaz).
- **Kriptografi:** Yalnızca tarayıcı yerel `window.crypto.subtle` API'si.
- **Tasarım:** Modern cyber-dark UI paleti ve Tailwind CSS.

---

## 📄 Lisans

Bu proje [ISC](LICENSE) lisansı altında sunulmaktadır.

---

<div align="center">

**Siber Güvenlik E2EE İletişim Terminali** 🔒  
*"Sunucu göremez. Sunucu çözemez. Sunucu loglayamaz."*

</div>
