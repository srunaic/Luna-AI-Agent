const { app, BrowserWindow, ipcMain, Menu, dialog, clipboard } = require('electron');
const path = require('path');
const fs = require('fs');
const { spawn, execSync } = require('child_process');
const { AgentRuntime } = require('./runtime');
const http = require('http');
const log = require('electron-log');
const { autoUpdater } = require('electron-updater');

// 관리자 권한 체크 함수
function isAdmin() {
  try {
    // Windows에서 관리자 권한이 필요한 명령어를 실행해 확인
    execSync('net session', { stdio: 'ignore' });
    return true;
  } catch (e) {
    return false;
  }
}

let mainWindow;
let chatWindow; // 분리된 채팅 창을 위한 변수
let ptyProcess;
const agentRuntime = new AgentRuntime();
let llmHealthInterval = null;
let lastLLMConnected = null;
let updateCheckInterval = null;
let globalEditorState = {
  openFiles: [],
  activeFile: null,
  cursor: { line: 1, column: 1 },
  selection: null,
  projectRoot: null
};

function createWindow() {
  // 관리자 권한이 아니면 경고 메시지를 띄우고 종료
  if (!isAdmin()) {
    dialog.showErrorBox(
      '권한 부족',
      'Luna AI Agent는 관리자 권한으로 실행되어야 합니다. 프로그램을 우클릭하여 "관리자 권한으로 실행"을 선택해 주세요.'
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
    try {
      setupPowerShell();
    } catch (e) {
      console.error('PowerShell setup failed:', e);
    }

    // Start LLM health monitor (Ollama)
    startLLMHealthMonitor();

    // Auto update
    setupAutoUpdater();
  });

  mainWindow.on('closed', () => {
    if (chatWindow) chatWindow.close(); // 메인 창 닫히면 채팅 창도 닫음
    mainWindow = null;
    if (ptyProcess) ptyProcess.kill();
    stopLLMHealthMonitor();
    stopAutoUpdater();
  });

  setupMenu();
}

function sendLLMConnectionStatus(payload) {
  if (mainWindow) mainWindow.webContents.send('llm-connection', payload);
  if (chatWindow) chatWindow.webContents.send('llm-connection', payload);
}

function checkOllamaOnce(timeoutMs = 700) {
  return new Promise((resolve) => {
    const req = http.request(
      {
        hostname: 'localhost',
        port: 11434,
        path: '/api/version',
        method: 'GET'
      },
      (res) => {
        // Any 2xx is "connected"
        const ok = res.statusCode >= 200 && res.statusCode < 300;
        res.resume();
        resolve(ok);
      }
    );

    req.on('error', () => resolve(false));
    req.setTimeout(timeoutMs, () => {
      try { req.destroy(); } catch (_) {}
      resolve(false);
    });
    req.end();
  });
}

function startLLMHealthMonitor() {
  if (llmHealthInterval) return;

  const tick = async () => {
    const connected = await checkOllamaOnce();
    if (connected !== lastLLMConnected) {
      lastLLMConnected = connected;
      sendLLMConnectionStatus({
        provider: 'ollama',
        connected,
        message: connected ? 'Ollama connected' : 'Ollama not reachable (localhost:11434)'
      });
    }
  };

  // Fire immediately + poll
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
  if (mainWindow) mainWindow.webContents.send('update-status', payload);
  if (chatWindow) chatWindow.webContents.send('update-status', payload);
}

