@echo off
setlocal enabledelayedexpansion

title Cyber Chat Terminal - [3] Kod Bicimlendirme ve Sozdizimi Kontrolu
cd /d "%~dp0"

echo ======================================================================
echo  [3] CYBER CHAT TERMINAL - KOD FORMATLAMA VE SYNTAX KONTROLU
echo ======================================================================
echo.

echo [+] JavaScript dosyalari uzerinde sozdizimi (syntax) kontrolu yapiliyor...
set "ERR_COUNT=0"

for %%F in (src\*.js electron\*.js public\*.js) do (
    node --check "%%F"
    if errorlevel 1 (
        echo [!] HATA: %%F dosyasinda sozdizimi hatasi bulundu!
        set /a ERR_COUNT+=1
    ) else (
        echo   [OK] %%F
    )
)

if !ERR_COUNT! gtr 0 (
    echo.
    echo [!] Toplam !ERR_COUNT! dosyada sozdizimi hatasi tespit edildi!
    pause
    exit /b 1
)

echo.
echo [+] Prettier ile kod bicimlendirme calistiriliyor...
call npx.cmd --yes prettier --write "src/**/*.js" "electron/**/*.js" "tests/**/*.js" "public/*.js" --single-quote --tab-width 4

if errorlevel 1 (
    echo.
    echo [!] UYARI: Prettier calistirilirken bir sorun olustu.
    pause
    exit /b 1
)

echo.
echo ======================================================================
echo [+] TEBRIKLER! Tum kaynak kodlar dogrulandi ve bicimlendirildi.
echo ======================================================================
echo.
if /i not "%~1"=="--no-pause" pause
exit /b 0
