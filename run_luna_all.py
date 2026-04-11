"""
Luna Engine v7 — Unified Launcher
==================================
모든 서비스를 한 번에 실행:
  1. Django Backend
  2. TTS Server
  3. Autonomous Evolution Engine
  4. Body Controller
  5. Local UI Server
"""

import subprocess
import time
import os
import sys
import webbrowser

PROJECT_ROOT = os.path.dirname(os.path.abspath(__file__))

def check_ollama():
    """Ollama 서비스 및 luna 모델 확인"""
    import urllib.request
    try:
        res = urllib.request.urlopen("http://127.0.0.1:11434/api/tags", timeout=3)
        data = res.read().decode('utf-8')
        import json
        models = [m['name'] for m in json.loads(data).get('models', [])]
        print(f"  Ollama 모델: {', '.join(models)}")
        if not any('luna' in m for m in models):
            print("  ⚠️ 'luna' 모델이 없습니다! 'ollama create luna -f Luna-Modelfile' 실행 필요")
        return True
    except:
        print("  ❌ Ollama가 실행 중이 아닙니다. 먼저 Ollama를 시작하세요!")
        return False

def run_luna():
    print("""
╔═══════════════════════════════════════════════════════════╗
║       LUNA ENGINE v7.0 — Self-Evolving AI Agent           ║
╠═══════════════════════════════════════════════════════════╣
║  🧠 듀얼 브레인 | 🔧 자기 수리 | 🛡️ 안전 장치             ║
╚═══════════════════════════════════════════════════════════╝""")

    # 0. Ollama 체크
    print("\n[0/5] Ollama 확인...")
    if not check_ollama():
        input("  Enter를 눌러 그래도 시작하거나 Ctrl+C로 중단...")

    # 1. Clean previous processes
    print("[1/5] 이전 프로세스 정리...")
    os.system('taskkill /F /IM python.exe /T 2>nul')
    time.sleep(2)

    # 2. Start Backend
    print("[2/5] Django Backend 시작...")
    subprocess.Popen(
        ['python', os.path.join(PROJECT_ROOT, 'luna-server', 'manage.py'), 'runserver', '0.0.0.0:6780'],
        creationflags=subprocess.CREATE_NEW_CONSOLE
    )

    # 3. Start TTS
    print("[3/5] TTS Server 시작...")
    subprocess.Popen(
        ['python', os.path.join(PROJECT_ROOT, 'luna_tts_server.py')],
        creationflags=subprocess.CREATE_NEW_CONSOLE
    )

    # 4. Start Autonomous Evolution Engine
    print("[4/5] 🧠 자율 진화 엔진 시작...")
    subprocess.Popen(
        ['python', os.path.join(PROJECT_ROOT, 'luna_autonomous.py')],
        creationflags=subprocess.CREATE_NEW_CONSOLE
    )

    # 4.5. Start Agent Watcher (UI 명령 실행기)
    print("[4.5/5] Agent Watcher 시작...")
    subprocess.Popen(
        ['python', os.path.join(PROJECT_ROOT, 'luna_agent_watcher.py')],
        creationflags=subprocess.CREATE_NEW_CONSOLE
    )

    # 5. Start Local UI Server
    print("[5/5] Local UI Server (Port 8000) 시작...")
    subprocess.Popen(
        ['python', '-m', 'http.server', '8000', '--directory', PROJECT_ROOT],
        creationflags=subprocess.CREATE_NEW_CONSOLE
    )

    print("\n  모든 서비스 Warm-up 대기 (8초)...")
    time.sleep(8)

    # Launch Browser
    print("  🌐 UI 열기 (http://localhost:8000/index.html)...")
    webbrowser.open("http://localhost:8000/index.html")

    print(f"""
╔═══════════════════════════════════════════════════════════╗
║  ✅ 모든 시스템 가동 완료!                                ║
║                                                           ║
║  📊 Dashboard API: http://127.0.0.1:6785/luna/status      ║
║  🌐 UI: http://localhost:8000/index.html                  ║
║  🛡️ 킬 스위치: D:\\LunaProject\\luna_kill_switch.flag       ║
║                                                           ║
║  루나가 스스로 진화를 시작합니다! 🌙❤️                      ║
║  이 창은 닫으셔도 됩니다.                                  ║
╚═══════════════════════════════════════════════════════════╝""")

if __name__ == "__main__":
    run_luna()
