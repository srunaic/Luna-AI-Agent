// Luna AI Agent - Renderer Process
let editor = null;
let currentFile = null;
let currentFolder = null;
let terminal = null;
let terminalFitAddon = null;
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

    // 1. 濡쒕뵫 ?붾㈃??理쒕???鍮⑤━ ?レ뒿?덈떎. (?덉젙???뺣낫)
    setTimeout(() => {
        const loading = document.getElementById('loading');
        if (loading) loading.classList.add('hide');
    }, 1000);

    // 2. ?ㅻⅨ UI 而댄룷?뚰듃?ㅼ쓣 ?낅┰?곸쑝濡?珥덇린?뷀빀?덈떎.
    try {
        setupNavigation();
        setupIPCListeners();
        initializeAIPanel();
        setupSplitters();
        setupTerminal();
        setupSidebarSections();
        setupPackageManager();
    } catch (e) {
        console.error('UI Setup error:', e);
    }

    // 3. ?먮뵒???붿쭊(媛??臾닿굅???묒뾽)??諛깃렇?쇱슫?쒖뿉??濡쒕뱶?⑸땲??
    loadMonaco();
}

function applySavedLayout() {
    try {
        const sidebar = document.getElementById('sidebar');
        const right = document.getElementById('right-panel');
        const terminalPanel = document.getElementById('terminal-panel');

        const sidebarCollapsed = localStorage.getItem('luna.sidebarCollapsed') === 'true';
        if (sidebar) {
            if (sidebarCollapsed) {
                sidebar.style.width = '0px';
                sidebar.style.minWidth = '0px';
                sidebar.style.borderRight = 'none';
            } else {
                sidebar.style.minWidth = '';
                sidebar.style.borderRight = '';
            }
        }

        const sw = Number(localStorage.getItem('luna.sidebarWidth') || '');
        if (sidebar && !sidebarCollapsed && Number.isFinite(sw) && sw > 0) sidebar.style.width = `${sw}px`;

        const rightCollapsed = localStorage.getItem('luna.rightPanelCollapsed') === 'true';
        if (right) {
            if (rightCollapsed) {
                right.style.width = '0px';
                right.style.minWidth = '0px';
                right.style.borderLeft = 'none';
            } else {
                right.style.minWidth = '';
                right.style.borderLeft = '';
            }
        }

        const rw = Number(localStorage.getItem('luna.rightPanelWidth') || '');
        if (right && !rightCollapsed && Number.isFinite(rw) && rw > 0) right.style.width = `${rw}px`;

        const terminalCollapsed = localStorage.getItem('luna.terminalCollapsed') === 'true';
        if (terminalPanel) {
            if (terminalCollapsed) {
                terminalPanel.style.height = '0px';
                terminalPanel.style.minHeight = '0px';
                terminalPanel.style.borderTop = 'none';
            } else {
                terminalPanel.style.minHeight = '';
                terminalPanel.style.borderTop = '';
            }
        }

        const th = Number(localStorage.getItem('luna.terminalHeight') || '');
        if (terminalPanel && !terminalCollapsed && Number.isFinite(th) && th > 0) terminalPanel.style.height = `${th}px`;
    } catch (_) { }
}

function persistLayout() {
    try {
        const sidebar = document.getElementById('sidebar');
        const right = document.getElementById('right-panel');
        const terminalPanel = document.getElementById('terminal-panel');
        if (sidebar) {
            const w = sidebar.getBoundingClientRect().width;
            if (w > 0) localStorage.setItem('luna.sidebarWidth', String(w));
        }
        if (right) {
            const w = right.getBoundingClientRect().width;
            if (w > 0) localStorage.setItem('luna.rightPanelWidth', String(w));
        }
        if (terminalPanel) {
            const h = terminalPanel.getBoundingClientRect().height;
            if (h > 0) localStorage.setItem('luna.terminalHeight', String(h));
        }
    } catch (_) { }
}

function relayoutEditors() {
    try {
        if (editor) editor.layout();
    } catch (_) { }
    try {
        if (terminalFitAddon) terminalFitAddon.fit();
    } catch (_) { }
}

function clamp(n, min, max) {
    return Math.max(min, Math.min(max, n));
}

