#!/usr/bin/env bash
set -e

cd "$(dirname "$0")"

echo "======================================================================"
echo " [6] CYBER CHAT TERMINAL - LINUX / MACOS MASAUSTU UYGULAMA DERLEYICI"
echo "======================================================================"
echo ""

if [ ! -d "node_modules" ]; then
    echo "[*] node_modules bulunamadi, bagimliliklar yukleniyor..."
    npm install
fi

OS_NAME="$(uname -s)"
if [ "$OS_NAME" = "Darwin" ]; then
    echo "[+] macOS tespit edildi (.dmg ve .zip paketleri derleniyor)..."
    npm run desktop:build:mac
else
    echo "[+] Linux tespit edildi (.deb ve .AppImage paketleri derleniyor)..."
    npm run desktop:build:linux
fi

echo ""
echo "======================================================================"
echo "[+] TEBRIKLER! Masaustu paketleri 'dist/' klasorunde olusturuldu:"
echo "======================================================================"
ls -lh dist/ 2>/dev/null || true
