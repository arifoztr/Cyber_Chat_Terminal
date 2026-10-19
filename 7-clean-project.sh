#!/usr/bin/env bash
set -e

cd "$(dirname "$0")"

echo "======================================================================"
echo " [7] CYBER CHAT TERMINAL - PROJE TEMIZLEME ARACI (LINUX / WSL)"
echo "======================================================================"
echo ""

MODE="${1:-}"
if [ -z "$MODE" ]; then
    echo "Yapmak istediginiz temizlik seviyesini secin:"
    echo "  [1] Standart Temizlik: dist, coverage, docs/api ve gecici dosyalari sil [Varsayilan]"
    echo "  [2] Derin Temizlik   : Standart Temizlik + node_modules klasorunu tamamen sil"
    echo "  [3] Sadece desktop.ini ve gecici log dosyalarini temizle"
    echo "  [0] Cikis"
    echo ""
    read -r -p "Seciminiz (1/2/3/0) [Varsayilan: 1]: " CHOICE
    CHOICE=${CHOICE:-1}
else
    case "$MODE" in
        --soft) CHOICE=1 ;;
        --all) CHOICE=2 ;;
        --ini) CHOICE=3 ;;
        *) CHOICE=1 ;;
    esac
fi

if [ "$CHOICE" = "0" ]; then
    exit 0
fi

if [ "$CHOICE" = "1" ] || [ "$CHOICE" = "2" ]; then
    echo "[+] Derleme ve rapor klasorleri (dist, coverage, docs/api) temizleniyor..."
    rm -rf dist dist-electron coverage docs/api test_tmp_dir_check
fi

if [ "$CHOICE" = "2" ]; then
    echo "[+] node_modules klasoru siliniyor..."
    rm -rf node_modules
fi

echo "[+] desktop.ini ve gecici log dosyalari temizleniyor..."
find . -name "desktop.ini" -type f -delete 2>/dev/null || true
rm -f ./*.log

echo ""
echo "======================================================================"
echo "[+] TEBRIKLER! Proje temizligi basariyla tamamlandi."
echo "======================================================================"
