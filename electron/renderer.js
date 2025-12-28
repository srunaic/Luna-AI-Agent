// Luna AI Agent - Renderer Process
let editor = null;
let currentFile = null;
let currentFolder = null;
let terminal = null;
let navigationHistory = [];
let historyIndex = -1;
let activeTaskId = null;

// Editor State Model
let editorState = {
    openFiles: [],
    activeFile: null,
    cursor: { line: 1, column: 1 },
    selection: null,
    projectRoot: null
};

// Initialize UI
function initializeUI() {
    console.log('Initializing Luna UI components...');
    
    // 1. 로딩 화면을 최대한 빨리 닫습니다. (안정성 확보)
    setTimeout(() => {
        const loading = document.getElementById('loading');
        if (loading) loading.classList.add('hide');
    }, 1000);

    // 2. 다른 UI 컴포넌트들을 독립적으로 초기화합니다.
    try {
        setupNavigation();
        setupIPCListeners();
        initializeAIPanel();
        setupTerminal();
    } catch (e) {
        console.error('UI Setup error:', e);
    }

    // 3. 에디터 엔진(가장 무거운 작업)을 백그라운드에서 로드합니다.
    loadMonaco();
}

// PowerShell Terminal Setup (xterm.js)
function setupTerminal() {
    const container = document.getElementById('terminal-container');
    if (!container) return;

    if (typeof Terminal === 'undefined') {
        container.innerHTML = '<div style="padding:10px; color: #888; font-size: 11px;">Terminal library loading...</div>';
        return;
    }

    try {
        terminal = new Terminal({
            theme: { background: '#1e1e1e', foreground: '#ffffff' },
            fontSize: 12,
            fontFamily: 'Consolas, monospace',
            cursorBlink: true,
            convertEol: true // Windows EOL conversion
        });

        if (typeof FitAddon !== 'undefined') {
            const fitAddon = new FitAddon.FitAddon();
            terminal.loadAddon(fitAddon);
            terminal.open(container);
            fitAddon.fit();
            
            window.addEventListener('resize', () => fitAddon.fit());
        } else {
            terminal.open(container);
        }

        // --- Copy/Paste and Key Handling ---
        terminal.attachCustomKeyEventHandler((arg) => {
            // Ctrl + C: Only copy if there's a selection, otherwise let it through (for SIGINT)
            if (arg.ctrlKey && arg.code === 'KeyC') {
                if (terminal.hasSelection()) {
                    window.electronAPI?.clipboard.writeText(terminal.getSelection());
                    return false; // Prevent default
                }
            }
            // Ctrl + V: Paste from clipboard
            if (arg.ctrlKey && arg.code === 'KeyV' && arg.type === 'keydown') {
                window.electronAPI?.clipboard.readText().then(text => {
                    if (text) window.electronAPI?.sendTerminalInput(text);
                });
                return false;
            }
            // Ctrl + L: Clear terminal (Manual "지우기")
            if (arg.ctrlKey && arg.code === 'KeyL') {
                terminal.clear();
                return false;
            }
            return true;
        });

        // Right-click: Copy selection or Paste
        container.addEventListener('contextmenu', (e) => {
            e.preventDefault();
            if (terminal.hasSelection()) {
                window.electronAPI?.clipboard.writeText(terminal.getSelection());
                terminal.clearSelection();
            } else {
                window.electronAPI?.clipboard.readText().then(text => {
                    if (text) window.electronAPI?.sendTerminalInput(text);
                });
            }
        });

        terminal.onData(data => {
            // Send input to main process (PowerShell)
            window.electronAPI?.sendTerminalInput(data);
        });

        window.electronAPI?.onTerminalData(data => {
            terminal.write(data);
        });

        terminal.writeln('Luna Terminal (PowerShell) connected.');
        terminal.writeln(' - Use Ctrl+C to copy (when text selected)');
        terminal.writeln(' - Use Ctrl+V to paste');
        terminal.writeln(' - Right-click to copy/paste (Always works)');
        terminal.writeln(' - Ctrl+L to clear screen');
        terminal.write('\r\n');
    } catch (err) {
        console.error('Terminal initialization error:', err);
    }
}

// Monaco Editor 로딩
function loadMonaco() {
    const editorContainer = document.getElementById('monaco-editor');
    if (!editorContainer) return;

    // 에디터가 뜨기 전 메시지
    editorContainer.innerHTML = '<div style="display:flex; justify-content:center; align-items:center; height:100%; color:#555;">Loading Editor Engine...</div>';

    if (typeof require === 'undefined') {
        console.error('Require.js not found');
        return;
    }

    try {
        require.config({ paths: { 'vs': 'https://unpkg.com/monaco-editor@0.44.0/min/vs' }});
        require(['vs/editor/editor.main'], function() {
            // 로딩 성공 시 에디터 생성
            editorContainer.innerHTML = ''; // 로딩 메시지 제거
            initEditor();
        }, function(err) {
            console.error('Monaco load failed:', err);
            editorContainer.innerHTML = '<div style="display:flex; justify-content:center; align-items:center; height:100%; color:#f48771; text-align:center;">Editor load failed.<br>Please check internet connection.</div>';
        });
    } catch (e) {
        console.error('Monaco config error:', e);
    }
}

