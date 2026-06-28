# OPTİMİZASYON VE GÜVENLİK KILAVUZU (OPTIMIZATIONS)

**Sürüm:** v10 (Cyber-HUD Edition)
**Son Güncelleme:** 2026-06-28

---

## 📌 Uyulması Zorunlu Kısıtlamalar

### 1. Sıfır-Bilgi Backend (Zero-Knowledge)
Node.js sunucusu (`server.js`, `socket.js`) yalnızca signaling ve relay görevi görür.
Backend mantığında `textPayload` veya `filePayload` içeriğini **asla** çözmeyin, parse etmeyin, inceleyin veya loglayın.

### 2. İstemci Tarafı Depolama Katılığı
Sohbet geçmişi (`cyber_history_`), kişi listesi (`cyber_contacts_`) ve türetilmiş ECDH sırları **yalnızca** tarayıcının IndexedDB / localStorage'ında saklanır. Bu verileri **asla** sunucuya iletmeyin.

### 3. Yerel Web Crypto Kullanımı
Tüm istemci tarafı şifreleme/şifre çözme işlemleri `window.crypto.subtle` API'si ile yapılmalıdır. Harici kriptografi paketleri (crypto-js vb.) **yasaktır**.

### 4. Vanilla Frontend Ekosistemi
İstemci (`siber_e2ee_sohbet_terminali.html`) Vanilla JavaScript ve Tailwind CSS (CDN) kullanır. React, Vue, Svelte veya herhangi bir framework/bundler **yasaktır**.

---

## 🔒 Güvenlik Yapılandırması (FAZ 1 — Tamamlandı)

### JWT Güvenliği
- JWT, bağımlılıksız HMAC-SHA256 ile imzalanır.
- `JWT_SECRET` ortam değişkeni `.env` dosyasından okunur.
- **Üretim ortamında** `.env` yoksa rastgele 32-byte geçici anahtar üretilir (sunucu restart oturumları geçersiz kılar).
- **Geliştirme ortamında** sabit geliştirme anahtarı kullanılır.
- JWT süresi: 24 saat.

### Rate Limiting (Hız Sınırlandırma)
| İşlem | Limit | Pencere |
|-------|-------|---------|
| Kayıt (`register`) | 3 | 60 saniye |
| Giriş (`login`) | 5 | 60 saniye |
| Mesaj gönderimi (`send_packet`) | 60 | 60 saniye |
| ECDH teklifi/yanıtı | 10 | 60 saniye |
| Anahtar istekleri (`get_pubkey`) | 60 | 60 saniye |
| Kullanıcı arama (`search`) | 30 | 60 saniye |
| Profil güncelleme (`update_avatar`) | 10 | 60 saniye |
| Hesap silme (`delete_account`) | 3 | 60 saniye |

### Express Güvenlik Başlıkları
- `Strict-Transport-Security`: HSTS aktif (1 yıl, alt domainler dahil)
- `X-Content-Type-Options`: nosniff
- `X-Frame-Options`: DENY
- `X-XSS-Protection`: 1; mode=block

### CORS ve Proxy Yapılandırması
- CORS origin `CORS_ORIGIN` ortam değişkeniyle ayarlanabilir (varsayılan: `*`).
- `trust proxy` aktif — `x-forwarded-for` header'ı üzerinden gerçek istemci IP'si alınır.
- `allowEIO3` (eski Socket.IO protokolü) kaldırıldı.

### Statik Dosya Güvenliği
- Yalnızca `./public/` dizini HTTP üzerinden sunulur.
- `database.json`, `database.sqlite`, `server.js`, `socket.js`, `package.json` gibi hassas dosyalara HTTP erişimi engellenmiştir.

---

## 🗄️ Veritabanı Mimarisi (FAZ 2 — Tamamlandı)

### SQLite Geçişi
- `database.json` → SQLite (WAL modu) geçişi tamamlandı.
- Otomatik migration: İlk çalıştırmada `database.json` verilerini SQLite'a aktarır ve eski dosyayı `.backup` olarak yedekler.
- Bellek-içi cache (`db.users`, `db.queue`) ile hızlı okuma, transaction bazlı yazma ile veri bütünlüğü.

### Debounced Yazma Mekanizması
- `saveDatabase()`: 50ms debounce ile birleştirilmiş yazma (normal işlemler).
- `saveDatabaseImmediate()`: Anında diske yazma (hesap silme, sunucu kapanışı).
- Write lock ile eşzamanlı yazma çakışması önlenir.

### Çöp Toplayıcı (Garbage Collector)
- Her saat başı çalışır.
- `MAX_PACKET_AGE_MS = 7 gün` süresi dolan çevrimdışı paketleri siler.
- Hem SQLite hem bellek-içi durumu senkronize eder.

---

## 🔗 Bağlantı Yönetimi ve Yeniden Bağlanma

### İstemci Otomatik Yeniden Bağlanma
- Bağlantı koptuğunda (sunucu restart, ağ hatası) istemci otomatik olarak yeniden bağlanmayı dener.
- Maksimum 20 deneme, 2 saniye aralıklarla.
- Yeniden bağlanma sırasında cyberpunk temalı overlay gösterilir, kullanıcı oturumu korunur.
- Başarılı yeniden bağlanmada JWT ile oturum doğrulanır, ECDH anahtarları tekrar yayınlanır.

### Çevrimiçi Durum Takibi
- `onlineNodes` Map'i bellekte tutulur. Sunucu restart durumunda kullanıcılar tekrar giriş yapana kadar çevrimdışı görünür.
- Her kullanıcının birden fazla socket bağlantısı desteklenir (çoklu sekme/cihaz).

---

## 📐 Repo Kuralları ve Bilinen Kırılganlıklar

### Agent ID Formatı
Sistem tarafından üretilen kullanıcı ID'leri `AGN-XXXX-XXXX` formatını takip eder.

### Çift Dil Kuralı
- Kod mimarisi (değişkenler, fonksiyonlar, API olayları): **İngilizce**
- Kullanıcı arayüzü metinleri: **Türkçe**
- UI eklemeleri mevcut "cyber" estetiğine uymalıdır (neon renkler, monospace fontlar, büyük harf, glitch efektleri).

### Revoke Protokolü Kırılganlığı
- `revoke_packet` olayı `packetId`, `senderId` ve `targetId` alanlarının tam eşleşmesine bağlıdır.
- Paket şeması değiştirilirse bu üç alan korunmalıdır.
- DOM'da `msg-{packetId}` ID'siyle element aranır.

### Global State vs. UI Senkronizasyonu
- Frontend global state değişkenleri (`myContacts`, `activeTarget`, `derivedSecrets`, `unreadCounts`) DOM'a otomatik yansımaz.
- State değişikliği sonrası ilgili render fonksiyonları (`renderContactsSidebar()`, `enableChatUI()` vb.) manuel çağrılmalıdır.

### Çevrimdışı Kuyruk Overwrite Riski
- `db.queue[targetId]` dizisine ekleme yapmadan önce her zaman `if (!db.queue[targetId]) db.queue[targetId] = [];` kontrolü yapın.