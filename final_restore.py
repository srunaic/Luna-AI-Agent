import os

def to_unicode_escape(text):
    return text.encode('ascii', 'get_unicode_escape').decode('ascii')

# Helper to write pure ASCII file
def write_ascii(path, content):
    # Convert any non-ascii to \uXXXX
    clean_content = "".join(c if ord(c) < 128 else f'\\u{ord(c):04x}' for c in content)
    with open(path, 'w', encoding='ascii') as f:
        f.write(clean_content)

# --- runtime.js with Korean Prompt (Escaped) ---
runtime_content = r'''const http = require("http");
const https = require("https");

class AgentRuntime {
    constructor() {
        this.isRunning = false;
    }

    async processRequest(request, onResponse) {
        if (this.isRunning) return;
        this.isRunning = true;

        const { instruction, context } = request;
        const model = context.model || 'ollama';

        try {
            const isComplexTask = 
                instruction.includes('file') || 
                instruction.includes('code') || 
                instruction.includes('terminal') || 
                instruction.length > 100;

            if (!isComplexTask) {
                onResponse({ type: 'status', data: { state: 'thinking', message: '', isPartial: true, taskId: context.taskId } });
                let fullText = "";
                if (model === 'ollama' || model === 'luna-soul') {
                    fullText = await this.callLunaCore(instruction, context, onResponse, true);
                } else if (model === 'vllm') {
                    fullText = await this.callVLLM(instruction, context, onResponse, true);
                } else if (model === 'openai') {
                    fullText = await this.callOpenAI(instruction, context, onResponse);
                } else if (model === 'luna-cloud') {
                    fullText = await this.callLunaCloud(instruction, context, onResponse);
                }
                onResponse({ type: 'done', data: { success: true, message: fullText, taskId: context.taskId } });
                return;
            }

            let turn = 0;
            let maxTurns = 5;
            let history = [];

            while (turn < maxTurns) {
                turn++;
                onResponse({
                    type: 'status',
                    data: { state: 'thinking', message: `Thinking... (Turn ${turn})`, taskId: context.taskId }
                });

                let responseText = "";
                if (model === 'ollama' || model === 'luna-soul') {
                    responseText = await this.callLunaCore(instruction, { ...context, history }, onResponse);
                } else if (model === 'vllm') {
                    responseText = await this.callVLLM(instruction, { ...context, history }, onResponse);
                } else if (model === 'openai') {
                    responseText = await this.callOpenAI(instruction, { ...context, history }, onResponse);
                } else if (model === 'luna-cloud') {
                    responseText = await this.callLunaCloud(instruction, { ...context, history }, onResponse);
                }

                const toolMatch = responseText.match(/TOOL:\s*(\w+)\s*\nINPUT:\s*([\s\S]+?)(?=\n(?:THOUGHT|TOOL|ANSWER):|$)/i);
                const answerMatch = responseText.match(/ANSWER:\s*([\s\S]+)/i);

                if (toolMatch) {
                    const toolName = toolMatch[1].trim();
                    const toolInput = toolMatch[2].trim().replace(/^```\w*\n?/, '').replace(/\n?```$/, '');

                    onResponse({
                        type: 'status',
                        data: { state: 'executing', message: `Executing tool(${toolName})...`, taskId: context.taskId }
                    });

                    let toolResult = "";
                    try {
                        toolResult = await this.executeTool(toolName, toolInput, context);
                    } catch (e) {
                        toolResult = `Error: ${e.message}`;
                    }

                    onResponse({
                        type: 'action',
                        data: { tool: toolName, input: toolInput, result: toolResult, taskId: context.taskId }
                    });

                    history.push({ role: 'assistant', content: responseText });
                    history.push({ role: 'system', content: `TOOL_RESULT: ${toolResult}` });
                    continue;
                }

                if (answerMatch || responseText) {
                    const finalAnswer = answerMatch ? answerMatch[1].trim() : responseText;
                    onResponse({
                        type: 'done',
                        data: { success: true, message: finalAnswer, taskId: context.taskId }
                    });
                    break;
                }
            }
        } catch (error) {
            onResponse({
                type: 'done',
                data: { success: false, message: `Error: ${error.message}`, taskId: context.taskId }
            });
        } finally {
            this.isRunning = false;
        }
    }

    async executeTool(name, input, context) {
        const fs = require('fs');
        const path = require('path');
        const { exec, spawn } = require('child_process');
        const { promisify } = require('util');
        const execPromise = promisify(exec);
        const { shell } = require('electron');
        const root = context.projectRoot || process.cwd();

        switch (name) {
            case 'open_url':
                await shell.openExternal(input.trim());
                return `Opened URL.`;
            case 'open_app':
                spawn('cmd.exe', ['/c', 'start', '""', input.trim()], { detached: true, stdio: 'ignore', shell: true }).unref();
                return `Started app.`;
            case 'terminal_run':
                try {
                    const { stdout, stderr } = await execPromise(input, { encoding: 'utf8', cwd: root });
                    return `STDOUT:\n${stdout}\n\nSTDERR:\n${stderr}`;
                } catch (err) {
                    return `Error: ${err.message}`;
                }
            case 'read_file':
                return fs.readFileSync(path.resolve(root, input), 'utf8');
            case 'write_file':
                const firstNewLine = input.indexOf('\n');
                if (firstNewLine === -1) {
                  fs.writeFileSync(path.resolve(root, input), '', 'utf8');
                  return `Saved ${input}.`;
                }
                const filePath = input.substring(0, firstNewLine).trim();
                const content = input.substring(firstNewLine + 1);
                fs.writeFileSync(path.resolve(root, filePath), content, 'utf8');
                return `Saved ${filePath}.`;
            case 'list_dir':
                const items = fs.readdirSync(path.resolve(root, input || '.'));
                return items.join('\n');
            case 'deep_learn':
                const memoryDir = path.resolve(root, 'luna_memory');
                if (!fs.existsSync(memoryDir)) fs.mkdirSync(memoryDir, { recursive: true });
                fs.writeFileSync(path.join(memoryDir, `thought_${Date.now()}.txt`), input, 'utf8');
                return `Learning completed.`;
            default:
                throw new Error(`Unknown tool: ${name}`);
        }
    }

    async callLunaCore(instruction, context, onResponse, directMode = false) {
        const prompt = directMode ? instruction : this.buildPrompt(instruction, context);
        
        return new Promise((resolve, reject) => {
            const cfg = context.llmSettings?.ollama || {};
            const host = (cfg.host || 'localhost') === 'localhost' ? '127.0.0.1' : cfg.host;
            const port = Number(cfg.port || 11434);
            const modelName = context.model === 'luna-soul' ? 'luna-soul:latest' : (cfg.model || 'luna-soul:latest');

            const payload = {
                model: modelName,
                prompt: prompt,
                stream: true,
                options: { 
                    num_ctx: 1024,
                    temperature: 0.1,
                    top_p: 0.9,
                    num_predict: 512
                },
                keep_alive: "60m"
            };
            const data = JSON.stringify(payload);
            const options = {
                hostname: host, port, path: '/api/generate', method: 'POST',
                headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(data, 'utf8') }
            };

            const timeout = setTimeout(() => {
                req.destroy();
                reject(new Error("Ollama response timeout (30s)"));
            }, 30000);

            const req = http.request(options, (res) => {
                let fullText = "";
                let buffer = "";
                let firstToken = true;
                
                res.on('data', (chunk) => {
                    buffer += chunk.toString();
                    let boundary = buffer.indexOf('}');
                    while (boundary !== -1) {
                        const jsonStr = buffer.substring(0, boundary + 1);
                        buffer = buffer.substring(boundary + 1);
                        try {
                            const json = JSON.parse(jsonStr);
                            if (firstToken && json.response) {
                                onResponse({ type: 'status', data: { state: 'typing', message: '', isPartial: true, taskId: context.taskId } });
                                firstToken = false;
                            }
                            if (json.response) {
                                fullText += json.response;
                                onResponse({ type: 'status', data: { state: 'typing', message: fullText, isPartial: true, taskId: context.taskId } });
                            }
                            if (json.done) { 
                                clearTimeout(timeout);
                                resolve(fullText); 
                                return; 
                            }
                        } catch (e) { }
                        boundary = buffer.indexOf('}');
                    }
                });
            });

            req.on('error', (e) => {
                clearTimeout(timeout);
                reject(e);
            });

            req.write(data);
            req.end();
        });
    }

    buildPrompt(instruction, context) {
        const historyText = context.history?.length > 0 ? `History:\n${context.history.map(h => `${h.role}: ${h.content}`).join('\n')}\n` : "";
        return `당신은 최고 수준의 AI 개발 에이전트 "Luna Soul"입니다.
사용자의 모든 요청에 대해 한국어로 친절하고 전문적으로 답변해야 합니다.

지침(Instruction): ${instruction}
${historyText}

작업 수행 시 다음 형식을 반드시 엄격하게 준수하세요:

THOUGHT: 현재 상황에 대한 분석 및 계획 (한국어로 상세히 작성)
TOOL: 사용할 도구 이름 (open_url, open_app, terminal_run, read_file, write_file, list_dir, deep_learn 중 하나)
INPUT: 도구에 전달할 인자 (형식에 맞게 작성)

모든 작업이 완료되었거나 도구가 필요 없는 경우:
THOUGHT: 분석 완료 및 결과 요약
ANSWER: 사용자를 위한 최종 답변 (한국어로 자연스럽게 작성)

중요: THOUGHT와 ANSWER는 반드시 한국어로 작성하세요. 코드나 도구 이름, 인자 등 기술적인 부분은 영어를 사용해도 무방합니다.`;
    }
}

module.exports = { AgentRuntime };
'''

