import os
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]

def read_bytes(p: Path) -> bytes:
    return p.read_bytes()

def write_bytes(p: Path, data: bytes) -> None:
    p.write_bytes(data)

def replace_once(data: bytes, old: bytes, new: bytes, label: str) -> bytes:
    if old not in data:
        raise RuntimeError(f"[{label}] pattern not found")
    return data.replace(old, new, 1)

def replace_all(data: bytes, old: bytes, new: bytes, label: str) -> bytes:
    if old not in data:
        raise RuntimeError(f"[{label}] pattern not found")
    return data.replace(old, new)

def insert_after(data: bytes, anchor: bytes, insert: bytes, label: str) -> bytes:
    idx = data.find(anchor)
    if idx < 0:
        raise RuntimeError(f"[{label}] anchor not found")
    idx_end = idx + len(anchor)
    return data[:idx_end] + insert + data[idx_end:]


def patch_runtime_js():
    p = ROOT / 'electron' / 'runtime.js'
    b = read_bytes(p)

    b = replace_once(
        b,
        b"fullText = await this.callLunaCore(instruction, context, onResponse, true); // directMode: true",
        b"fullText = await this.callLunaCore(instruction, context, onResponse, false); // directMode: false (keep system prompt)",
        'runtime:directModeCall',
    )

    b = replace_all(
        b,
        b"const prompt = directMode ? instruction : this.buildPrompt(instruction, context);",
        b"const prompt = this.buildPrompt(instruction, context);",
        'runtime:promptSelect',
    )

    write_bytes(p, b)


def patch_preload_js():
    p = ROOT / 'electron' / 'preload.js'
    b = read_bytes(p)
    old = b"'stop_deep_learning', 'get_deep_learning_status'"
    new = b"'stop_deep_learning', 'get_deep_learning_status', 'rl-feedback'"
    if new in b:
        return
    b = replace_once(b, old, new, 'preload:addRlFeedback')
    write_bytes(p, b)


def patch_chatwindow_js():
    p = ROOT / 'electron' / 'chatWindow.js'
    b = read_bytes(p)

    if b"message.type === 'rl_feedback'" not in b:
        anchor = b"if (message.type === 'cancel_task') {\n      const taskId = message.data?.taskId;\n      if (taskId) await window.electronAPI?.cancelTask(taskId);\n      return;\n    }\n"
        insert = b"\n    if (message.type === 'rl_feedback') {\n      const payload = message.data || {};\n      window.electronAPI?.send?.('rl-feedback', payload);\n      return;\n    }\n"
        b = insert_after(b, anchor, insert, 'chatWindow:forwardRl')

    old = b"data: { taskId, success: !!response.data?.success, message: response.data?.message || '' }"
    new = b"data: { taskId, success: !!response.data?.success, message: response.data?.message || '', rl: response.data?.rl || null }"
    if old in b and new not in b:
        b = replace_once(b, old, new, 'chatWindow:mapDoneRl')

    write_bytes(p, b)


