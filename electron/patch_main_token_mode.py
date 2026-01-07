from __future__ import annotations

import re
from pathlib import Path


def patch_main() -> bool:
    p = Path(__file__).resolve().parent / "main.js"
    s = p.read_text(encoding="utf-8", errors="replace").replace("\r\n", "\n")
    before = s

    # Insert token helpers after DJANGO_API_URL
    if "function getClientToken()" not in s:
        m = re.search(r"^const DJANGO_API_URL = process\.env\.LUNA_SERVER_URL \|\| [^;]+;\n", s, flags=re.M)
        if not m:
            raise RuntimeError("DJANGO_API_URL line not found")
        line = m.group(0)
        insert = (
            "\n"
            "function getClientToken() {\n"
            "  return String(process.env.LUNA_CLIENT_TOKEN || \"\").trim();\n"
            "}\n\n"
            "function getClientAuthHeaders() {\n"
            "  const t = getClientToken();\n"
            "  return t ? { \"X-Luna-Client-Token\": t } : {};\n"
            "}\n"
        )
        s = s.replace(line, line + insert)

    # httpJson: accept extraHeaders and merge
    s = s.replace(
        "function httpJson(method, url, body, timeoutMs = 2500) {",
        "function httpJson(method, url, body, timeoutMs = 2500, extraHeaders = null) {",
    )

    if "...(extraHeaders || {})" not in s:
        s = s.replace(
            '...(data ? { "Content-Length": data.length } : {})\n          }',
            '...(data ? { "Content-Length": data.length } : {}),\n            ...(extraHeaders || {})\n          }',
        )

    # Token-gate memory calls + add client token header
    s = s.replace(
        "if (!cfg.enabled || !cfg.autoIngest) return;",
        "if (!cfg.enabled || !cfg.autoIngest) return;\n    if (!getClientToken()) return;",
    )
    s = s.replace(
        "if (!cfg.enabled || !cfg.ragEnabled) return [];",
        "if (!cfg.enabled || !cfg.ragEnabled) return [];\n    if (!getClientToken()) return [];",
    )
    s = s.replace(
        'await httpJson("POST", url, { items }, 2500);',
        'await httpJson("POST", url, { items }, 2500, getClientAuthHeaders());',
    )
    s = s.replace(
        'const res = await httpJson("POST", url, { query, top_k: topK || cfg.topK }, 2500);',
        'const res = await httpJson("POST", url, { query, top_k: topK || cfg.topK }, 2500, getClientAuthHeaders());',
    )

    # Allow launching without admin elevation (demo must run asInvoker)
    s = re.sub(
        r"\n\s*if \(!isAdmin\(\)\) \{[\s\S]*?\n\s*return;\n\s*\}\n",
        "\n  // NOTE: Do not hard-require Windows Administrator to launch.\n"
        "  // Full features are enforced by server-side tokens (LUNA_CLIENT_TOKEN / LUNA_ADMIN_TOKEN).\n",
        s,
        count=1,
    )

    # Disable devtools in packaged demo when token missing
    if "devTools:" not in s:
        s = s.replace(
            "webPreferences: {\n      nodeIntegration: false,",
            "webPreferences: {\n      devTools: !!getClientToken() || !app.isPackaged,\n      nodeIntegration: false,",
        )

    # Block deep learning start without token
    if "[deep-learning] blocked (no client token)" not in s:
        s = s.replace(
            'ipcMain.on("start_deep_learning", () => {',
            'ipcMain.on("start_deep_learning", () => {\n'
            "  if (!getClientToken()) {\n"
            '    try { log.warn("[deep-learning] blocked (no client token)"); } catch (_) {}\n'
            "    return;\n"
            "  }",
        )

    # Harden Django spawn env defaults (explicit)
    if "LUNA_CLIENT_ALLOW_LOCALHOST" not in s:
        s = s.replace(
            "const p = spawn(cmd, args, { cwd: serverPath, shell: true, detached: false });",
            "const p = spawn(cmd, args, { cwd: serverPath, shell: true, detached: false, env: { ...process.env, "
            'LUNA_DJANGO_DEBUG: String(process.env.LUNA_DJANGO_DEBUG || (app.isPackaged ? "0" : "1")), '
            'LUNA_ADMIN_ALLOW_LOCALHOST: String(process.env.LUNA_ADMIN_ALLOW_LOCALHOST || "0"), '
            'LUNA_CLIENT_ALLOW_LOCALHOST: String(process.env.LUNA_CLIENT_ALLOW_LOCALHOST || "0") } });',
        )

    if s != before:
        p.write_text(s, encoding="utf-8", newline="\n")
        return True
    return False


if __name__ == "__main__":
    changed = patch_main()
    print("patched electron/main.js" if changed else "no changes needed")










