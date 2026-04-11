"""
Luna Agent Watcher v7.0 — Self-Evolving Execution Engine
=========================================================
루나의 "손" 역할. UI 및 자율 엔진에서 내린 명령을 실제로 실행.
v7 변경사항:
  - luna_safety 통합 (자동 백업, 안전 필터, 킬 스위치)
  - 프로세스 관리 도구 추가 (시작/중지/재시작)
  - 패키지 설치 도구 추가
  - 롤백 기능 추가
  - 시스템 모니터링 강화
"""

import time
import httpx
import json
import os
import subprocess
import glob
import datetime

from luna_safety import (
    is_kill_switch_active, is_path_safe, is_command_safe,
    backup_file, rollback_file, log_change, log_evolution,
    safe_write_file, safe_run_command, check_resources,
    BACKUP_DIR, PROJECT_ROOT
)

API_URL = "http://127.0.0.1:6780/api/actions/actions/pending/"
APPROVED_URL = "http://127.0.0.1:6780/api/actions/actions/approved/"
UPDATE_URL = "http://127.0.0.1:6780/api/actions/actions/"

# --- Safety Configuration (luna_safety에서 강화됨) ---
DANGEROUS_COMMANDS = ['rm -rf /', 'format', 'del /s /q C:\\', 'mkfs', 'dd if=']
DANGEROUS_PATHS = ['C:\\Windows', 'C:\\Program Files', 'C:\\System Volume Information']

def is_safe(tool, args, workspace, file_path=""):
    """Safety check — luna_safety 레이어와 이중 검증"""
    check_str = (str(args) + " " + str(file_path)).lower()
    
    if tool == 'run_command':
        if not is_command_safe(str(args)):
            return False
        for cmd in DANGEROUS_COMMANDS:
            if cmd.lower() in check_str:
                return False
    
    if not is_path_safe(file_path):
        return False
            
    if any(path.lower() in check_str for path in DANGEROUS_PATHS):
        return False
        
    return True

# ============================================================
#  기존 핸들러들 (안전 장치 통합 버전)
# ============================================================

def handle_run_command(command_str, cwd):
    print(f"   [Execute] Running terminal command: {command_str} in {cwd}")
    success, output = safe_run_command(command_str, cwd, actor="agent_watcher")
    return success, output

def handle_read_file(filepath, cwd):
    filepath = filepath.strip('"\'')
    if not os.path.isabs(filepath):
        filepath = os.path.join(cwd, filepath)
    print(f"   [Execute] Reading file: {filepath}")
    try:
        with open(filepath, 'r', encoding='utf-8') as f:
            content = f.read()
            if len(content) > 5000: content = content[:5000] + "\n...[TRUNCATED]"
            return True, content
    except Exception as e:
        return False, f"File read error: {str(e)}"

def handle_search_code(query, cwd):
    print(f"   [Execute] Searching code for: {query} in {cwd}")
    query = query.strip('"\'')
    results = []
    try:
        for root, dirs, files in os.walk(cwd):
            if 'node_modules' in dirs: dirs.remove('node_modules')
            if '.git' in dirs: dirs.remove('.git')
            if '__pycache__' in dirs: dirs.remove('__pycache__')
            if '.luna_backup' in dirs: dirs.remove('.luna_backup')
                
            for file in files:
                if file.endswith(('.py', '.js', '.html', '.bat', '.json', '.tsx', '.css')):
                    filepath = os.path.join(root, file)
                    try:
                        with open(filepath, 'r', encoding='utf-8', errors='ignore') as f:
                            if query.lower() in f.read().lower():
                                results.append(filepath.replace(cwd, ''))
                    except: pass
        if results:
            return True, "Found in files:\n" + "\n".join(results[:10])
        else:
            return True, "No matches found."
    except Exception as e:
        return False, f"Search error: {str(e)}"

def handle_write_file(filepath, content, cwd):
    filepath = filepath.strip('"\'')
    if not os.path.isabs(filepath):
        filepath = os.path.join(cwd, filepath)
    
    print(f"   [Execute] Writing file: {filepath}")
    success, msg = safe_write_file(filepath, content, actor="agent_watcher")
    return success, msg

