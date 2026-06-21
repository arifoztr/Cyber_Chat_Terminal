AGENTS.md – Siber E2EE Sohbet Terminali (v10 Cyber-HUD Edition)
📌 Proje Özeti
Bu proje, uçtan uca şifreli (E2EE) bir P2P sohbet terminalidir. İstemciler (web tarayıcıları) arasında ECDH ile anahtar takası yapılır, tüm mesajlar ve dosyalar AES-GCM-256 ile şifrelenir. Sunucu yalnızca signaling ve relay görevi görür; şifreli içerikleri asla çözemez.

Arayüz, cyberpunk / hacker estetiğinde tasarlanmıştır ve gerçek zamanlı ağ trafiği izleyicisi (sniffer), TTL ile kendini imha eden mesajlar, görsel dosya paylaşımı, çevrimdışı kuyruklama ve tamamen istemci tarafında saklanan kriptografik anahtarlar içerir.

🧰 Teknoloji Yığını
Alan  ||    Teknoloji
-------------------    
Frontend  ||    Vanilla JavaScript, Tailwind CSS (CDN), Socket.io (client)
Backend   ||	Node.js, Express, Socket.io (server)
Şifreleme   ||	Web Crypto API (crypto.subtle): AES-GCM, ECDH, SHA-256
Kimlik Doğrulama    ||	JWT (bağımlılıksız, HMAC-SHA256) + bcrypt
Veritabanı  ||	JSON dosyası (database.json) – senkron, debounced yazma
CSS Kütüphanesi ||	Tailwind CSS (CDN) + özel cyberpunk stilleri (style.css)
Fontlar ||	Fira Code, Share Tech Mono



📁 Klasör / Dosya Yapısı
text
/
├── public/
│   ├── client.js                         # Frontend ana mantık (socket, UI, kripto)
│   ├── siber_e2ee_sohbet_terminali.html  # Ana HTML şablonu
│   └── style.css                         # Tüm özel CSS (cyber tema, animasyonlar)
├── database.js                           # JSON veritabanı yönetimi (okuma/yazma, indeks, GC)
├── socket.js                             # Socket.io olay işleyicileri (sunucu tarafı)
├── server.js                             # Express + HTTP sunucu başlangıcı
├── database.json                         # (Çalışma zamanı oluşur) Kullanıcılar ve kuyruklar
├── OPTIMIZATIONS.md                      # Gelecek faz planlaması (güvenlik, ölçeklendirme)
├── PROGRESS.md                           # Mevcut durum ve roadmap
└── AGENTS.md                             # (Bu dosya) – AI asistanı için kılavuz
🤖 AI Asistanı İçin Özel Talimatlar
Bu proje "Vibe Coding" yaklaşımıyla geliştirilmektedir. Aşağıdaki kurallara kesinlikle uyun:

1. Kod Dili ve Yorumlar
-Kod (değişkenler, fonksiyonlar, API olayları) İngilizce olmalıdır.

-Kullanıcı arayüzü metinleri (etiketler, butonlar, tost mesajları) Türkçe olmalıdır.

-Yorumlar Türkçe olabilir, ancak kodun kendisi İngilizce kalmalıdır.

2. Frontend Katmanı
-Vanilla JavaScript kullanın. React, Vue, Svelte veya herhangi bir framework/bundler YASAKTIR.

-Tüm şifreleme işlemleri window.crypto.subtle API'si ile yapılmalıdır. Harici kripto kütüphaneleri kullanmayın.

-CSS eklemeleri Tailwind CDN sınıfları + style.css içindeki özel "cyber" sınıflarla yapılmalıdır.

-Yeni UI öğeleri mevcut neon renk paletine, monospace fontlara, büyük harf kullanımına ve glitch efektlerine uymalıdır.

3. Backend Katmanı
-Sunucu yalnızca signaling ve relay görevi görür. textPayload veya filePayload içeriğini asla çözmeyin, incelemeyin veya loglamayın.

-db nesnesinde yapılan her değişiklikten sonra saveDatabase() çağrılmalıdır (debounced ~50ms).

-Kritik işlemlerde (hesap silme, sunucu kapanışı) saveDatabaseImmediate() kullanın.

-Kuyruğa ekleme yaparken mutlaka if (!db.queue[targetId]) db.queue[targetId] = [] kontrolü yapın.

4. State ve UI Senkronizasyonu
-Frontend global state değişkenleriyle çalışır (myContacts, activeTarget, derivedSecrets).

