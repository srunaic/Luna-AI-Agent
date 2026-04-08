@echo off
setlocal
title Luna AI Agent - Gemma 4 Integration (Admin Mode)

:: 1. 관리자 권한 체크 및 자가 승격
:checkPrivileges
NET FILE 1>NUL 2>NUL
if %ERRORLEVEL% neq 0 (
    echo [System] 관리자 권한이 필요합니다. 권한 승격을 요청합니다...
    powershell -Command "Start-Process -FilePath '%0' -Verb RunAs"
    exit /b
)

echo ==========================================
echo    Luna AI Agent - Gemma 4 Admin Mode
echo ==========================================

:: 2. 종속성 체크
where ollama >nul 2>nul
if %ERRORLEVEL% neq 0 (
    echo [ERROR] Ollama가 설치되어 있지 않습니다.
    pause
    exit /b
)

:: 3. Ollama 서비스 시작
netstat -ano | findstr :11434 >nul
if %ERRORLEVEL% neq 0 (
    echo [System] Ollama 서비스를 시작합니다...
    start /min "" ollama serve
    timeout /t 10 /nobreak >nul
)

:: 4. 모델 확인
echo [System] Gemma 4 모델 상태 확인 중...
ollama list | findstr "gemma4" >nul
if %ERRORLEVEL% neq 0 (
    echo [Alert] gemma4 모델이 없습니다. 다운로드를 시작합니다...
    ollama pull gemma4
) else (
    echo [Success] gemma4 모델이 준비되었습니다.
)

:: 5. 캐시 문제 해결을 위한 환경 변수 설정
:: GPU 캐시 오류 방지 및 하드웨어 가속 관련 설정
set ELECTRON_DISABLE_GPU=1
set ELECTRON_FORCE_WINDOW_MENU_BAR=1

:: 6. 앱 실행
echo [System] Luna AI Agent를 실행합니다...
cd /d "%~dp0"
call npm run electron
if %ERRORLEVEL% neq 0 (
    echo.
    echo [ERROR] 앱 실행 중 오류 상수가 발생했습니다 (Exit Code: %ERRORLEVEL%)
    echo 종종 다른 앱이 캐시 폴더를 사용 중일 수 있습니다.
    pause
)
pause
