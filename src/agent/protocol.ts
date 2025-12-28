// Editor ↔ Agent Communication Protocol

export interface EditorContext {
  projectRoot: string;
  openFiles: string[];
  activeFile?: string;
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

// Messages from Editor to Agent
export interface TaskRequestMessage {
  type: 'task_request';
  taskId: string;
  instruction: string;
  editorContext: EditorContext;
}

export interface CancelTaskMessage {
  type: 'cancel_task';
  taskId: string;
}

// Messages from Agent to Editor
export interface PlanMessage {
  type: 'plan';
  taskId: string;
  steps: PlanStep[];
}

export interface PlanStep {
  id: string;
  title: string;
  status: 'pending' | 'in_progress' | 'completed' | 'failed';
  description?: string;
}

export interface ActionMessage {
  type: 'action';
  taskId: string;
  actionId: string;
  tool: string;
  input: any;
}

export interface StatusUpdateMessage {
  type: 'status_update';
  taskId: string;
  state: AgentState;
  message?: string;
}

export interface TaskCompleteMessage {
  type: 'task_complete';
  taskId: string;
  success: boolean;
  message: string;
  result?: any;
}

// Agent States
export type AgentState = 'idle' | 'thinking' | 'planning' | 'executing' | 'editing' | 'running' | 'failed';

// Action Results
export interface ActionResult {
  actionId: string;
  success: boolean;
  output?: string;
  error?: string;
  metadata?: any;
}

// Webview ↔ Extension Messages
export interface WebviewToExtensionMessage {
  type: 'get_editor_context' | 'execute_task' | 'cancel_task';
  data?: any;
}

export interface ExtensionToWebviewMessage {
  type: 'editor_context' | 'plan_update' | 'action_log' | 'status_update' | 'task_complete';
  data: any;
}

// Union types for type safety
export type EditorToAgentMessage = TaskRequestMessage | CancelTaskMessage;
export type AgentToEditorMessage = PlanMessage | ActionMessage | StatusUpdateMessage | TaskCompleteMessage;
export type WebviewMessage = WebviewToExtensionMessage | ExtensionToWebviewMessage;