def patch_renderer_js():
    p = ROOT / 'electron' / 'renderer.js'
    b = read_bytes(p)

    if b"function mapAgentResponse" not in b:
        anchor = b"// IPC listeners\n        if (window.electronAPI) {\n"
        insert = (
            b"            // Forward agent responses to iframe (webview-ui)\n"
            b"            window.electronAPI.on('agent-response', (_event, response) => {\n"
            b"                try {\n"
            b"                    if (!iframe || !iframe.contentWindow) return;\n"
            b"                    iframe.contentWindow.postMessage(mapAgentResponse(response), '*');\n"
            b"                } catch (_) { }\n"
            b"            });\n\n"
        )
        b = insert_after(b, anchor, insert, 'renderer:agentForward')

        marker = b"        }\n\n    } catch (err) {"
        bridge = (
            b"\n            window.electronAPI.on('update-status', (_event, payload) => {\n"
            b"                try {\n"
            b"                    if (iframe && iframe.contentWindow) {\n"
            b"                        iframe.contentWindow.postMessage({ type: 'update_status', data: payload }, '*');\n"
            b"                    }\n"
            b"                } catch (_) { }\n"
            b"            });\n"
            b"        }\n\n"
            b"        // Bridge: iframe(webview-ui) -> main process\n"
            b"        window.addEventListener('message', async (event) => {\n"
            b"            const msg = event.data;\n"
            b"            if (!msg) return;\n"
            b"            if (!window.electronAPI) return;\n\n"
            b"            if (msg.type === 'get_editor_context') {\n"
            b"                try {\n"
            b"                    const ctx = await window.electronAPI.getEditorState?.();\n"
            b"                    iframe?.contentWindow?.postMessage({ type: 'editor_context', data: ctx || {} }, '*');\n"
            b"                } catch (_) { }\n"
            b"                return;\n"
            b"            }\n\n"
            b"            if (msg.type === 'execute_task') {\n"
            b"                const instruction = msg.data?.instruction;\n"
            b"                const context = msg.data?.context || {};\n"
            b"                if (!instruction) return;\n"
            b"                await window.electronAPI.executeTask(instruction, { ...context, taskId: msg.data?.taskId });\n"
            b"                return;\n"
            b"            }\n\n"
            b"            if (msg.type === 'cancel_task') {\n"
            b"                const taskId = msg.data?.taskId;\n"
            b"                if (taskId) await window.electronAPI.cancelTask(taskId);\n"
            b"                return;\n"
            b"            }\n\n"
            b"            if (msg.type === 'rl_feedback') {\n"
            b"                window.electronAPI.send?.('rl-feedback', msg.data || {});\n"
            b"                return;\n"
            b"            }\n"
            b"        });\n"
        )
        b = replace_once(b, marker, bridge + marker, 'renderer:bridgeInsert')

        entry = b"// Entry point"
        idx = b.find(entry)
        if idx < 0:
            raise RuntimeError('[renderer] entry point anchor not found')
        helper = (
            b"\nfunction mapAgentResponse(response) {\n"
            b"    const taskId = response?.data?.taskId;\n"
            b"    if (response?.type === 'status') {\n"
            b"        return { type: 'status_update', data: { taskId, state: response.data?.state || 'thinking', message: response.data?.message || '' } };\n"
            b"    }\n"
            b"    if (response?.type === 'done') {\n"
            b"        return { type: 'task_complete', data: { taskId, success: !!response.data?.success, message: response.data?.message || '', rl: response.data?.rl || null } };\n"
            b"    }\n"
            b"    if (response?.type === 'action') {\n"
            b"        return { type: 'action_log', data: { taskId, actionId: response.data?.actionId || response.data?.tool || `action_${Date.now()}`, tool: response.data?.tool || 'action', input: response.data?.input || response.data || {}, result: response.data?.result || '', success: true } };\n"
            b"    }\n"
            b"    return response;\n"
            b"}\n\n"
        )
        b = b[:idx] + helper + b[idx:]

    write_bytes(p, b)


