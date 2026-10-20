#!/usr/bin/env bash
set -e

cd "$(dirname "$0")"

echo "======================================================================"
echo " [4] CYBER CHAT TERMINAL - API DOKUMANTASYONU DERLEME (JSDoc)"
echo "======================================================================"
echo ""

if [ ! -d "node_modules" ]; then
    echo "[*] node_modules bulunamadi, bagimliliklar yukleniyor..."
    npm install
fi

echo "[+] JSDoc ile HTML API dokumantasyonu uretiliyor (docs/api)..."
npm run docs

echo ""
echo "======================================================================"
echo "[+] TEBRIKLER! API Dokumantasyonu basariyla olusturuldu."
echo "[+] Konum: docs/api/index.html"
echo "======================================================================"
