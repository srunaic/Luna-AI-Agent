from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]

app_tsx = ROOT / 'webview-ui' / 'src' / 'App.tsx'
ch_tsx = ROOT / 'webview-ui' / 'src' / 'components' / 'ChatHistory.tsx'
ch_css = ROOT / 'webview-ui' / 'src' / 'components' / 'ChatHistory.css'
bridge_ts = ROOT / 'webview-ui' / 'src' / 'types' / 'bridge.ts'
proto_ts = ROOT / 'webview-ui' / 'src' / 'types' / 'protocol.ts'

for p in [app_tsx, ch_tsx, ch_css, bridge_ts, proto_ts]:
    if not p.exists():
        raise SystemExit(f"missing: {p}")

# protocol.ts
pt = proto_ts.read_text(encoding='utf-8')
if "'rl_feedback'" not in pt:
    pt = pt.replace(
        "type: 'get_editor_context' | 'execute_task' | 'cancel_task' | 'set_model' | 'start_deep_learning' | 'stop_deep_learning' | 'get_deep_learning_status';",
        "type: 'get_editor_context' | 'execute_task' | 'cancel_task' | 'set_model' | 'start_deep_learning' | 'stop_deep_learning' | 'get_deep_learning_status' | 'rl_feedback';",
    )
    proto_ts.write_text(pt, encoding='utf-8')

# bridge.ts
bt = bridge_ts.read_text(encoding='utf-8')
if 'sendRLFeedback' not in bt:
    insert = "\n  public sendRLFeedback(taskId: string, reward: number, label: string): void {\n    const message: WebviewToExtensionMessage = {\n      type: 'rl_feedback',\n      data: { taskId, reward, label }\n    };\n    this.vscode.postMessage(message);\n  }\n"
    bt = bt.replace("    this.vscode.postMessage(message);\n  }\n\n  public cancelTask", "    this.vscode.postMessage(message);\n  }\n" + insert + "\n  public cancelTask")
    bridge_ts.write_text(bt, encoding='utf-8')

# ChatHistory.tsx
ct = ch_tsx.read_text(encoding='utf-8')
if 'onFeedback' not in ct or 'chat-msg-feedback' not in ct:
    ct = ct.replace("ts: number;", "ts: number;\n  meta?: { taskId?: string; rlAction?: string; };\n")
    ct = ct.replace("messages: ChatMessage[];", "messages: ChatMessage[];\n  onFeedback?: (taskId: string, reward: number, label: string) => void;\n")
    ct = ct.replace("export function ChatHistory({ messages }: ChatHistoryProps)", "export function ChatHistory({ messages, onFeedback }: ChatHistoryProps)")
    ct = ct.replace(
        "<div className=\"chat-msg-content\">{m.content}</div>",
        "<div className=\"chat-msg-content\">{m.content}</div>\n            {m.role === 'assistant' && m.meta?.taskId && onFeedback && (\n              <div className=\"chat-msg-feedback\">\n                <button className=\"chat-feedback-btn\" onClick={() => onFeedback(m.meta!.taskId!, 1, 'like')} title=\"醫뗭븘??">?몟</button>\n                <button className=\"chat-feedback-btn\" onClick={() => onFeedback(m.meta!.taskId!, -1, 'dislike')} title=\"蹂꾨줈?먯슂\">?몠</button>\n                <button className=\"chat-feedback-btn chat-feedback-btn-solved\" onClick={() => onFeedback(m.meta!.taskId!, 2, 'solved')} title=\"?닿껐??">?닿껐??/button>\n                {m.meta?.rlAction && <span className=\"chat-feedback-meta\">RL: {m.meta.rlAction}</span>}\n              </div>\n            )}",
    )
    ch_tsx.write_text(ct, encoding='utf-8')

# ChatHistory.css
css = ch_css.read_text(encoding='utf-8')
if 'chat-msg-feedback' not in css:
    css += "\n.chat-msg-feedback { display: flex; align-items: center; gap: 8px; margin-top: 8px; }\n"
    css += ".chat-feedback-btn { border: 1px solid rgba(255,255,255,0.15); background: rgba(255,255,255,0.06); color: #e6e6e6; padding: 4px 8px; border-radius: 6px; font-size: 12px; cursor: pointer; }\n"
    css += ".chat-feedback-btn:hover { background: rgba(255,255,255,0.10); }\n"
    css += ".chat-feedback-btn-solved { border-color: rgba(0,122,204,0.5); background: rgba(0,122,204,0.18); }\n"
    css += ".chat-feedback-meta { margin-left: auto; font-size: 11px; color: rgba(255,255,255,0.55); }\n"
    ch_css.write_text(css, encoding='utf-8')

# App.tsx
at = app_tsx.read_text(encoding='utf-8')
if 'handleFeedback' not in at:
    at = at.replace(
        "ts: Date.now()\n                }",
        "ts: Date.now(),\n                  meta: { taskId: String(message.data.taskId || ''), rlAction: message.data?.rl?.action ? String(message.data.rl.action) : undefined }\n                }",
    )
    marker = "  const handleClearChat = () => {"
    idx = at.find(marker)
    if idx > 0:
        insert = "\n  const handleFeedback = (taskId: string, reward: number, label: string) => {\n    try {\n      bridge.sendRLFeedback(taskId, reward, label);\n    } catch (e) {\n      console.error('RL feedback failed:', e);\n    }\n  };\n\n"
        at = at[:idx] + insert + at[idx:]
    at = at.replace("<ChatHistory messages={store.chatHistory} />", "<ChatHistory messages={store.chatHistory} onFeedback={handleFeedback} />")
    app_tsx.write_text(at, encoding='utf-8')

print('OK: webview-ui RL feedback UI patched')