function initEditor() {
    const container = document.getElementById('monaco-editor');
    editor = monaco.editor.create(container, {
        value: '// Select a file to start coding with Luna!\n',
        language: 'javascript',
        theme: 'vs-dark',
        automaticLayout: true,
        fontSize: 14,
        minimap: { enabled: true }
    });

    setupEditorEvents();
    console.log('Monaco Editor initialized successfully.');
}

// ... (setupEditorEvents, broadcastState, openFile, openFolder 등 기능 유지)

function setupEditorEvents() {
    if (!editor) return;
    editor.onDidChangeCursorPosition((e) => {
        editorState.cursor = { line: e.position.lineNumber, column: e.position.column };
        const cp = document.getElementById('cursor-position');
        if (cp) cp.textContent = `Ln ${editorState.cursor.line}, Col ${editorState.cursor.column}`;
        broadcastState();
    });
    editor.onDidChangeModelContent(() => {
        if (currentFile) {
            const st = document.getElementById('status-text');
            if (st) st.textContent = `${currentFile.name} - Modified`;
        }
        broadcastState();
    });
}

function broadcastState() {
    if (window.electronAPI) window.electronAPI.updateEditorState(editorState);
    const iframe = document.getElementById('ai-panel-iframe');
    if (iframe && iframe.contentWindow) {
        iframe.contentWindow.postMessage({ type: 'editor_state_update', data: editorState }, '*');
    }
}

function setupIPCListeners() {
    if (!window.electronAPI) return;

    // 분리 버튼 이벤트
    const popoutBtn = document.getElementById('popout-chat');
    if (popoutBtn) {
        popoutBtn.onclick = () => {
            window.electronAPI.send('popout-chat');
            document.getElementById('right-panel').style.display = 'none'; // 메인 창의 패널은 숨김
        };
    }

    // 채팅 창이 닫혔을 때 다시 메인 패널 보여주기
    window.electronAPI.on('chat-window-closed', () => {
        document.getElementById('right-panel').style.display = 'flex';
    });

    // Listen for messages from the AI Panel Webview
    window.addEventListener('message', (event) => {
        const message = event.data;
        if (!message) return;

        if (message.type === 'get_editor_context') {
            const iframe = document.getElementById('ai-panel-iframe');
            if (iframe && iframe.contentWindow) {
                iframe.contentWindow.postMessage({
                    type: 'editor_context',
                    data: editorState
                }, '*');
            }
        } else if (message.type === 'execute_task') {
            // Capture taskId from webview so we can resolve "thinking" properly
            activeTaskId = message.data?.taskId || activeTaskId;
            window.electronAPI.executeTask(message.data.instruction, {
                ...(message.data.context || {}),
                taskId: activeTaskId
            });
        } else if (message.type === 'cancel_task') {
            const taskId = message.data?.taskId || activeTaskId;
            if (taskId) window.electronAPI.cancelTask(taskId);
        }
    });

    window.electronAPI.on('open-file', (e, p) => openFile(p));
    window.electronAPI.on('open-folder', (e, p) => openFolder(p));
    window.electronAPI.on('save-file', () => {
        if (currentFile && editor) {
            window.electronAPI.writeFile(currentFile.path, editor.getValue());
            const st = document.getElementById('status-text');
            if (st) st.textContent = `Saved ${currentFile.name}`;
        }
    });
    window.electronAPI.on('agent-response', (event, response) => {
        // Keep Monaco apply_diff behavior (editor-side)
        if (response.type === 'action' && response.data.tool === 'apply_diff') {
            if (editor && (!response.data.filePath || response.data.filePath === currentFile?.path)) {
                editor.executeEdits('agent', [{
                    range: editor.getSelection(),
                    text: response.data.newText,
                    forceMoveMarkers: true
                }]);
            }
        }

        // Map Electron runtime protocol -> Webview UI protocol
        const taskId = response?.data?.taskId || activeTaskId;
        let mapped = null;
        if (response.type === 'status') {
            mapped = {
                type: 'status_update',
                data: {
                    taskId,
                    state: response.data?.state || 'thinking',
                    message: response.data?.message || ''
                }
            };
        } else if (response.type === 'done') {
            mapped = {
                type: 'task_complete',
                data: {
                    taskId,
                    success: !!response.data?.success,
                    message: response.data?.message || ''
                }
            };
        } else if (response.type === 'action') {
            mapped = {
                type: 'action_log',
                data: {
                    taskId,
                    actionId: response.data?.actionId || response.data?.tool || `action_${Date.now()}`,
                    tool: response.data?.tool || 'action',
                    input: response.data?.input || response.data || {},
                    result: response.data?.result || '',
                    success: true
                }
            };
        } else {
            // Fallback: forward raw message
            mapped = response;
        }

        const iframe = document.getElementById('ai-panel-iframe');
        if (iframe && iframe.contentWindow) iframe.contentWindow.postMessage(mapped, '*');
    });

    // LLM connection status -> forward to AI webview
    window.electronAPI.on('llm-connection', (event, payload) => {
        const iframe = document.getElementById('ai-panel-iframe');
        if (iframe && iframe.contentWindow) {
            iframe.contentWindow.postMessage({
                type: 'llm_connection',
                data: payload
            }, '*');
        }
    });

    // Auto-update status -> forward to AI webview (optional UI later)
    window.electronAPI.on('update-status', (event, payload) => {
        const iframe = document.getElementById('ai-panel-iframe');
        if (iframe && iframe.contentWindow) {
            iframe.contentWindow.postMessage({
                type: 'update_status',
                data: payload
            }, '*');
        }
    });
}

