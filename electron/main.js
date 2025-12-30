const { app, BrowserWindow, ipcMain, Menu, dialog, clipboard } = require('electron');
const path = require('path');
const fs = require('fs');
const { spawn, execSync } = require('child_process');
const { AgentRuntime } = require('./runtime');
const http = require('http');
const https = require('https');
const log = require('electron-log');
const { autoUpdater } = require('electron-updater');
// ---- Crash-safe logging (critical for white screen diagnosis) ----
log.transports.file.level = 'info';
log.transports.console.level = 'info';

const SMOKE_TEST =
  process.env.LUNA_SMOKE_TEST === '1' ||
  String(process.env.LUNA_SMOKE_TEST || '').toLowerCase() === 'true';

process.on('uncaughtException', (err) => {
  try { log.error('[uncaughtException]', err); } catch (_) {}
  try { dialog.showErrorBox('Luna AI Agent - Crash (main)', err?.stack || String(err)); } catch (_) {}
});

process.on('unhandledRejection', (reason) => {
  try { log.error('[unhandledRejection]', reason); } catch (_) {}
  try { dialog.showErrorBox('Luna AI Agent - Crash (promise)', String(reason)); } catch (_) {}
});

// GPU issues are a common cause of blank/white window on Windows.
if (process.platform === 'win32') {
  try { app.disableHardwareAcceleration(); } catch (_) {}
}

const DJANGO_API_URL = process.env.LUNA_SERVER_URL || 'http://127.0.0.1:8000';

const EXTENSIONS_PATH = path.join(app.getPath('userData'), 'extensions');
if (!fs.existsSync(EXTENSIONS_PATH)) {
  fs.mkdirSync(EXTENSIONS_PATH, { recursive: true });
}

// --- Extensions: installed list (used by renderer marketplace UI) ---
ipcMain.handle('get-installed-extensions', async () => {
  try {
    if (!fs.existsSync(EXTENSIONS_PATH)) return [];
    const dirs = fs.readdirSync(EXTENSIONS_PATH);
    const extensions = [];
    for (const d of dirs) {
      const manifestPath = path.join(EXTENSIONS_PATH, d, 'manifest.json');
      if (!fs.existsSync(manifestPath)) continue;
      try {
        const m = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
        extensions.push(m);
      } catch (_) {}
    }
    return extensions;
  } catch (_) {
    return [];
  }
});



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
let chatWindows = []; // 분리된 채팅 창들
let ptyProcess;
let djangoProcess;
let djangoStarting = false;
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
      // Local Ollama model name (must exist in `ollama list`)
      model: 'luna-soul',
      // Speed: limit generated tokens to reduce latency (higher = slower)
      numPredict: 256,
      // Optional: creativity/speed tradeoff (0.0-1.0)
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
    },
    memory: {
      enabled: true,
      autoIngest: true,
      ragEnabled: true,
      topK: 6
    }
  };
}

function getMemoryCfg() {
  const cfg = (llmSettings && llmSettings.memory) ? llmSettings.memory : (defaultSettings().memory || {});
  return {
    enabled: cfg.enabled !== false,
    autoIngest: cfg.autoIngest !== false,
    ragEnabled: cfg.ragEnabled !== false,
    topK: Number(cfg.topK || 6)
  };
}

function httpJson(method, url, body, timeoutMs = 2500) {
  return new Promise((resolve, reject) => {
    try {
      const u = new URL(url);
      const client = u.protocol === 'https:' ? https : http;
      const data = body ? Buffer.from(JSON.stringify(body), "utf8") : null;
      const req = client.request(
        {
          hostname: u.hostname,
          port: u.port ? Number(u.port) : (u.protocol === 'https:' ? 443 : 80),
          path: u.pathname + (u.search || ""),
          method,
          headers: {
            'Content-Type': 'application/json',
            ...(data ? { "Content-Length": data.length } : {})
          }
        },
        (res) => {
          let raw = "";
          res.on("data", (c) => (raw += c));
          res.on("end", () => {
            try {
              const parsed = raw ? JSON.parse(raw) : {};
              resolve({ status: res.statusCode, data: parsed });
            } catch (_) {
              resolve({ status: res.statusCode, data: { raw } });
            }
          });
        }
      );
      req.on("error", reject);
      req.setTimeout(timeoutMs, () => { try { req.destroy(); } catch (_) {} reject(new Error("timeout")); });
      if (data) req.write(data);
      req.end();
    } catch (e) {
      reject(e);
    }
  });
}

