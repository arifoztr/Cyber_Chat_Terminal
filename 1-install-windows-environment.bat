@echo off
setlocal enabledelayedexpansion

title Cyber Chat Terminal - [1] Windows Ortam ve Bagimlilik Kurulumu
cd /d "%~dp0"

echo ======================================================================
echo  [1] CYBER CHAT TERMINAL - WINDOWS GELISTIRME ORTAMI KURULUMU
echo ======================================================================
echo.

:: 1. Node.js kontrolu
echo [*] Node.js kurulumu kontrol ediliyor...
where node >nul 2>&1
if errorlevel 1 (
    echo [!] Node.js bulunamadi!
    where winget >nul 2>&1
    if not errorlevel 1 (
        set /p "INSTALL_NODE=Node.js LTS winget ile otomatik kurulsun mu? (E/H) [Varsayilan: E]: "
        if /i not "!INSTALL_NODE!"=="H" (
            echo [+] Node.js LTS kuruluyor...
            winget install OpenJS.NodeJS.LTS --accept-source-agreements --accept-package-agreements
            echo [*] Kurulum tamamlandi. PATH degisikliklerinin aktif olmasi icin terminali yeniden baslatmaniz gerekebilir.
        ) else (
            echo [!] Lutfen https://nodejs.org adresinden Node.js v20+ yukleyin.
            pause
            exit /b 1
        )
    ) else (
        echo [!] Lutfen https://nodejs.org adresinden Node.js v20+ yukleyin.
        pause
        exit /b 1
    )
) else (
    for /f "delims=" %%v in ('node -v') do echo [+] Node.js surumu : %%v
    for /f "delims=" %%n in ('npm.cmd -v') do echo [+] npm surumu     : v%%n
)

:: 2. .env dosyasi kontrolu
echo.
echo [*] Ortam degiskenleri (.env) kontrol ediliyor...
if not exist ".env" (
    if exist ".env.example" (
        copy /y ".env.example" ".env" >nul
        echo [+] .env.example dosyasindan varsayilan .env dosyasi olusturuldu.
    ) else (
        echo [!] .env.example bulunamadi, varsayilan .env olusturuluyor...
        (
            echo PORT=3000
            echo NODE_ENV=development
            echo JWT_SECRET=cyber_dev_secret_key_change_in_production_min_32_chars
            echo CORS_ORIGIN=*
            echo DB_PATH=./src/database.sqlite
        ) > ".env"
        echo [+] Varsayilan .env dosyasi olusturuldu.
    )
) else (
    echo [+] Mevcut .env dosyasi korundu.
)

:: 3. Bagimliliklarin yuklenmesi
echo.
echo ======================================================================
echo [+] Proje bagimliliklari yukleniyor (npm install)...
echo ======================================================================
call npm.cmd install
if errorlevel 1 (
    echo.
    echo [!] HATA: npm install sirasinda bir hata olustu!
    pause
    exit /b 1
)

echo.
echo ======================================================================
echo [+] TEBRIKLER! Windows gelistirme ortami basariyla hazirlandi.
echo ======================================================================
echo.
if /i not "%~1"=="--no-pause" pause
exit /b 0
