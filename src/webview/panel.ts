import * as vscode from 'vscode';
import * as path from 'path';
import { EditorStateManager } from '../editor/editorState';
import { createAgentClient, AgentClient } from '../agent/agentClient';
import { EditorToAgentMessage, ExtensionToWebviewMessage } from '../agent/protocol';
import { logger } from '../utils/logger';

export class AIPanelProvider {
    private panel: vscode.WebviewPanel | undefined;
    private extensionUri: vscode.Uri;
    private context: vscode.ExtensionContext;
    private editorState: EditorStateManager;
    private agentClient: AgentClient;
    private activeTasks: Map<string, AbortController> = new Map();

    constructor(extensionUri: vscode.Uri, context: vscode.ExtensionContext) {
        this.extensionUri = extensionUri;
        this.context = context;
        this.editorState = new EditorStateManager();
        this.agentClient = createAgentClient();
    }

    public showAIPanel() {
        if (this.panel) {
            this.panel.reveal(vscode.ViewColumn.Beside);
            return;
        }

        this.panel = vscode.window.createWebviewPanel(
            'aiPanel',
            'Luna chat',
            vscode.ViewColumn.Beside,
            {
                enableScripts: true,
                localResourceRoots: [
                    vscode.Uri.joinPath(this.extensionUri, 'webview-ui', 'dist')
                ]
            }
        );

        this.panel.webview.html = this.getWebviewContent();
        this.setupMessageHandlers();
        this.panel.onDidDispose(() => {
            this.panel = undefined;
        });
    }

    private getWebviewContent() {
        const webviewUri = this.panel!.webview.asWebviewUri(
            vscode.Uri.joinPath(this.extensionUri, 'webview-ui', 'dist', 'index.html')
        );

        // For development, we'll serve from a local dev server
        // In production, this would be the built files
        const isDev = process.env.NODE_ENV === 'development';
        const htmlUri = isDev
            ? vscode.Uri.parse('http://localhost:5173')
            : webviewUri;

        return `<!DOCTYPE html>
        <html lang="en">
        <head>
            <meta charset="UTF-8">
            <meta name="viewport" content="width=device-width, initial-scale=1.0">
            <title>Luna chat</title>
            <style>
                body {
                    margin: 0;
                    padding: 0;
                    height: 100vh;
                    overflow: hidden;
                }
                iframe {
                    width: 100%;
                    height: 100%;
                    border: none;
                }
            </style>
        </head>
        <body>
            <iframe src="${htmlUri}"></iframe>
            <script>
                // Bridge for communication between webview and extension
                window.vscode = acquireVsCodeApi();
            </script>
        </body>
        </html>`;
    }

    private setupMessageHandlers() {
        if (!this.panel) return;

        this.panel.webview.onDidReceiveMessage(
            async (message) => {
                switch (message.type) {
                    case 'getEditorContext':
                        const context = await this.editorState.getCurrentContext();
                        this.panel?.webview.postMessage({
                            type: 'editorContext',
                            data: context
                        });
                        break;

                    case 'executeTask':
                        this.handleExecuteTask(message.data);
                        break;

                    case 'cancel_task':
                        this.handleCancelTask(message.data.taskId);
                        break;

                    default:
                        console.log('Unknown message type:', message.type);
                }
            },
            undefined,
            this.context.subscriptions
        );
    }

    private async handleExecuteTask(data: any): Promise<void> {
        const { taskId, instruction, context } = data;

        try {
            const message: EditorToAgentMessage = {
                type: 'task_request',
                taskId,
                instruction,
                editorContext: context
            };

            const abortController = new AbortController();
            this.activeTasks.set(taskId, abortController);

            for await (const response of this.agentClient.executeTask(message)) {
                if (abortController.signal.aborted) {
                    break;
                }

                this.sendToWebview(response);
                logger.info(`Agent response: ${response.type}`, response);
            }
        } catch (error) {
            logger.error('Task execution failed:', error);
            this.sendToWebview({
                type: 'task_complete',
                taskId,
                success: false,
                message: `Task execution failed: ${error}`
            });
        } finally {
            this.activeTasks.delete(taskId);
        }
    }

    private async handleCancelTask(taskId: string): Promise<void> {
        const controller = this.activeTasks.get(taskId);
        if (controller) {
            controller.abort();
            this.activeTasks.delete(taskId);
        }

        try {
            await this.agentClient.cancelTask(taskId);
        } catch (error) {
            logger.error('Failed to cancel task:', error);
        }
    }

    private sendToWebview(message: any): void {
        if (this.panel) {
            this.panel.webview.postMessage(message);
        }
    }

    public dispose() {
        // Cancel all active tasks
        for (const controller of this.activeTasks.values()) {
            controller.abort();
        }
        this.activeTasks.clear();

        if (this.panel) {
            this.panel.dispose();
        }
    }
}
