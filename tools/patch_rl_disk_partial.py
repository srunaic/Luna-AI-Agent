from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]

def read_bytes(p: Path) -> bytes:
    return p.read_bytes()

def write_bytes(p: Path, data: bytes) -> None:
    p.write_bytes(data)

def replace_first_optional(data: bytes, old: bytes, new: bytes) -> bytes:
    return data.replace(old, new, 1) if old in data else data

def replace_all_optional(data: bytes, old: bytes, new: bytes) -> bytes:
    return data.replace(old, new) if old in data else data

def insert_after_once(data: bytes, anchor: bytes, insert: bytes) -> bytes:
    idx = data.find(anchor)
    if idx < 0:
        return data
    idx_end = idx + len(anchor)
    if insert in data:
        return data
    return data[:idx_end] + insert + data[idx_end:]


def patch_runtime_js():
    p = ROOT / 'electron' / 'runtime.js'
    b = read_bytes(p)
    b = replace_first_optional(
        b,
        b"fullText = await this.callLunaCore(instruction, context, onResponse, true); // directMode: true",
        b"fullText = await this.callLunaCore(instruction, context, onResponse, false); // directMode: false (keep system prompt)",
    )
    b = replace_all_optional(
        b,
        b"const prompt = directMode ? instruction : this.buildPrompt(instruction, context);",
        b"const prompt = this.buildPrompt(instruction, context);",
    )
    write_bytes(p, b)


def patch_preload_js():
    p = ROOT / 'electron' / 'preload.js'
    b = read_bytes(p)
    if b"'rl-feedback'" in b:
        write_bytes(p, b)
        return
    # Insert into send() validChannels list after get_deep_learning_status
    anchor = b"      'get_deep_learning_status'\n"
    insert = b"      ,'rl-feedback'\n"
    if anchor in b:
        b = insert_after_once(b, anchor, insert)
    write_bytes(p, b)


def patch_chatwindow_js():
    p = ROOT / 'electron' / 'chatWindow.js'
    b = read_bytes(p)

    if b"message.type === 'rl_feedback'" not in b:
        anchor = b"if (message.type === 'cancel_task') {\n      const taskId = message.data?.taskId;\n      if (taskId) await window.electronAPI?.cancelTask(taskId);\n      return;\n    }\n"
        insert = b"\n    if (message.type === 'rl_feedback') {\n      const payload = message.data || {};\n      window.electronAPI?.send?.('rl-feedback', payload);\n      return;\n    }\n"
        b = insert_after_once(b, anchor, insert)

    b = replace_first_optional(
        b,
        b"data: { taskId, success: !!response.data?.success, message: response.data?.message || '' }",
        b"data: { taskId, success: !!response.data?.success, message: response.data?.message || '', rl: response.data?.rl || null }",
    )

    write_bytes(p, b)


def patch_renderer_js():
    p = ROOT / 'electron' / 'renderer.js'
    b = read_bytes(p)

    if b"function mapAgentResponse" in b:
        write_bytes(p, b)
        return

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
    b = insert_after_once(b, anchor, insert)

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
    if marker in b:
        b = b.replace(marker, bridge + marker, 1)

    entry = b"// Entry point"
    idx = b.find(entry)
    if idx >= 0:
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


def main():
    patch_runtime_js()
    patch_preload_js()
    patch_chatwindow_js()
    patch_renderer_js()
    print('OK: partial patches applied (runtime/preload/chatWindow/renderer)')


if __name__ == '__main__':
    main()
