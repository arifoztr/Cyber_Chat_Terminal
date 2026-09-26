# Siber E2EE Sohbet Terminali — Dağıtım Kılavuzu (Hibrit & Bulut Mimari)

Bu kılavuz, projenizi **Frontend: Cloudflare Pages / Vercel** ve **Backend: Bulut (Render / Railway / Turso / VPS)** üzerinde 7/24 kesintisiz ve güvenli şekilde canlıya almak için gereken adımları içerir.

---

## 🏗️ Mimari Şema

```text
[Kullanıcı Tarayıcısı / Electron Masaüstü]
        │
        ├── (HTTPS) ────────► [Cloudflare Pages] (public/ statik web arayüzü)
        │
        └── (WSS/WebSockets) ► [Backend: Render / Railway / VPS] (Node.js + Socket.IO)
                                       │
                                       └── (HTTPS / IPC) ──► [Turso Cloud DB veya Yerel SQLite]
```

---

## 🚀 ADIM 1: Veritabanı Seçimi (Önerilen: Turso Cloud)

Proje hem yerel dosya tabanlı SQLite hem de bulut tabanlı **Turso (LibSQL)** destekler. Kalıcı disk maliyeti olmadan sunucusuz (serverless) çalışmak için Turso en ideal çözümdür:

1. [turso.tech](https://turso.tech) üzerinde ücretsiz bir hesap oluşturun.
2. CLI veya web paneli üzerinden yeni bir veritabanı açın:
   ```bash
   turso db create cyber-db
   turso db show cyber-db --url
   turso db tokens create cyber-db
   ```
3. Elde ettiğiniz bağlantı URL'sini (`TURSO_DATABASE_URL`) ve yetki belirtecini (`TURSO_AUTH_TOKEN`) bir kenara not edin.

---

## 🚀 ADIM 2: Backend Dağıtımı

### Seçenek A: Render.com (Önerilen)
1. [render.com](https://render.com) üzerinde oturum açın.
2. **New +** -> **Web Service** seçeneğine tıklayın.
3. GitHub deponuzu bağlayın.
4. Temel ayarları yapın:
   - **Name:** `cyber-backend`
   - **Environment:** `Node`
   - **Build Command:** `npm install`
   - **Start Command:** `npm start` (veya `node src/server.js`)
   - **Plan:** Free
5. **Environment Variables** (Ortam Değişkenleri) sekmesinde ekleyin:
   - `NODE_ENV`: `production`
   - `JWT_SECRET`: En az 32 karakterlik güçlü rastgele metin
   - `TURSO_DATABASE_URL`: *(Turso kullanıyorsanız libSQL URL'si)*
   - `TURSO_AUTH_TOKEN`: *(Turso auth token)*
   - `CORS_ORIGIN`: Cloudflare Pages alan adınız (ör. `https://cyber-chat.pages.dev`)
6. **Create Web Service** butonuna basarak dağıtımı tamamlayın.
   👉 Backend URL: `https://cyber-backend.onrender.com`

---

### Seçenek B: Railway.app (Yerel SQLite Diski İle)
1. [railway.app](https://railway.app) üzerinde GitHub ile giriş yapın.
2. **New Project** -> **Deploy from GitHub repo** adımlarını izleyin.
3. Turso kullanmıyorsanız ve verileri sunucu içi SQLite'ta tutmak istiyorsanız:
   - Servis paneline gidin, **Add Volume** ile `/data` dizinine kalıcı bir disk bağlayın.
   - Değişkenlere `DB_PATH=/data/database.sqlite` ekleyin.
4. `JWT_SECRET` ve `NODE_ENV=production` değişkenlerini tanımlayın.
5. **Generate Domain** ile genel URL'nizi alın:  
   👉 `https://cyber-production.up.railway.app`

---

### Seçenek C: VPS / Kendi Linux Sunucunuz (Docker İle)
```bash
# Depoyu sunucuya klonlayın
git clone https://github.com/Arif8054/Cyber_Chat_Terminal.git
cd Cyber_Chat_Terminal

# Docker imajını derleyin ve arka planda çalıştırın
docker build -t cyber-backend .
docker run -d \
  -p 3000:3000 \
  -v $(pwd)/data:/app/data \
  -e DB_PATH=/app/data/database.sqlite \
  -e JWT_SECRET="guclu-rastgele-gizli-anahtar-32-karakter" \
  -e NODE_ENV="production" \
  --name cyber-chat \
  cyber-backend
```

---

## 🌐 ADIM 3: Frontend Dağıtımı (Cloudflare Pages)

1. [dash.cloudflare.com](https://dash.cloudflare.com) adresine giriş yapın.
2. **Workers & Pages** -> **Create application** -> **Pages** -> **Connect to Git** seçin.
3. `Cyber_Chat_Terminal` deponuzu seçin.
4. Dağıtım ayarlarını şu şekilde yapılandırın:
   - **Framework preset:** `None`
   - **Build command:** *(BOŞ BIRAKIN)*
   - **Build output directory:** `public`
5. **Save and Deploy** butonuna tıklayın. Siteniz yaklaşık 20 saniye içinde yayına girecektir.  
   👉 Örnek URL: `https://cyber-chat.pages.dev`

---

## 🔗 ADIM 4: Frontend ve Backend'i Bağlama

İstemcinin canlıdaki sunucuya otomatik olarak bağlanması için:

1. `public/config.js` dosyasını açın:
   ```javascript
   window.APP_CONFIG = {
       BACKEND_URL: "https://cyber-backend.onrender.com" // Kendi backend adresiniz
   };
   ```
2. Değişikliği commit edip GitHub'a gönderin:
   ```bash
   git add public/config.js
   git commit -m "Configure production backend URL"
   git push origin main
   ```
3. Cloudflare Pages otomatik olarak yeni commit'i algılar ve saniyeler içinde günceller.

---

## 🔒 Güvenlik Sertleştirmesi (CORS & CSWSH)

Backend sunucunuzun ortam değişkenlerine `CORS_ORIGIN` tanımlayarak yetkisiz kaynaklardan gelen WebSocket bağlantılarını (CSWSH) tamamen engelleyin:

```env
CORS_ORIGIN=https://cyber-chat.pages.dev
```

---

**Son Güncelleme:** 2026-09-26  
**Doküman Sürümü:** v2.0
