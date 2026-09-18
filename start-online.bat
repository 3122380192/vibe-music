@echo off
title LAN Music Office & Game Zone - Online & LAN Server
cd /d "%~dp0"
echo ======================================================
echo    🎧 LAN MUSIC OFFICE - KHOI DONG SERVER ONLINE & LAN
echo ======================================================
where node >nul 2>nul
if %errorlevel% neq 0 (
    echo [LOI] May chua cai dat Node.js!
    echo Vui long tai va cai dat Node.js tai: https://nodejs.org
    pause
    exit /b
)

if not exist node_modules (
    echo [1/2] Dang cai dat thu vien phu thuoc...
    call npm install
)

echo [2/2] Dang khoi dong Server LAN va mo duong ham Online toan cau...
start http://localhost:3000
node server.js --online
pause
