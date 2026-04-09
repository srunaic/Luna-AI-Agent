@echo off
setlocal
cd /d "%~dp0"

echo [Luna-MCP] Starting MCP Server...
echo [Luna-MCP] Current directory: %cd%

:: The MCP server uses stdio. Running this manually will wait for input.
python server.py

if %ERRORLEVEL% neq 0 (
    echo.
    echo [ERROR] Luna-MCP server exited with error code %ERRORLEVEL%
    pause
)
pause
