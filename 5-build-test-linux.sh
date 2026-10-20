#!/usr/bin/env bash
set -e

cd "$(dirname "$0")"

echo "======================================================================"
echo " [5] CYBER CHAT TERMINAL - UNIT TESTLER & KAPSAM (COVERAGE) RAPORU"
echo "======================================================================"
echo ""

if [ ! -d "node_modules" ]; then
    echo "[*] node_modules bulunamadi, bagimliliklar yukleniyor..."
    npm install
fi

if [ "${1:-}" = "--watch" ]; then
    echo "[+] Canli test izleme modu (vitest watch) baslatiliyor..."
    npm run test:watch
    exit 0
fi

echo "[+] Testler calistiriliyor ve v8 Kapsam Analizi yapiliyor..."
echo ""

npm test

echo ""
echo "======================================================================"
echo "[+] TEBRIKLER! Tum testler basariyla gecti."
echo "[+] HTML Kapsam Raporu hazirlandi: coverage/index.html"
echo "======================================================================"