async function memoryUpsert(items) {
  try {
    const cfg = getMemoryCfg();
    if (!cfg.enabled || !cfg.autoIngest) return;
    const url = DJANGO_API_URL + '/api/memory/upsert/';
    await httpJson("POST", url, { items }, 2500);
  } catch (e) {
    try { log.warn("[memory] upsert failed", { message: e && e.message ? e.message : String(e) }); } catch (_) {}
  }
}

async function memorySearch(query, topK) {
  try {
    const cfg = getMemoryCfg();
    if (!cfg.enabled || !cfg.ragEnabled) return [];
    const url = DJANGO_API_URL + '/api/memory/search/';
    const res = await httpJson("POST", url, { query, top_k: topK || cfg.topK }, 2500);
    const results = res && res.data ? res.data.results : null;
    return Array.isArray(results) ? results : [];
  } catch (e) {
    try { log.warn("[memory] search failed", { message: e && e.message ? e.message : String(e) }); } catch (_) {}
    return [];
  }
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
  // Smoke test: exit automatically to verify renderer load (prevents hangs in CI/local).
  if (SMOKE_TEST) {
    const timer = setTimeout(() => {
      try { log.error('[smoke] timeout waiting for did-finish-load'); } catch (_) {}
      try { app.exit(10); } catch (_) { process.exit(10); }
    }, 15000);

    mainWindow.webContents.once('did-finish-load', () => {
      try { clearTimeout(timer); } catch (_) {}
      try { log.info('[smoke] did-finish-load OK'); } catch (_) {}
      try { app.exit(0); } catch (_) { process.exit(0); }
    });

    mainWindow.webContents.once('did-fail-load', () => {
      try { clearTimeout(timer); } catch (_) {}
      try { app.exit(2); } catch (_) { process.exit(2); }
    });
  }

  mainWindow.once('ready-to-show', () => {
    if (!SMOKE_TEST) mainWindow.show();
    loadSettings();
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
    // 메인 창 닫히면 채팅 창들도 닫음
    for (const w of chatWindows) {
      try { w.close(); } catch (_) { }
    }
    chatWindows = [];
    mainWindow = null;
    if (ptyProcess) ptyProcess.kill();
    stopLLMHealthMonitor();
    stopAutoUpdater();
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
        // Any 2xx is "connected"
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
        path: '/v1/models', // vLLM 포트 생존 확인
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
      message: 'OpenAI API key missing (set OPENAI_API_KEY or LUNA_OPENAI_API_KEY)'
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
              ? 'OpenAI auth failed (check API key)'
              : `OpenAI not reachable (status ${res.statusCode})`
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
      message: connected ? `${displayName} Connected` : `${displayName} Not Reachable (localhost:${port})`
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
    autoUpdater.allowDowngrade = true; // 동일 버전이나 하위 버전으로의 "업데이트" 허용
    autoUpdater.allowPrerelease = true; // 프리릴리즈 버전 허용

    autoUpdater.on('checking-for-update', () => {
      lastUpdateCheckedAt = new Date().toISOString();
      sendUpdateStatus({ state: 'checking', message: 'Checking for updates...' });
    });
    autoUpdater.on('update-available', (info) => sendUpdateStatus({ state: 'available', info, availableVersion: info?.version, message: 'New update found!' }));
    autoUpdater.on('update-not-available', (info) => sendUpdateStatus({ state: 'none', info, message: 'Up to date' }));
    autoUpdater.on('download-progress', (progress) => sendUpdateStatus({ state: 'downloading', progress }));
    autoUpdater.on('error', (err) => {
      const msg = err?.message?.includes('404') ? 'Update check failed (404). If you just pushed a tag, wait 5-10 mins for GitHub to finish processing the release assets.' : (err?.message || String(err));
      sendUpdateStatus({ state: 'error', message: msg });
    });

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
  const sessionId = `chat_${Date.now()}_${Math.random().toString(16).slice(2)}`;
  const win = new BrowserWindow({
    width: 450,
    height: 800,
    title: 'New chat',
    icon: path.join(__dirname, '../assets/Luna.jpg'),
    autoHideMenuBar: true, // 메뉴 바 숨김
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      nodeIntegration: false,
      contextIsolation: true
    }
  });

  win.setMenuBarVisibility(false); // 메뉴 바 완전히 제거

  win.loadFile(path.join(__dirname, 'chat.html'), { query: { session: sessionId } });

  chatWindows.push(win);
  win.on('closed', () => {
    chatWindows = chatWindows.filter(w => w !== win);
  });

  // If we already know the LLM status, push it into the new chat window immediately
  if (lastLLMConnected !== null) {
    const displayName = activeModel === 'luna-soul' ? 'Luna Soul' : activeModel;
    sendLLMConnectionStatus({
      provider: displayName,
      connected: lastLLMConnected,
      message: lastLLMConnected ? `${displayName} Connected` : `${displayName} Not Reachable (localhost:11434)`
    });
  }
}

ipcMain.on('popout-chat', () => {
  createChatWindow();
});

// --- 자율 학습 (Deep Learning) 엔진 ---
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

  console.log("🧠 [LUNA DEEP LEARNING] 자율 학습 펄스 시작...");

  const topics = ["TypeScript의 고급 타입 시스템", "Electron 보안 베스트 프렉티스", "Rust 언어의 메모리 안전성", "AI 에이전트의 자율적 사고 모델", "현대적 CSS 애니메이션 기법"];
  const randomTopic = topics[Math.floor(Math.random() * topics.length)];

  const taskId = `dl_${Date.now()}`;
  const instruction = `자율 학습 모드: "${randomTopic}"에 대해 웹 검색을 수행하고, 핵심 요약을 [KNOWLEDGE] 카테고리로 deep_learn 도구를 사용하여 학습하세요.`;
  try {
    const ts = new Date().toISOString();
    memoryUpsert([{
      id: `dl_${taskId}_prompt`,
      text: String(instruction || ''),
      metadata: { kind: 'deep_learning', taskId, ts }
    }]);
  } catch (_) {}

  if (!llmSettings) loadSettings();

  const request = {
    type: 'edit_request', // 에디터 모드로 호출 (Plan 생성 유도)
  instruction: augmentedInstruction,
    context: {
      taskId,
      llmSettings,
      model: 'luna-soul',
      projectRoot: globalEditorState.projectRoot
    }
  };

  // Memory ingest: store user instruction
  try {
    const ts = new Date().toISOString();
    memoryUpsert([{
      id: `chat_${taskId || Date.now()}_user`,
      text: String(instruction || ""),
      metadata: { kind: "user", taskId: taskId || null, ts }
    }]);
  } catch (_) {}
  agentRuntime.processRequest(request, (response) => {
    if (response && response.type === 'done' && response.data && response.data.message) {
      try {
        const ts = new Date().toISOString();
        memoryUpsert([{
          id: `dl_${taskId}_result`,
          text: String(response.data.message),
          metadata: { kind: 'deep_learning', taskId, ts, success: !!response.data.success }
        }]);
      } catch (_) {}
    }

    // Memory ingest: store assistant final output
    if (response && response.type === 'done' && response.data && response.data.message) {
      try {
        const ts = new Date().toISOString();
        memoryUpsert([{
          id: `chat_${taskId || Date.now()}_assistant`,
          text: String(response.data.message),
          metadata: { kind: 'assistant', taskId: taskId || null, ts, success: !!response.data.success }
        }]);
      } catch (_) {}
    }

    // 모든 창에 진행 상황 전송 (UI Visualize)
    broadcastAgentResponse({
      ...response,
      data: { ...(response.data || {}), taskId }
    });

    if (response.type === 'action') {
      console.log(`🧠 [DL ACTION] ${response.data?.tool}: ${response.data?.input}`);
    }
    if (response.type === 'done') {
      console.log("🧠 [LUNA DEEP LEARNING] 학습 사이클 완료.");
      if (isDeepLearningActive) {
        deepLearningTimer = setTimeout(runDeepLearningPulse, 5 * 60 * 1000);
      }
    }
  });
}

