@echo off
setlocal enabledelayedexpansion

title Cyber Chat Terminal - [5] Unit Test ^& Coverage Runner
cd /d "%~dp0"

echo ======================================================================
echo  [5] CYBER CHAT TERMINAL - UNIT TESTLER ^& KAPSAM (COVERAGE) RAPORU
echo ======================================================================
echo.

if not exist "node_modules\" (
    echo [*] node_modules bulunamadi, bagimliliklar yukleniyor...
    call npm.cmd install
)

if /i "%~1"=="--watch" (
    echo [+] Canli test izleme modu (vitest watch) baslatiliyor...
    call npm.cmd run test:watch
    exit /b 0
)

echo [+] Testler calistiriliyor ve v8 Kapsam Analizi yapiliyor...
echo.

call npm.cmd test

if errorlevel 1 (
    echo.
    echo ======================================================================
    echo [!] HATA: Bazi testler basarisiz oldu!
    echo ======================================================================
    echo.
    pause
    exit /b 1
)

echo.
echo ======================================================================
echo [+] TEBRIKLER! Tum testler basariyla gecti.
echo [+] HTML Kapsam Raporu hazirlandi: coverage\index.html
echo ======================================================================
echo.

if /i "%~1"=="--no-pause" exit /b 0

set "OPEN_BROWSER=E"
set /p "OPEN_BROWSER=HTML Kapsam Raporunu tarayicida acmak ister misiniz? (E/H) [Varsayilan: E]: "
if /i "%OPEN_BROWSER%"=="H" goto son
if /i "%OPEN_BROWSER%"=="N" goto son

if exist "coverage\index.html" (
    echo [+] Rapor tarayicida aciliyor...
    start "" "coverage\index.html"
)

:son
echo.
echo Islem tamamlandi.
exit /b 0
