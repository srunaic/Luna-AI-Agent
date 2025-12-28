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
        setupSplitters();
        setupTerminal();
    } catch (e) {
        console.error('UI Setup error:', e);
    }

    // 3. 에디터 엔진(가장 무거운 작업)을 백그라운드에서 로드합니다.
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
    } catch (_) {}
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
    } catch (_) {}
}

function relayoutEditors() {
    try {
        if (editor) editor.layout();
    } catch (_) {}
    try {
        if (terminalFitAddon) terminalFitAddon.fit();
    } catch (_) {}
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
                try { terminal.focus(); } catch (_) {}
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

            // Ctrl + L: Clear terminal (Manual "지우기")
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
            try { terminal.focus(); } catch (_) {}
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
                statusEl.textContent = `Update status: ${payload?.state || 'idle'}${extra}${checkedAt}`;
            }
        } catch (_) {}
    });
}

async function openSettingsModal() {
    const overlay = document.getElementById('settings-overlay');
    if (!overlay || !window.electronAPI?.getSettings) return;

    const hostEl = document.getElementById('ollama-host');
    const portEl = document.getElementById('ollama-port');
    const baseUrlEl = document.getElementById('openai-baseUrl');
    const apiKeyEl = document.getElementById('openai-apiKey');
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
    if (baseUrlEl) baseUrlEl.value = settings?.openai?.baseUrl ?? 'https://api.openai.com';
    if (apiKeyEl) apiKeyEl.value = settings?.openai?.apiKey ?? '';
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
                port: Number((portEl?.value || '11434').trim())
            },
            openai: {
                baseUrl: (baseUrlEl?.value || 'https://api.openai.com').trim(),
                apiKey: (apiKeyEl?.value || '').trim()
            }
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