def handle_search_web(query):
    print(f"   [Execute] Searching web for: {query}")
    import time as _time, re as _re
    _time.sleep(2)  # Rate limit protection
    
    # === Query Preprocessing (URL -> Keywords) ===
    clean_query = query.strip().strip('"').strip("'")
    url_pattern = _re.compile(r'https?://(?:www\.)?([^\s/]+)(?:/(.*))?')
    url_match = url_pattern.match(clean_query)
    if url_match:
        domain = url_match.group(1)
        path = url_match.group(2) or ''
        path_parts = [p.replace('@', '').replace('_', ' ') for p in path.split('/') if p and p not in ['watch', 'channel', 'c', 'user']]
        site_hint = domain.split('.')[0]
        clean_query = ' '.join(path_parts + [site_hint]) if path_parts else f"{domain} {path}"
        print(f"   [Preprocessed] URL -> Keywords: '{clean_query}'")
    
    results_text = f"웹 검색 결과 ({clean_query}):\n"
    
    # === ENGINE 1: DuckDuckGo HTML + Korean Locale ===
    try:
        import urllib.request, urllib.parse, re, ssl
        ctx = ssl.create_default_context()
        ctx.check_hostname = False
        ctx.verify_mode = ssl.CERT_NONE
        data = urllib.parse.urlencode({'q': clean_query, 'kl': 'kr-kr'}).encode('utf-8')
        req = urllib.request.Request(
            'https://html.duckduckgo.com/html/', data=data,
            headers={
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
                'Accept-Language': 'ko-KR,ko;q=0.9'
            }
        )
        html = urllib.request.urlopen(req, timeout=10, context=ctx).read().decode('utf-8')
        snippets = re.findall(r'<a class="result__snippet[^>]*>(.*?)</a>', html, re.DOTALL | re.IGNORECASE)
        titles = re.findall(r'<h2 class="result__title">.*?<a[^>]*>(.*?)</a>', html, re.DOTALL | re.IGNORECASE)
        urls = re.findall(r'<a class="result__url"[^>]*href="([^"]*)"', html, re.DOTALL | re.IGNORECASE)
        clean_html = lambda t: re.sub(r'<[^>]+>', '', t).strip().replace('&#x27;', "'").replace('&quot;', '"').replace('&amp;', '&')
        if snippets:
            for i in range(min(5, len(snippets))):
                t = clean_html(titles[i]) if i < len(titles) else f"Result {i+1}"
                s = clean_html(snippets[i])
                u = urls[i] if i < len(urls) else ""
                results_text += f"{i+1}. [{t}] {s}\n   링크: {u}\n\n"
            return True, results_text
    except Exception as e:
        print(f"   [DDG HTML Fail] {e}")
    
    # === ENGINE 2: duckduckgo-search package ===
    try:
        from duckduckgo_search import DDGS
        with DDGS() as ddgs:
            results = list(ddgs.text(clean_query, region='kr-kr', max_results=5))
        if results:
            results_text += "(DDG 패키지 엔진 사용)\n\n"
            for i, r in enumerate(results):
                title = r.get('title', f'Result {i+1}')
                body = r.get('body', '')
                href = r.get('href', '')
                results_text += f"{i+1}. [{title}] {body}\n   링크: {href}\n\n"
            return True, results_text
    except Exception as e:
        print(f"   [DDG Package Fail] {e}")
        
    # === ENGINE 3: Wikipedia API ===
    try:
        import urllib.request, urllib.parse, re
        wiki_url = f"https://ko.wikipedia.org/w/api.php?action=query&list=search&srsearch={urllib.parse.quote(clean_query)}&utf8=&format=json"
        req = urllib.request.Request(wiki_url, headers={'User-Agent': 'Mozilla/5.0'})
        res = urllib.request.urlopen(req, timeout=10).read().decode('utf-8')
        data = json.loads(res)
        search_res = data.get("query", {}).get("search", [])
        if search_res:
            results_text += "(위키백과 검색 엔진 사용)\n\n"
            for i, item in enumerate(search_res[:5]):
                import re
                title = item.get("title", "")
                snippet = re.sub(re.compile('<.*?>'), '', item.get("snippet", "")).strip()
                results_text += f"{i+1}. [{title}] {snippet}...\n\n"
            return True, results_text
    except Exception as e:
        print(f"   [Wiki Fail] {e}")
        
    return True, "현재 모든 검색 엔진이 일시적으로 응답하지 않습니다."

