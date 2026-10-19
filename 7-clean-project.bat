@echo off
setlocal enabledelayedexpansion

title Cyber Chat Terminal - [7] Proje Temizleme Araci
cd /d "%~dp0"

echo ======================================================================
echo  [7] CYBER CHAT TERMINAL - PROJE TEMIZLEME ARACI
echo ======================================================================
echo.

if /i "%~1"=="--soft" goto clean_soft
if /i "%~1"=="--all" goto clean_all
if /i "%~1"=="--ini" goto clean_ini

echo Yapmak istediginiz temizlik seviyesini secin:
echo   [1] Standart Temizlik: dist, coverage, docs\api ve gecici dosyalari sil [Varsayilan]
echo   [2] Derin Temizlik   : Standart Temizlik + node_modules klasorunu tamamen sil
echo   [3] Sadece desktop.ini ve gecici log dosyalarini temizle
echo   [0] Cikis
echo.

set "CHOICE=1"
set /p "CHOICE=Seciminiz (1/2/3/0) [Varsayilan: 1]: "

if "%CHOICE%"=="0" exit /b 0
if "%CHOICE%"=="2" goto clean_all
if "%CHOICE%"=="3" goto clean_ini
goto clean_soft

:clean_soft
echo.
echo [+] Calisan Cyber Chat Terminal surecleri kapatiliyor...
taskkill /F /IM "Cyber Chat Terminal.exe" /T >nul 2>&1

if exist "dist\" (
    echo [+] dist\ klasoru siliniyor...
    rmdir /s /q "dist"
)
if exist "dist-electron\" (
    echo [+] dist-electron\ klasoru siliniyor...
    rmdir /s /q "dist-electron"
)
if exist "coverage\" (
    echo [+] coverage\ klasoru siliniyor...
    rmdir /s /q "coverage"
)
if exist "docs\api\" (
    echo [+] docs\api\ klasoru siliniyor...
    rmdir /s /q "docs\api"
)
if exist "test_tmp_dir_check\" (
    echo [+] test_tmp_dir_check\ klasoru siliniyor...
    rmdir /s /q "test_tmp_dir_check"
)
goto clean_ini

:clean_all
call :clean_soft_sub
if exist "node_modules\" (
    echo [+] node_modules\ klasoru siliniyor (bu islem biraz surebilir)...
    rmdir /s /q "node_modules"
)
goto clean_ini

:clean_soft_sub
taskkill /F /IM "Cyber Chat Terminal.exe" /T >nul 2>&1
if exist "dist\" rmdir /s /q "dist"
if exist "dist-electron\" rmdir /s /q "dist-electron"
if exist "coverage\" rmdir /s /q "coverage"
if exist "docs\api\" rmdir /s /q "docs\api"
if exist "test_tmp_dir_check\" rmdir /s /q "test_tmp_dir_check"
exit /b 0

:clean_ini
echo [+] Gecici log ve desktop.ini dosyalari temizleniyor...
del /s /q /f /a "desktop.ini" >nul 2>&1
del /q /f "*.log" >nul 2>&1

echo.
echo ======================================================================
echo [+] TEBRIKLER! Proje temizligi basariyla tamamlandi.
echo ======================================================================
echo.
if /i not "%~1"=="--no-pause" pause
exit /b 0
