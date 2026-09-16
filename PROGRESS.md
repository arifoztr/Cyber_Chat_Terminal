# PROJE İLERLEME DURUMU (PROGRESS)

**Mevcut Sürüm:** v10 (Cyber-HUD Edition)
**Proje Odak Noktası:** E2EE (Uçtan Uca Şifreleme), Asenkron ECDH, Çevrimdışı Kuyruklama ve modern arayüze sahip P2P Güvenli Sohbet Terminali.

## 🟢 MEVCUT DURUM (TAMAMLANAN ÖZELLİKLER)
* **Kimlik ve Tünel Altyapısı:** Kullanıcı kayıt/giriş işlemleri `bcrypt` ile güvence altına alınmış, istemciler arası ECDH ile asenkron anahtar takası (Shared Secret) kurulmuştur.
* **Şifreli İletişim:** Mesaj ve dosya içerikleri AES-GCM kullanılarak istemci tarafında şifrelenmektedir. Sunucu metadata dışında bir veriye erişemez.
* **Çevrimdışı İletişim:** Karşı taraf çevrimdışı olduğunda paketler sunucuda kuyruğa alınmakta, oturum açıldığında teslim edilmektedir.
* **İmha Mekanizmaları:** * Kullanıcı tarafından başlatılan "Revoke" (Herkesten Sil) protokolü entegre edilmiştir.
    * TTL (Zaman ayarlı) mesajların geri sayım bitiminde yerel kasadan ve DOM üzerinden otomatik silinmesi sağlanmıştır.
* **Terminal Arayüzü:** Modern siber koyu temalı, sadeleştirilmiş duyarlı (responsive) kart düzeni ve görsel sıkıştırma destekli dosya gönderimi aktiftir. (Ses efektleri ve ağ izleyici [sniffer] sadeleştirme kapsamında arayüzden kaldırılmıştır.)
* **Kullanıcı Arama ve Bildirimler:** Rate-limited kullanıcı arama, karşılıklı kişi ekleme isteği/onayı ve parmak izi doğrulama rehberi entegre edilmiştir.

---

## 🟢 TAMAMLANAN FAZLAR

### FAZ 1 — Güvenlik İyileştirmeleri ✅
* **[x] JWT Entegrasyonu:** Socket bağlantıları JWT (HMAC-SHA256) ile doğrulanmaktadır. Otomatik oturum yenileme ve güvenli fallback hiyerarşisi aktiftir.
* **[x] Fingerprint Doğrulaması:** ECDH açık anahtar parmak izi hesaplama ve doğrulama mekanizması kurulmuştur.
* **[x] İstek Sınırlandırma (Rate Limiting):** Kayıt, giriş, mesaj gönderimi, anahtar istekleri ve arama işlemlerine IP bazlı hız limiti getirilmiştir.
* **[x] Güvenli Aktarım:** Express güvenlik başlıkları (HSTS, X-Content-Type-Options, X-Frame-Options, X-XSS-Protection) aktiftir. Proxy trust yapılandırması ve CORS origin env değişkeniyle kontrol edilmektedir.

### FAZ 2 — Backend Altyapı İyileştirmeleri ✅
* **[x] Veritabanı Geçişi:** `database.json` → SQLite (WAL modunda) geçişi tamamlanmıştır. Otomatik migration, bellek-içi cache ve transaction bazlı yazma mekanizması aktiftir.
* **[x] Asenkron İşlemler:** Tüm dosya/veritabanı işlemleri asenkron Promise tabanlıdır. Debounced yazma (50ms) ve write lock mekanizması uygulanmıştır.
* **[x] Gelişmiş Durum Takibi:** "Yazıyor..." bildirimi ve çevrimiçi/çevrimdışı durum takibi aktiftir.
* **[x] Çevrimdışı Kuyruk:** Çevrimdışı paketler SQLite'da kalıcı olarak saklanmakta, 7 günlük GC ile otomatik temizlenmektedir.

---

## 🟡 GELİŞTİRME YOL HARİTASI (PLANLANAN FAZLAR)

### FAZ 3 — Kriptografik Yapının Geliştirilmesi
* **[ ] İleriye Dönük Gizlilik (Forward Secrecy):** Tek bir oturum anahtarına bağlı kalmamak için her mesaj/oturum bazında yeni anahtar türetimi sağlanacaktır.
* **[ ] Dijital İmza:** Gönderici kaynak doğrulamasını kesinleştirmek adına mesaj bütünlüğünü koruyan dijital imzalama mekanizması eklenecektir.

### FAZ 4 & 5 — Deneyim ve Operasyon
* **[ ] Kapsamlı Profiling:** Profil görseli atama ve nickname sistemleri geliştirilecektir.
* **[ ] DevOps ve Dağıtım:** İstemci ve sunucu bileşenleri bulut ortamında yayınlanacak, sistem olayları için loglama ve izleme (monitoring) altyapısı kurulacaktır.