ipcMain.on('start_deep_learning', () => {
  if (isDeepLearningActive) return;
  isDeepLearningActive = true;
  console.log("🚀 [LUNA] 자율 학습 모드 활성화!");
  runDeepLearningPulse();
  broadcastDeepLearningStatus();
});

ipcMain.on('stop_deep_learning', () => {
  isDeepLearningActive = false;
  if (deepLearningTimer) clearTimeout(deepLearningTimer);
  console.log("🛑 [LUNA] 자율 학습 모드 중단.");
  broadcastDeepLearningStatus();
});

ipcMain.on('get_deep_learning_status', () => {
  broadcastDeepLearningStatus();
});

ipcMain.on('new-chat-window', () => {
  createChatWindow();
});

// --- Extensions & Marketplace ---
const MARKET_REGISTRY_URL = 'https://raw.githubusercontent.com/srunaic/Luna-AI-Agent/main/market.json'; // 임시로 본체 저장소 사용

ipcMain.handle('fetch-marketplace', async () => {
  return new Promise((resolve) => {
    https.get(MARKET_REGISTRY_URL, (res) => {
      let data = '';
      res.on('data', (chunk) => data += chunk);
      res.on('end', () => {
        try {
          resolve(JSON.parse(data));
        } catch (e) {
          // 파일이 없으면 샘플 데이터 반환
          resolve([
            {
              id: 'luna-sample-plugin',
              name: 'Sample Plugin',
              version: '1.0.1',
              description: 'GitHub API 기반 서버리스 플러그인 예시입니다.',
              author: 'Luna Dev',
              downloadUrl: 'https://github.com/srunaic/Luna-AI-Agent/archive/refs/heads/main.zip'
            }
          ]);
        }
      });
    }).on('error', () => resolve([]));
  });
});

