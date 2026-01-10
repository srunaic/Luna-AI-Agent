import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';
import { exec } from 'child_process';
import { promisify } from 'util';

const execAsync = promisify(exec);

export class EditorApi {
    public async applyDiff(filePath: string, diff: string): Promise<void> {
        try {
            const uri = vscode.Uri.file(filePath);
            const document = await vscode.workspace.openTextDocument(uri);
            const editor = await vscode.window.showTextDocument(document);

            // Simple diff application - in a real implementation,
            // you'd use a proper diff library like 'diff' or 'fast-diff'
            const lines = diff.split('\n');
            let currentLine = 0;

            for (const line of lines) {
                if (line.startsWith('+')) {
                    // Insert line
                    const text = line.substring(1);
                    const position = new vscode.Position(currentLine, 0);
                    await editor.edit(editBuilder => {
                        editBuilder.insert(position, text + '\n');
                    });
                    currentLine++;
                } else if (line.startsWith('-')) {
                    // Delete line
                    const range = new vscode.Range(
                        new vscode.Position(currentLine, 0),
                        new vscode.Position(currentLine + 1, 0)
                    );
                    await editor.edit(editBuilder => {
                        editBuilder.delete(range);
                    });
                } else {
                    // Context line
                    currentLine++;
                }
            }

            await document.save();
        } catch (error) {
            throw new Error(`Failed to apply diff: ${error}`);
        }
    }

    public async runCommand(command: string, cwd?: string): Promise<{ success: boolean; output: string; error?: string }> {
        try {
            const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
            const workingDir = cwd || workspaceFolder?.uri.fsPath || process.cwd();

            const { stdout, stderr } = await execAsync(command, { cwd: workingDir });

            return {
                success: true,
                output: stdout,
                error: stderr || undefined
            };
        } catch (error: any) {
            return {
                success: false,
                output: error.stdout || '',
                error: error.stderr || error.message
            };
        }
    }

    public async readFile(filePath: string): Promise<string> {
        try {
            const uri = vscode.Uri.file(filePath);
            const document = await vscode.workspace.openTextDocument(uri);
            return document.getText();
        } catch (error) {
            // Fallback to fs.readFile
            return fs.promises.readFile(filePath, 'utf8');
        }
    }

    public async writeFile(filePath: string, content: string): Promise<void> {
        try {
            const uri = vscode.Uri.file(filePath);
            const document = await vscode.workspace.openTextDocument(uri);
            const editor = await vscode.window.showTextDocument(document);

            const fullRange = new vscode.Range(
                document.positionAt(0),
                document.positionAt(document.getText().length)
            );

            await editor.edit(editBuilder => {
                editBuilder.replace(fullRange, content);
            });

            await document.save();
        } catch (error) {
            // Fallback to fs.writeFile
            await fs.promises.writeFile(filePath, content, 'utf8');
        }
    }

    public async getFileTree(rootPath: string): Promise<any[]> {
        const result: any[] = [];

        const readDir = async (dirPath: string, relativePath: string = '') => {
            const entries = await fs.promises.readdir(dirPath, { withFileTypes: true });

            for (const entry of entries) {
                if (entry.name.startsWith('.') || entry.name === 'node_modules') {
                    continue;
                }

                const fullPath = path.join(dirPath, entry.name);
                const relPath = path.join(relativePath, entry.name);

                if (entry.isDirectory()) {
                    const children = await readDir(fullPath, relPath);
                    result.push({
                        name: entry.name,
                        type: 'directory',
                        path: relPath,
                        children
                    });
                } else {
                    result.push({
                        name: entry.name,
                        type: 'file',
                        path: relPath
                    });
                }
            }
        };

        await readDir(rootPath);
        return result;
    }
}











