def patch_main_js():
    p = ROOT / 'electron' / 'main.js'
    b = read_bytes(p)

    if b"// --- RL Controller (Q-learning) ---" not in b:
        anchor = b"const DJANGO_API_URL = process.env.LUNA_SERVER_URL || 'http://localhost:8000';\n"
        rl_block = (
            b"\n// --- RL Controller (Q-learning) ---\n"
            b"const RL_HOST = '127.0.0.1';\n"
            b"const RL_PORT = Number(process.env.LUNA_RL_PORT || 8765);\n"
            b"const RL_URL = `http://${RL_HOST}:${RL_PORT}`;\n"
            b"let rlProcess;\n"
            b"let rlStarting = false;\n"
            b"const rlTurnByTaskId = new Map(); // taskId -> { state, action, actions }\n\n"
            b"function rlHttpJson(method, url, body, timeoutMs = 1200) {\n"
            b"  return new Promise((resolve, reject) => {\n"
            b"    try {\n"
            b"      const data = body ? JSON.stringify(body) : '';\n"
            b"      const u = new URL(url);\n"
            b"      const options = { hostname: u.hostname, port: Number(u.port || 80), path: u.pathname + (u.search || ''), method, headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(data, 'utf8') } };\n"
            b"      const req = http.request(options, (res) => {\n"
            b"        let buf = '';\n"
            b"        res.on('data', (c) => (buf += c));\n"
            b"        res.on('end', () => { try { resolve(JSON.parse(buf || '{}')); } catch (_) { resolve({}); } });\n"
            b"      });\n"
            b"      req.on('error', reject);\n"
            b"      req.setTimeout(timeoutMs, () => { try { req.destroy(new Error('timeout')); } catch (_) {} reject(new Error('timeout')); });\n"
            b"      if (data) req.write(data);\n"
            b"      req.end();\n"
            b"    } catch (e) { reject(e); }\n"
            b"  });\n"
            b"}\n\n"
            b"async function waitForRLReady(timeoutMs = 8000) {\n"
            b"  const deadline = Date.now() + timeoutMs;\n"
            b"  while (Date.now() < deadline) {\n"
            b"    try { const res = await rlHttpJson('GET', `${RL_URL}/health`, null, 800); if (res && res.ok) return true; } catch (_) {}\n"
            b"    await new Promise(r => setTimeout(r, 250));\n"
            b"  }\n"
            b"  return false;\n"
            b"}\n\n"
            b"function startRLServer() {\n"
            b"  try {\n"
            b"    if (rlProcess || rlStarting) return;\n"
            b"    const rlPath = app.isPackaged ? path.join(process.resourcesPath, 'luna-rl') : path.join(__dirname, '../luna-rl');\n"
            b"    const entry = path.join(rlPath, 'rl_server.py');\n"
            b"    if (!fs.existsSync(entry)) { log.warn('[rl] rl_server.py missing; not starting', { entry }); return; }\n"
            b"    rlStarting = true;\n"
            b"    const py = resolvePythonCommand();\n"
            b"    const dataDir = path.join(app.getPath('userData'), 'rl');\n"
            b"    const args = [...(py.argsPrefix || []), entry, '--host', RL_HOST, '--port', String(RL_PORT), '--data-dir', dataDir];\n"
            b"    rlProcess = spawn(py.cmd, args, { cwd: rlPath, shell: true, detached: false });\n"
            b"    rlProcess.on('error', (e) => log.error('[rl] spawn error', e));\n"
            b"    rlProcess.stdout?.on('data', (d) => log.info('[rl]', String(d).trim()));\n"
            b"    rlProcess.stderr?.on('data', (d) => log.warn('[rl]', String(d).trim()));\n"
            b"    rlProcess.on('exit', (code) => { log.warn('[rl] exited', { code }); rlProcess = null; rlStarting = false; });\n"
            b"    setTimeout(async () => { const ok = await waitForRLReady(8000); rlStarting = false; if (ok) log.info('[rl] ready', { url: RL_URL }); else log.warn('[rl] not ready', { url: RL_URL }); }, 250);\n"
            b"  } catch (e) { rlStarting = false; log.error('[rl] start failed', e); }\n"
            b"}\n\n"
            b"function stopRLServer() {\n"
            b"  if (rlProcess) {\n"
            b"    try {\n"
            b"      if (process.platform === 'win32') { try { execSync(`taskkill /pid ${rlProcess.pid} /f /t`); } catch (_) {} }\n"
            b"      else { try { rlProcess.kill(); } catch (_) {} }\n"
            b"    } catch (_) {}\n"
            b"    rlProcess = null;\n"
            b"  }\n"
            b"  rlStarting = false;\n"
            b"}\n\n"
            b"function buildRLState(instruction, context) {\n"
            b"  const text = String(instruction || '');\n"
            b"  const hasKorean = /[\\uAC00-\\uD7A3]/.test(text);\n"
            b"  const len = text.length;\n"
            b"  const lenBucket = len < 40 ? 'short' : (len < 160 ? 'mid' : 'long');\n"
            b"  const isCode = /```|(\\bconst\\b|\\blet\\b|\\bfunction\\b|\\bclass\\b|\\bimport\\b|\\bexport\\b|\\bdef\\b|\\btraceback\\b|\\bException\\b)/i.test(text);\n"
            b"  return { lang: hasKorean ? 'ko' : 'en', len: lenBucket, code: isCode ? 1 : 0, model: String(context?.model || '') };\n"
            b"}\n\n"
            b"async function rlSelectStrategy(taskId, instruction, context) {\n"
            b"  const state = buildRLState(instruction, context);\n"
            b"  const actions = ['korean_concise','korean_step_by_step','ask_clarify','summarize_then_steps','cheerful_tone'];\n"
            b"  let action = 'korean_step_by_step';\n"
            b"  try { const res = await rlHttpJson('POST', `${RL_URL}/select_action`, { state, actions }, 1000); if (res && res.ok && typeof res.action === 'string') action = res.action; } catch (_) {}\n"
            b"  rlTurnByTaskId.set(String(taskId || ''), { state, action, actions });\n"
            b"  return { state, action, actions };\n"
            b"}\n\n"
            b"async function rlApplyFeedback(taskId, reward, label) {\n"
            b"  const key = String(taskId || '');\n"
            b"  const turn = rlTurnByTaskId.get(key);\n"
            b"  if (!turn) return { ok: false };\n"
            b"  try { await rlHttpJson('POST', `${RL_URL}/feedback`, { state: turn.state, action: turn.action, reward: Number(reward || 0), done: true, meta: { label: String(label || '') } }, 1200); rlTurnByTaskId.delete(key); return { ok: true }; } catch (_) { return { ok: false }; }\n"
            b"}\n"
        )
        b = insert_after(b, anchor, rl_block, 'main:insertRlBlock')

    if b"startRLServer();" not in b:
        b = b.replace(b"    startDjangoServer();\n", b"    startDjangoServer();\n    startRLServer();\n")

    if b"stopRLServer();" not in b:
        b = b.replace(b"  try { stopDjangoServer(); } catch (_) { }\n", b"  try { stopDjangoServer(); } catch (_) { }\n  try { stopRLServer(); } catch (_) { }\n")

    if b"// RL strategy selection" not in b:
        anchor = b"  try {\n    memories = await memorySearch(String(instruction || ''), memCfg.topK);\n  } catch (_) { }\n"
        inject = (
            b"\n  // RL strategy selection (best-effort)\n"
            b"  const rl = await rlSelectStrategy(taskId, instruction, context);\n"
            b"  const baseSys = (llmSettings && llmSettings.systemInstructions) ? String(llmSettings.systemInstructions) : '';\n"
            b"  const rlSys = `[STRATEGY_CARD]\\n${rl.action}\\n`;\n"
            b"  const llmSettingsWithRL = { ...(llmSettings || {}), systemInstructions: (baseSys ? (baseSys + '\\n\\n' + rlSys) : rlSys) };\n"
        )
        b = insert_after(b, anchor, inject, 'main:executeInject')

    if b"llmSettings: llmSettingsWithRL" not in b:
        b = b.replace(b"      llmSettings,\n", b"      llmSettings: llmSettingsWithRL,\n")

    if b"      rl\n" not in b:
        b = b.replace(b"      djangoApiUrl: DJANGO_API_URL\n", b"      djangoApiUrl: DJANGO_API_URL,\n      rl\n")

    if b"rlMeta" not in b and b"data: { ...(response.data || {}), taskId }" in b:
        b = b.replace(
            b"    const enriched = {\n      ...response,\n      data: { ...(response.data || {}), taskId }\n    };",
            b"    const rlMeta = rlTurnByTaskId.get(String(taskId || '')) || null;\n    const enriched = {\n      ...response,\n      data: { ...(response.data || {}), taskId, rl: rlMeta }\n    };",
        )

    if b"ipcMain.on('rl-feedback'" not in b:
        anchor2 = b"  return { success: true };\n});\n"
        insert2 = (
            b"\nipcMain.on('rl-feedback', async (_event, payload) => {\n"
            b"  try {\n"
            b"    const taskId = payload?.taskId;\n"
            b"    const reward = payload?.reward;\n"
            b"    const label = payload?.label;\n"
            b"    await rlApplyFeedback(taskId, reward, label);\n"
            b"  } catch (_) { }\n"
            b"});\n"
        )
        b = insert_after(b, anchor2, insert2, 'main:addRlFeedbackHandler')

    write_bytes(p, b)


