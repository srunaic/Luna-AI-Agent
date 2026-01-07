import { useState, useEffect } from 'react';
import { ChatInput } from './components/ChatInput';
import { PlanView } from './components/PlanView';
import { ChatHistory, ChatMessage } from './components/ChatHistory';
import { ActionLog } from './components/ActionLog';
import { StatusBar } from './components/StatusBar';
import { LunaDisplay } from './components/LunaDisplay';
import { WebviewBridge } from './types/bridge';
import { EditorContext, PlanStep, AgentState, ExtensionToWebviewMessage } from './types/protocol';
import './App.css';

interface AgentStore {
  currentTaskId: string | null;
  plan: PlanStep[];
  chatHistory: ChatMessage[];
  actionLogs: ActionLogEntry[];
  status: AgentState;
  editorContext: EditorContext | null;
  llmConnected: boolean;
  llmProvider: string | null;
  deepLearningActive: boolean;
  update: {
    state: 'idle' | 'checking' | 'available' | 'none' | 'downloading' | 'downloaded' | 'error';
    progress?: {
      percent?: number;
      bytesPerSecond?: number;
      transferred?: number;
      total?: number;
    };
    message?: string;
    currentVersion?: string;
    availableVersion?: string;
    checkedAt?: string;
  };
}

interface ActionLogEntry {
  id: string;
  timestamp: Date;
  action: string;
  input: string;
  result: string;
  success: boolean;
}