def handle_remember(text):
    print(f"   [Execute] Remembering info: {text}")
    try:
        url = "http://127.0.0.1:6780/api/memory/upsert/"
        payload = {"items": [{"text": text, "metadata": {"source": "luna"}}]}
        with httpx.Client() as client:
            res = client.post(url, json=payload, timeout=10)
            if res.status_code == 200:
                return True, "성공적으로 루나의 기억 데이터베이스에 장기 저장되었습니다."
            return False, f"Memory Save Failed: {res.text}"
    except Exception as e:
        return False, f"Memory Save Error: {str(e)}"

def handle_search_memory(query):
    print(f"   [Execute] Searching memory for: {query}")
    try:
        url = "http://127.0.0.1:6780/api/memory/search/"
        payload = {"query": query, "top_k": 3}
        with httpx.Client() as client:
            res = client.post(url, json=payload, timeout=10)
            if res.status_code == 200:
                data = res.json()
                results = data.get("results", [])
                if not results:
                    return True, "저장된 기억 중에 관련된 내용이 없습니다."
                
                out = "과거 기억 검색 결과:\n"
                for i, r in enumerate(results):
                    text = r.get("text", "")
                    out += f"{i+1}. {text}\n"
                return True, out
            return False, f"Memory Search Failed: {res.text}"
    except Exception as e:
        return False, f"Memory Search Error: {str(e)}"

def handle_replace_code(filepath, search_text, replace_text, cwd):
    filepath = filepath.strip('"\'')
    if not os.path.isabs(filepath):
        filepath = os.path.join(cwd, filepath)
    
    print(f"   [Execute] Replacing code in file: {filepath}")
    if not os.path.exists(filepath):
        return False, f"File not found: {filepath}"
    
    # 안전 체크
    if not is_path_safe(filepath):
        return False, f"위험 경로 접근 차단: {filepath}"
    
    # 자동 백업
    backup_path = backup_file(filepath)
    
    try:
        with open(filepath, 'r', encoding='utf-8') as f:
            content = f.read()
            
        if search_text not in content:
            return False, f"Replace Failed. Cannot find the exact SEARCH_START text in the file."
            
        new_content = content.replace(search_text, replace_text, 1)
        
        with open(filepath, 'w', encoding='utf-8') as f:
            f.write(new_content)
        
        log_change("REPLACE_CODE", filepath, f"backup={backup_path}")
        return True, f"Successfully replaced code chunk in file: {filepath}"
    except Exception as e:
        # 실패 시 롤백
        if backup_path:
            rollback_file(filepath)
        return False, f"Replace code error: {str(e)}"

def handle_list_files(directory, cwd):
    if not directory: directory = cwd
    directory = directory.strip('"\'')
    if not os.path.isabs(directory):
        directory = os.path.join(cwd, directory)
    
    print(f"   [Execute] Listing files in: {directory}")
    try:
        entries = os.listdir(directory)
        out = f"Directory contents of {directory}:\n"
        for e in entries[:50]:
            full = os.path.join(directory, e)
            kind = "[DIR]" if os.path.isdir(full) else "[FILE]"
            out += f"{kind} {e}\n"
        if len(entries) > 50: out += "... (Truncated)"
        return True, out
    except Exception as e:
        return False, f"List error: {str(e)}"

def handle_check_environment():
    print(f"   [Execute] Checking system environment")
    import platform
    try:
        import psutil
        mem = psutil.virtual_memory()
        disk = psutil.disk_usage('/')
        cpu = psutil.cpu_percent(interval=1)
        
        # 프로세스 목록 (루나 관련)
        luna_procs = []
        for proc in psutil.process_iter(['pid', 'name', 'cmdline']):
            try:
                cmdline = ' '.join(proc.info.get('cmdline', []) or [])
                if 'luna' in cmdline.lower() or 'ollama' in cmdline.lower() or 'manage.py' in cmdline.lower():
                    luna_procs.append(f"  PID={proc.info['pid']} {proc.info['name']} | {cmdline[:80]}")
            except:
                pass
        
        info = f"System: {platform.system()} {platform.release()}\n"
        info += f"CPU: {os.cpu_count()} cores, {cpu}% usage\n"
        info += f"RAM: {mem.percent}% used ({mem.available // (1024**2)}MB free)\n"
        info += f"Disk: {disk.percent}% used ({disk.free // (1024**3)}GB free)\n"
        info += f"Current User: {os.getlogin()}\n"
        info += f"Luna Processes ({len(luna_procs)}):\n" + '\n'.join(luna_procs[:10])
        return True, info
    except ImportError:
        info = f"System: {platform.system()} {platform.release()}\n"
        info += f"CPU Count: {os.cpu_count()}\n"
        info += f"Current User: {os.getlogin()}\n"
        info += "(psutil 미설치 — 상세 정보 불가)"
        return True, info

