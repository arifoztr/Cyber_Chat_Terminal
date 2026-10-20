#!/usr/bin/env bash
set -e

cd "$(dirname "$0")"

echo "======================================================================"
echo " [2] CYBER CHAT TERMINAL - GELISTIRME ORTAMI BASLATICI (LINUX / WSL)"
echo "======================================================================"
echo ""

if [ ! -d "node_modules" ]; then
    echo "[*] node_modules bulunamadi, kurulum betigi calistiriliyor..."
    bash ./1-install-wsl-environment.sh
fi

MODE="${1:-}"
if [ -z "$MODE" ]; then
    echo "Baslatmak istediginiz modu secin:"
    echo "  [1] Web / Relay Sunucusunu Baslat (npm run dev -> http://localhost:3000) [Varsayilan]"
    echo "  [2] Electron Masaustu Uygulamasini Baslat (npm run desktop:start)"
    echo "  [3] Hem Sunucuyu Hem Masaustu Uygulamasini Birlikte Baslat"
    echo "  [0] Cikis"
    echo ""
    read -r -p "Seciminiz (1/2/3/0) [Varsayilan: 1]: " CHOICE
    CHOICE=${CHOICE:-1}
else
    case "$MODE" in
        --server) CHOICE=1 ;;
        --desktop) CHOICE=2 ;;
        --both) CHOICE=3 ;;
        *) CHOICE=1 ;;
    esac
fi

case "$CHOICE" in
    0)
        exit 0
        ;;
    2)
        echo "[+] Cyber Chat Terminal Masaustu (Electron) baslatiliyor..."
        npm run desktop:start
        ;;
    3)
        echo "[+] Yerel sunucu arka planda baslatiliyor..."
        npm run dev &
        SERVER_PID=$!
        trap 'kill $SERVER_PID 2>/dev/null || true' EXIT
        sleep 2
        echo "[+] Electron Masaustu istemcisi baslatiliyor..."
        npm run desktop:start
        ;;
    *)
        echo "[+] Cyber Chat Terminal Sunucusu baslatiliyor (http://localhost:3000)..."
        npm run dev
        ;;
esac
