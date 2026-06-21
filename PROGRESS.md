# PROJE İLERLEME DURUMU (PROGRESS)

**Mevcut Sürüm:** v8.6 (Revoke Fix Aktif)
**Proje Odak Noktası:** E2EE (Uçtan Uca Şifreleme), Asenkron ECDH, Çevrimdışı Kuyruklama ve Ağ Dinleme (Sniffer) yeteneklerine sahip P2P Terminal.

## 🟢 MEVCUT DURUM (TAMAMLANAN ÖZELLİKLER)
* **Kimlik ve Tünel Altyapısı:** Kullanıcı kayıt/giriş işlemleri `bcrypt` ile güvence altına alınmış, istemciler arası ECDH ile asenkron anahtar takası (Shared Secret) kurulmuştur.
* **Şifreli İletişim:** Mesaj ve dosya içerikleri AES-GCM kullanılarak istemci tarafında şifrelenmektedir. Sunucu metadata dışında bir veriye erişemez.
* **Çevrimdışı İletişim:** Karşı taraf çevrimdışı olduğunda paketler sunucuda kuyruğa alınmakta, oturum açıldığında teslim edilmektedir.
* **İmha Mekanizmaları:** * Kullanıcı tarafından başlatılan "Revoke" (Herkesten Sil) protokolü entegre edilmiştir.
    * TTL (Zaman ayarlı) mesajların geri sayım bitiminde yerel kasadan ve DOM üzerinden otomatik silinmesi sağlanmıştır.
* **Terminal Arayüzü:** Ağ paketlerini izleyen sniffer, siber güvenlik temalı UI ve görsel sıkıştırma destekli dosya gönderimi aktiftir.

---

## 🟡 GELİŞTİRME YOL HARİTASI (PLANLANAN FAZLAR)

[cite_start]Aşağıdaki fazlar, mevcut sistemin güvenlik ve ölçeklenebilirlik açısından üretim (production) ortamına hazırlanması için planlanmıştır[cite: 1, 29].

### FAZ 1 — Güvenlik İyileştirmeleri
* [cite_start]**[ ] JWT Entegrasyonu:** Kullanıcı girişlerinde socket bağlantıları için JSON Web Token tabanlı kimlik doğrulamasına geçilecektir[cite: 3, 4].
* [cite_start]**[ ] Fingerprint Doğrulaması:** Ortadaki adam (MITM) saldırılarını engellemek için açık anahtarlar arası parmak izi doğrulama mekanizması kurulacaktır[cite: 6].
* [cite_start]**[ ] İstek Sınırlandırma (Rate Limiting):** Brute-force ve spam engellemek için giriş/kayıt ve mesaj akışına limit getirilecektir[cite: 7, 8].
* [cite_start]**[ ] Güvenli Aktarım:** Veri transferi HTTPS üzerinden yapılacak, Cookie kullanımı halinde `httpOnly` ve `secure` bayrakları eklenecektir[cite: 9].

### FAZ 2 — Backend Altyapı İyileştirmeleri
* [cite_start]**[ ] Veritabanı Geçişi:** Mevcut `database.json` yapısından daha ölçeklenebilir olan SQLite veya MongoDB gibi bir sisteme geçilecektir[cite: 11].
* [cite_start]**[ ] Asenkron İşlemler:** Sunucu performansını artırmak adına senkron dosya işlemleri asenkron hale getirilecektir[cite: 13].
* [cite_start]**[ ] Gelişmiş Durum Takibi:** Sadece "çevrimiçi/çevrimdışı" bilgisi yerine "son görülme" ve "yazıyor..." bilgileri sisteme dahil edilecektir[cite: 14].
* [cite_start]**[ ] Kalıcı Kuyruk:** Çevrimdışı mesaj kuyruğu bellekte tutulmak yerine Redis gibi kalıcı bir sistemle yönetilecektir[cite: 16].

### FAZ 3 — Kriptografik Yapının Geliştirilmesi
* [cite_start]**[ ] İleriye Dönük Gizlilik (Forward Secrecy):** Tek bir oturum anahtarına bağlı kalmamak için her mesaj/oturum bazında yeni anahtar türetimi sağlanacaktır[cite: 19, 20].
* [cite_start]**[ ] Dijital İmza:** Gönderici kaynak doğrulamasını kesinleştirmek adına mesaj bütünlüğünü koruyan dijital imzalama mekanizması eklenecektir[cite: 21, 22].

### FAZ 4 & 5 — Deneyim ve Operasyon
* [cite_start]**[ ] Kapsamlı Profiling:** Kullanıcı arama özellikleri, profil görseli atama ve nickname sistemleri geliştirilecektir[cite: 25].
* [cite_start]**[ ] DevOps ve Dağıtım:** İstemci ve sunucu bileşenleri bulut ortamında yayınlanacak [cite: 26][cite_start], sistem olayları için loglama ve izleme (monitoring) altyapısı kurulacaktır[cite: 27, 28].