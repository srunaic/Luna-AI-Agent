import time
import httpx
import json
import os
import subprocess
import glob

API_URL = "http://127.0.0.1:8000/api/actions/actions/pending/"
APPROVED_URL = "http://127.0.0.1:8000/api/actions/actions/approved/"
UPDATE_URL = "http://127.0.0.1:8000/api/actions/actions/"

def handle_run_command(command_str, cwd):
    print(f"   [Execute] Running terminal command: {command_str} in {cwd}")
    try:
        result = subprocess.run(command_str, shell=True, capture_output=True, text=True, timeout=60, cwd=cwd)
        output = result.stdout + result.stderr
        return True, output.strip() if output else "Command executed successfully (No Output)."
    except Exception as e:
        return False, f"Error: {str(e)}"

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
    try:
        os.makedirs(os.path.dirname(filepath), exist_ok=True)
        with open(filepath, 'w', encoding='utf-8') as f:
            f.write(content)
        return True, f"Successfully created/modified file: {filepath}"
    except Exception as e:
        return False, f"File write error: {str(e)}"

def handle_search_web(query):
    print(f"   [Execute] Searching web for: {query}")
    import time, re as _re
    time.sleep(2)  # Rate limit protection for autopilot mode
    
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
    
    # === ENGINE 1: DuckDuckGo HTML + Korean Locale (kl=kr-kr) ===
    try:
        import urllib.request, urllib.parse, re, ssl
        ctx = ssl.create_default_context()
        ctx.check_hostname = False
        ctx.verify_mode = ssl.CERT_NONE
        data = urllib.parse.urlencode({'q': clean_query, 'kl': 'kr-kr'}).encode('utf-8')
        req = urllib.request.Request(
            'https://html.duckduckgo.com/html/', data=data,
            headers={
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
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
        
    # === ENGINE 3: Wikipedia API (Last resort) ===
    try:
        import urllib.request, urllib.parse, json, re
        wiki_url = f"https://ko.wikipedia.org/w/api.php?action=query&list=search&srsearch={urllib.parse.quote(clean_query)}&utf8=&format=json"
        req = urllib.request.Request(wiki_url, headers={'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)'})
        res = urllib.request.urlopen(req, timeout=10).read().decode('utf-8')
        data = json.loads(res)
        search_res = data.get("query", {}).get("search", [])
        if search_res:
            results_text += "(위키백과 검색 엔진 대체 됨)\n\n"
            for i, item in enumerate(search_res[:5]):
                title = item.get("title", "")
                snippet = re.sub(re.compile('<.*?>'), '', item.get("snippet", "")).strip()
                results_text += f"{i+1}. [{title}] {snippet}...\n\n"
            return True, results_text
    except Exception as e:
        print(f"   [Wiki Fail] {e}")
        
    return True, "현재 모든 검색 엔진이 일시적으로 응답하지 않습니다. 잠시 후 다시 시도하거나, 영문 키워드로 바꿔서 검색해 보세요."

def handle_remember(text):
    print(f"   [Execute] Remembering info: {text}")
    try:
        url = "http://127.0.0.1:8000/api/memory/upsert/"
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
        url = "http://127.0.0.1:8000/api/memory/search/"
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
    try:
        with open(filepath, 'r', encoding='utf-8') as f:
            content = f.read()
            
        if search_text not in content:
            return False, f"Replace Failed. Cannot find the exact SEARCH_START text in the file. Ensure you exactly copy-pasted the original source code including spaces."
            
        new_content = content.replace(search_text, replace_text, 1)
        
        with open(filepath, 'w', encoding='utf-8') as f:
            f.write(new_content)
            
        return True, f"Successfully replaced code chunk in file: {filepath}"
    except Exception as e:
        return False, f"Replace code error: {str(e)}"

def execute_action(action):
    action_id = action['id']
    tool = action['tool_name']
    raw_payload = action.get('arguments_json', '{}')
    
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
            
    # 3. Emulate Luna's hands
    if tool == "run_command":
        success, result_text = handle_run_command(command_arg, workspace)
    elif tool == "read_file":
        success, result_text = handle_read_file(command_arg, workspace)
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
            result_text = f"Parsing replace payload failed. The JSON payload might be malformed: {str(e)}"
    elif tool == "search_web":
        success, result_text = handle_search_web(command_arg)
    elif tool == "remember":
        success, result_text = handle_remember(command_arg)
    elif tool == "search_memory":
        success, result_text = handle_search_memory(command_arg)
    else:
        success = False
        result_text = f"Unknown tool requested: {tool}"

        
    print(f"   [Result] {'SUCCESS' if success else 'FAILED'} -> {result_text[:100]}...")

    # 4. Save final result to DB
    final_status = "completed" if success else "failed"
    httpx.patch(f"{UPDATE_URL}{action_id}/", json={"status": final_status, "result": result_text})


def poll():
    print("[*] Luna-Antigravity Bridge is ACTIVE.")
    print("[*] Waiting for approved commands from Luna UI...")
    while True:
        try:
            with httpx.Client() as client:
                response = client.get(APPROVED_URL, timeout=5.0)
                if response.status_code == 200:
                    actions = response.json()
                    for action in actions:
                        execute_action(action)
        except Exception as e:
            pass # Keep terminal clean, retry silently
            
        time.sleep(2) # Fast polling for snap interaction

if __name__ == "__main__":
    poll()