async function openFile(filePath) {
    try {
        const content = await window.electronAPI.readFile(filePath);
        const fileName = filePath.split(/[/\\]/).pop();
        if (editor) {
            const model = monaco.editor.createModel(content, undefined);
            editor.setModel(model);
            const lang = document.getElementById('file-language');
            if (lang) lang.textContent = model.getLanguageId().toUpperCase();
        }
        currentFile = { path: filePath, name: fileName };
        editorState.activeFile = filePath;
        document.getElementById('editor-placeholder').style.display = 'none';
        document.getElementById('editor-container').style.display = 'block';
        const fileTab = document.getElementById('file-tab');
        if (fileTab) {
            fileTab.classList.add('active');
            document.getElementById('tab-filename').textContent = fileName;
        }
        document.getElementById('status-text').textContent = `Opened ${fileName}`;
        if (editor) editor.focus();
        broadcastState();
    } catch (error) { console.error('File open error:', error); }
}

async function openFolder(folderPath, updateHistory = true) {
    try {
        currentFolder = folderPath;
        const files = await window.electronAPI.readDirectory(folderPath);
        renderFileTree(files);
        if (updateHistory) {
            navigationHistory = navigationHistory.slice(0, historyIndex + 1);
            navigationHistory.push(folderPath);
            historyIndex = navigationHistory.length - 1;
            updateNavButtons();
        }
        editorState.projectRoot = folderPath;
        document.getElementById('status-text').textContent = `Folder: ${folderPath}`;
        broadcastState();
    } catch (error) { console.error('Folder open error:', error); }
}

function renderFileTree(files) {
    const fileTree = document.getElementById('file-tree');
    if (!fileTree) return;
    fileTree.innerHTML = '';
    files.sort((a, b) => (a.isDirectory === b.isDirectory ? a.name.localeCompare(b.name) : a.isDirectory ? -1 : 1));
    files.forEach(file => {
        const item = document.createElement('div');
        item.className = 'file-item';
        item.innerHTML = `<span class="icon">${file.isDirectory ? '📁' : '📄'}</span><span>${file.name}</span>`;
        item.onclick = () => file.isDirectory ? openFolder(file.path) : openFile(file.path);
        fileTree.appendChild(item);
    });
}

function setupNavigation() {
    const backBtn = document.getElementById('nav-back');
    const forwardBtn = document.getElementById('nav-forward');
    const closeFileBtn = document.getElementById('close-file');
    if (backBtn) backBtn.onclick = () => { if (historyIndex > 0) { historyIndex--; openFolder(navigationHistory[historyIndex], false); } };
    if (forwardBtn) forwardBtn.onclick = () => { if (historyIndex < navigationHistory.length - 1) { historyIndex++; openFolder(navigationHistory[historyIndex], false); } };
    if (closeFileBtn) closeFileBtn.onclick = () => {
        currentFile = null; editorState.activeFile = null;
        document.getElementById('editor-placeholder').style.display = 'flex';
        document.getElementById('editor-container').style.display = 'none';
        document.getElementById('file-tab').classList.remove('active');
        document.getElementById('status-text').textContent = 'Ready';
        broadcastState();
    };
    updateNavButtons();
}

function updateNavButtons() {
    const back = document.getElementById('nav-back');
    const fwd = document.getElementById('nav-forward');
    if (back) back.disabled = historyIndex <= 0;
    if (fwd) fwd.disabled = historyIndex >= navigationHistory.length - 1;
}

function initializeAIPanel() {
    const iframe = document.getElementById('ai-panel-iframe');
    if (iframe) iframe.src = '../webview-ui/dist/index.html';
}

window.addEventListener('DOMContentLoaded', initializeUI);