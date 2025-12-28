import * as vscode from 'vscode';
import { EditorApi } from './editorApi';

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

export class EditorStateManager {
    private editorApi: EditorApi;

    constructor() {
        this.editorApi = new EditorApi();
    }

    public async getCurrentContext(): Promise<EditorContext> {
        const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
        const projectRoot = workspaceFolder?.uri.fsPath || '';

        const openTabs = vscode.window.tabGroups.all
            .flatMap(tg => tg.tabs)
            .filter(tab => tab.input instanceof vscode.TabInputText)
            .map(tab => (tab.input as vscode.TabInputText).uri.fsPath);

        const activeEditor = vscode.window.activeTextEditor;
        let activeFile: string | undefined;
        let cursor: EditorContext['cursor'];
        let selection: EditorContext['selection'];
        let selectedText: string | undefined;

        if (activeEditor) {
            activeFile = activeEditor.document.uri.fsPath;
            cursor = {
                line: activeEditor.selection.active.line,
                character: activeEditor.selection.active.character
            };

            if (!activeEditor.selection.isEmpty) {
                selection = {
                    start: {
                        line: activeEditor.selection.start.line,
                        character: activeEditor.selection.start.character
                    },
                    end: {
                        line: activeEditor.selection.end.line,
                        character: activeEditor.selection.end.character
                    }
                };
                selectedText = activeEditor.document.getText(activeEditor.selection);
            }
        }

        return {
            projectRoot,
            openFiles: openTabs,
            activeFile,
            cursor,
            selection,
            selectedText
        };
    }

    public async applyDiff(filePath: string, diff: string): Promise<void> {
        return this.editorApi.applyDiff(filePath, diff);
    }

    public async runCommand(command: string, cwd?: string): Promise<{ success: boolean; output: string; error?: string }> {
        return this.editorApi.runCommand(command, cwd);
    }

    public async readFile(filePath: string): Promise<string> {
        return this.editorApi.readFile(filePath);
    }

    public async writeFile(filePath: string, content: string): Promise<void> {
        return this.editorApi.writeFile(filePath, content);
    }
}




