import * as vscode from 'vscode';
import { WebviewToExtensionMessage, ExtensionToWebviewMessage, EditorContext } from '../agent/protocol';

// Webview-side bridge for communication with extension
// This file runs in the webview context (browser environment)

export class WebviewBridge {
  private vscode: any;
  private messageHandlers: ((message: any) => void)[] = [];

  constructor() {
    // VSCode API is injected by the webview
    this.vscode = (globalThis as any).vscode;
    if (!this.vscode) {
      console.warn('VSCode API not available - running in development mode');
      this.vscode = {
        postMessage: (msg: any) => console.log('Posting message:', msg),
        getState: () => null,
        setState: (state: any) => console.log('Setting state:', state)
      };
    }
  }

  // Send messages to extension
  public getEditorContext(): Promise<any> {
    return new Promise((resolve) => {
      const message = {
        type: 'get_editor_context'
      };

      const handler = (response: any) => {
        if (response.type === 'editor_context') {
          this.removeMessageHandler(handler);
          resolve(response.data);
        }
      };

      this.addMessageHandler(handler);
      this.vscode.postMessage(message);
    });
  }

  public executeTask(instruction: string, context?: any): Promise<string> {
    return new Promise((resolve, reject) => {
      const taskId = `task_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;

      const message = {
        type: 'execute_task',
        data: {
          taskId,
          instruction,
          context
        }
      };

      const handler = (response: any) => {
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

  public cancelTask(taskId: string): void {
    const message = {
      type: 'cancel_task',
      data: { taskId }
    };
    this.vscode.postMessage(message);
  }

  // Listen for messages from extension
  public onMessage(handler: (message: any) => void): () => void {
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

// Singleton instance
let bridgeInstance: WebviewBridge | null = null;

export function getBridge(): WebviewBridge {
  if (!bridgeInstance) {
    bridgeInstance = new WebviewBridge();
  }
  return bridgeInstance;
}
