import os
import subprocess

def fix_all():
    # --- main.js ---
    main_js = r'''const { app, BrowserWindow, ipcMain, Menu, dialog, clipboard } = require('electron');
const path = require('path');
const fs = require('fs');
const { spawn, execSync } = require('child_process');
const { AgentRuntime } = require('./runtime');
const http = require('http');
const https = require('https');
const log = require('electron-log');
const { autoUpdater } = require('electron-updater');

const DJANGO_API_URL = process.env.LUNA_SERVER_URL || 'http://localhost:8000';
const EXTENSIONS_PATH = path.join(app.getPath('userData'), 'extensions');
if (!fs.existsSync(EXTENSIONS_PATH)) {
  fs.mkdirSync(EXTENSIONS_PATH, { recursive: true });
}

function isAdmin() {
  try {
    execSync('net session', { stdio: 'ignore' });
    return true;
  } catch (e) {
    return false;
  }
}

let mainWindow;
let chatWindows = []; 
let ptyProcess;
let djangoProcess; 
const agentRuntime = new AgentRuntime();
let llmHealthInterval = null;
let lastLLMConnected = null;
let activeModel = 'ollama';
let updateCheckInterval = null;
let lastUpdateState = { state: 'idle' };
let lastUpdateCheckedAt = null;
let settingsPath = null;
let llmSettings = null;
let globalEditorState = {
  openFiles: [],
  activeFile: null,
  cursor: { line: 1, column: 1 },
  selection: null,
  projectRoot: null
};

function defaultSettings() {
  return {
    ollama: {
      protocol: 'http',
      host: 'localhost',
      port: 11434,
      model: 'luna-soul',
      numPredict: 256,
      temperature: 0.2
    },
    openai: {
      baseUrl: 'https://api.openai.com',
      apiKey: ''
    },
    luna: {
      apiKey: ''
    },
    vllm: {
      host: '127.0.0.1',
      port: 8000,
      model: 'facebook/opt-125m',
      numPredict: 1024,
      temperature: 0.1
    }
  };
}

function loadSettings() {
  try {
    if (!settingsPath) {
      settingsPath = path.join(app.getPath('userData'), 'settings.json');
    }
    if (fs.existsSync(settingsPath)) {
      const raw = fs.readFileSync(settingsPath, 'utf8');
      const parsed = JSON.parse(raw);
      llmSettings = { ...defaultSettings(), ...(parsed || {}) };
    } else {
      llmSettings = defaultSettings();
      fs.writeFileSync(settingsPath, JSON.stringify(llmSettings, null, 2), 'utf8');
    }
  } catch (e) {
    console.error('Failed to load settings:', e);
    llmSettings = defaultSettings();
  }
}

function saveSettings(next) {
  try {
    if (!settingsPath) {
      settingsPath = path.join(app.getPath('userData'), 'settings.json');
    }
    fs.writeFileSync(settingsPath, JSON.stringify(next, null, 2), 'utf8');
  } catch (e) {
    console.error('Failed to save settings:', e);
  }
}

function createWindow() {
  if (!isAdmin()) {
    dialog.showErrorBox(
      'Privilege Error',
      'Luna AI Agent must be run as Administrator.'
    );
    app.quit();
    return;
  }

  mainWindow = new BrowserWindow({
    width: 1400,
    height: 900,
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      enableRemoteModule: false,
      preload: path.join(__dirname, 'preload.js')
    },
    icon: path.join(__dirname, '../assets/Luna.jpg'),
    title: 'Luna AI Agent',
    show: false
  });

  const htmlPath = path.join(__dirname, 'index.html');
  mainWindow.loadFile(htmlPath).catch(err => {
    console.error('Failed to load file:', err);
  });

  mainWindow.once('ready-to-show', () => {
    mainWindow.show();
    loadSettings();
    try {
      setupPowerShell();
    } catch (e) {
      console.error('PowerShell setup failed:', e);
    }
    startLLMHealthMonitor();
    setupAutoUpdater();
  });

  mainWindow.on('closed', () => {
    for (const w of chatWindows) {
      try { w.close(); } catch (_) { }
    }
    chatWindows = [];
    mainWindow = null;
    if (ptyProcess) ptyProcess.kill();
    stopLLMHealthMonitor();
    stopAutoUpdater();
    stopDjangoServer(); 
  });

  setupMenu();
}

function sendLLMConnectionStatus(payload) {
  if (mainWindow) mainWindow.webContents.send('llm-connection', payload);
  for (const w of chatWindows) {
    try { w.webContents.send('llm-connection', payload); } catch (_) { }
  }
}

function isOpenAIModel(model) {
  return typeof model === 'string' && model.toLowerCase().startsWith('gpt');
}

function checkLunaCoreOnce(timeoutMs = 700) {
  return new Promise((resolve) => {
    const cfg = (llmSettings?.ollama || defaultSettings().ollama);
    const host = (cfg.host || 'localhost').trim();
    const hostname = host.toLowerCase() === 'localhost' ? '127.0.0.1' : host;
    const req = http.request(
      {
        hostname,
        family: hostname === '127.0.0.1' ? 4 : undefined,
        port: Number(cfg.port || 11434),
        path: '/api/version',
        method: 'GET'
      },
      (res) => {
        const ok = res.statusCode >= 200 && res.statusCode < 300;
        res.resume();
        resolve(ok);
      }
    );

    req.on('error', () => resolve(false));
    req.setTimeout(timeoutMs, () => {
      try { req.destroy(); } catch (_) { }
      resolve(false);
    });
    req.end();
  });
}

function checkVLLMOnce(timeoutMs = 700) {
  return new Promise((resolve) => {
    const cfg = (llmSettings?.vllm || defaultSettings().vllm);
    const host = (cfg.host || '127.0.0.1').trim();
    const req = http.request(
      {
        hostname: host,
        port: Number(cfg.port || 8000),
        path: '/v1/models', 
        method: 'GET'
      },
      (res) => {
        const ok = res.statusCode >= 200 && res.statusCode < 300;
        res.resume();
        resolve(ok);
      }
    );
    req.on('error', () => resolve(false));
    req.setTimeout(timeoutMs, () => { try { req.destroy(); } catch (_) { } resolve(false); });
    req.end();
  });
}

function checkOpenAIOnce(timeoutMs = 1200) {
  const cfg = (llmSettings?.openai || defaultSettings().openai);
  let baseUrl = cfg.baseUrl || 'https://api.openai.com';
  try {
    baseUrl = new URL(baseUrl).toString().replace(/\/+$/, '');
  } catch (_) {
    baseUrl = 'https://api.openai.com';
  }

  const key =
    cfg.apiKey ||
    process.env.LUNA_OPENAI_API_KEY ||
    process.env.OPENAI_API_KEY ||
    '';

  if (!key) {
    return Promise.resolve({
      provider: 'openai',
      connected: false,
      message: 'OpenAI API key missing'
    });
  }

  return new Promise((resolve) => {
    const u = new URL(baseUrl);
    const req = https.request(
      {
        hostname: u.hostname,
        port: u.port ? Number(u.port) : 443,
        path: '/v1/models',
        method: 'GET',
        headers: {
          Authorization: `Bearer ${key}`
        }
      },
      (res) => {
        const ok = res.statusCode >= 200 && res.statusCode < 300;
        const unauthorized = res.statusCode === 401 || res.statusCode === 403;
        res.resume();
        resolve({
          provider: 'openai',
          connected: ok,
          message: ok
            ? 'OpenAI connected'
            : unauthorized
              ? 'OpenAI auth failed'
              : `OpenAI not reachable (${res.statusCode})`
        });
      }
    );

    req.on('error', (e) => resolve({
      provider: 'openai',
      connected: false,
      message: `OpenAI connection failed: ${e.message}`
    }));
    req.setTimeout(timeoutMs, () => {
      try { req.destroy(); } catch (_) { }
      resolve({
        provider: 'openai',
        connected: false,
        message: 'OpenAI connection timeout'
      });
    });
    req.end();
  });
}

async function checkLLMOnce() {
  if (activeModel === 'ollama' || activeModel === 'luna-soul') {
    const connected = await checkLunaCoreOnce();
    const cfg = (llmSettings?.ollama || defaultSettings().ollama);
    const host = (cfg.host || 'localhost').trim();
    const port = Number(cfg.port || 11434);
    const displayName = activeModel === 'luna-soul' ? 'Luna Soul' : activeModel;
    return {
      provider: displayName,
      connected,
      model: activeModel,
      message: connected ? `${displayName} Connected` : `${displayName} Not Reachable (${host}:${port})`
    };
  }

  if (activeModel === 'vllm') {
    const connected = await checkVLLMOnce();
    const cfg = (llmSettings?.vllm || defaultSettings().vllm);
    return {
      provider: 'vLLM',
      connected,
      model: activeModel,
      message: connected ? 'vLLM Connected' : `vLLM Not Reachable (${cfg.host}:${cfg.port})`
    };
  }

  if (isOpenAIModel(activeModel)) {
    const status = await checkOpenAIOnce();
    return { ...status, model: activeModel };
  }

  return {
    provider: activeModel,
    connected: false,
    model: activeModel,
    message: `Unknown model provider: ${activeModel}`
  };
}

function startLLMHealthMonitor() {
  if (llmHealthInterval) return;

  const tick = async () => {
    const status = await checkLLMOnce();
    const connected = !!status.connected;
    const changed = connected !== lastLLMConnected;
    if (changed) {
      lastLLMConnected = connected;
      sendLLMConnectionStatus(status);
    }
  };

  tick();
  llmHealthInterval = setInterval(tick, 2000);
}

function stopLLMHealthMonitor() {
  if (llmHealthInterval) {
    clearInterval(llmHealthInterval);
    llmHealthInterval = null;
  }
  lastLLMConnected = null;
}

function sendUpdateStatus(payload) {
  const enriched = {
    ...payload,
    currentVersion: app.getVersion(),
    checkedAt: lastUpdateCheckedAt
  };
  lastUpdateState = enriched;
  if (mainWindow) mainWindow.webContents.send('update-status', enriched);
  for (const w of chatWindows) {
    try { w.webContents.send('update-status', enriched); } catch (_) { }
  }
}

function setupAutoUpdater() {
  try {
    if (!app.isPackaged) {
      sendUpdateStatus({ state: 'idle', message: 'Auto-update disabled' });
      return;
    }

    autoUpdater.logger = log;
    log.transports.file.level = 'info';

    const updateUrl = process.env.LUNA_UPDATE_URL;
    if (updateUrl) {
      autoUpdater.setFeedURL({ provider: 'generic', url: updateUrl });
    }

    autoUpdater.autoDownload = true;
    autoUpdater.autoInstallOnAppQuit = true;
    autoUpdater.allowDowngrade = true; 
    autoUpdater.allowPrerelease = true; 

    autoUpdater.on('checking-for-update', () => {
      lastUpdateCheckedAt = new Date().toISOString();
      sendUpdateStatus({ state: 'checking', message: 'Checking for updates...' });
    });
    autoUpdater.on('update-available', (info) => sendUpdateStatus({ state: 'available', info, availableVersion: info?.version, message: 'New update found!' }));
    autoUpdater.on('update-not-available', (info) => sendUpdateStatus({ state: 'none', info, message: 'Up to date' }));
    autoUpdater.on('download-progress', (progress) => sendUpdateStatus({ state: 'downloading', progress }));
    autoUpdater.on('error', (err) => {
      const msg = err?.message || String(err);
      sendUpdateStatus({ state: 'error', message: msg });
    });

    autoUpdater.on('update-downloaded', async (info) => {
      sendUpdateStatus({ state: 'downloaded', info });

      const unattended = String(process.env.LUNA_AUTO_INSTALL_UPDATE || '').toLowerCase() === 'true';
      if (unattended) {
        sendUpdateStatus({ state: 'installing', info });
        autoUpdater.quitAndInstall(true, true);
        return;
      }

      const result = await dialog.showMessageBox(mainWindow, {
        type: 'info',
        buttons: ['Restart now', 'Later'],
        defaultId: 0,
        cancelId: 1,
        title: 'Update ready',
        message: 'A new version has been downloaded.',
        detail: 'Restart Luna AI Agent to apply the update.'
      });
      if (result.response === 0) {
        autoUpdater.quitAndInstall();
      }
    });

    autoUpdater.checkForUpdatesAndNotify().catch((e) => log.warn('[autoUpdate] check failed', e));
    if (!updateCheckInterval) {
      updateCheckInterval = setInterval(() => {
        autoUpdater.checkForUpdatesAndNotify().catch((e) => log.warn('[autoUpdate] periodic check failed', e));
      }, 10 * 60 * 1000);
    }
  } catch (e) {
    console.error('AutoUpdater setup failed:', e);
  }
}

function stopAutoUpdater() {
  if (updateCheckInterval) {
    clearInterval(updateCheckInterval);
    updateCheckInterval = null;
  }
}

function createChatWindow() {
  const sessionId = `chat_${Date.now()}_${Math.random().toString(16).slice(2)}`;
  const win = new BrowserWindow({
    width: 450,
    height: 800,
    title: 'New chat',
    icon: path.join(__dirname, '../assets/Luna.jpg'),
    autoHideMenuBar: true, 
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      nodeIntegration: false,
      contextIsolation: true
    }
  });

  win.setMenuBarVisibility(false); 

  win.loadFile(path.join(__dirname, 'chat.html'), { query: { session: sessionId } });

  chatWindows.push(win);
  win.on('closed', () => {
    chatWindows = chatWindows.filter(w => w !== win);
  });

  if (lastLLMConnected !== null) {
    const displayName = activeModel === 'luna-soul' ? 'Luna Soul' : activeModel;
    sendLLMConnectionStatus({
      provider: displayName,
      connected: lastLLMConnected,
      message: lastLLMConnected ? `${displayName} Connected` : `${displayName} Not Reachable`
    });
  }
}

ipcMain.on('popout-chat', () => {
  createChatWindow();
});

let isDeepLearningActive = false;
let deepLearningTimer = null;

function broadcastDeepLearningStatus() {
  const payload = { active: isDeepLearningActive };
  if (mainWindow) mainWindow.webContents.send('deep_learning_status', payload);
  for (const w of chatWindows) {
    try { w.webContents.send('deep_learning_status', payload); } catch (_) { }
  }
}

function broadcastAgentResponse(response) {
  if (mainWindow) mainWindow.webContents.send('agent-response', response);
  for (const w of chatWindows) {
    try { w.webContents.send('agent-response', response); } catch (_) { }
  }
}

function runDeepLearningPulse() {
  if (!isDeepLearningActive) return;

  const topics = ["TypeScript", "Electron", "Rust", "AI Agent", "Modern CSS"];
  const randomTopic = topics[Math.floor(Math.random() * topics.length)];

  const taskId = `dl_${Date.now()}`;
  const instruction = `Learning Mode: Summary about "${randomTopic}"`;

  if (!llmSettings) loadSettings();

  const request = {
    type: 'edit_request', 
    instruction,
    context: {
      taskId,
      llmSettings,
      model: 'luna-soul',
      projectRoot: globalEditorState.projectRoot
    }
  };

  agentRuntime.processRequest(request, (response) => {
    broadcastAgentResponse({
      ...response,
      data: { ...(response.data || {}), taskId }
    });

    if (response.type === 'done') {
      if (isDeepLearningActive) {
        deepLearningTimer = setTimeout(runDeepLearningPulse, 5 * 60 * 1000);
      }
    }
  });
}

ipcMain.on('start_deep_learning', () => {
  if (isDeepLearningActive) return;
  isDeepLearningActive = true;
  runDeepLearningPulse();
  broadcastDeepLearningStatus();
});

ipcMain.on('stop_deep_learning', () => {
  isDeepLearningActive = false;
  if (deepLearningTimer) clearTimeout(deepLearningTimer);
  broadcastDeepLearningStatus();
});

ipcMain.on('get_deep_learning_status', () => {
  broadcastDeepLearningStatus();
});

ipcMain.on('new-chat-window', () => {
  createChatWindow();
});

ipcMain.on('set-model', async (_event, payload) => {
  const next = payload?.model;
  if (!next || typeof next !== 'string') return;
  activeModel = next;
  lastLLMConnected = null;
  const status = await checkLLMOnce();
  lastLLMConnected = !!status.connected;
  sendLLMConnectionStatus(status);
});

ipcMain.handle('get-settings', async () => {
  if (!llmSettings) loadSettings();
  return llmSettings;
});

ipcMain.handle('set-settings', async (_event, next) => {
  if (!llmSettings) loadSettings();
  const merged = {
    ...defaultSettings(),
    ...(llmSettings || {}),
    ...(next || {})
  };

  merged.ollama = {
    protocol: merged.ollama?.protocol === 'https' ? 'https' : 'http',
    host: String(merged.ollama?.host || 'localhost'),
    port: Number(merged.ollama?.port || 11434),
    model: String(merged.ollama?.model || 'luna-soul'),
    numPredict: Number(merged.ollama?.numPredict || 256),
    temperature: Number(merged.ollama?.temperature ?? 0.2)
  };
  merged.openai = {
    baseUrl: String(merged.openai?.baseUrl || 'https://api.openai.com'),
    apiKey: String(merged.openai?.apiKey || '')
  };

  llmSettings = merged;
  saveSettings(llmSettings);

  lastLLMConnected = null;
  const status = await checkLLMOnce();
  lastLLMConnected = !!status.connected;
  sendLLMConnectionStatus(status);

  return llmSettings;
});

ipcMain.handle('firewall-allow-ollama', async () => {
  try {
    if (process.platform !== 'win32') {
      return { success: false, message: 'Windows only.' };
    }

    const inName = 'Luna - Allow Ollama 11434 (TCP In)';
    const outName = 'Luna - Allow Ollama 11434 (TCP Out)';

    try {
      execSync(`netsh advfirewall firewall add rule name="${inName}" dir=in action=allow protocol=TCP localport=11434`, { stdio: 'ignore' });
    } catch (_) { }
    try {
      execSync(`netsh advfirewall firewall add rule name="${outName}" dir=out action=allow protocol=TCP localport=11434`, { stdio: 'ignore' });
    } catch (_) { }

    return { success: true, message: 'Firewall rules added.' };
  } catch (e) {
    return { success: false, message: `Failed: ${e?.message || String(e)}` };
  }
});

ipcMain.handle('get-app-info', async () => {
  return {
    version: app.getVersion(),
    isPackaged: app.isPackaged,
    lastUpdate: lastUpdateState,
    lastUpdateCheckedAt
  };
});

ipcMain.handle('check-updates-now', async () => {
  try {
    if (!app.isPackaged) {
      return { success: false, message: 'Dev build.' };
    }
    lastUpdateCheckedAt = new Date().toISOString();
    sendUpdateStatus({ state: 'checking' });
    const result = await autoUpdater.checkForUpdates();
    const info = result?.updateInfo;
    if (info?.version) {
      return { success: true, message: `Checked. Latest: v${info.version}` };
    }
    return { success: true, message: 'Checked.' };
  } catch (e) {
    sendUpdateStatus({ state: 'error', message: e?.message || String(e) });
    return { success: false, message: e?.message || String(e) };
  }
});

function setupMenu() {
  const template = [
    {
      label: 'File',
      submenu: [
        {
          label: 'Open File',
          accelerator: 'CmdOrCtrl+O',
          click: async () => {
            const result = await dialog.showOpenDialog(mainWindow, {
              properties: ['openFile'],
              filters: [{ name: 'All Files', extensions: ['*'] }]
            });
            if (!result.canceled) {
              mainWindow.webContents.send('open-file', result.filePaths[0]);
            }
          }
        },
        {
          label: 'Open Folder',
          accelerator: 'CmdOrCtrl+K CmdOrCtrl+O',
          click: async () => {
            const result = await dialog.showOpenDialog(mainWindow, {
              properties: ['openDirectory']
            });
            if (!result.canceled) {
              mainWindow.webContents.send('open-folder', result.filePaths[0]);
            }
          }
        },
        { type: 'separator' },
        {
          label: 'Save',
          accelerator: 'CmdOrCtrl+S',
          click: () => {
            mainWindow.webContents.send('save-file');
          }
        },
        {
          label: 'Save As...',
          accelerator: 'CmdOrCtrl+Shift+S',
          click: async () => {
            const result = await dialog.showSaveDialog(mainWindow, {
              properties: ['showOverwriteConfirmation']
            });
            if (!result.canceled) {
              mainWindow.webContents.send('save-file-as', result.filePath);
            }
          }
        },
        { type: 'separator' },
        {
          label: 'Settings',
          accelerator: 'CmdOrCtrl+,',
          click: () => {
            mainWindow.webContents.send('open-settings');
          }
        },
        { type: 'separator' },
        { role: 'quit', label: 'Exit' }
      ]
    },
    {
      label: 'Edit',
      submenu: [
        { role: 'undo' },
        { role: 'redo' },
        { type: 'separator' },
        { role: 'cut' },
        { role: 'copy' },
        { role: 'paste' },
        { role: 'selectall' }
      ]
    },
    {
      label: 'View',
      submenu: [
        { role: 'reload' },
        { role: 'forcereload' },
        { role: 'toggledevtools' },
        { type: 'separator' },
        { role: 'resetzoom' },
        { role: 'zoomin' },
        { role: 'zoomout' },
        { type: 'separator' },
        { role: 'togglefullscreen' }
      ]
    },
    {
      label: 'Window',
      submenu: [
        { role: 'minimize' },
        { role: 'close' },
        { type: 'separator' },
        {
          label: 'New Chat Window',
          accelerator: 'CmdOrCtrl+N',
          click: () => createChatWindow()
        },
        {
          label: 'New Terminal Window',
          accelerator: 'CmdOrCtrl+Shift+T',
          click: () => {
             spawn('powershell.exe', { detached: true, stdio: 'ignore' }).unref();
          }
        }
      ]
    },
    {
      label: 'Help',
      submenu: [
        {
          label: 'About Luna AI Agent',
          click: () => {
            dialog.showMessageBox(mainWindow, {
              type: 'info',
              title: 'About',
              message: 'Luna AI Agent',
              detail: 'Version 0.1.0'
            });
          }
        }
      ]
    }
  ];

  const menu = Menu.buildFromTemplate(template);
  Menu.setApplicationMenu(menu);
}

function setupPowerShell() {
  try {
    ptyProcess = spawn('powershell.exe', ['-NoLogo', '-NoExit'], {
      stdio: ['pipe', 'pipe', 'pipe'],
      shell: true
    });

    ptyProcess.stdout.on('data', (data) => {
      if (mainWindow) mainWindow.webContents.send('terminal-data', data.toString());
    });

    ptyProcess.stderr.on('data', (data) => {
      if (mainWindow) mainWindow.webContents.send('terminal-data', data.toString());
    });

    ipcMain.on('terminal-input', (event, input) => {
      if (ptyProcess && ptyProcess.stdin && ptyProcess.stdin.writable) {
        try {
          ptyProcess.stdin.write(input);
        } catch (err) {
          console.error('Terminal write error:', err);
        }
      }
    });
  } catch (err) {
    console.error('Could not start PowerShell:', err);
  }
}

function startDjangoServer() {
  try {
    const serverPath = app.isPackaged 
      ? path.join(process.resourcesPath, 'luna-server') 
      : path.join(__dirname, '../luna-server');

    if (!fs.existsSync(serverPath)) return;

    djangoProcess = spawn('python', ['manage.py', 'runserver', '127.0.0.1:8000', '--noreload'], {
      cwd: serverPath,
      shell: true,
      detached: false
    });
  } catch (e) {
    console.error('[DJANGO] Start failed:', e);
  }
}

function stopDjangoServer() {
  if (djangoProcess) {
    if (process.platform === 'win32') {
      execSync(`taskkill /pid ${djangoProcess.pid} /f /t`);
    } else {
      djangoProcess.kill();
    }
    djangoProcess = null;
  }
}

app.whenReady().then(() => {
  createWindow();
  startDjangoServer();
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

ipcMain.handle('read-file', async (e, path) => fs.readFileSync(path, 'utf8'));
ipcMain.handle('write-file', async (e, path, content) => fs.writeFileSync(path, content, 'utf8'));
ipcMain.handle('get-installed-extensions', async () => {
  try {
    if (!fs.existsSync(EXTENSIONS_PATH)) return [];
    const dirs = fs.readdirSync(EXTENSIONS_PATH);
    const extensions = [];
    for (const d of dirs) {
      const mPath = path.join(EXTENSIONS_PATH, d, 'manifest.json');
      if (fs.existsSync(mPath)) {
        try {
          const m = JSON.parse(fs.readFileSync(mPath, 'utf8'));
          extensions.push(m);
        } catch (_) { }
      }
    }
    return extensions;
  } catch (e) {
    return [];
  }
});
ipcMain.handle('read-directory', async (e, dirPath) => {
  const items = fs.readdirSync(dirPath, { withFileTypes: true });
  return items.map(item => ({
    name: item.name,
    isDirectory: item.isDirectory(),
    path: path.join(dirPath, item.name)
  }));
});

ipcMain.handle('execute-task', async (event, instruction, context) => {
  const taskId = context?.taskId;
  if (!llmSettings) loadSettings();
  const request = {
    type: 'edit_request',
    instruction,
    context: {
      ...(context || {}),
      llmSettings
    }
  };

  agentRuntime.processRequest(request, (response) => {
    const enriched = {
      ...response,
      data: { ...(response.data || {}), taskId }
    };
    try {
      event.sender.send('agent-response', enriched);
    } catch (_) {
      if (mainWindow) mainWindow.webContents.send('agent-response', enriched);
    }
  });

  return { success: true };
});

ipcMain.handle('cancel-task', async (e, id) => true);
ipcMain.on('update-editor-state', (event, state) => {
  globalEditorState = { ...globalEditorState, ...state };
});
ipcMain.handle('get-editor-state', () => globalEditorState);

ipcMain.handle('package-list', async (event, query) => {
  return new Promise((resolve) => {
    const url = `${DJANGO_API_URL}/api/packages/?q=${encodeURIComponent(query || '')}`;
    const client = url.startsWith('https') ? https : http;
    client.get(url, (res) => {
      let data = '';
      res.on('data', (chunk) => data += chunk);
      res.on('end', () => {
        try { resolve(JSON.parse(data)); } catch (e) { resolve([]); }
      });
    }).on('error', () => resolve([]));
  });
});

ipcMain.handle('package-install', async (event, { name, version }) => {
  try {
    const downloadUrl = `${DJANGO_API_URL}/api/packages/${name}/${version}/download/`;
    const targetDir = path.join(EXTENSIONS_PATH, name);
    const tempZip = path.join(app.getPath('temp'), `luna_pkg_${name}_${version}.zip`);

    if (!fs.existsSync(targetDir)) {
      fs.mkdirSync(targetDir, { recursive: true });
    }

    await new Promise((resolve, reject) => {
      const file = fs.createWriteStream(tempZip);
      const client = downloadUrl.startsWith('https') ? https : http;
      client.get(downloadUrl, (res) => {
        if (res.statusCode !== 200) { reject(new Error('Download failed')); return; }
        res.pipe(file);
        file.on('finish', () => { file.close(); resolve(); });
      }).on('error', reject);
    });

    const unzipCmd = `Expand-Archive -Path "${tempZip}" -DestinationPath "${targetDir}" -Force`;
    execSync(`powershell -Command "${unzipCmd}"`);

    if (fs.existsSync(tempZip)) fs.unlinkSync(tempZip);
    return { success: true };
  } catch (e) {
    return { success: false, error: e.message };
  }
});

ipcMain.on('clipboard-write', (event, text) => {
  clipboard.writeText(text);
});

ipcMain.handle('clipboard-read', () => {
  return clipboard.readText();
});'''

    # Write files strictly as ASCII
    with open('electron/main.js', 'wb') as f: f.write(main_js.encode('ascii'))
    print('SUCCESS: main.js wrote as ASCII')

    # Verify syntax
    res = subprocess.run(['node', '--check', 'electron/main.js'], capture_output=True, text=True)
    if res.returncode == 0:
        print('VERIFIED: main.js syntax is PERFECT')
    else:
        print('FAIL: main.js syntax error:\n', res.stderr)

fix_all()