# ============================================================
#  v7 신규 핸들러들
# ============================================================

def handle_rollback(filepath, cwd):
    """파일을 가장 최근 백업으로 복원"""
    filepath = filepath.strip('"\'')
    if not os.path.isabs(filepath):
        filepath = os.path.join(cwd, filepath)
    
    print(f"   [Execute] Rolling back file: {filepath}")
    success, msg = rollback_file(filepath)
    return success, msg

def handle_manage_process(action, name):
    """프로세스 관리: start/stop/restart"""
    print(f"   [Execute] Process management: {action} {name}")
    
    PROCESS_MAP = {
        'backend': ['python', 'd:/LunaProject/luna-server/manage.py', 'runserver', '0.0.0.0:6780'],
        'tts': ['python', 'd:/LunaProject/luna_tts_server.py'],
        'autonomous': ['python', 'd:/LunaProject/luna_autonomous.py'],
        'body': ['python', 'd:/LunaProject/luna_body_controller.py'],
    }
    
    if name not in PROCESS_MAP:
        return False, f"알 수 없는 프로세스: {name}. 가능: {list(PROCESS_MAP.keys())}"
    
    try:
        import psutil
        
        if action in ('stop', 'restart'):
            for proc in psutil.process_iter(['pid', 'cmdline']):
                try:
                    cmdline = ' '.join(proc.info.get('cmdline', []) or [])
                    target_cmd = ' '.join(PROCESS_MAP[name][1:])
                    if target_cmd.lower() in cmdline.lower():
                        proc.terminate()
                        proc.wait(timeout=5)
                except:
                    pass
        
        if action in ('start', 'restart'):
            subprocess.Popen(
                PROCESS_MAP[name],
                creationflags=subprocess.CREATE_NEW_CONSOLE
            )
        
        log_change("PROCESS", f"{action} {name}", "success")
        return True, f"프로세스 '{name}' {action} 완료"
    except Exception as e:
        return False, f"프로세스 관리 오류: {str(e)}"

def handle_install_package(package_name):
    """pip 패키지 설치"""
    package_name = package_name.strip('"\'')
    print(f"   [Execute] Installing package: {package_name}")
    
    # 위험 패키지 차단
    dangerous = ['os', 'sys', 'subprocess', 'ctypes', 'winreg']
    if package_name.lower() in dangerous:
        return False, f"시스템 위험 패키지 차단: {package_name}"
    
    try:
        result = subprocess.run(
            ['pip', 'install', package_name],
            capture_output=True, text=True, timeout=120
        )
        log_change("INSTALL", package_name, result.stdout[:200])
        if result.returncode == 0:
            return True, f"'{package_name}' 설치 완료\n{result.stdout[-200:]}"
        else:
            return False, f"설치 실패: {result.stderr[-300:]}"
    except Exception as e:
        return False, f"설치 오류: {str(e)}"

