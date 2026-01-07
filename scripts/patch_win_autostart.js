const fs = require("fs");

const targetPath = "electron/main.js";
let c = fs.readFileSync(targetPath, "utf8");

function replaceOnce(needle, replacement, label) {
  const idx = c.indexOf(needle);
  if (idx === -1) throw new Error(`Missing needle for ${label}`);
  c = c.slice(0, idx) + replacement + c.slice(idx + needle.length);
}

function ensureInserted(afterNeedle, insertText, label) {
  if (c.includes(insertText.trim())) return;
  const idx = c.indexOf(afterNeedle);
  if (idx === -1) throw new Error(`Missing anchor for ${label}`);
  const insertAt = idx + afterNeedle.length;
  c = c.slice(0, insertAt) + "\n\n" + insertText + c.slice(insertAt);
}

// 1) Autostart flag
const bootNeedle =
  "log.info('[boot] starting', { version: app.getVersion(), isPackaged: app.isPackaged, platform: process.platform });";
ensureInserted(
  bootNeedle,
  `// Autostart mode: launched at OS login to keep Django server running in background.
const AUTOSTART_LAUNCH = process.argv.includes('--autostart') || process.env.LUNA_AUTOSTART === '1';\n`,
  "AUTOSTART_LAUNCH"
);

// 2) Windows openAtLogin (auto-run at login)
const helperNeedle = "function isAdmin() {";
ensureInserted(
  helperNeedle,
  `function configureWindowsAutoStart() {
  try {
    if (process.platform !== 'win32') return;
    app.setLoginItemSettings({
      openAtLogin: true,
      path: process.execPath,
      args: ['--autostart']
    });
    try { log.info('[startup] openAtLogin enabled'); } catch (_) {}
  } catch (e) {
    try { log.warn('[startup] failed to enable openAtLogin', { message: e?.message || String(e) }); } catch (_) {}
  }
}
`,
  "configureWindowsAutoStart"
);

// 3) Hide window when started by autostart
c = c.replace(
  "if (!SMOKE_TEST) mainWindow.show();",
  "if (!SMOKE_TEST && !AUTOSTART_LAUNCH) mainWindow.show();"
);

// 4) Replace simple whenReady block with single-instance + headless autostart.
const whenReadyRe = /app\.whenReady\(\)\.then\(\(\) => \{[\s\S]*?\}\);/m;
if (!whenReadyRe.test(c)) throw new Error("Could not find app.whenReady() block");
c = c.replace(
  whenReadyRe,
  `// Prevent duplicate instances (important when auto-starting on Windows).
const gotSingleInstanceLock = app.requestSingleInstanceLock();
if (!gotSingleInstanceLock) {
  try { log.warn('[boot] second instance detected; quitting'); } catch (_) {}
  app.quit();
} else {
  app.on('second-instance', () => {
    try {
      if (!mainWindow) {
        createWindow();
      } else {
        if (mainWindow.isMinimized()) mainWindow.restore();
        mainWindow.show();
        mainWindow.focus();
      }
    } catch (_) {}
  });

  app.whenReady().then(() => {
    configureWindowsAutoStart();
    if (!AUTOSTART_LAUNCH) {
      createWindow();
    } else {
      try { log.info('[startup] autostart launch: headless mode'); } catch (_) {}
    }
    startDjangoServer();
  });
}
`
);

// 5) Ensure server stops on quit
const beforeQuitNeedle = "app.on('window-all-closed', () => {";
ensureInserted(
  beforeQuitNeedle,
  `app.on('before-quit', () => {
  try { stopDjangoServer(); } catch (_) {}
});
`,
  "before-quit"
);

fs.writeFileSync(targetPath, c, "utf8");
console.log(`[patch] Updated ${targetPath}`);













