#!/usr/bin/env bash
set -e

cd "$(dirname "$0")"

echo "======================================================================"
echo " [1] CYBER CHAT TERMINAL - LINUX / WSL GELISTIRME ORTAMI KURULUMU"
echo "======================================================================"
echo ""

# 1. Node.js ve npm kontrolu
echo "[*] Node.js ve sistem bagimliliklari kontrol ediliyor..."
if ! command -v node >/dev/null 2>&1; then
    echo "[!] Node.js bulunamadi!"
    if command -v apt-get >/dev/null 2>&1; then
        read -r -p "Node.js, npm ve libfuse2 apt ile kurulsun mu? (E/H) [Varsayilan: E]: " INSTALL_NODE
        INSTALL_NODE=${INSTALL_NODE:-E}
        if [[ "$INSTALL_NODE" =~ ^[EeYy]$ ]]; then
            sudo apt-get update
            sudo apt-get install -y nodejs npm libfuse2
        else
            echo "[!] Lutfen Node.js v20+ yukleyip tekrar deneyin."
            exit 1
        fi
    else
        echo "[!] Lutfen dagitiminizin paket yoneticisi ile Node.js v20+ yukleyin."
        exit 1
    fi
else
    echo "[+] Node.js surumu : $(node -v)"
    echo "[+] npm surumu     : v$(npm -v)"
fi

# 2. .env dosyasi kontrolu
echo ""
echo "[*] Ortam degiskenleri (.env) kontrol ediliyor..."
if [ ! -f ".env" ]; then
    if [ -f ".env.example" ]; then
        cp ".env.example" ".env"
        echo "[+] .env.example dosyasindan varsayilan .env dosyasi olusturuldu."
    else
        cat <<EOF > .env
PORT=3000
NODE_ENV=development
JWT_SECRET=cyber_dev_secret_key_change_in_production_min_32_chars
CORS_ORIGIN=*
DB_PATH=./src/database.sqlite
EOF
        echo "[+] Varsayilan .env dosyasi olusturuldu."
    fi
else
    echo "[+] Mevcut .env dosyasi korundu."
fi

# 3. npm install
echo ""
echo "======================================================================"
echo "[+] Proje bagimliliklari yukleniyor (npm install)..."
echo "======================================================================"
npm install

# 4. Betiklere calistirma izni tanimlama
chmod +x ./*.sh 2>/dev/null || true

echo ""
echo "======================================================================"
echo "[+] TEBRIKLER! Linux/WSL gelistirme ortami basariyla hazirlandi."
echo "======================================================================"