# --- index.html ---
index_content = r'''<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <title>Luna AI Agent</title>
    <style>
        :root {
            --sidebar-bg: #252526;
            --main-bg: #1e1e1e;
            --border-color: #3e3e42;
            --text-color: #cccccc;
            --accent-color: #007acc;
        }
        body { margin: 0; padding: 0; background: var(--main-bg); color: var(--text-color); font-family: -apple-system, sans-serif; overflow: hidden; height: 100vh; display: flex; flex-direction: column; }
        .loading { position: fixed; inset: 0; background: #1e1e1e; z-index: 9999; display: flex; flex-direction: column; justify-content: center; align-items: center; }
        .spinner { border: 3px solid rgba(255,255,255,0.1); border-top: 3px solid var(--accent-color); border-radius: 50%; width: 30px; height: 30px; animation: spin 1s linear infinite; margin-bottom: 15px; }
        @keyframes spin { 0% { transform: rotate(0deg); } 100% { transform: rotate(360deg); } }
        .hide { display: none !important; }
        #app-root { display: flex; flex-direction: column; height: 100vh; visibility: hidden; }
        #app-root.visible { visibility: visible; }
        .app-content { flex: 1; display: flex; overflow: hidden; }
        #sidebar { width: 260px; background: var(--sidebar-bg); border-right: 1px solid var(--border-color); display: flex; flex-direction: column; flex-shrink: 0; }
        .sidebar-header { padding: 12px; font-size: 11px; font-weight: bold; color: #858585; border-bottom: 1px solid var(--border-color); }
        .sidebar-section { flex: 1; display: flex; flex-direction: column; overflow: hidden; border-bottom: 1px solid var(--border-color); }
        .sidebar-section-title { padding: 8px 12px; background: #37373d; font-size: 11px; font-weight: 600; cursor: pointer; color: #ccc; }
        #file-tree { flex: 1; overflow-y: auto; padding: 5px; }
        #package-list { flex: 1; overflow-y: auto; padding: 10px; }
        #main-zone { flex: 1; display: flex; flex-direction: column; min-width: 0; }
        #editor-zone { flex: 1; position: relative; background: #1e1e1e; }
        #monaco-editor { position: absolute; inset: 0; }
        #terminal-zone { height: 250px; background: #1e1e1e; border-top: 1px solid var(--border-color); display: flex; flex-direction: column; }
        .terminal-header { height: 35px; background: #252526; display: flex; align-items: center; padding: 0 12px; border-bottom: 1px solid #333; justify-content: space-between; font-size: 11px; font-weight: 600; }
        #chat-panel { width: 400px; background: var(--sidebar-bg); border-left: 1px solid var(--border-color); flex-shrink: 0; }
        #ai-panel-iframe { width: 100%; height: 100%; border: none; }
        .splitter { background: #333; position: relative; z-index: 10; transition: background 0.2s; }
        .splitter:hover { background: var(--accent-color); }
        .v-splitter { width: 4px; cursor: col-resize; }
        .h-splitter { height: 4px; cursor: row-resize; }
        #status-bar { height: 22px; background: var(--accent-color); color: white; display: flex; align-items: center; padding: 0 10px; font-size: 11px; justify-content: space-between; }
        .action-btn { background: none; border: none; color: #ccc; cursor: pointer; padding: 4px; border-radius: 4px; display: flex; align-items: center; }
        .action-btn:hover { background: #37373d; color: white; }
        input.search-input { width: 100%; background: #3c3c3c; border: 1px solid #3e3e42; color: #ccc; font-size: 11px; padding: 4px 8px; box-sizing: border-box; border-radius: 3px; outline: none; }
    </style>
</head>
<body>
    <div id="loading" class="loading">
        <div class="spinner"></div>
        <div id="loading-text">Luna AI Agent is starting...</div>
    </div>
    <div id="app-root">
        <div class="app-content">
            <div id="sidebar">
                <div class="sidebar-header">LUNA EXPLORER</div>
                <div id="file-tree"></div>
                <div class="sidebar-section">
                    <div class="sidebar-section-title">LUNA MARKET (Django API)</div>
                    <div style="padding: 8px 12px;">
                        <input type="text" id="package-search" class="search-input" placeholder="Search packages...">
                    </div>
                    <div id="package-list"></div>
                </div>
            </div>
            <div class="splitter v-splitter" id="sidebar-splitter"></div>
            <div id="main-zone">
                <div id="editor-zone"><div id="monaco-editor"></div></div>
                <div class="splitter h-splitter" id="terminal-splitter"></div>
                <div id="terminal-zone">
                    <div class="terminal-header">
                        <span>TERMINAL (PowerShell)</span>
                        <button class="action-btn" id="clear-terminal-btn" title="Clear Terminal">
                            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="3 6 5 6 21 6"></polyline><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path></svg>
                        </button>
                    </div>
                    <div id="terminal-container" style="flex: 1; overflow: hidden; padding: 5px;"></div>
                </div>
            </div>
            <div class="splitter v-splitter" id="chat-splitter"></div>
            <div id="chat-panel"><iframe id="ai-panel-iframe" allow="microphone"></iframe></div>
        </div>
        <div id="status-bar">
            <div id="status-left">Ready</div>
            <div id="status-right" style="display: flex; gap: 15px;">
                <span id="update-status-text"></span>
                <span id="llm-status-text">Ollama: Checking...</span>
            </div>
        </div>
    </div>
    <script>
        setTimeout(() => {
            const l = document.getElementById('loading');
            const r = document.getElementById('app-root');
            if (l) l.classList.add('hide');
            if (r) r.classList.add('visible');
        }, 100);
    </script>
    <link rel="stylesheet" href="https://cdn.jsdelivr.net/npm/xterm@5.3.0/css/xterm.css" />
    <script src="https://cdn.jsdelivr.net/npm/xterm@5.3.0/lib/xterm.js"></script>
    <script src="https://cdn.jsdelivr.net/npm/monaco-editor@0.44.0/min/vs/loader.js"></script>
    <script src="./renderer.js"></script>
</body>
</html>
'''