ipcMain.handle('install-extension', async (event, { url, id }) => {
  try {
    log.info(`Installing extension: ${id} from ${url}`);
    const targetPath = path.join(EXTENSIONS_PATH, id);
    const zipPath = path.join(app.getPath('temp'), `${id}.zip`);

    if (!fs.existsSync(targetPath)) {
      fs.mkdirSync(targetPath, { recursive: true });
    }

    // 1. Download ZIP
    await new Promise((resolve, reject) => {
      const file = fs.createWriteStream(zipPath);
      https.get(url, (res) => {
        if (res.statusCode === 302 || res.statusCode === 301) { // 리다이렉트 대응
          https.get(res.headers.location, (res2) => {
            res2.pipe(file);
            file.on('finish', () => { file.close(); resolve(); });
          });
        } else {
          res.pipe(file);
          file.on('finish', () => { file.close(); resolve(); });
        }
      }).on('error', reject);
    });

    // 2. Unzip using PowerShell (Serverless - No extra npm deps)
    const unzipCmd = `Expand-Archive -Path "${zipPath}" -DestinationPath "${targetPath}" -Force`;
    execSync(`powershell -Command "${unzipCmd}"`);

    // 3. 만약 압축을 풀었는데 안에 폴더가 하나 더 있다면 (GitHub ZIP 특성)
    const content = fs.readdirSync(targetPath);
    if (content.length === 1 && fs.lstatSync(path.join(targetPath, content[0])).isDirectory()) {
      const subDir = path.join(targetPath, content[0]);
      const files = fs.readdirSync(subDir);
      files.forEach(f => {
        fs.renameSync(path.join(subDir, f), path.join(targetPath, f));
      });
      fs.rmdirSync(subDir);
    }

    // 4. Ensure manifest.json exists
    const manifestPath = path.join(targetPath, 'manifest.json');
    if (!fs.existsSync(manifestPath)) {
      const dummyManifest = { id, name: id, version: "1.0.0", entry: "index.js" };
      fs.writeFileSync(manifestPath, JSON.stringify(dummyManifest, null, 2));
    }

    return { success: true };
  } catch (e) {
    log.error(`Installation failed`, e);
    return { success: false, error: e.message };
  }
});

// Model selection from UI -> switch health check target
ipcMain.on('set-model', async (_event, payload) => {
  const next = payload?.model;
  if (!next || typeof next !== 'string') return;
  activeModel = next;
  // Force refresh
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
    model: String(merged.ollama?.model || 'llama3'),
    numPredict: Number(merged.ollama?.numPredict || 256),
    temperature: Number(merged.ollama?.temperature ?? 0.2)
  };
  merged.openai = {
    baseUrl: String(merged.openai?.baseUrl || 'https://api.openai.com'),
    apiKey: String(merged.openai?.apiKey || '')
  };

  llmSettings = merged;
  saveSettings(llmSettings);

  // Refresh connection status immediately
  lastLLMConnected = null;
  const status = await checkLLMOnce();
  lastLLMConnected = !!status.connected;
  sendLLMConnectionStatus(status);

  return llmSettings;
});