def patch_webview_ui():
    app_tsx = ROOT / 'webview-ui' / 'src' / 'App.tsx'
    ch_tsx = ROOT / 'webview-ui' / 'src' / 'components' / 'ChatHistory.tsx'
    ch_css = ROOT / 'webview-ui' / 'src' / 'components' / 'ChatHistory.css'
    bridge_ts = ROOT / 'webview-ui' / 'src' / 'types' / 'bridge.ts'
    proto_ts = ROOT / 'webview-ui' / 'src' / 'types' / 'protocol.ts'

    if not all(p.exists() for p in [app_tsx, ch_tsx, ch_css, bridge_ts, proto_ts]):
        return

    if 'chat-msg-feedback' in ch_css.read_text(encoding='utf-8'):
        return

    t = proto_ts.read_text(encoding='utf-8')
    if "'rl_feedback'" not in t:
        t = t.replace("| 'get_deep_learning_status';", "| 'get_deep_learning_status' | 'rl_feedback';")
        proto_ts.write_text(t, encoding='utf-8')

    t = bridge_ts.read_text(encoding='utf-8')
    if 'sendRLFeedback' not in t:
        ins = "\n  public sendRLFeedback(taskId: string, reward: number, label: string): void {\n    const message: WebviewToExtensionMessage = {\n      type: 'rl_feedback',\n      data: { taskId, reward, label }\n    };\n    this.vscode.postMessage(message);\n  }\n"
        t = t.replace("    this.vscode.postMessage(message);\n  }\n\n  public cancelTask", "    this.vscode.postMessage(message);\n  }\n" + ins + "\n  public cancelTask")
        bridge_ts.write_text(t, encoding='utf-8')

    t = ch_tsx.read_text(encoding='utf-8')
    if 'onFeedback' not in t:
        t = t.replace("ts: number;", "ts: number;\n  meta?: { taskId?: string; rlAction?: string; }; ")
        t = t.replace("messages: ChatMessage[];", "messages: ChatMessage[];\n  onFeedback?: (taskId: string, reward: number, label: string) => void;")
        t = t.replace("export function ChatHistory({ messages }: ChatHistoryProps)", "export function ChatHistory({ messages, onFeedback }: ChatHistoryProps)")
        t = t.replace("<div className=\"chat-msg-content\">{m.content}</div>", "<div className=\"chat-msg-content\">{m.content}</div>\n            {m.role === 'assistant' && m.meta?.taskId && onFeedback && (\n              <div className=\"chat-msg-feedback\">\n                <button className=\"chat-feedback-btn\" onClick={() => onFeedback(m.meta!.taskId!, 1, 'like')} title=\"Like\">?몟</button>\n                <button className=\"chat-feedback-btn\" onClick={() => onFeedback(m.meta!.taskId!, -1, 'dislike')} title=\"Dislike\">?몠</button>\n                <button className=\"chat-feedback-btn chat-feedback-btn-solved\" onClick={() => onFeedback(m.meta!.taskId!, 2, 'solved')} title=\"Solved\">Solved</button>\n                {m.meta?.rlAction && <span className=\"chat-feedback-meta\">RL: {m.meta.rlAction}</span>}\n              </div>\n            )}")
        ch_tsx.write_text(t, encoding='utf-8')

    css = ch_css.read_text(encoding='utf-8')
    css += "\n.chat-msg-feedback{display:flex;align-items:center;gap:8px;margin-top:8px;}\n.chat-feedback-btn{border:1px solid rgba(255,255,255,0.15);background:rgba(255,255,255,0.06);color:#e6e6e6;padding:4px 8px;border-radius:6px;font-size:12px;cursor:pointer;}\n.chat-feedback-btn:hover{background:rgba(255,255,255,0.10);}\n.chat-feedback-btn-solved{border-color:rgba(0,122,204,0.5);background:rgba(0,122,204,0.18);}\n.chat-feedback-meta{margin-left:auto;font-size:11px;color:rgba(255,255,255,0.55);}\n"
    ch_css.write_text(css, encoding='utf-8')

    t = app_tsx.read_text(encoding='utf-8')
    if 'handleFeedback' not in t:
        t = t.replace("ts: Date.now()\n                }", "ts: Date.now(),\n                  meta: { taskId: String(message.data.taskId || ''), rlAction: message.data?.rl?.action ? String(message.data.rl.action) : undefined }\n                }")
        marker = "  const handleClearChat = () => {"
        idx = t.find(marker)
        if idx > 0:
            insert = "\n  const handleFeedback = (taskId: string, reward: number, label: string) => {\n    try {\n      bridge.sendRLFeedback(taskId, reward, label);\n    } catch (e) {\n      console.error('RL feedback failed:', e);\n    }\n  };\n\n"
            t = t[:idx] + insert + t[idx:]
        t = t.replace("<ChatHistory messages={store.chatHistory} />", "<ChatHistory messages={store.chatHistory} onFeedback={handleFeedback} />")
        app_tsx.write_text(t, encoding='utf-8')


def main():
    patch_runtime_js()
    patch_preload_js()
    patch_chatwindow_js()
    patch_renderer_js()
    patch_main_js()
    patch_webview_ui()
    print('OK: patches applied to disk')


if __name__ == '__main__':
    main()
