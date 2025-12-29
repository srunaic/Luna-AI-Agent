// Luna AI Agent - Renderer Process
let editor = null; let currentFile = null; let currentFolder = null; let terminal = null; let terminalFitAddon = null; let navigationHistory = []; let historyIndex = -1; let activeTaskId = null;
let editorState = { openFiles: [], activeFile: null, cursor: { line: 1, column: 1 }, selection: null, projectRoot: null };

function initializeUI() {
    console.log('Initializing Luna UI components...');
    setTimeout(() => { const loading = document.getElementById('loading'); if (loading) loading.classList.add('hide'); }, 1000);
    try { setupNavigation(); setupIPCListeners(); initializeAIPanel(); setupSplitters(); setupTerminal(); setupSidebarSections(); setupPackageManager(); } catch (e) { console.error('UI Setup error:', e); }
    loadMonaco();
}

function loadMonaco() {
    const container = document.getElementById('monaco-editor');
    if (!container) return;
    require.config({ paths: { 'vs': 'https://cdn.jsdelivr.net/npm/monaco-editor@0.44.0/min/vs' } });
    require(['vs/editor/editor.main'], function () { initEditor(); });
}

function initEditor() {
    const container = document.getElementById('monaco-editor');
    editor = monaco.editor.create(container, {
        value: '// Select a file to start coding with Luna!\n',
        language: 'javascript',
        theme: 'vs-dark',
        automaticLayout: true,
        fontSize: 14,
        fontFamily: "'Cascadia Code', 'Consolas', 'Courier New', monospace",
        fontLigatures: true,
        minimap: { enabled: true, side: 'right' },
        bracketPairColorization: { enabled: true },
        cursorSmoothCaretAnimation: 'on',
        smoothScrolling: true,
        padding: { top: 15, bottom: 15 },
        lineHeight: 22,
        cursorBlinking: 'smooth',
        renderLineHighlight: 'all'
    });
    setupEditorEvents();
}

function setupEditorEvents() {
    editor.onDidChangeCursorPosition((e) => { editorState.cursor = { line: e.position.lineNumber, column: e.position.column }; broadcastState(); });
}

function broadcastState() {
    if (window.electronAPI) window.electronAPI.updateEditorState(editorState);
    const iframe = document.getElementById('ai-panel-iframe');
    if (iframe && iframe.contentWindow) iframe.contentWindow.postMessage({ type: 'editor_state_update', data: editorState }, '*');
}

async function openFolder(folderPath, updateHistory = true) {
    currentFolder = folderPath;
    const files = await window.electronAPI.readDirectory(folderPath);
    renderFileTree(files);
    editorState.projectRoot = folderPath;
    broadcastState();
    const iframe = document.getElementById('ai-panel-iframe');
    if (iframe && iframe.contentWindow) {
        iframe.contentWindow.postMessage({ type: 'task_complete', data: { success: true, message: '?? ?????? ????? ??????????? ??' } }, '*');
    }
}

function renderFileTree(files) {
    const fileTree = document.getElementById('file-tree');
    fileTree.innerHTML = '';
    files.forEach(file => {
        const item = document.createElement('div');
        item.className = 'file-item';
        item.innerHTML = \<span>\</span> <span>\</span>\;
        item.onclick = () => file.isDirectory ? openFolder(file.path) : openFile(file.path);
        fileTree.appendChild(item);
    });
}

function initializeAIPanel() {
    const iframe = document.getElementById('ai-panel-iframe');
    if (iframe) iframe.src = '../webview-ui/dist/index.html?session=main';
}

function setupIPCListeners() {
    window.electronAPI.on('agent-response', (event, response) => {
        const iframe = document.getElementById('ai-panel-iframe');
        if (iframe && iframe.contentWindow) iframe.contentWindow.postMessage(response, '*');
    });
    window.electronAPI.on('open-folder', (e, p) => openFolder(p));
}

// ... other setup functions omitted for brevity in force-write ...
window.addEventListener('DOMContentLoaded', initializeUI);