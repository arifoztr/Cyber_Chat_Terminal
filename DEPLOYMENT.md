# Siber E2EE Sohbet Terminali — Dağıtım Kılavuzu (Hibrit Mimari)

Bu kılavuz, projenizi **Frontend: Cloudflare Pages** ve **Backend: Bulut (Render / Railway / VPS)** üzerinde 7/24 canlıya almak için gereken adımları içerir.

---

## 🏗️ Mimari Şema

```
[Kullanıcı Tarayıcısı]
        │
        ├── (HTTPS) ────────► [Cloudflare Pages] (public/ statik dosyaları)
        │
        └── (WSS/WebSockets) ► [Backend: Render/Railway/VPS] (Node.js + Socket.IO + SQLite)
```

---

## 🚀 ADIM 1: Backend Dağıtımı

Backend'inizi barındırmak için aşağıdaki seçeneklerden birini seçin:

### Seçenek A: Render.com (Önerilen / Kolay)
1. [render.com](https://render.com) üzerinde ücretsiz hesap açın.
2. **New +** butonuna basıp **Web Service** seçin.
3. GitHub deponuzu (`Arif8054/Cyber_Chat_Terminal`) bağlayın.
4. Ayarları şu şekilde yapın:
   - **Name:** `cyber-backend` (veya istediğiniz bir isim)
   - **Environment:** `Node` veya `Docker`
   - **Build Command:** `npm install` (Node seçtiyseniz)
   - **Start Command:** `node server.js` (Node seçtiyseniz)
   - **Plan:** Free
5. **Environment Variables** (Ortam Değişkenleri) sekmesinde ekleyin:
   - `NODE_ENV`: `production`
   - `JWT_SECRET`: En az 32 karakterlik rastgele bir metin
   - `CORS_ORIGIN`: Cloudflare Pages adresiniz (Deploy sonrası güncelleyebilirsiniz, şimdilik boş bırakabilirsiniz)
6. **Create Web Service** butonuna tıklayın.
7. Dağıtım tamamlandığında size bir adres verilecektir:  
   👉 `https://cyber-backend.onrender.com`

---

### Seçenek B: Railway.app (SQLite Kalıcı Disk İçin İdeal)
1. [railway.app](https://railway.app) üzerinde GitHub ile giriş yapın.
2. **New Project** -> **Deploy from GitHub repo** seçin ve bu depoyu seçin.
3. Servis ayarlarına gidip **Variables** bölümünden `JWT_SECRET` ekleyin.
4. SQLite verilerinin sıfırlanmaması için:
   - **Add Volume** seçeneğiyle bir kalıcı disk ekleyin (Bağlama noktası: `/data`).
   - Ortam değişkenlerine `DB_PATH=/data/database.sqlite` ekleyin.
5. **Generate Domain** butonuna basarak backend adresinizi alın:  
   👉 `https://cyber-production.up.railway.app`

---

### Seçenek C: VPS / Kendi Linux Sunucunuz (Docker ile)
```bash
# Depoyu sunucuya çekin
git clone https://github.com/Arif8054/Cyber_Chat_Terminal.git
cd Cyber_Chat_Terminal

# Docker imajını oluşturun ve başlatın
docker build -t cyber-backend .
docker run -d -p 3000:3000 -v $(pwd)/data:/app/data -e DB_PATH=/app/data/database.sqlite --name cyber-chat cyber-backend
```

---

## 🌐 ADIM 2: Frontend Dağıtımı (Cloudflare Pages)

1. [dash.cloudflare.com](https://dash.cloudflare.com) adresine giriş yapın.
2. Sol menüden **Workers & Pages** -> **Create application** -> **Pages** sekmesini seçin.
3. **Connect to Git** (Git'e Bağlan) butonuna tıklayın ve GitHub hesabınızı yetkilendirin.
4. `Arif8054/Cyber_Chat_Terminal` deposunu seçin ve **Begin setup** deyin.
5. Dağıtım ayarlarını şu şekilde doldurun:
   - **Project name:** `cyber-chat` (isteğe bağlı)
   - **Production branch:** `main`
   - **Framework preset:** `None`
   - **Build command:** *(BOŞ BIRAKIN)*
   - **Build output directory:** `public`
6. **Save and Deploy** butonuna tıklayın.
7. Yaklaşık 15-30 saniye içinde siteniz yayında olacaktır!  
   👉 Örnek adres: `https://cyber-chat.pages.dev`

---

## 🔗 ADIM 3: Frontend ve Backend'i Birbirine Bağlama

1. Bilgisayarınızdaki `public/config.js` dosyasını açın:
   ```javascript
   window.APP_CONFIG = {
       // ADIM 1'de aldığınız backend adresini buraya yapıştırın:
       BACKEND_URL: "https://cyber-backend.onrender.com"
   };
   ```
2. Değişikliği kaydedip GitHub'a gönderin:
   ```bash
   git add public/config.js
   git commit -m "Configure backend URL for Cloudflare Pages"
   git push origin main
   ```
3. Cloudflare Pages otomatik olarak yeni commit'i algılar ve saniyeler içinde güncellemeyi canlıya alır.

---

## 🔒 Güvenlik & CORS Sıkılaştırma (Opsiyonel)

Sistem canlıya alındıktan sonra, backend sunucunuzun ortam değişkenlerine şunu ekleyerek yalnızca kendi Cloudflare sitenizden gelen isteklere izin verebilirsiniz:

- `CORS_ORIGIN`: `https://cyber-chat.pages.dev`