// Windows Firewall: allow Ollama port (11434) through firewall
ipcMain.handle('firewall-allow-ollama', async () => {
  try {
    if (process.platform !== 'win32') {
      return { success: false, message: 'Firewall helper is only supported on Windows.' };
    }

    // Requires admin; app already enforces admin on startup, but keep safe.
    // Add inbound + outbound allow rules for TCP 11434.
    const inName = 'Luna - Allow Ollama 11434 (TCP In)';
    const outName = 'Luna - Allow Ollama 11434 (TCP Out)';

    try {
      execSync(`netsh advfirewall firewall add rule name="${inName}" dir=in action=allow protocol=TCP localport=11434`, { stdio: 'ignore' });
    } catch (_) { }
    try {
      execSync(`netsh advfirewall firewall add rule name="${outName}" dir=out action=allow protocol=TCP localport=11434`, { stdio: 'ignore' });
    } catch (_) { }

    return { success: true, message: 'Added Windows Firewall allow rules for TCP port 11434.' };
  } catch (e) {
    return { success: false, message: `Failed to add firewall rules: ${e?.message || String(e)}` };
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
      return { success: false, message: 'Auto-update is disabled (dev/unpacked build).' };
    }
    lastUpdateCheckedAt = new Date().toISOString();
    sendUpdateStatus({ state: 'checking' });
    // Use checkForUpdates so we can return a deterministic result message
    const result = await autoUpdater.checkForUpdates();
    const info = result?.updateInfo;
    if (info?.version) {
      // update-available / update-not-available events will still fire
      return { success: true, message: `Checked. Latest: v${info.version}` };
    }
    return { success: true, message: 'Checked for updates.' };
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

app.whenReady().then(() => {
  createWindow();
  try { startDjangoServer(); } catch (e) { try { log.error('[django] start on ready failed', e); } catch (_) {} }
});

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
  const taskId = context?.taskId;
  if (!llmSettings) loadSettings();
  let augmentedInstruction = instruction;
  try {
    const cfg = getMemoryCfg();
    if (cfg.enabled && cfg.ragEnabled) {
      const q = String(instruction || '');
      const memories = await memorySearch(q, cfg.topK);
      if (Array.isArray(memories) && memories.length) {
        const lines = memories.map((m, i) => {
          const t = (m && (m.text || m.document || m.content)) ? String(m.text || m.document || m.content) : '';
          return `(${i + 1}) ${t}`;
        }).filter(Boolean);
        if (lines.length) {
          augmentedInstruction = q + "\n\n[MEMORY]\n" + lines.join("\n");
        }
      }
    }
  } catch (_) {}

  const request = {
    type: 'edit_request',
    instruction,
    context: {
      ...(context || {}),
      llmSettings
    }
  };

  agentRuntime.processRequest(request, (response) => {
    // [DEBUG] 루나의 행동을 메인 콘솔에 대대적으로 출력
    if (response.type === 'action') {
      console.log("\n" + "=".repeat(50));
      console.log("🔥🔥🔥 [LUNA ACTION] 도구 실행 감지");
      console.log("🛠️  [TOOL]:", response.data?.tool);
      console.log("📥  [INPUT]:", response.data?.input);
      console.log("📤  [RESULT]:", response.data?.result?.substring(0, 500) + (response.data?.result?.length > 500 ? "..." : ""));
      console.log("=".repeat(50) + "\n");
    }

    // Ensure taskId is present on all responses for reliable correlation in UI
    const enriched = {
      ...response,
      data: { ...(response.data || {}), taskId }
    };
    // Send back to the window that initiated the request
    try {
      event.sender.send('agent-response', enriched);
    } catch (_) {
      // Fallback to main window
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

// 클립보드 관련 IPC 핸들러
ipcMain.on('clipboard-write', (event, text) => {
  clipboard.writeText(text);
});

ipcMain.handle('clipboard-read', () => {
  return clipboard.readText();
});



function broadcastDjangoStatus(payload) {
  if (mainWindow) mainWindow.webContents.send('django-status', payload);
  for (const w of chatWindows) {
    try { w.webContents.send('django-status', payload); } catch (_) { }
  }
}

function broadcastDjangoReady(payload) {
  if (mainWindow) mainWindow.webContents.send('django-ready', payload);
  for (const w of chatWindows) {
    try { w.webContents.send('django-ready', payload); } catch (_) { }
  }
}

function checkHttpOk(url, timeoutMs = 700) {
  return new Promise((resolve) => {
    try {
      const u = new URL(url);
      const client = u.protocol === 'https:' ? https : http;
      const req = client.request(
        {
          hostname: u.hostname,
          port: u.port ? Number(u.port) : (u.protocol === 'https:' ? 443 : 80),
          path: u.pathname + (u.search || ''),
          method: 'GET'
        },
        (res) => {
          const ok = res.statusCode >= 200 && res.statusCode < 500;
          res.resume();
          resolve(ok);
        }
      );
      req.on('error', () => resolve(false));
      req.setTimeout(timeoutMs, () => { try { req.destroy(); } catch (_) {} resolve(false); });
      req.end();
    } catch (_) {
      resolve(false);
    }
  });
}

async function waitForDjangoReady(timeoutMs = 15000) {
  const start = Date.now();
  const probe = `${DJANGO_API_URL}/admin/`;
  while (Date.now() - start < timeoutMs) {
    const ok = await checkHttpOk(probe, 900);
    if (ok) return true;
    await new Promise(r => setTimeout(r, 450));
  }
  return false;
}

function resolvePythonCommand() {
  const forced = String(process.env.LUNA_PYTHON_PATH || '').trim();
  if (forced) return { cmd: forced, prefix: [] };
  if (process.platform === 'win32') {
    return { cmd: 'python', prefix: [], fallback: { cmd: 'py', prefix: ['-3'] } };
  }
  return { cmd: 'python3', prefix: [], fallback: { cmd: 'python', prefix: [] } };
}

function startDjangoServer() {
  try {
    if (djangoProcess || djangoStarting) return;

    const serverPath = app.isPackaged
      ? path.join(process.resourcesPath, 'luna-server')
      : path.join(__dirname, '../luna-server');

    if (!fs.existsSync(serverPath)) {
      log.warn('[django] serverPath missing; not starting', { serverPath });
      broadcastDjangoStatus({ state: 'missing', serverPath });
      return;
    }

    djangoStarting = true;
    broadcastDjangoStatus({ state: 'starting', serverPath, url: DJANGO_API_URL });

    (async () => {
      const alreadyUp = await checkHttpOk(`${DJANGO_API_URL}/admin/`, 600);
      if (alreadyUp) {
        djangoStarting = false;
        broadcastDjangoStatus({ state: 'ready', url: DJANGO_API_URL, note: 'already running' });
        broadcastDjangoReady({ url: DJANGO_API_URL });
        return;
      }

      const py = resolvePythonCommand();
      const baseArgs = ['manage.py', 'runserver', '127.0.0.1:8000', '--noreload'];

      const spawnOne = (cmd, prefix) => {
        const args = [...(prefix || []), ...baseArgs];
        log.info('[django] spawn', { cmd, args, cwd: serverPath });
        const p = spawn(cmd, args, { cwd: serverPath, shell: true, detached: false });
        p.stdout?.on('data', (d) => log.info('[django]', String(d).trim()));
        p.stderr?.on('data', (d) => log.error('[django]', String(d).trim()));
        p.on('exit', (code) => log.warn('[django] exited', { code }));
        p.on('error', (e) => log.error('[django] spawn error', e));
        return p;
      };

      djangoProcess = spawnOne(py.cmd, py.prefix);

      let ok = await waitForDjangoReady(15000);
      if (!ok && py.fallback) {
        try { stopDjangoServer(); } catch (_) { }
        djangoStarting = true;
        djangoProcess = spawnOne(py.fallback.cmd, py.fallback.prefix);
        ok = await waitForDjangoReady(15000);
      }

      djangoStarting = false;
      if (ok) {
        broadcastDjangoStatus({ state: 'ready', url: DJANGO_API_URL });
        broadcastDjangoReady({ url: DJANGO_API_URL });
      } else {
        broadcastDjangoStatus({ state: 'failed', url: DJANGO_API_URL });
      }
    })().catch((e) => {
      djangoStarting = false;
      log.error('[django] start flow failed', e);
      try { broadcastDjangoStatus({ state: 'error', message: e?.message || String(e) }); } catch (_) {}
    });
  } catch (e) {
    djangoStarting = false;
    log.error('[django] start failed', e);
    try { broadcastDjangoStatus({ state: 'error', message: e?.message || String(e) }); } catch (_) {}
  }
}

function stopDjangoServer() {
  if (djangoProcess) {
    if (process.platform === 'win32') {
      try { execSync(`taskkill /pid ${djangoProcess.pid} /f /t`); } catch (_) { }
    } else {
      try { djangoProcess.kill(); } catch (_) { }
    }
    djangoProcess = null;
  }
  djangoStarting = false;
}