def handle_self_diagnostic():
    """루나 자기 진단 — 전체 시스템 건강 상태 확인"""
    print(f"   [Execute] Running self-diagnostic...")
    report = "=== Luna Self-Diagnostic Report ===\n"
    
    # 1. Python 구문 검사
    import ast
    source_files = [
        'luna_autonomous.py', 'luna_agent_watcher.py', 'luna_safety.py',
        'luna_tts_server.py', 'luna_body_controller.py', 'run_luna_all.py'
    ]
    report += "\n[코드 무결성 검사]\n"
    for sf in source_files:
        fpath = os.path.join(PROJECT_ROOT, sf)
        if os.path.exists(fpath):
            try:
                with open(fpath, 'r', encoding='utf-8') as f:
                    ast.parse(f.read())
                report += f"  ✅ {sf}: 정상\n"
            except SyntaxError as e:
                report += f"  ❌ {sf}: 구문 오류 (line {e.lineno}): {e.msg}\n"
        else:
            report += f"  ⚠️ {sf}: 파일 없음\n"
    
    # 2. 서비스 연결 확인
    report += "\n[서비스 연결 상태]\n"
    services = {
        'Ollama': 'http://127.0.0.1:11434/api/tags',
        'Backend': 'http://127.0.0.1:6780/api/actions/actions/',
        'Body Controller': 'http://127.0.0.1:6782/command',
    }
    for name, url in services.items():
        try:
            with httpx.Client() as client:
                r = client.get(url, timeout=3)
                report += f"  ✅ {name}: Online (HTTP {r.status_code})\n"
        except:
            report += f"  ❌ {name}: Offline\n"
    
    # 3. 리소스 상태
    ok, msg = check_resources()
    report += f"\n[리소스 상태]\n  {'✅' if ok else '⚠️'} {msg}\n"
    
    # 4. 백업 상태
    backup_count = 0
    if os.path.exists(BACKUP_DIR):
        backup_count = len(os.listdir(BACKUP_DIR))
    report += f"\n[백업 시스템]\n  백업 파일 수: {backup_count}\n"
    
    # 5. 킬 스위치
    report += f"\n[킬 스위치]\n  {'🔴 활성 (자율 활동 차단중)' if is_kill_switch_active() else '🟢 비활성 (정상 운영)'}\n"
    
    return True, report

# ============================================================
#  v8 채팅 연동 핸들러
# ============================================================

def handle_add_goal(raw_args):
    """채팅에서 학습 목표를 자율학습 큐에 추가"""
    print(f"   [Execute] Adding goal to queue: {raw_args}")
    try:
        args = json.loads(raw_args) if raw_args.startswith('{') else {"topic": raw_args}
        topic = args.get('topic', raw_args)
        goal_type = args.get('type', 'LEARN')
        priority = args.get('priority', 'HIGH')
        
        # 직접 goal_queue.json에 추가
        queue_path = os.path.join(PROJECT_ROOT, 'luna_goal_queue.json')
        with open(queue_path, 'r', encoding='utf-8') as f:
            data = json.load(f)
        
        goals = data.get('goals', [])
        max_id = max([g.get('id', 0) for g in goals], default=0)
        
        import datetime
        new_goal = {
            'id': max_id + 1,
            'type': goal_type,
            'priority': priority,
            'description': topic,
            'status': 'pending',
            'attempts': 0,
            'created_at': datetime.datetime.now().isoformat()
        }
        goals.append(new_goal)
        data['goals'] = goals
        
        with open(queue_path, 'w', encoding='utf-8') as f:
            json.dump(data, f, ensure_ascii=False, indent=2)
        
        return True, f"✅ 학습 목표 추가 완료! (ID: {max_id + 1})\n📋 {goal_type} [{priority}]: {topic}\n자율 학습 엔진이 이 목표를 자동으로 처리합니다."
    except Exception as e:
        return False, f"목표 추가 실패: {str(e)}"

def handle_add_interest(raw_args):
    """관심 주제를 interests 목록에 추가"""
    print(f"   [Execute] Adding interest: {raw_args}")
    try:
        args = json.loads(raw_args) if raw_args.startswith('{') else {"interest": raw_args}
        interest = args.get('interest', raw_args)
        
        queue_path = os.path.join(PROJECT_ROOT, 'luna_goal_queue.json')
        with open(queue_path, 'r', encoding='utf-8') as f:
            data = json.load(f)
        
        interests = data.get('interests', [])
        if interest not in interests:
            interests.append(interest)
            data['interests'] = interests
            with open(queue_path, 'w', encoding='utf-8') as f:
                json.dump(data, f, ensure_ascii=False, indent=2)
            return True, f"✅ 관심 주제 추가 완료: {interest}\n이제 자율 학습 시 이 주제도 반영됩니다."
        else:
            return True, f"ℹ️ 이미 관심 주제에 포함되어 있어요: {interest}"
    except Exception as e:
        return False, f"관심 주제 추가 실패: {str(e)}"

# ============================================================
#  명령 디스패처
# ============================================================

