// Protocol types for webview UI
export interface EditorContext {
  projectRoot?: string;
  openFiles?: string[];
  activeFile?: string;
  model?: string;
  cursor?: {
    line: number;
    character: number;
  };
  selection?: {
    start: {
      line: number;
      character: number;
    };
    end: {
      line: number;
      character: number;
    };
  };
  selectedText?: string;
}

export interface PlanStep {
  id: string;
  title: string;
  status: 'pending' | 'in_progress' | 'completed' | 'failed';
  description?: string;
}

export type AgentState = 'idle' | 'thinking' | 'planning' | 'executing' | 'editing' | 'running' | 'failed';

export interface WebviewToExtensionMessage {
  type: 'get_editor_context' | 'execute_task' | 'cancel_task' | 'set_model' | 'start_deep_learning' | 'stop_deep_learning' | 'get_deep_learning_status';
  data?: any;
}

export interface ExtensionToWebviewMessage {
  type: 'editor_context' | 'plan_update' | 'action_log' | 'status_update' | 'task_complete' | 'llm_connection' | 'update_status' | 'editor_state_update' | 'deep_learning_status';
  data: any;
}
