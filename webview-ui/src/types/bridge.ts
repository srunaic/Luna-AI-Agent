import { EditorContext, WebviewToExtensionMessage, ExtensionToWebviewMessage } from './protocol';

// Webview-side bridge for communication with extension
export class WebviewBridge {
  private vscode: any;
  private messageHandlers: ((message: any) => void)[] = [];

  constructor() {
    // 1) VSCode Webview 환경: acquireVsCodeApi() 사용
    const acquire = (globalThis as any).acquireVsCodeApi;
    if (typeof acquire === 'function') {
      this.vscode = acquire();
    }

    // 2) Electron iframe 환경: window.parent.postMessage 사용
    if (!this.vscode && typeof window !== 'undefined' && window.parent && window.parent !== window) {
      this.vscode = {
        postMessage: (msg: any) => window.parent.postMessage(msg, '*'),
        getState: () => null,
        setState: (_state: any) => {}
      };
    }

    // 3) Fallback: dev mode
    if (!this.vscode) {
      console.warn('Bridge API not available - running in development mode');
      this.vscode = {
        postMessage: (msg: any) => console.log('Posting message:', msg),
        getState: () => null,
        setState: (state: any) => console.log('Setting state:', state)
      };
    }

    // Incoming messages (VSCode webview + Electron iframe both use window.message)
    if (typeof window !== 'undefined') {
      window.addEventListener('message', (event: MessageEvent) => {
        const message = (event as any).data;
        if (!message) return;
        // Fan out to all handlers
        for (const handler of this.messageHandlers) {
          try {
            handler(message);
          } catch (e) {
            console.error('Bridge message handler error:', e);
          }
        }
      });
    }
  }

  // Send messages to extension
  public getEditorContext(): Promise<EditorContext> {
    return new Promise((resolve) => {
      const message: WebviewToExtensionMessage = {
        type: 'get_editor_context'
      };

      const handler = (response: ExtensionToWebviewMessage) => {
        if (response.type === 'editor_context') {
          this.removeMessageHandler(handler);
          resolve(response.data);
        }
      };

      this.addMessageHandler(handler);
      this.vscode.postMessage(message);
    });
  }

  public executeTask(instruction: string, context?: EditorContext): Promise<string> {
    return new Promise((resolve, reject) => {
      const taskId = `task_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;

      const message: WebviewToExtensionMessage = {
        type: 'execute_task',
        data: {
          taskId,
          instruction,
          context
        }
      };

      const handler = (response: ExtensionToWebviewMessage) => {
        if (response.type === 'task_complete' && response.data?.taskId === taskId) {
          this.removeMessageHandler(handler);
          if (response.data.success) {
            resolve(response.data.message);
          } else {
            reject(new Error(response.data.message));
          }
        }
      };

      this.addMessageHandler(handler);
      this.vscode.postMessage(message);

      // Timeout after 5 minutes
      setTimeout(() => {
        this.removeMessageHandler(handler);
        reject(new Error('Task execution timeout'));
      }, 5 * 60 * 1000);
    });
  }

  public setModel(model: string): void {
    const message: WebviewToExtensionMessage = {
      type: 'set_model',
      data: { model }
    };
    this.vscode.postMessage(message);
  }

  public cancelTask(taskId: string): void {
    const message: WebviewToExtensionMessage = {
      type: 'cancel_task',
      data: { taskId }
    };
    this.vscode.postMessage(message);
  }

  // Listen for messages from extension
  public onMessage(handler: (message: ExtensionToWebviewMessage) => void): () => void {
    this.addMessageHandler(handler);
    return () => this.removeMessageHandler(handler);
  }

  private addMessageHandler(handler: (message: any) => void): void {
    this.messageHandlers.push(handler);
  }

  private removeMessageHandler(handler: (message: any) => void): void {
    const index = this.messageHandlers.indexOf(handler);
    if (index > -1) {
      this.messageHandlers.splice(index, 1);
    }
  }

  // State management
  public getState(): unknown {
    return this.vscode.getState();
  }

  public setState(state: unknown): void {
    this.vscode.setState(state);
  }
}


