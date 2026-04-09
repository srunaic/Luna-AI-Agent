@echo off
title Luna AI Agent - Master Controller
setlocal

echo ==========================================
echo    LUNA AI AGENT: STARTING SYSTEM...
echo ==========================================

:: 0. Set environment variables for Ollama (CORS fix)
set OLLAMA_ORIGINS=*

:: 1. Handle Ollama Lifecycle
echo [1/4] Checking Ollama Status...
tasklist | findstr /i "ollama" > nul
if %ERRORLEVEL% equ 0 (
    echo [*] Restarting Ollama to apply CORS settings...
    taskkill /f /im "ollama app.exe" > nul 2>&1
    taskkill /f /im "ollama.exe" > nul 2>&1
    timeout /t 2 /nobreak > nul
)
echo [*] Launching Ollama...
start /min "" "C:\Users\USER\AppData\Local\Programs\Ollama\ollama.exe"
timeout /t 5 /nobreak > nul

:: 2. Start Luna Backend (Django)
echo [2/4] Starting Luna Backend (Django)...
start "Luna Backend" /min cmd /c "cd /d d:\LunaProject\luna-server && start_server.cmd"

:: 3. Start Luna MCP Server
echo [3/4] Starting Luna MCP Server...
start "Luna MCP" /min cmd /c "cd /d d:\LunaProject\luna-mcp && run_luna_mcp.bat"
timeout /t 3 /nobreak > nul

:: 4. Start Luna-Antigravity Bridge Watcher
echo [4/5] Starting Luna-Antigravity Bridge...
start "Luna Bridge" /min cmd /c "cd /d d:\LunaProject && python luna_agent_watcher.py"
timeout /t 2 /nobreak > nul

:: 5. Start Luna Chat UI
echo [5/5] Opening Luna Chat UI...
start "" "d:\LunaProject\luna_chat.html"

echo ==========================================
echo    LUNA SYSTEM IS ACTIVE!
echo ==========================================
echo.
echo  [ STATUS ]
echo  * Luna UI: Active
echo  * Luna Soul: Connected (Port 8000/11434)
echo.
echo  [ EXIT ]
echo  Press any key in this window to STOP all servers 
echo  and exit the Luna system.
echo.
echo ==========================================

pause > nul

echo.
echo [!] Shutting down Luna system...
taskkill /f /im "ollama app.exe" > nul 2>&1
taskkill /f /im "ollama.exe" > nul 2>&1
wmic process where "CommandLine like '%%python%%luna_agent_watcher.py%%'" call terminate > nul 2>&1
taskkill /f /im "python.exe" /fi "WINDOWTITLE eq Luna Backend*" > nul 2>&1
taskkill /f /im "python.exe" /fi "WINDOWTITLE eq Luna MCP*" > nul 2>&1

echo [*] Cleanup complete. Goodbye!
timeout /t 2 /nobreak > nul
exit