function setupSplitters() {
    applySavedLayout();

    const sidebar = document.getElementById('sidebar');
    const right = document.getElementById('right-panel');
    const terminalPanel = document.getElementById('terminal-panel');
    const dragOverlay = document.getElementById('drag-overlay');

    const splitterLeft = document.getElementById('splitter-left');
    const splitterRight = document.getElementById('splitter-right');
    const splitterBottom = document.getElementById('splitter-bottom');

    const startDrag = (mode, startEvent, onMove) => {
        startEvent.preventDefault();

        // Show overlay so pointer events keep flowing even over iframe
        if (dragOverlay) {
            dragOverlay.classList.add('show');
            dragOverlay.classList.toggle('col', mode === 'col');
            dragOverlay.classList.toggle('row', mode === 'row');
        }

        document.body.classList.add('resizing');
        if (mode === 'row') document.body.classList.add('resizing-row');

        const onPointerMove = (e) => onMove(e);
        const end = () => {
            if (dragOverlay) {
                dragOverlay.classList.remove('show', 'col', 'row');
            }
            document.body.classList.remove('resizing');
            document.body.classList.remove('resizing-row');

            window.removeEventListener('pointermove', onPointerMove);
            window.removeEventListener('pointerup', end);
            window.removeEventListener('pointercancel', end);

            persistLayout();
            relayoutEditors();
        };

        window.addEventListener('pointermove', onPointerMove);
        window.addEventListener('pointerup', end);
        window.addEventListener('pointercancel', end);
    };

    if (splitterLeft && sidebar) {
        splitterLeft.addEventListener('pointerdown', (e) => {
            const startX = e.clientX;
            const startW = sidebar.getBoundingClientRect().width;
            startDrag('col', e, (ev) => {
                const next = clamp(startW + (ev.clientX - startX), 180, 600);
                sidebar.style.width = `${next}px`;
                sidebar.style.minWidth = '';
                sidebar.style.borderRight = '';
                localStorage.setItem('luna.sidebarCollapsed', 'false');
                relayoutEditors();
            });
        });

        splitterLeft.addEventListener('dblclick', (e) => {
            e.preventDefault();
            const collapsed = localStorage.getItem('luna.sidebarCollapsed') === 'true';
            if (!collapsed) {
                const current = sidebar.getBoundingClientRect().width;
                if (current > 0) localStorage.setItem('luna.sidebarWidth', String(current));
                localStorage.setItem('luna.sidebarCollapsed', 'true');
                sidebar.style.width = '0px';
                sidebar.style.minWidth = '0px';
                sidebar.style.borderRight = 'none';
            } else {
                localStorage.setItem('luna.sidebarCollapsed', 'false');
                const saved = Number(localStorage.getItem('luna.sidebarWidth') || 250);
                const next = clamp(saved, 180, 600);
                sidebar.style.width = `${next}px`;
                sidebar.style.minWidth = '';
                sidebar.style.borderRight = '';
            }
            persistLayout();
            relayoutEditors();
        });
    }

    if (splitterRight && right) {
        splitterRight.addEventListener('pointerdown', (e) => {
            const startX = e.clientX;
            const startW = right.getBoundingClientRect().width;
            startDrag('col', e, (ev) => {
                // Dragging splitter: moving right decreases right panel width, moving left increases.
                const next = clamp(startW - (ev.clientX - startX), 280, 800);
                right.style.width = `${next}px`;
                right.style.minWidth = '';
                right.style.borderLeft = '';
                localStorage.setItem('luna.rightPanelCollapsed', 'false');
                relayoutEditors();
            });
        });

        splitterRight.addEventListener('dblclick', (e) => {
            e.preventDefault();
            const collapsed = localStorage.getItem('luna.rightPanelCollapsed') === 'true';
            if (!collapsed) {
                const current = right.getBoundingClientRect().width;
                if (current > 0) localStorage.setItem('luna.rightPanelWidth', String(current));
                localStorage.setItem('luna.rightPanelCollapsed', 'true');
                right.style.width = '0px';
                right.style.minWidth = '0px';
                right.style.borderLeft = 'none';
            } else {
                localStorage.setItem('luna.rightPanelCollapsed', 'false');
                const saved = Number(localStorage.getItem('luna.rightPanelWidth') || 400);
                const next = clamp(saved, 280, 800);
                right.style.width = `${next}px`;
                right.style.minWidth = '';
                right.style.borderLeft = '';
            }
            persistLayout();
            relayoutEditors();
        });
    }

    if (splitterBottom && terminalPanel) {
        splitterBottom.addEventListener('pointerdown', (e) => {
            const startY = e.clientY;
            const startH = terminalPanel.getBoundingClientRect().height;
            startDrag('row', e, (ev) => {
                // Dragging splitter down decreases terminal height, up increases.
                const next = clamp(startH - (ev.clientY - startY), 100, 600);
                terminalPanel.style.height = `${next}px`;
                terminalPanel.style.minHeight = '';
                terminalPanel.style.borderTop = '';
                localStorage.setItem('luna.terminalCollapsed', 'false');
                relayoutEditors();
            });
        });

        splitterBottom.addEventListener('dblclick', (e) => {
            e.preventDefault();
            const collapsed = localStorage.getItem('luna.terminalCollapsed') === 'true';
            if (!collapsed) {
                const current = terminalPanel.getBoundingClientRect().height;
                if (current > 0) localStorage.setItem('luna.terminalHeight', String(current));
                localStorage.setItem('luna.terminalCollapsed', 'true');
                terminalPanel.style.height = '0px';
                terminalPanel.style.minHeight = '0px';
                terminalPanel.style.borderTop = 'none';
            } else {
                localStorage.setItem('luna.terminalCollapsed', 'false');
                const saved = Number(localStorage.getItem('luna.terminalHeight') || 200);
                const next = clamp(saved, 100, 600);
                terminalPanel.style.height = `${next}px`;
                terminalPanel.style.minHeight = '';
                terminalPanel.style.borderTop = '';
            }
            persistLayout();
            relayoutEditors();
        });
    }

    // Relayout on window resize too
    window.addEventListener('resize', () => relayoutEditors());
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
        let inputBuffer = '';

        const writeLocal = (text) => terminal.write(text);
        const sendToShell = (text) => window.electronAPI?.sendTerminalInput(text);

        const handleEnter = () => {
            writeLocal('\r\n');
            if (inputBuffer.length > 0) {
                sendToShell(inputBuffer + '\r\n');
                inputBuffer = '';
            } else {
                sendToShell('\r\n');
            }
        };

        const handleBackspace = () => {
            if (inputBuffer.length === 0) return;
            inputBuffer = inputBuffer.slice(0, -1);
            // Move back, erase, move back
            writeLocal('\b \b');
        };

        const pasteText = (text) => {
            if (!text) return;
            // Normalize newlines
            const normalized = text.replace(/\r\n/g, '\n').replace(/\r/g, '\n');
            const lines = normalized.split('\n');
            for (let i = 0; i < lines.length; i++) {
                const line = lines[i];
                if (line) {
                    inputBuffer += line;
                    writeLocal(line);
                }
                if (i < lines.length - 1) {
                    // Execute line breaks as Enter
                    handleEnter();
                }
            }
        };

        terminal = new Terminal({
            theme: { background: '#1e1e1e', foreground: '#ffffff' },
            fontSize: 12,
            fontFamily: 'Consolas, monospace',
            cursorBlink: true,
            convertEol: true // Windows EOL conversion
        });

        if (typeof FitAddon !== 'undefined') {
            terminalFitAddon = new FitAddon.FitAddon();
            terminal.loadAddon(terminalFitAddon);
            terminal.open(container);
            terminalFitAddon.fit();

            window.addEventListener('resize', () => terminalFitAddon.fit());
        } else {
            terminal.open(container);
        }

        // --- Copy/Paste and Key Handling ---
        terminal.attachCustomKeyEventHandler((arg) => {
            // Always focus terminal when interacting
            if (arg.type === 'mousedown' || arg.type === 'keydown') {
                try { terminal.focus(); } catch (_) { }
            }

            // Ctrl + C: Only copy if there's a selection, otherwise let it through (for SIGINT)
            if ((arg.ctrlKey && (arg.code === 'KeyC' || arg.key === 'c' || arg.key === 'C')) ||
                (arg.ctrlKey && arg.shiftKey && (arg.code === 'KeyC' || arg.key === 'c' || arg.key === 'C'))) {
                if (terminal.hasSelection()) {
                    window.electronAPI?.clipboard.writeText(terminal.getSelection());
                    return false; // Prevent default
                }
            }

            // Ctrl + V: Paste from clipboard
            if ((arg.ctrlKey && (arg.code === 'KeyV' || arg.key === 'v' || arg.key === 'V') && arg.type === 'keydown') ||
                (arg.ctrlKey && arg.shiftKey && (arg.code === 'KeyV' || arg.key === 'v' || arg.key === 'V') && arg.type === 'keydown')) {
                window.electronAPI?.clipboard.readText().then(text => pasteText(text));
                return false;
            }

            // Shift+Insert paste (common terminal shortcut)
            if (arg.shiftKey && arg.code === 'Insert' && arg.type === 'keydown') {
                window.electronAPI?.clipboard.readText().then(text => pasteText(text));
                return false;
            }

            // Ctrl + L: Clear terminal (Manual "吏?곌린")
            if (arg.ctrlKey && arg.code === 'KeyL') {
                terminal.clear();
                inputBuffer = '';
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
                window.electronAPI?.clipboard.readText().then(text => pasteText(text));
            }
        });

        // Ensure terminal receives focus when clicked
        container.addEventListener('mousedown', () => {
            try { terminal.focus(); } catch (_) { }
        });

        // --- Local line-editing (works with PowerShell over pipes) ---
        terminal.onData((data) => {
            // Enter
            if (data === '\r') {
                handleEnter();
                return;
            }
            // Backspace (DEL)
            if (data === '\u007f') {
                handleBackspace();
                return;
            }
            // Ctrl+C (interrupt)
            if (data === '\x03') {
                sendToShell('\x03');
                writeLocal('^C\r\n');
                inputBuffer = '';
                return;
            }

            // Ignore escape sequences (arrows etc.) since stdin is a pipe
            if (data.startsWith('\x1b')) return;

            // Printable text (including IME chunks)
            inputBuffer += data;
            writeLocal(data);
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
        // Bridge: iframe(webview-ui) -> main process
        window.addEventListener('message', async (event) => {
            const msg = event.data;
            if (!msg) return;
            if (!window.electronAPI) return;

            if (msg.type === 'get_editor_context') {
                try {
                    const ctx = await window.electronAPI.getEditorState?.();
                    iframe?.contentWindow?.postMessage({ type: 'editor_context', data: ctx || {} }, '*');
                } catch (_) { }
                return;
            }

            if (msg.type === 'execute_task') {
                const instruction = msg.data?.instruction;
                const context = msg.data?.context || {};
                if (!instruction) return;
                await window.electronAPI.executeTask(instruction, { ...context, taskId: msg.data?.taskId });
                return;
            }

            if (msg.type === 'cancel_task') {
                const taskId = msg.data?.taskId;
                if (taskId) await window.electronAPI.cancelTask(taskId);
                return;
            }

            if (msg.type === 'rl_feedback') {
                window.electronAPI.send?.('rl-feedback', msg.data || {});
                return;
            }
        });
    } catch (err) {
        console.error('Terminal initialization error:', err);
    }
}

// Monaco Editor 濡쒕뵫
function loadMonaco() {
    const editorContainer = document.getElementById('monaco-editor');
    if (!editorContainer) return;

    // ?먮뵒?곌? ?④린 ??硫붿떆吏
    editorContainer.innerHTML = '<div style="display:flex; justify-content:center; align-items:center; height:100%; color:#555;">Loading Editor Engine...</div>';

    if (typeof require === 'undefined') {
        console.error('Require.js not found');
        return;
    }

    try {
        require.config({ paths: { 'vs': 'https://unpkg.com/monaco-editor@0.44.0/min/vs' } });
        require(['vs/editor/editor.main'], function () {
            // 濡쒕뵫 ?깃났 ???먮뵒???앹꽦
            editorContainer.innerHTML = ''; // 濡쒕뵫 硫붿떆吏 ?쒓굅
            initEditor();
        }, function (err) {
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

// ... (setupEditorEvents, broadcastState, openFile, openFolder ??湲곕뒫 ?좎?)

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

    // 遺꾨━ 踰꾪듉 ?대깽??
    const popoutBtn = document.getElementById('popout-chat');
    if (popoutBtn) {
        popoutBtn.onclick = () => {
            // Open a new independent chat window (keep the main chat panel visible)
            window.electronAPI.send('new-chat-window');
        };
    }

    // 梨꾪똿 李쎌씠 ?ロ삍?????ㅼ떆 硫붿씤 ?⑤꼸 蹂댁뿬二쇨린
    window.electronAPI.on('chat-window-closed', () => {
        document.getElementById('right-panel').style.display = 'flex';
    });

    // Settings modal open
    window.electronAPI.on('open-settings', async () => {
        await openSettingsModal();
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
        } else if (message.type === 'set_model') {
            const model = message.data?.model;
            if (model) window.electronAPI.send('set-model', { model });
        } else if (message.type === 'start_deep_learning') {
            window.electronAPI.send('start_deep_learning');
        } else if (message.type === 'stop_deep_learning') {
            window.electronAPI.send('stop_deep_learning');
        } else if (message.type === 'get_deep_learning_status') {
             window.electronAPI.send('get_deep_learning_status');
         } else if (message.type === 'rl_feedback') {
             window.electronAPI.send('rl-feedback', message.data || {});
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
                    message: response.data?.message || '',
                    isPartial: !!response.data?.isPartial
                }
            };
        } else if (response.type === 'done') {
            mapped = {
                type: 'task_complete',
                data: {
                    taskId,
                    success: !!response.data?.success,
                    message: response.data?.message || '',
                     rl: response.data?.rl || null
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
    window.electronAPI.on('django-ready', async () => {
  try {
    await refreshPackageList();
  } catch (e) {
    console.error('django-ready refresh error', e);
  }
});

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

        // Also reflect into Settings modal if open (so user sees result immediately)
        try {
            const overlay = document.getElementById('settings-overlay');
            const statusEl = document.getElementById('settings-status');
            const versionEl = document.getElementById('app-version');
            if (versionEl && payload?.currentVersion) {
                versionEl.textContent = `v${payload.currentVersion}`;
            }
            if (overlay && overlay.classList.contains('show') && statusEl) {
                const checkedAt = payload?.checkedAt ? ` (last check: ${payload.checkedAt})` : '';
                const extra = payload?.availableVersion ? ` (available: v${payload.availableVersion})` : '';
                const msg = payload?.message ? ` - ${payload.message}` : '';
                statusEl.textContent = `Update status: ${payload?.state || 'idle'}${extra}${checkedAt}${msg}`;
            }
        } catch (_) { }
    });

    // ?먯쑉 ?숈뒿 ?곹깭 ?섏떊 諛??밸럭 ?꾨떖
    window.electronAPI.on('deep_learning_status', (event, payload) => {
        const iframe = document.getElementById('ai-panel-iframe');
        if (iframe && iframe.contentWindow) {
            iframe.contentWindow.postMessage({
                type: 'deep_learning_status',
                data: payload
            }, '*');
        }
    });
}

async function openSettingsModal() {
    const overlay = document.getElementById('settings-overlay');
    if (!overlay || !window.electronAPI?.getSettings) return;

    const hostEl = document.getElementById('ollama-host');
    const portEl = document.getElementById('ollama-port');
    const modelEl = document.getElementById('ollama-model');
    const numPredictEl = document.getElementById('ollama-numPredict');
    const temperatureEl = document.getElementById('ollama-temperature');
    const baseUrlEl = document.getElementById('openai-baseUrl');
    const apiKeyEl = document.getElementById('openai-apiKey');
    const lunaApiKeyEl = document.getElementById('luna-apiKey');
    const vllmHostEl = document.getElementById('vllm-host');
    const vllmPortEl = document.getElementById('vllm-port');
    const vllmModelEl = document.getElementById('vllm-model');
    const systemInstructionsEl = document.getElementById('luna-system-instructions');
    const firewallBtn = document.getElementById('ollama-firewall-allow');
    const statusEl = document.getElementById('settings-status');
    const versionEl = document.getElementById('app-version');
    const checkUpdatesBtn = document.getElementById('check-updates-now');
    const btnSave = document.getElementById('settings-save');
    const btnCancel = document.getElementById('settings-cancel');
    const btnCloseX = document.getElementById('settings-close-x');

    const close = () => overlay.classList.remove('show');
    const show = () => overlay.classList.add('show');

    const settings = await window.electronAPI.getSettings();
    if (hostEl) hostEl.value = settings?.ollama?.host ?? 'localhost';
    if (portEl) portEl.value = String(settings?.ollama?.port ?? 11434);
    if (modelEl) modelEl.value = String(settings?.ollama?.model ?? 'llama3');
    if (numPredictEl) numPredictEl.value = String(settings?.ollama?.numPredict ?? 256);
    if (temperatureEl) temperatureEl.value = String(settings?.ollama?.temperature ?? 0.2);
    if (baseUrlEl) baseUrlEl.value = settings?.openai?.baseUrl ?? 'https://api.openai.com';
    if (apiKeyEl) apiKeyEl.value = settings?.openai?.apiKey ?? '';
    if (lunaApiKeyEl) lunaApiKeyEl.value = settings?.luna?.apiKey ?? '';
    if (vllmHostEl) vllmHostEl.value = settings?.vllm?.host ?? '127.0.0.1';
    if (vllmPortEl) vllmPortEl.value = String(settings?.vllm?.port ?? 8000);
    if (vllmModelEl) vllmModelEl.value = settings?.vllm?.model ?? 'facebook/opt-125m';
    if (systemInstructionsEl) systemInstructionsEl.value = settings?.systemInstructions ?? '';
    if (statusEl) statusEl.textContent = '';

    // App version + last update info
    if (window.electronAPI?.getAppInfo && versionEl) {
        const info = await window.electronAPI.getAppInfo();
        versionEl.textContent = info?.version ? `v${info.version}` : '-';
        if (info?.lastUpdate?.state && statusEl) {
            const checkedAt = info?.lastUpdate?.checkedAt || info?.lastUpdateCheckedAt;
            const suffix = checkedAt ? ` (last check: ${checkedAt})` : '';
            statusEl.textContent = `Update status: ${info.lastUpdate.state}${suffix}`;
        }
    }

    const onCancel = () => close();
    const onCloseX = () => close();
    const onOverlayClick = (e) => { if (e.target === overlay) close(); };

    const onSave = async () => {
        if (statusEl) statusEl.textContent = 'Saving...';
        const next = {
            ollama: {
                host: (hostEl?.value || 'localhost').trim(),
                port: Number((portEl?.value || '11434').trim()),
                model: (modelEl?.value || 'llama3').trim(),
                numPredict: Number((numPredictEl?.value || '256').trim()),
                temperature: Number((temperatureEl?.value || '0.2').trim())
            },
            openai: {
                baseUrl: (baseUrlEl?.value || 'https://api.openai.com').trim(),
                apiKey: (apiKeyEl?.value || '').trim()
            },
            luna: {
                apiKey: (lunaApiKeyEl?.value || '').trim()
            },
            vllm: {
                host: (vllmHostEl?.value || '127.0.0.1').trim(),
                port: Number((vllmPortEl?.value || '8000').trim()),
                model: (vllmModelEl?.value || 'facebook/opt-125m').trim(),
                numPredict: settings?.vllm?.numPredict ?? 1024,
                temperature: settings?.vllm?.temperature ?? 0.1
            },
            systemInstructions: (systemInstructionsEl?.value || '').trim()
        };
        await window.electronAPI.setSettings(next);
        if (statusEl) statusEl.textContent = 'Saved.';
        close();
    };

    const onAllowFirewall = async () => {
        if (!window.electronAPI?.allowOllamaFirewall) return;
        if (statusEl) statusEl.textContent = 'Adding firewall rule...';
        const res = await window.electronAPI.allowOllamaFirewall();
        if (statusEl) statusEl.textContent = res?.success ? 'Firewall rule added.' : (res?.message || 'Failed to add firewall rule.');
        // Re-check connection by re-saving current settings (no-op) to trigger check, or just close/open indicator will update via monitor.
    };

    const onCheckUpdatesNow = async () => {
        if (!window.electronAPI?.checkUpdatesNow) return;
        if (statusEl) statusEl.textContent = 'Checking updates...';
        const res = await window.electronAPI.checkUpdatesNow();
        if (statusEl) statusEl.textContent = res?.message || 'Update check requested.';
    };

    // (Re)bind handlers safely
    if (btnCancel) btnCancel.onclick = onCancel;
    if (btnCloseX) btnCloseX.onclick = onCloseX;
    if (btnSave) btnSave.onclick = onSave;
    if (firewallBtn) firewallBtn.onclick = onAllowFirewall;
    if (checkUpdatesBtn) checkUpdatesBtn.onclick = onCheckUpdatesNow;
    overlay.onclick = onOverlayClick;

    // ESC closes
    window.addEventListener('keydown', function escHandler(ev) {
        if (ev.key === 'Escape') {
            close();
            window.removeEventListener('keydown', escHandler);
        }
    });

    show();
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
        item.innerHTML = `<span class="icon">${file.isDirectory ? '?뱚' : '?뱞'}</span><span>${file.name}</span>`;
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
    if (iframe) iframe.src = '../webview-ui/dist/index.html?session=main';
}

// Sidebar Sections (Accordion)
function setupSidebarSections() {
    const sections = [
        { header: 'header-explorer', content: 'content-explorer' },
        { header: 'header-packages', content: 'content-packages' }
    ];

    sections.forEach(s => {
        const h = document.getElementById(s.header);
        const c = document.getElementById(s.content);
        if (!h || !c) return;

        h.onclick = () => {
            const isCollapsed = h.classList.toggle('collapsed');
            c.classList.toggle('hidden', isCollapsed);
            h.querySelector('.icon').textContent = isCollapsed ? '?? : '??;
        };
    });
}

// Package Manager Logic
async function setupPackageManager() {
    const btnRefresh = document.getElementById('btn-refresh-market');
    const statusEl = document.getElementById('pkg-status');
    const installedListEl = document.getElementById('installed-pkg-list');
    const marketListEl = document.getElementById('market-pkg-list');

    const refreshInstalled = async () => {
        if (!window.electronAPI?.getInstalledExtensions) return;
        const installed = await window.electronAPI.getInstalledExtensions();
        installedListEl.innerHTML = '';
        installed.forEach(ext => {
            const item = document.createElement('div');
            item.className = 'pkg-item';
            item.innerHTML = `
                <div class="pkg-info">
                    <span class="pkg-name">${ext.name}</span>
                    <span class="pkg-desc">${ext.version}</span>
                </div>
                <button class="btn btn-sm">Open</button>
            `;
            installedListEl.appendChild(item);
        });
    };

    const refreshMarket = async () => {
        if (!window.electronAPI?.fetchMarketplace) return;
        statusEl.textContent = 'Updating store...';
        const marketItems = await window.electronAPI.fetchMarketplace();
        marketListEl.innerHTML = '';

        marketItems.forEach(item => {
            const el = document.createElement('div');
            el.className = 'pkg-item';
            el.innerHTML = `
                <div class="pkg-info">
                    <span class="pkg-name">${item.name}</span>
                    <span class="pkg-desc">${item.version} ??${item.author}</span>
                </div>
                <button class="btn btn-sm primary install-btn" data-url="${item.downloadUrl}" data-id="${item.id}">Get</button>
            `;

            el.querySelector('.install-btn').onclick = async (e) => {
                const btn = e.target;
                const url = btn.dataset.url;
                const id = btn.dataset.id;

                btn.disabled = true;
                btn.textContent = '...';
                statusEl.textContent = `Installing ${id}...`;

                const res = await window.electronAPI.installExtension(url, id);
                if (res.success) {
                    statusEl.textContent = `${id} installed!`;
                    await refreshInstalled();
                } else {
                    statusEl.textContent = `Failed: ${res.error}`;
                }
                btn.disabled = false;
                btn.textContent = 'Get';
            };

            marketListEl.appendChild(el);
        });
        statusEl.textContent = '';
    };

    if (btnRefresh) btnRefresh.onclick = refreshMarket;

    // Initial load
    await refreshInstalled();
    await refreshMarket();
}

window.addEventListener('DOMContentLoaded', initializeUI);




