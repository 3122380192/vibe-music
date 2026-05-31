@echo off
echo ===================================
echo   VIBE MUSIC - KHOI TAO SERVER
echo ===================================
echo Dang mo trinh duyet...
start http://localhost:8080
echo Dang chay server tai cong 8080...
python -m http.server 8080
pause
