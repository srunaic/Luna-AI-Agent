import * as vscode from 'vscode';
import { AIPanelProvider } from './webview/panel';

let aiPanelProvider: AIPanelProvider;

export function activate(context: vscode.ExtensionContext) {
    console.log('Cursor-like Agent Editor is now active!');

    // Initialize AI Panel Provider
    aiPanelProvider = new AIPanelProvider(context.extensionUri, context);

    // Register commands
    context.subscriptions.push(
        vscode.commands.registerCommand('cursorLikeAgent.openAIPanel', () => {
            aiPanelProvider.showAIPanel();
        })
    );

    // Auto-open AI Panel on startup
    setTimeout(() => {
        aiPanelProvider.showAIPanel();
    }, 1000);
}

export function deactivate() {
    if (aiPanelProvider) {
        aiPanelProvider.dispose();
    }
}



