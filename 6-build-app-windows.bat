@echo off
setlocal enabledelayedexpansion

title Cyber Chat Terminal - [6] Windows Exe Derleyici
cd /d "%~dp0"

echo ======================================================================
echo  [6] CYBER CHAT TERMINAL - WINDOWS EXE DERLEME ^& GUNCELLEME ARACI
echo ======================================================================
echo.

:: Parametre kontrolu
if /i "%~1"=="--pull" goto op_pull
if /i "%~1"=="--install" goto op_install
if /i "%~1"=="--build" goto op_build

echo Yapmak istediginiz islemi secin:
echo   [1] Dogrudan Exe Derle (npm run desktop:build) [Varsayilan]
echo   [2] Git Pull + Bagimliliklari Guncelle (npm install) + Exe Derle
echo   [3] Bagimliliklari Guncelle (npm install) + Exe Derle
echo   [0] Cikis
echo.

set "CHOICE=1"
set /p "CHOICE=Seciminiz (1/2/3/0) [Varsayilan: 1]: "

if "%CHOICE%"=="0" goto son
if "%CHOICE%"=="2" goto op_pull
if "%CHOICE%"=="3" goto op_install
if "%CHOICE%"=="1" goto op_build
goto op_build

:op_pull
echo.
echo ======================================================================
echo [+] Git uzerindeki degisiklikler cekiliyor (git pull)...
echo ======================================================================
call git pull
if errorlevel 1 (
    echo.
    echo [!] UYARI: Git pull sirasinda bir uyari veya cakisma olustu.
    set /p "DEVAM=Yine de derlemeye devam edilsin mi? (E/H) [Varsayilan: H]: "
    if /i not "!DEVAM!"=="E" (
        echo Derleme iptal edildi.
        pause
        exit /b 1
    )
)

:op_install
echo.
echo ======================================================================
echo [+] Bagimliliklar kontrol ediliyor ve yukleniyor (npm install)...
echo ======================================================================
call npm.cmd install
if errorlevel 1 (
    echo.
    echo [!] HATA: npm install basarisiz oldu!
    pause
    exit /b 1
)

:op_build
echo.
echo ======================================================================
echo [+] Calisan eski Cyber Chat Terminal surecleri kapatiliyor...
echo ======================================================================
taskkill /F /IM "Cyber Chat Terminal.exe" /T >nul 2>&1

if not exist "node_modules\" (
    echo [*] node_modules klasoru bulunamadi, npm install calistiriliyor...
    call npm.cmd install
    if errorlevel 1 (
        echo [!] HATA: Bagimliliklar yuklenemedi!
        pause
        exit /b 1
    )
)

echo.
echo ======================================================================
echo [+] Windows Exe Paketleri Derleniyor (electron-builder)...
echo ======================================================================
echo Bu islem sistem hizina bagli olarak 1-2 dakika surebilir...
echo.

call npm.cmd run desktop:build

if errorlevel 1 (
    echo.
    echo ======================================================================
    echo [!] HATA: Exe derleme islemi basarisiz oldu!
    echo ======================================================================
    echo Lutfen hata mesajlarini yukaridan kontrol edin.
    echo.
    pause
    exit /b 1
)

echo.
echo ======================================================================
echo [+] TEBRIKLER! Exe dosyalari basariyla derlendi ve guncellendi.
echo ======================================================================
echo.
echo Olusturulan Paketler (dist klasorunde):
if exist "dist\Cyber Chat Terminal Setup 1.0.0.exe" (
    echo   - Kurulum Dosyasi : dist\Cyber Chat Terminal Setup 1.0.0.exe
)
if exist "dist\Cyber Chat Terminal 1.0.0.exe" (
    echo   - Portable Exe    : dist\Cyber Chat Terminal 1.0.0.exe
)
if exist "dist\win-unpacked\" (
    echo   - Klasor Ciktisi  : dist\win-unpacked\
)
echo.

echo Sonraki islem:
echo   [1] dist klasorunu Dosya Gezgininde ac [Varsayilan]
echo   [2] Yeni derlenen Portable Exe yi calistir
echo   [3] Cikis
echo.

set "POST_ACTION=1"
set /p "POST_ACTION=Seciminiz (1/2/3) [Varsayilan: 1]: "

if "%POST_ACTION%"=="2" (
    if exist "dist\Cyber Chat Terminal 1.0.0.exe" (
        echo [+] Cyber Chat Terminal baslatiliyor...
        start "" "dist\Cyber Chat Terminal 1.0.0.exe"
    )
    goto son
)

if "%POST_ACTION%"=="1" (
    echo [+] dist klasoru aciliyor...
    start "" "dist"
    goto son
)

:son
echo.
echo Islem tamamlandi.
exit /b 0