function App() {
  const sessionId = (() => {
    try {
      const params = new URLSearchParams(window.location.search);
      return params.get('session') || 'main';
    } catch (_) {
      return 'main';
    }
  })();

  const chatStorageKey = `luna.chatHistory.${sessionId}`;

  const [store, setStore] = useState<AgentStore>({
    currentTaskId: null,
    plan: [],
    chatHistory: [],
    actionLogs: [],
    status: 'idle',
    editorContext: null,
    llmConnected: false,
    llmProvider: null,
    deepLearningActive: false,
    update: { state: 'idle' }
  });

  const [bridge] = useState(() => new WebviewBridge());
  const [lunaDisplayOpen, setLunaDisplayOpen] = useState(false);
  const [speakText, setSpeakText] = useState<string>('');

  useEffect(() => {
    // Load persisted chat history (per session)
    try {
      const raw = localStorage.getItem(chatStorageKey);
      if (raw) {
        const parsed = JSON.parse(raw);
        if (Array.isArray(parsed)) {
          setStore((prev: AgentStore) => ({ ...prev, chatHistory: parsed }));
        }
      }
    } catch (_) { }

    // Load initial editor context
    bridge.getEditorContext().then((context: EditorContext | null) => {
      setStore((prev: AgentStore) => ({ ...prev, editorContext: context }));
    });

    // Default model auto-connect on startup
    bridge.setModel('luna-soul');

    // Load initial Deep Learning status
    bridge.getDeepLearningStatus();

    // Listen for messages from extension
    const cleanup = bridge.onMessage((message: ExtensionToWebviewMessage) => {
      switch (message.type) {
        case 'plan_update':
          setStore((prev: AgentStore) => ({
            ...prev,
            plan: message.data.steps,
            currentTaskId: message.data.taskId
          }));
          break;

        case 'action_log':
          const newLog: ActionLogEntry = {
            id: message.data.actionId,
            timestamp: new Date(),
            action: message.data.tool,
            input: JSON.stringify(message.data.input),
            result: message.data.result || '',
            success: message.data.success
          };
          setStore((prev: AgentStore) => ({
            ...prev,
            actionLogs: [...prev.actionLogs, newLog]
          }));
          break;

        case 'status_update':
          if (message.data.isPartial) {
            setStore((prev: AgentStore) => {
              const last = prev.chatHistory[prev.chatHistory.length - 1];
              // If the last message is a stream for this task, update it
              if (last && last.role === 'assistant' && last.id === `stream_${message.data.taskId}`) {
                const newHistory = [...prev.chatHistory];
                newHistory[newHistory.length - 1] = { ...last, content: message.data.message };
                return { ...prev, status: message.data.state, chatHistory: newHistory };
              } else {
                // New streaming message
                return {
                  ...prev,
                  status: message.data.state,
                  chatHistory: [
                    ...prev.chatHistory,
                    {
                      id: `stream_${message.data.taskId}`,
                      role: 'assistant',
                      content: message.data.message,
                      ts: Date.now()
                }
                  ]
                };
              }
            });
          } else {
            setStore((prev: AgentStore) => ({
              ...prev,
              status: message.data.state
            }));
          }
          break;

        case 'task_complete':
          setStore((prev: AgentStore) => {
            // Remove the temporary stream message and add the final one
            const filtered = prev.chatHistory.filter((m: ChatMessage) => m.id !== `stream_${message.data.taskId}`);
            const finalText = String(message.data?.message || '');
            // Trigger avatar ?쐓peak??(visual-only) when Luna finishes a response
            if (finalText) setSpeakText(finalText);
            return {
              ...prev,
              currentTaskId: null,
              status: 'idle',
              chatHistory: [
                ...filtered,
                {
                  id: `assistant_${Date.now()}`,
                  role: 'assistant',
                  content: finalText,
                  ts: Date.now(),
                  meta: { taskId: String(message.data.taskId || ''), rlAction: message.data?.rl?.action ? String(message.data.rl.action) : undefined }
                }
              ]
            };
          });
          break;

        case 'llm_connection':
          setStore((prev: AgentStore) => ({
            ...prev,
            llmConnected: !!message.data?.connected,
            llmProvider: message.data?.provider || null
          }));
          break;

        case 'update_status':
          setStore((prev: AgentStore) => ({
            ...prev,
            update: {
              state: message.data?.state || 'idle',
              progress: message.data?.progress,
              message: message.data?.message,
              currentVersion: message.data?.currentVersion,
              availableVersion: message.data?.availableVersion,
              checkedAt: message.data?.checkedAt
            }
          }));
          break;

        case 'editor_state_update':
          setStore((prev: AgentStore) => ({
            ...prev,
            editorContext: {
              ...prev.editorContext,
              ...message.data
            }
          }));
          break;

        case 'deep_learning_status':
          setStore((prev: AgentStore) => ({
            ...prev,
            deepLearningActive: !!message.data?.active
          }));
          break;
      }
    });

    return cleanup;
  }, []);

  useEffect(() => {
    // Persist chat history
    try {
      localStorage.setItem(chatStorageKey, JSON.stringify(store.chatHistory));
    } catch (_) { }
  }, [store.chatHistory]);

  const handleModelChange = (model: string) => {
    bridge.setModel(model);
  };

  const handleExecuteTask = async (instruction: string, model: string) => {
    try {
      setStore((prev: AgentStore) => ({
        ...prev,
        status: 'thinking',
        chatHistory: [
          ...prev.chatHistory,
          { id: `user_${Date.now()}`, role: 'user', content: instruction, ts: Date.now() }
        ]
      }));
      await bridge.executeTask(instruction, {
        ...store.editorContext,
        model: model
      });
    } catch (error) {
      console.error('Task execution failed:', error);
      setStore((prev: AgentStore) => ({
        ...prev,
        status: 'idle',
        chatHistory: [
          ...prev.chatHistory,
          { id: `system_${Date.now()}`, role: 'system', content: `Error: ${error instanceof Error ? error.message : String(error)}`, ts: Date.now() }
        ]
      }));
    }
  };

  const handleCancelTask = () => {
    if (store.currentTaskId) {
      bridge.cancelTask(store.currentTaskId);
      setStore((prev: AgentStore) => ({
        ...prev,
        currentTaskId: null,
        status: 'idle'
      }));
    }
  };

  const handleDeepLearningToggle = (active: boolean) => {
    if (active) {
      bridge.startDeepLearning();
    } else {
      bridge.stopDeepLearning();
    }
  };

  const handleFeedback = (taskId: string, reward: number, label: string) => {
    try {
      bridge.sendRLFeedback(taskId, reward, label);
    } catch (e) {
      console.error('RL feedback failed:', e);
    }
  };

  const handleClearChat = () => {
    setStore((prev: AgentStore) => ({
      ...prev,
      chatHistory: [],
      plan: [],
      actionLogs: [],
      currentTaskId: null,
      status: 'idle'
    }));
    try {
      localStorage.removeItem(chatStorageKey);
    } catch (_) { }
  };

  return (
    <div className="app">
      <div className="app-header">
        <div className="header-left">
          <div className="header-avatar">
            <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="#007acc" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M12 2a10 10 0 1 0 10 10A10 10 0 0 0 12 2zm0 18a8 8 0 1 1 8-8 8 8 0 0 1-8 8z"></path>
              <path d="M12 6v6l4 2"></path>
            </svg>
          </div>
          <span className="header-title">Luna chat</span>
        </div>
        <div className="header-right">
          <button
            className="header-action-btn"
            onClick={() => setLunaDisplayOpen((v) => !v)}
            title={lunaDisplayOpen ? 'Luna Display ?リ린' : 'Luna Display ?닿린'}
            aria-pressed={lunaDisplayOpen}
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M12 3a9 9 0 1 0 9 9"></path>
              <path d="M12 3a9 9 0 0 0-9 9"></path>
              <path d="M7 14s1.5 2 5 2 5-2 5-2"></path>
              <path d="M9 9h.01"></path>
              <path d="M15 9h.01"></path>
            </svg>
          </button>
          <button className="header-action-btn" id="new-terminal-toggle" onClick={() => bridge.executeTask("Open a new terminal", { model: "luna-soul" })} title="Open New Terminal">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <rect x="4" y="4" width="16" height="16" rx="2" ry="2"></rect>
              <polyline points="9 22 9 12 15 12 15 22"></polyline>
            </svg>
          </button>
          <button className="header-action-btn" onClick={handleClearChat} title="Clear Chat history">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <polyline points="3 6 5 6 21 6"></polyline>
              <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path>
              <line x1="10" y1="11" x2="10" y2="17"></line>
              <line x1="14" y1="11" x2="14" y2="17"></line>
            </svg>
          </button>
        </div>
      </div>
      <LunaDisplay
        open={lunaDisplayOpen}
        onClose={() => setLunaDisplayOpen(false)}
        speakText={speakText}
      />
      <div className="app-content">
        <div className="chat-messages">
          <ChatHistory messages={store.chatHistory} onFeedback={handleFeedback} />
          <PlanView steps={store.plan} />
          <ActionLog entries={store.actionLogs} />
        </div>

        <div className="chat-footer">
          <StatusBar
            status={store.status}
            llmConnected={store.llmConnected}
            llmProvider={store.llmProvider}
            update={store.update}
            deepLearningActive={store.deepLearningActive}
            onDeepLearningToggle={handleDeepLearningToggle}
          />
          <ChatInput
            onExecute={handleExecuteTask}
            onCancel={handleCancelTask}
            onClear={handleClearChat}
            isExecuting={['thinking', 'planning', 'executing', 'editing', 'running'].includes(store.status)}
            editorContext={store.editorContext}
            onModelChange={handleModelChange}
          />
        </div>
      </div>
    </div>
  );
}

export default App;




