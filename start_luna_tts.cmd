@echo off
echo ============================================
echo   Luna TTS Server - XTTS v2 Voice Clone
echo ============================================
cd /d %~dp0
set COQUI_TOS_AGREED=1
call luna-tts-venv\Scripts\activate.bat
python luna_tts_server.py
pause
