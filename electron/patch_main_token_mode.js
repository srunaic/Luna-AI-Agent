const fs = require("fs");
const path = require("path");

function patch() {
  const p = path.join(__dirname, "main.js");
  let s = fs.readFileSync(p, "utf8");
  s = s.replace(/\r\n/g, "\n");
  const before = s;

  // Insert token helpers by rewriting the httpJson function header
  if (!s.includes("function getClientToken()")) {
    const helpers =
      "\nfunction getClientToken() {\n" +
      "  return String(process.env.LUNA_CLIENT_TOKEN || \"\").trim();\n" +
      "}\n\n" +
      "function getClientAuthHeaders() {\n" +
      "  const t = getClientToken();\n" +
      "  return t ? { \"X-Luna-Client-Token\": t } : {};\n" +
      "}\n\n";

    s = s.replace(
      "function httpJson(method, url, body, timeoutMs = 2500) {",
      helpers + "function httpJson(method, url, body, timeoutMs = 2500, extraHeaders = null) {"
    );
  }

  // Merge extraHeaders into headers
  if (!s.includes("...(extraHeaders || {})")) {
    s = s.replace(
      "            ...(data ? { \"Content-Length\": data.length } : {})",
      "            ...(data ? { \"Content-Length\": data.length } : {}),\n            ...(extraHeaders || {})"
    );
  }

  // Gate memory upsert/search without token and attach header
  s = s.replace(
    "if (!cfg.enabled || !cfg.autoIngest) return;",
    "if (!cfg.enabled || !cfg.autoIngest) return;\n    if (!getClientToken()) return;"
  );
  s = s.replace(
    "if (!cfg.enabled || !cfg.ragEnabled) return [];",
    "if (!cfg.enabled || !cfg.ragEnabled) return [];\n    if (!getClientToken()) return [];"
  );
  s = s.replace(
    "await httpJson(\"POST\", url, { items }, 2500);",
    "await httpJson(\"POST\", url, { items }, 2500, getClientAuthHeaders());"
  );
  s = s.replace(
    "const res = await httpJson(\"POST\", url, { query, top_k: topK || cfg.topK }, 2500);",
    "const res = await httpJson(\"POST\", url, { query, top_k: topK || cfg.topK }, 2500, getClientAuthHeaders());"
  );

  // Allow launching without admin elevation (demo must run asInvoker)
  s = s.replace(
    /\n\s*if \(!isAdmin\(\)\) \{[\s\S]*?\n\s*return;\n\s*\}\n/,
    "\n  // NOTE: Do not hard-require Windows Administrator to launch.\n" +
      "  // Full features are enforced by server-side tokens (LUNA_CLIENT_TOKEN / LUNA_ADMIN_TOKEN).\n"
  );

  // Disable devtools in packaged demo when token missing
  if (!s.includes("devTools:")) {
    s = s.replace(
      "webPreferences: {\n      nodeIntegration: false,",
      "webPreferences: {\n      devTools: !!getClientToken() || !app.isPackaged,\n      nodeIntegration: false,"
    );
  }

  // Block deep learning start without token
  if (!s.includes("blocked (no client token)")) {
    s = s.replace(
      "ipcMain.on(\"start_deep_learning\", () => {",
      "ipcMain.on(\"start_deep_learning\", () => {\n" +
        "  if (!getClientToken()) {\n" +
        "    try { log.warn(\"[deep-learning] blocked (no client token)\"); } catch (_) {}\n" +
        "    return;\n" +
        "  }"
    );
  }

  // Harden Django spawn env defaults (explicit)
  if (!s.includes("LUNA_CLIENT_ALLOW_LOCALHOST")) {
    s = s.replace(
      "const p = spawn(cmd, args, { cwd: serverPath, shell: true, detached: false });",
      "const p = spawn(cmd, args, { cwd: serverPath, shell: true, detached: false, env: {\n" +
        "          ...process.env,\n" +
        "          LUNA_DJANGO_DEBUG: String(process.env.LUNA_DJANGO_DEBUG || (app.isPackaged ? \"0\" : \"1\")),\n" +
        "          LUNA_ADMIN_ALLOW_LOCALHOST: String(process.env.LUNA_ADMIN_ALLOW_LOCALHOST || \"0\"),\n" +
        "          LUNA_CLIENT_ALLOW_LOCALHOST: String(process.env.LUNA_CLIENT_ALLOW_LOCALHOST || \"0\")\n" +
        "        } });"
    );
  }

  if (s !== before) {
    fs.writeFileSync(p, s, "utf8");
    return true;
  }
  return false;
}

const changed = patch();
process.stdout.write(changed ? "patched electron/main.js\n" : "no changes needed\n");