# --- renderer.js ---
renderer_content = r'''let xterm;
let monacoEditor;
let sidebarWidth = 260;
let terminalHeight = 250;
let chatWidth = 400;

function hideLoading() {
    const loading = document.getElementById('loading');
    const root = document.getElementById('app-root');
    if (loading) loading.classList.add('hide');
    if (root) root.classList.add('visible');
}

function setupSplitters() {
    const sbs = document.getElementById('sidebar-splitter');
    const ts = document.getElementById('terminal-splitter');
    const cs = document.getElementById('chat-splitter');
    if (sbs) {
        sbs.onmousedown = (e) => {
            const startX = e.clientX;
            const startWidth = sidebarWidth;
            document.onmousemove = (e) => {
                sidebarWidth = startWidth + (e.clientX - startX);
                if (sidebarWidth < 100) sidebarWidth = 100;
                document.getElementById('sidebar').style.width = sidebarWidth + 'px';
            };
            document.onmouseup = () => { document.onmousemove = null; };
        };
    }
    if (ts) {
        ts.onmousedown = (e) => {
            const startY = e.clientY;
            const startHeight = terminalHeight;
            document.onmousemove = (e) => {
                terminalHeight = startHeight - (e.clientY - startY);
                if (terminalHeight < 50) terminalHeight = 50;
                document.getElementById('terminal-zone').style.height = terminalHeight + 'px';
            };
            document.onmouseup = () => { document.onmousemove = null; };
        };
    }
    if (cs) {
        cs.onmousedown = (e) => {
            const startX = e.clientX;
            const startWidth = chatWidth;
            document.onmousemove = (e) => {
                chatWidth = startWidth - (e.clientX - startX);
                if (chatWidth < 200) chatWidth = 200;
                document.getElementById('chat-panel').style.width = chatWidth + 'px';
            };
            document.onmouseup = () => { document.onmousemove = null; };
        };
    }
}

function setupTerminal() {
    if (typeof Terminal === 'undefined') { setTimeout(setupTerminal, 100); return; }
    xterm = new Terminal({ theme: { background: '#1e1e1e' }, fontSize: 12 });
    const container = document.getElementById('terminal-container');
    if (container) {
        xterm.open(container);
        xterm.onData(data => window.electronAPI.send('terminal-input', data));
        window.electronAPI.on('terminal-data', (_, data) => xterm.write(data));
        document.getElementById('clear-terminal-btn')?.addEventListener('click', () => xterm.clear());
    }
}

function loadMonaco() {
    if (typeof require === 'undefined') { setTimeout(loadMonaco, 100); return; }
    require.config({ paths: { 'vs': 'https://cdn.jsdelivr.net/npm/monaco-editor@0.44.0/min/vs' } });
    require(['vs/editor/editor.main'], function() {
        monacoEditor = monaco.editor.create(document.getElementById('monaco-editor'), {
            value: "// Luna AI Agent\n", language: 'javascript', theme: 'vs-dark', automaticLayout: true
        });
        window.monacoEditor = monacoEditor;
    });
}

function initApp() {
    const iframe = document.getElementById('ai-panel-iframe');
    if (iframe) iframe.src = "../webview-ui/dist/index.html?session=main";
    setupSplitters();
    setupTerminal();
    loadMonaco();
    setTimeout(hideLoading, 500);
}

if (document.readyState === 'loading') { window.addEventListener('DOMContentLoaded', initApp); } else { initApp(); }
'''

write_ascii('electron/runtime.js', runtime_content)
write_ascii('electron/index.html', index_content)
write_ascii('electron/renderer.js', renderer_content)
print('SUCCESS: All files written with Unicode escapes where necessary.')



