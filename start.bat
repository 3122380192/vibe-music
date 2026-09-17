@echo off
title LAN Music Office - Admin Server
cd /d "%~dp0"
echo ======================================================
echo    🎧 LAN MUSIC OFFICE - KHOI DONG SERVER
echo ======================================================
where node >nul 2>nul
if %errorlevel% neq 0 (
    echo [LOI] May chua cai dat Node.js!
    echo Vui long tai va cai dat Node.js tai: https://nodejs.org
    pause
    exit /b
)

if not exist node_modules (
    echo [1/2] Phat hien chua cai dat thu vien, dang chay npm install...
    call npm install
)

echo [2/2] Dang mo trinh duyet va khoi dong server tren mang LAN...
start http://localhost:3000
node server.js
pause
