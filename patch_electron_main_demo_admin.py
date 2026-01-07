from __future__ import annotations

from pathlib import Path


def patch() -> bool:
    p = Path("electron/main.js")
    b = p.read_bytes().replace(b"\r\n", b"\n")
    changed = False

    needle = b"const DJANGO_API_URL = process.env.LUNA_SERVER_URL || 'http://127.0.0.1:8000';\n"
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
    if needle in b and b"function getBuildFlavor()" not in b:
        b2 = b.replace(needle, needle + insert)
        if b2 != b:
            b = b2
            changed = True

    # Remove hard admin requirement block in createWindow
    admin_if = b"  if (!isAdmin()) {\n"
    if admin_if in b:
        start = b.find(admin_if)
        end = b.find(b"\n  }\n", start)
        if end != -1:
            # extend to include the block and the following blank line if present
            end2 = b.find(b"\n\n", end)
            end = end2 + 2 if end2 != -1 else end + 1
            b = (
                b[:start]
                + b"  // NOTE: Do not hard-require Windows Administrator to launch.\n"
                + b"  // Demo builds run as normal user. Admin-only features are gated by server-side tokens.\n\n"
                + b[end:]
            )
            changed = True

    # Extend httpJson signature
    sig_old = b"function httpJson(method, url, body, timeoutMs = 2500) {"
    sig_new = b"function httpJson(method, url, body, timeoutMs = 2500, extraHeaders = null) {"
    if sig_old in b and sig_new not in b:
        b = b.replace(sig_old, sig_new)
        changed = True

    # Merge extra headers
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

    # Token-gated memory calls
    if b'await httpJson("POST", url, { items }, 2500);' in b:
        b = b.replace(
            b'await httpJson("POST", url, { items }, 2500);',
            b'await httpJson("POST", url, { items }, 2500, getClientAuthHeaders());',
        )
        changed = True

    if b'const res = await httpJson("POST", url, { query, top_k: topK || cfg.topK }, 2500);' in b:
        b = b.replace(
            b'const res = await httpJson("POST", url, { query, top_k: topK || cfg.topK }, 2500);',
            b'const res = await httpJson("POST", url, { query, top_k: topK || cfg.topK }, 2500, getClientAuthHeaders());',
        )
        changed = True

    if b"if (!cfg.enabled || !cfg.autoIngest) return;" in b and b"isDemoBuild() && !getClientToken()" not in b:
        b = b.replace(
            b"if (!cfg.enabled || !cfg.autoIngest) return;",
            b"if (!cfg.enabled || !cfg.autoIngest) return;\n    if (isDemoBuild() && !getClientToken()) return;",
        )
        changed = True

    if b"if (!cfg.enabled || !cfg.ragEnabled) return [];" in b and b"isDemoBuild() && !getClientToken()) return []" not in b:
        b = b.replace(
            b"if (!cfg.enabled || !cfg.ragEnabled) return [];",
            b"if (!cfg.enabled || !cfg.ragEnabled) return [];\n    if (isDemoBuild() && !getClientToken()) return [];",
        )
        changed = True

    # Gate deep learning
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

    # Django spawn env defaults (secure by default)
    spawn_old = b"const p = spawn(cmd, args, { cwd: serverPath, shell: true, detached: false });"
    if spawn_old in b and b"LUNA_CLIENT_ALLOW_LOCALHOST" not in b:
        b = b.replace(
            spawn_old,
            (
                b"const p = spawn(cmd, args, {\n"
                b"          cwd: serverPath,\n"
                b"          shell: true,\n"
                b"          detached: false,\n"
                b"          env: {\n"
                b"            ...process.env,\n"
                b"            LUNA_DJANGO_DEBUG: String(process.env.LUNA_DJANGO_DEBUG || (app.isPackaged ? '0' : '1')),\n"
                b"            LUNA_ADMIN_ALLOW_LOCALHOST: String(process.env.LUNA_ADMIN_ALLOW_LOCALHOST || '0'),\n"
                b"            LUNA_CLIENT_ALLOW_LOCALHOST: String(process.env.LUNA_CLIENT_ALLOW_LOCALHOST || '0')\n"
                b"          }\n"
                b"        });"
            ),
        )
        changed = True

    if changed:
        p.write_bytes(b)
    return changed


if __name__ == "__main__":
    did = patch()
    print("patched" if did else "no changes needed")















