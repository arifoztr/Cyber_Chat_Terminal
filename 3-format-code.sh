#!/usr/bin/env bash
set -e

cd "$(dirname "$0")"

echo "======================================================================"
echo " [3] CYBER CHAT TERMINAL - KOD FORMATLAMA VE SYNTAX KONTROLU"
echo "======================================================================"
echo ""

echo "[+] JavaScript dosyalari uzerinde sozdizimi (syntax) kontrolu yapiliyor..."
for f in src/*.js electron/*.js public/*.js; do
    if [ -f "$f" ]; then
        node --check "$f"
        echo "  [OK] $f"
    fi
done

echo ""
echo "[+] Prettier ile kod bicimlendirme calistiriliyor..."
npx --yes prettier --write "src/**/*.js" "electron/**/*.js" "tests/**/*.js" "public/*.js" --single-quote --tab-width 4

echo ""
echo "======================================================================"
echo "[+] TEBRIKLER! Tum kaynak kodlar dogrulandi ve bicimlendirildi."
echo "======================================================================"
