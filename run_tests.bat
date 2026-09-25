@echo off
setlocal

title Cyber Chat Terminal - Unit Test & Coverage Runner
echo ======================================================================
echo  CYBER CHAT TERMINAL - UNIT TESTLER & KAPSAM (COVERAGE) RAPORU
echo ======================================================================
echo.

cd /d "%~dp0"

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

set /p OPEN_BROWSER="HTML Kapsam Raporunu tarayicida acmak ister misiniz? (E/H) [Varsayilan: E]: "
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
