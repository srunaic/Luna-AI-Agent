import { useState, useEffect } from 'react';
import { ChatInput } from './components/ChatInput';
import { PlanView } from './components/PlanView';
import { ActionLog } from './components/ActionLog';
import { StatusBar } from './components/StatusBar';
import { WebviewBridge } from './types/bridge';
import { EditorContext, PlanStep, AgentState } from './types/protocol';
import './App.css';

interface AgentStore {
  currentTaskId: string | null;
  plan: PlanStep[];
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
  const [store, setStore] = useState<AgentStore>({
    currentTaskId: null,
    plan: [],
    actionLogs: [],
    status: 'idle',
    editorContext: null,
    llmConnected: false,
    llmProvider: null,
    update: { state: 'idle' }
  });

  const [bridge] = useState(() => new WebviewBridge());

  useEffect(() => {
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
          setStore(prev => ({
            ...prev,
            status: message.data.state
          }));
          break;

        case 'task_complete':
          setStore(prev => ({
            ...prev,
            currentTaskId: null,
            status: 'idle'
          }));
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
              message: message.data?.message
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

  const handleModelChange = (model: string) => {
    bridge.setModel(model);
  };

  const handleExecuteTask = async (instruction: string, model: string) => {
    try {
      setStore(prev => ({ ...prev, status: 'thinking' }));
      await bridge.executeTask(instruction, {
        ...store.editorContext,
        model: model
      });
    } catch (error) {
      console.error('Task execution failed:', error);
      setStore(prev => ({ ...prev, status: 'failed' }));
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
            isExecuting={store.status !== 'idle'}
            editorContext={store.editorContext}
            onModelChange={handleModelChange}
          />
        </div>
      </div>
    </div>
  );
}

export default App;
