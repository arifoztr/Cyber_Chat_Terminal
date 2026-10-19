@echo off
setlocal enabledelayedexpansion

title Cyber Chat Terminal - [2] Gelistirici Baslatici (Sunucu ^& Masaustu)
cd /d "%~dp0"

echo ======================================================================
echo  [2] CYBER CHAT TERMINAL - GELISTIRME ORTAMI BASLATICI
echo ======================================================================
echo.

if not exist "node_modules\" (
    echo [*] node_modules bulunamadi, once kurulum betigi calistiriliyor...
    call "%~dp01-install-windows-environment.bat" --no-pause
)

if /i "%~1"=="--server" goto start_server
if /i "%~1"=="--desktop" goto start_desktop
if /i "%~1"=="--both" goto start_both

echo Baslatmak istediginiz modu secin:
echo   [1] Web / Relay Sunucusunu Baslat (npm run dev -> http://localhost:3000) [Varsayilan]
echo   [2] Electron Masaustu Uygulamasini Baslat (npm run desktop:start)
echo   [3] Hem Sunucuyu Hem Masaustu Uygulamasini Birlikte Baslat
echo   [0] Cikis
echo.

set "CHOICE=1"
set /p "CHOICE=Seciminiz (1/2/3/0) [Varsayilan: 1]: "

if "%CHOICE%"=="0" exit /b 0
if "%CHOICE%"=="2" goto start_desktop
if "%CHOICE%"=="3" goto start_both
goto start_server

:start_server
echo.
echo [+] Cyber Chat Terminal Sunucusu baslatiliyor (http://localhost:3000)...
call npm.cmd run dev
pause
exit /b 0

:start_desktop
echo.
echo [+] Cyber Chat Terminal Masaustu (Electron) baslatiliyor...
call npm.cmd run desktop:start
exit /b 0

:start_both
echo.
echo [+] Arka planda yerel sunucu yeni pencerede baslatiliyor...
start "Cyber Chat Server" cmd /k "cd /d "%~dp0" && npm.cmd run dev"
timeout /t 2 /nobreak >nul
echo [+] Electron Masaustu istemcisi baslatiliyor...
call npm.cmd run desktop:start
exit /b 0