function setupAutoUpdater() {
  try {
    // Auto-update only works reliably for installed/packaged apps (NSIS-installed).
    // Prevent confusing behavior during dev or when running unpacked binaries.
    if (!app.isPackaged) {
      sendUpdateStatus({ state: 'idle', message: 'Auto-update disabled (dev/unpacked build)' });
      return;
    }

    // Logging
    autoUpdater.logger = log;
    log.transports.file.level = 'info';

    // Allow overriding update URL at runtime (recommended)
    const updateUrl = process.env.LUNA_UPDATE_URL;
    if (updateUrl) {
      autoUpdater.setFeedURL({ provider: 'generic', url: updateUrl });
      log.info('[autoUpdate] Using LUNA_UPDATE_URL:', updateUrl);
    } else {
      log.info('[autoUpdate] Using build.publish configuration');
    }

    autoUpdater.autoDownload = true;
    autoUpdater.autoInstallOnAppQuit = true;

    autoUpdater.on('checking-for-update', () => sendUpdateStatus({ state: 'checking' }));
    autoUpdater.on('update-available', (info) => sendUpdateStatus({ state: 'available', info }));
    autoUpdater.on('update-not-available', (info) => sendUpdateStatus({ state: 'none', info }));
    autoUpdater.on('download-progress', (progress) => sendUpdateStatus({ state: 'downloading', progress }));
    autoUpdater.on('error', (err) => sendUpdateStatus({ state: 'error', message: err?.message || String(err) }));

    autoUpdater.on('update-downloaded', async (info) => {
      sendUpdateStatus({ state: 'downloaded', info });

      // Unattended mode: auto-restart + install when download completes
      const unattended = String(process.env.LUNA_AUTO_INSTALL_UPDATE || '').toLowerCase() === 'true';
      if (unattended) {
        sendUpdateStatus({ state: 'installing', info });
        // quitAndInstall(isSilent, isForceRunAfter)
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

    // Initial check + periodic checks
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

// 채팅 분리 창 생성 함수
function createChatWindow() {
  if (chatWindow) {
    chatWindow.focus();
    return;
  }

  chatWindow = new BrowserWindow({
    width: 450,
    height: 800,
    title: 'Luna chat',
    icon: path.join(__dirname, '../assets/Luna.jpg'),
    autoHideMenuBar: true, // 메뉴 바 숨김
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      nodeIntegration: false,
      contextIsolation: true
    }
  });

  chatWindow.setMenuBarVisibility(false); // 메뉴 바 완전히 제거

  chatWindow.loadFile(path.join(__dirname, '../webview-ui/dist/index.html'));

  chatWindow.on('closed', () => {
    chatWindow = null;
    if (mainWindow) {
      mainWindow.webContents.send('chat-window-closed');
    }
  });

  // If we already know the LLM status, push it into the new chat window immediately
  if (lastLLMConnected !== null) {
    sendLLMConnectionStatus({
      provider: 'ollama',
      connected: lastLLMConnected,
      message: lastLLMConnected ? 'Ollama connected' : 'Ollama not reachable (localhost:11434)'
    });
  }
}

ipcMain.on('popout-chat', () => {
  createChatWindow();
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
        { role: 'close' }
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
              title: 'About Luna AI Agent',
              message: 'Luna AI Agent',
              detail: 'Next Generation AI-powered Code Editor\nVersion 0.1.0'
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

app.whenReady().then(createWindow);

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

ipcMain.handle('read-file', async (e, path) => fs.readFileSync(path, 'utf8'));
ipcMain.handle('write-file', async (e, path, content) => fs.writeFileSync(path, content, 'utf8'));
ipcMain.handle('read-directory', async (e, dirPath) => {
  const items = fs.readdirSync(dirPath, { withFileTypes: true });
  return items.map(item => ({
    name: item.name,
    isDirectory: item.isDirectory(),
    path: path.join(dirPath, item.name)
  }));
});

ipcMain.handle('execute-task', async (event, instruction, context) => {
  const request = {
    type: 'edit_request',
    instruction,
    context
  };

  agentRuntime.processRequest(request, (response) => {
    mainWindow.webContents.send('agent-response', response);
  });

  return { success: true };
});

ipcMain.handle('cancel-task', async (e, id) => true);

ipcMain.on('update-editor-state', (event, state) => {
  globalEditorState = { ...globalEditorState, ...state };
});

ipcMain.handle('get-editor-state', () => globalEditorState);

// 클립보드 관련 IPC 핸들러
ipcMain.on('clipboard-write', (event, text) => {
  clipboard.writeText(text);
});

ipcMain.handle('clipboard-read', () => {
  return clipboard.readText();
});