-State değiştiğinde ilgili UI render fonksiyonlarını manuel olarak tetikleyin (renderContactsSidebar(), enableChatUI() vb.).

-DOM güncellemeleri için document.getElementById() ile doğrudan erişim kullanın.

5. Hata Ayıklama Stili
-Hataları console.error ile loglayın, ancak kullanıcıya showToast() ile Türkçe ve anlaşılır mesajlar gösterin.

-Beklenmeyen durumlar için try/catch blokları kullanın ve UI'da geri bildirim sağlayın.

⚠️ Bilinen Sorunlar / Kırılgan Noktalar
🔴 Revoke Protokolü (Mesaj İmhası)
Kırılganlık: revoke_packet olayı, packetId, senderId ve targetId alanlarının tam eşleşmesine bağlıdır.

Risk: Paket yapısı değişirse (örneğin alan adı değişikliği) iptal çalışmaz. Ayrıca DOM'da msg-{packetId} ID'siyle aranan öğe bulunamazsa hata oluşur.

Öneri: Packet şemasını değiştirirken bu üç alanı koruyun. socket.js içindeki filtreleme mantığını da güncelleyin.

🟡 Veritabanı (JSON) Performansı
Tüm veriler database.json'da saklanır. Çok sayıda kullanıcı veya kuyruk mesajı olduğunda fs.writeFile darboğaz oluşturabilir.

Debounce (50ms) ile yazma işlemleri birleştirilse de, yüksek trafikte tam senkronizasyon sorunları yaşanabilir.

Gelecek: SQLite/MongoDB'ye geçiş planlanmaktadır (FAZ 2).

🟠 Frontend State Yönetimi
Global değişkenler üzerinden yapılan tüm mutasyonlar DOM'a otomatik yansımaz.

Örneğin unreadCounts güncellenir, ancak renderContactsSidebar() çağrılmazsa kullanıcı göremez.

Çözüm: State değişikliği yapan her fonksiyonun sonunda ilgili render fonksiyonlarını çağırdığından emin olun.

🔵 Offline Kuyruk (Queue) Overwrite Rsiski
socket.js içinde db.queue[packet.targetId] = db.queue[packet.targetId] || [] kontrolü yapılmazsa, mevcut kuyruk yanlışlıkla sıfırlanabilir.

Fix: Her ekleme öncesi if (!db.queue[targetId]) db.queue[targetId] = []; kontrolü eklenmiştir, ancak bu kuralı her yeni işlemde hatırlayın.

🟣 JWT ve Oturum Yönetimi
JWT, bağımlılıksız olarak HMAC-SHA256 ile imzalanmıştır. JWT_SECRET değişkeni .env'den okunmalıdır (prod ortamında).

Şu an process.env.JWT_SECRET yoksa sabit anahtar kullanılır – bu güvenlik zafiyetidir.

Öneri: .env dosyası oluşturup JWT_SECRET tanımlayın ve dotenv ekleyin.

🧪 Test ve Doğrulama İpuçları
Test Senaryosu	Nasıl Doğrulanır
ECDH Anahtar Takası	İki taraf da giriş yaptıktan sonra derivedSecrets objesinde karşılıklı anahtar var mı kontrol edin.
Mesaj Şifreleme	Sniffer log'unda textPayload alanının şifreli (base64) göründüğünden emin olun.
Revoke (İmha)	Mesaj gönderip "İMHA ET" butonuna tıklayın. Karşı tarafta mesaj kaybolmalı.
TTL (Zamanlı İmha)	TTL süresi dolduğunda mesaj hem DOM'dan hem de IDB'den silinmeli.
Çevrimdışı Kuyruk	Hedef çevrimdışıyken mesaj gönderin. Hedef giriş yaptığında mesajlar gelmeli.
📎 Ek Notlar
OPTIMIZATIONS.md ve PROGRESS.md dosyaları, gelecek planlamaları içerir. FAZ 1–5 arası güvenlik, ölçeklenebilirlik ve deneyim iyileştirmeleri burada detaylandırılmıştır.

database.js içindeki MAX_PACKET_AGE_MS = 7 gün değeri, kuyruktaki mesajların otomatik temizlenme süresidir.

Sniffer (ağ dinleyici) yalnızca metadata'yı gösterir, şifreli içerik asla görüntülenmez.

Son Güncelleme: 2026-06-20
Versiyon: v10 (Cyber-HUD Edition)
Maintainer: Vibe Coding Collective 🚀