def execute_action(action):
    action_id = action['id']
    tool = action['tool_name']
    raw_payload = action.get('arguments_json', '{}')
    
    # 킬 스위치 체크
    if is_kill_switch_active():
        httpx.patch(f"{UPDATE_URL}{action_id}/", json={
            "status": "failed", 
            "result": "킬 스위치 활성 — 모든 명령 실행 차단 중"
        })
        return
    
    # 1. Update status to executing
    httpx.patch(f"{UPDATE_URL}{action_id}/", json={"status": "executing"})
    
    # 2. Parse Payload
    workspace = "d:/"
    command_arg = ""
    file_path = ""
    file_content = ""
    
    try:
        payload = json.loads(raw_payload)
        if isinstance(payload, dict):
            workspace = payload.get('workspace', 'd:/')
            command_arg = payload.get('raw_args', '')
            file_path = payload.get('file_path', '')
            file_content = payload.get('file_content', '')
        else:
            command_arg = raw_payload
    except:
        command_arg = raw_payload

    if not os.path.exists(workspace):
        workspace = "d:/"

    print(f"\n[*] Processing Action [{action_id}]: {tool} | Workspace: {workspace}")
    
    success = False
    result_text = ""
            
    if not is_safe(tool, command_arg, workspace, file_path):
        success = False
        result_text = "ERROR: Safety filter blocked this operation."
    else:
        # 3. Dispatch to handlers
        if tool == "run_command":
            success, result_text = handle_run_command(command_arg, workspace)
        elif tool == "read_file":
            success, result_text = handle_read_file(command_arg, workspace)
        elif tool == "list_files":
            success, result_text = handle_list_files(command_arg, workspace)
        elif tool == "check_environment":
            success, result_text = handle_check_environment()
        elif tool == "search_code":
            success, result_text = handle_search_code(command_arg, workspace)
        elif tool == "write_file":
            success, result_text = handle_write_file(file_path, file_content, workspace)
        elif tool == "replace_code":
            try:
                parsed_content = json.loads(file_content)
                search_text = parsed_content.get("search", "")
                replace_text = parsed_content.get("replace", "")
                success, result_text = handle_replace_code(file_path, search_text, replace_text, workspace)
            except Exception as e:
                success = False
                result_text = f"Parsing replace payload failed: {str(e)}"
        elif tool == "search_web":
            success, result_text = handle_search_web(command_arg)
        elif tool == "remember":
            success, result_text = handle_remember(command_arg)
        elif tool == "search_memory":
            success, result_text = handle_search_memory(command_arg)
        # v7 신규 도구
        elif tool == "rollback":
            success, result_text = handle_rollback(command_arg, workspace)
        elif tool == "manage_process":
            try:
                parts = command_arg.split(' ', 1)
                success, result_text = handle_manage_process(parts[0], parts[1] if len(parts) > 1 else '')
            except:
                success, result_text = False, "Usage: manage_process <start|stop|restart> <name>"
        elif tool == "install_package":
            success, result_text = handle_install_package(command_arg)
        elif tool == "self_diagnostic":
            success, result_text = handle_self_diagnostic()
        # v8 채팅 연동 도구
        elif tool == "add_goal":
            success, result_text = handle_add_goal(command_arg)
        elif tool == "add_interest":
            success, result_text = handle_add_interest(command_arg)
        else:
            success = False
            result_text = f"Unknown tool requested: {tool}"

        
    print(f"   [Result] {'SUCCESS' if success else 'FAILED'} -> {result_text[:100]}...")

    # 4. Save final result to DB
    final_status = "completed" if success else "failed"
    httpx.patch(f"{UPDATE_URL}{action_id}/", json={"status": final_status, "result": result_text})


def poll():
    print("=" * 60)
    print("  LUNA AGENT WATCHER v7.0 — Self-Evolving Execution Engine")
    print("=" * 60)
    print(f"  Project Root: {PROJECT_ROOT}")
    print(f"  Kill Switch: {'🔴 ACTIVE' if is_kill_switch_active() else '🟢 Inactive'}")
    print(f"  Backup Dir: {BACKUP_DIR}")
    print("=" * 60)
    print("[*] Waiting for approved commands...")
    
    while True:
        try:
            # 킬 스위치 실시간 확인
            if is_kill_switch_active():
                time.sleep(5)
                continue
            
            with httpx.Client() as client:
                response = client.get(APPROVED_URL, timeout=5.0)
                if response.status_code == 200:
                    actions = response.json()
                    for action in actions:
                        execute_action(action)
        except Exception as e:
            pass  # Keep terminal clean, retry silently
            
        time.sleep(2)

if __name__ == "__main__":
    poll()
