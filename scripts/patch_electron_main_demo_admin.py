from __future__ import annotations

from pathlib import Path


def main() -> None:
    p = Path("electron/main.js")
    b = p.read_bytes()

    # Normalize newlines for stable patching
    b = b.replace(b"\r\n", b"\n")

    needle = b"const DJANGO_API_URL = process.env.LUNA_SERVER_URL || 'http://127.0.0.1:8000';\n"
    if needle not in b:
        raise SystemExit("needle not found: DJANGO_API_URL line")

    insert = (
        b"\nfunction getBuildFlavor() {\n"
        b"  // demo: public release flavor (restricted)\n"
        b"  // dev: local development\n"
        b"  // admin: explicitly enabled (still token-protected server-side)\n"
        b"  return String(process.env.LUNA_BUILD_FLAVOR || (app.isPackaged ? 'demo' : 'dev')).toLowerCase();\n"
        b"}\n\n"
        b"function isDemoBuild() {\n"
        b"  return getBuildFlavor() === 'demo';\n"
        b"}\n\n"
        b"function getClientToken() {\n"
        b"  return String(process.env.LUNA_CLIENT_TOKEN || '').trim();\n"
        b"}\n\n"
        b"function getClientAuthHeaders() {\n"
        b"  const t = getClientToken();\n"
        b"  return t ? { 'X-Luna-Client-Token': t } : {};\n"
        b"}\n"
    )

    changed = False
    if b"function getBuildFlavor()" not in b:
        b2 = b.replace(needle, needle + insert)
        if b2 != b:
            b = b2
            changed = True
        else:
            raise SystemExit("DJANGO_API_URL insertion replace produced no change")

    # Remove hard Windows admin requirement during launch (keep elevation for specific ops only)
    admin_if = b"  if (!isAdmin()) {\n"
    if admin_if in b:
        start = b.find(admin_if)
        end = b.find(b"\n  }\n\n", start)
        if end == -1:
            raise SystemExit("admin block end not found")
        end += len(b"\n  }\n\n")
        replacement = (
            b"  // NOTE: Do not hard-require Windows Administrator to launch.\n"
            b"  // Demo builds run as normal user. Admin-only features are gated by tokens.\n\n"
        )
        b = b[:start] + replacement + b[end:]
        changed = True

    # Extend httpJson signature and merge extra headers
    sig_old = b"function httpJson(method, url, body, timeoutMs = 2500) {"
    sig_new = b"function httpJson(method, url, body, timeoutMs = 2500, extraHeaders = null) {"
    if sig_old in b and sig_new not in b:
        b = b.replace(sig_old, sig_new)
        changed = True

    hdr_old = (
        b"'Content-Type': 'application/json',\n"
        b"            ...(data ? { \"Content-Length\": data.length } : {})"
    )
    hdr_new = (
        b"'Content-Type': 'application/json',\n"
        b"            ...(data ? { \"Content-Length\": data.length } : {}),\n"
        b"            ...(extraHeaders || {})"
    )
    if hdr_old in b and hdr_new not in b:
        b = b.replace(hdr_old, hdr_new)
        changed = True

    # Gate memory endpoints in demo build unless client token is present (server also enforces)
    b = b.replace(
        b"    if (!cfg.enabled || !cfg.autoIngest) return;\n",
        b"    if (!cfg.enabled || !cfg.autoIngest) return;\n    if (isDemoBuild() && !getClientToken()) return;\n",
    )
    b = b.replace(
        b'    await httpJson("POST", url, { items }, 2500);',
        b'    await httpJson("POST", url, { items }, 2500, getClientAuthHeaders());',
    )
    if b != p.read_bytes().replace(b\"\\r\\n\", b\"\\n\"):
        changed = True

    b = b.replace(
        b"    if (!cfg.enabled || !cfg.ragEnabled) return [];\n",
        b"    if (!cfg.enabled || !cfg.ragEnabled) return [];\n    if (isDemoBuild() && !getClientToken()) return [];\n",
    )
    b = b.replace(
        b'    const res = await httpJson("POST", url, { query, top_k: topK || cfg.topK }, 2500);',
        b'    const res = await httpJson("POST", url, { query, top_k: topK || cfg.topK }, 2500, getClientAuthHeaders());',
    )

    # Ensure Django spawn passes env hardening defaults (token auth is enforced server-side)
    spawn_old = b"const p = spawn(cmd, args, { cwd: serverPath, shell: true, detached: false });"
    spawn_new = (
        b"const p = spawn(cmd, args, {\n"
        b"          cwd: serverPath,\n"
        b"          shell: true,\n"
        b"          detached: false,\n"
        b"          env: {\n"
        b"            ...process.env,\n"
        b"            // Default-hardening for packaged/demo builds\n"
        b"            LUNA_DJANGO_DEBUG: String(process.env.LUNA_DJANGO_DEBUG || (app.isPackaged ? '0' : '1')),\n"
        b"            LUNA_ADMIN_ALLOW_LOCALHOST: String(process.env.LUNA_ADMIN_ALLOW_LOCALHOST || '0'),\n"
        b"            LUNA_CLIENT_ALLOW_LOCALHOST: String(process.env.LUNA_CLIENT_ALLOW_LOCALHOST || '0')\n"
        b"          }\n"
        b"        });"
    )
    if spawn_old in b and spawn_new not in b:
        b = b.replace(spawn_old, spawn_new)
        changed = True

    # Gate deep learning in demo unless client token is present
    start_dl = b"ipcMain.on('start_deep_learning', () => {\n"
    gate = (
        b"  if (isDemoBuild() && !getClientToken()) {\n"
        b"    try { log.warn('[deep-learning] blocked in demo build (no client token)'); } catch (_) {}\n"
        b"    return;\n"
        b"  }\n"
    )
    if start_dl in b and gate not in b:
        b = b.replace(start_dl, start_dl + gate)
        changed = True

    if changed:
        p.write_bytes(b)
        print(\"patched electron/main.js\")  # noqa: T201
    else:
        print(\"no changes needed\")  # noqa: T201


if __name__ == \"__main__\":
    main()


