# 🔐 Siber E2EE Sohbet Terminali (v10 Cyber-HUD Edition)

> **Uçtan Uca Şifreli (E2EE) P2P Sohbet Terminali** — Sunucu sadece signaling ve relay görevi görür; şifreli içerikleri asla çözemez.

![Version](https://img.shields.io/badge/version-v10-blueviolet)
![License](https://img.shields.io/badge/license-ISC-green)
![Node](https://img.shields.io/badge/node-%3E%3D18-brightgreen)

---

## 📌 Proje Özeti

Bu proje, web tarayıcıları arasında **ECDH** ile anahtar takası yapılan, tüm mesaj ve dosyaların **AES-GCM-256** ile şifrelendiği bir P2P sohbet terminalidir. Sunucu yalnızca signaling ve relay görevi görür — şifreli içerikleri asla çözmez, incelemez veya loglamaz.

**Öne Çıkan Özellikler:**
- 🔐 **E2EE Şifreleme:** ECDH anahtar takası + AES-GCM-256 şifreleme (Web Crypto API)
- ⏱️ **TTL İmha:** Zaman ayarlı kendini imha eden mesajlar
- 🗑️ **Revoke Protokolü:** Gönderilen mesajı herkesten silme
- 📴 **Çevrimdışı Kuyruk:** Hedef çevrimdışıyken mesajları beklemede tutma
- 👤 **Parmak İzi Doğrulama:** MITM saldırılarına karşı ECDH anahtar doğrulama (QR Kod destekli)
- 🎨 **Modern Cyber-Dark Arayüz:** Sade, modern karanlık tema, özel CSS değişkenleri, duyarlı (responsive) mobil/masaüstü görünüm

---

## 🧰 Teknoloji Yığını

| Alan | Teknoloji |
|------|-----------|
| **Frontend** | Vanilla JavaScript, Tailwind CSS (CDN), Socket.io (client) |
| **Backend** | Node.js, Express, Socket.io (server) |
| **Şifreleme** | Web Crypto API (`crypto.subtle`): AES-GCM, ECDH, SHA-256 |
| **Kimlik Doğrulama** | JWT (bağımlılıksız, HMAC-SHA256) + bcrypt |
| **Veritabanı** | SQLite (WAL modu) + Bellek içi cache |
| **CSS** | Tailwind CSS (CDN) + Özel Modern Cyber-Dark CSS (`style.css`) |
| **Fontlar** | Inter, JetBrains Mono |

---

## 📁 Proje Yapısı

```
/
├── public/                          # Statik dosyalar (HTTP üzerinden sunulur)
│   ├── siber_e2ee_sohbet_terminali.html  # Ana HTML şablonu
│   ├── style.css                    # Cyberpunk teması, animasyonlar
│   ├── crypto.js                    # Kriptografi modülü (ECDH, AES-GCM)
│   ├── db.js                        # IndexedDB Vault yönetimi
│   ├── ui.js                        # UI, state yönetimi, DOM işlemleri
│   └── socket-handlers.js           # Socket.io olay dinleyicileri
├── database.js                      # SQLite veritabanı yönetimi
├── database.json                    # Eski JSON veritabanı (migration için)
├── socket.js                        # Socket.io sunucu olay işleyicileri
├── server.js                        # Express + HTTP sunucu başlangıcı
├── package.json                     # Bağımlılıklar
├── AGENTS.md                        # AI asistanı için proje kılavuzu
├── OPTIMIZATIONS.md                 # Gelecek faz planlaması
├── PROGRESS.md                      # Mevcut durum ve roadmap
└── README.md                        # Bu dosya
```

---

## 🚀 Kurulum ve Başlatma

### Gereksinimler
- Node.js >= 18
- npm veya yarn

### 1. Depoyu Klonlayın

```bash
git clone <repo-url>
cd siber-e2ee-sohbet-terminali
```

### 2. Bağımlılıkları Yükleyin

```bash
npm install
```

### 3. Çevre Değişkenlerini Ayarlayın (Opsiyonel ama Önerilir)

```bash
# .env dosyası oluşturun
echo "JWT_SECRET=your_super_secret_key_here_min_32_chars" > .env
```

> ⚠️ **Güvenlik Uyarısı:** `JWT_SECRET` tanımlanmazsa varsayılan bir anahtar kullanılır. Üretim ortamında mutlaka özel bir değer belirleyin.

### 4. Sunucuyu Başlatın

```bash
npm start
```

Sunucu `http://localhost:3000` adresinde çalışmaya başlayacaktır.

---

## 🔐 Güvenlik Özellikleri

| Özellik | Açıklama |
|---------|----------|
| **Zero-Knowledge Backend** | Sunucu `textPayload` veya `filePayload` içeriğini asla çözmez |
| **Client-Side Storage** | Sohbet geçmişi, kişiler ve ECDH sırları yalnızca tarayıcıda saklanır |
| **Native Web Crypto** | Tüm şifreleme `window.crypto.subtle` ile yapılır; harici kütüphane yok |
| **JWT Authentication** | Bağımlılıksız HMAC-SHA256 JWT ile socket oturum yönetimi |
| **Rate Limiting** | IP bazlı giriş/kayıt/mesaj sınırlandırması |
| **Security Headers** | HSTS, X-Content-Type-Options, X-Frame-Options, XSS Protection |
| **Sender Spoofing Koruması** | `packet.senderId` ile oturum açmış kullanıcı eşleştirmesi |
| **Fingerprint Doğrulama** | ECDH anahtarları için SHA-256 parmak izi + QR kod doğrulama |

---

## 🎮 Kullanım

### İlk Bağlantı
1. Tarayıcıda `http://localhost:3000` açın
2. Sunucu düğümü adresini girin (varsayılan: kendi origin)
3. Yeni kimlik oluşturun veya mevcut kimlikle giriş yapın

### Ajan Ekleme
1. "YENİ AJAN BAĞLA" butonuna tıklayın
2. Hedef Ajan ID'sini girin (`AGN-XXXX-XXXX` formatında)
3. Sistem otomatik olarak ECDH anahtar takası başlatır

### Parmak İzi Doğrulama
1. Sohbet başlığındaki "🔐 DOĞRULA" butonuna tıklayın
2. Kendi ve karşı tarafın parmak izlerini güvenli kanaldan karşılaştırın
3. "DOĞRULANDI" butonuna tıklayın

### Mesaj Gönderimi
- Metin veya görsel (JPEG/PNG) gönderebilirsiniz
- TTL seçeneği ile zaman ayarlı imha ayarlayabilirsiniz
- "İMHA ET" butonu ile gönderdiğiniz mesajı herkesten silebilirsiniz

---

## 🧪 Test Senaryoları

| Senaryo | Doğrulama |
|---------|-----------|
| ECDH Anahtar Takası | `derivedSecrets` objesinde karşılıklı anahtar var mı kontrol edin |
| Mesaj Şifreleme | Tarayıcı geliştirici konsolunda / Network akışında `textPayload` alanının base64 şifreli göründüğünden emin olun |
| Revoke (İmha) | Mesaj gönderip "İMHA ET" butonuna tıklayın; karşı tarafta kaybolmalı |
| TTL (Zamanlı İmha) | TTL süresi dolduğunda mesaj hem DOM'dan hem IDB'den silinmeli |
| Çevrimdışı Kuyruk | Hedef çevrimdışıyken mesaj gönderin; hedef giriş yaptığında mesajlar gelmeli |

---

## ⚠️ Bilinen Sınırlamalar

- **JSON Veritabanı:** Mevcut sürümde SQLite kullanılmaktadır; eski `database.json` otomatik olarak migrate edilir
- **Bellek İçi Cache:** Yüksek trafikte debounce (50ms) ile yazma işlemleri birleştirilir
- **Frontend State:** Global değişkenler üzerinden yapılan mutasyonlar DOM'a otomatik yansımaz; ilgili render fonksiyonlarını manuel tetikleyin

---

## 🗺️ Geliştirme Yol Haritası

### FAZ 1 — Güvenlik İyileştirmeleri ✅
- [x] JWT Entegrasyonu
- [x] Rate Limiting
- [x] Güvenlik Başlıkları
- [x] Parmak İzi Doğrulama

### FAZ 2 — Backend Altyapı ✅
- [x] SQLite Geçişi
- [x] Asenkron İşlemler
- [x] Çevrimdışı Kuyruk
- [ ] Redis ile Kalıcı Kuyruk

### FAZ 3 — Kriptografik Geliştirmeler 🔄
- [ ] İleriye Dönük Gizlilik (Forward Secrecy)
- [ ] Dijital İmza

### FAZ 4 & 5 — Deneyim ve Operasyon
- [ ] Kapsamlı Profil Yönetimi
- [ ] Bulut Dağıtımı
- [ ] Loglama ve İzleme

---

## 🤝 Katkıda Bulunma

Bu proje "Vibe Coding" yaklaşımıyla geliştirilmektedir. Katkıda bulunurken lütfen aşağıdaki kurallara uyun:

1. **Kod dili:** İngilizce (değişkenler, fonksiyonlar, API olayları)
2. **UI metinleri:** Türkçe (etiketler, butonlar, toast mesajları)
3. **Frontend:** Vanilla JavaScript — React/Vue/Svelte yasak
4. **Kriptografi:** Sadece `window.crypto.subtle` — harici kütüphane yasak
5. **UI teması:** Modern siber koyu tema standartlarına uygun (temiz koyu yüzeyler, CSS değişkenleri, duyarlı kart yapısı)

---

## 📄 Lisans

MIT License 

---

<div align="center">

**Siber Güvenlik P2P Lab Konsolu** 🔒

*"Sunucu göremez. Sunucu çözemez. Sunucu loglayamaz."*

</div>
