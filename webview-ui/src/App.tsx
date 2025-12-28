import { useState, useEffect } from 'react';
import { ChatInput } from './components/ChatInput';
import { PlanView } from './components/PlanView';
import { ChatHistory, ChatMessage } from './components/ChatHistory';
import { ActionLog } from './components/ActionLog';
import { StatusBar } from './components/StatusBar';
import { WebviewBridge } from './types/bridge';
import { EditorContext, PlanStep, AgentState } from './types/protocol';
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
    update: { state: 'idle' }
  });

  const [bridge] = useState(() => new WebviewBridge());

  useEffect(() => {
    // Load persisted chat history (per session)
    try {
      const raw = localStorage.getItem(chatStorageKey);
      if (raw) {
        const parsed = JSON.parse(raw);
        if (Array.isArray(parsed)) {
          setStore(prev => ({ ...prev, chatHistory: parsed }));
        }
      }
    } catch (_) {}

    // Load initial editor context
    bridge.getEditorContext().then(context => {
      setStore(prev => ({ ...prev, editorContext: context }));
    });

    // Default model auto-connect on startup
    bridge.setModel('ollama');

    // Listen for messages from extension
    const cleanup = bridge.onMessage((message: any) => {
      switch (message.type) {
        case 'plan_update':
          setStore(prev => ({
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
          setStore(prev => ({
            ...prev,
            actionLogs: [...prev.actionLogs, newLog]
          }));
          break;

        case 'status_update':
          if (message.data.isPartial) {
            setStore(prev => {
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
            setStore(prev => ({
              ...prev,
              status: message.data.state
            }));
          }
          break;

        case 'task_complete':
          setStore(prev => {
            // Remove the temporary stream message and add the final one
            const filtered = prev.chatHistory.filter(m => m.id !== `stream_${message.data.taskId}`);
            return {
              ...prev,
              currentTaskId: null,
              status: 'idle',
              chatHistory: [
                ...filtered,
                {
                  id: `assistant_${Date.now()}`,
                  role: 'assistant',
                  content: String(message.data?.message || ''),
                  ts: Date.now()
                }
              ]
            };
          });
          break;

        case 'llm_connection':
          setStore(prev => ({
            ...prev,
            llmConnected: !!message.data?.connected,
            llmProvider: message.data?.provider || null
          }));
          break;

        case 'update_status':
          setStore(prev => ({
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
          setStore(prev => ({
            ...prev,
            editorContext: {
              ...prev.editorContext,
              ...message.data
            }
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
    } catch (_) {}
  }, [store.chatHistory]);

  const handleModelChange = (model: string) => {
    bridge.setModel(model);
  };

  const handleExecuteTask = async (instruction: string, model: string) => {
    try {
      setStore(prev => ({
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
      setStore(prev => ({
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
      setStore(prev => ({
        ...prev,
        currentTaskId: null,
        status: 'idle'
      }));
    }
  };

  return (
    <div className="app">
      <div className="app-content">
        <div className="chat-messages">
          <ChatHistory messages={store.chatHistory} />
          <PlanView steps={store.plan} />
          <ActionLog entries={store.actionLogs} />
        </div>

        <div className="chat-footer">
          <StatusBar
            status={store.status}
            llmConnected={store.llmConnected}
            llmProvider={store.llmProvider}
            update={store.update}
          />
          <ChatInput
            onExecute={handleExecuteTask}
            onCancel={handleCancelTask}
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
