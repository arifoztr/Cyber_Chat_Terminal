@echo off
setlocal enabledelayedexpansion

title Cyber Chat Terminal - [4] JSDoc API Dokumantasyon Derleyici
cd /d "%~dp0"

echo ======================================================================
echo  [4] CYBER CHAT TERMINAL - API DOKUMANTASYONU DERLEME (JSDoc)
echo ======================================================================
echo.

if not exist "node_modules\" (
    echo [*] node_modules bulunamadi, bagimliliklar yukleniyor...
    call npm.cmd install
)

echo [+] JSDoc ile HTML API dokumantasyonu uretiliyor (docs\api)...
call npm.cmd run docs

if errorlevel 1 (
    echo.
    echo ======================================================================
    echo [!] HATA: Dokumantasyon derlenirken bir hata olustu!
    echo ======================================================================
    pause
    exit /b 1
)

echo.
echo ======================================================================
echo [+] TEBRIKLER! API Dokumantasyonu basariyla olusturuldu.
echo [+] Konum: docs\api\index.html
echo ======================================================================
echo.

if /i "%~1"=="--no-pause" exit /b 0

set "OPEN_DOC=E"
set /p "OPEN_DOC=Dokumantasyonu tarayicida acmak ister misiniz? (E/H) [Varsayilan: E]: "
if /i "%OPEN_DOC%"=="H" goto son
if /i "%OPEN_DOC%"=="N" goto son

if exist "docs\api\index.html" (
    echo [+] Dokumantasyon tarayicida aciliyor...
    start "" "docs\api\index.html"
)

:son
echo.
echo Islem tamamlandi.
exit /b 0
