// Luna Agent Runtime - Phase 1: Real Brain Integration
const http = require('http');
const https = require('https');

class AgentRuntime {
    constructor() {
        this.isRunning = false;
    }

    async processRequest(request, onResponse) {
        if (this.isRunning) return;
        this.isRunning = true;

        const { instruction, context } = request;
        const model = context.model || 'ollama';

        let turn = 0;
        let maxTurns = 5;
        let history = [];

        try {
            while (turn < maxTurns) {
                turn++;
                onResponse({
                    type: 'status',
                    data: { state: 'thinking', message: `Orchestrating (Turn ${turn})...`, taskId: context.taskId }
                });

                let responseText = "";
                if (model === 'ollama') {
                    responseText = await this.callOllama(instruction, { ...context, history }, onResponse);
                } else {
                    responseText = await this.callOpenAI(instruction, { ...context, history }, onResponse);
                }

                // Parse Thought/Tool/Answer
                const toolMatch = responseText.match(/TOOL:\s*(\w+)\nINPUT:\s*([\s\S]+)/i);
                const answerMatch = responseText.match(/ANSWER:\s*([\s\S]+)/i);

                if (toolMatch) {
                    const toolName = toolMatch[1].trim();
                    const toolInput = toolMatch[2].trim();

                    onResponse({
                        type: 'status',
                        data: { state: 'executing', message: `Using tool: ${toolName}...`, taskId: context.taskId }
                    });

                    // Execute tool
                    let toolResult = "";
                    try {
                        toolResult = await this.executeTool(toolName, toolInput, context);
                    } catch (e) {
                        toolResult = `Error: ${e.message}`;
                    }

                    onResponse({
                        type: 'action',
                        data: { 
                            tool: toolName, 
                            input: toolInput, 
                            result: toolResult,
                            taskId: context.taskId 
                        }
                    });

                    history.push({ role: 'assistant', content: responseText });
                    history.push({ role: 'system', content: `TOOL_RESULT: ${toolResult}` });
                    
                    // Continue loop
                    continue;
                } 

                if (answerMatch || responseText) {
                    const finalAnswer = answerMatch ? answerMatch[1].trim() : responseText;
                    onResponse({
                        type: 'done',
                        data: { success: true, message: finalAnswer, taskId: context.taskId }
                    });
                    break;
                }
            }
        } catch (error) {
            onResponse({
                type: 'done',
                data: { success: false, message: `Orchestration Error: ${error.message}`, taskId: context.taskId }
            });
        } finally {
            this.isRunning = false;
        }
    }

    async executeTool(name, input, context) {
        switch (name) {
            case 'terminal_run':
                const { execSync } = require('child_process');
                return execSync(input, { encoding: 'utf8', cwd: context.projectRoot || process.cwd() });
            case 'read_file':
                const fs = require('fs');
                return fs.readFileSync(input, 'utf8');
            case 'web_search':
                // Placeholder for real web search
                return `Search results for "${input}": [Luna is integrating real-time search...]`;
            default:
                throw new Error(`Unknown tool: ${name}`);
        }
    }

    async callOllama(instruction, context, onResponse) {
        const prompt = this.buildPrompt(instruction, context);
        
        return new Promise((resolve, reject) => {
            const cfg = context?.llmSettings?.ollama || { host: 'localhost', port: 11434, protocol: 'http' };
            const rawHost = String(cfg.host || 'localhost').trim();
            // Windows에서 localhost가 ::1로 해석되면 Ollama가 127.0.0.1만 리슨할 때 ECONNREFUSED 발생 가능
            const host = rawHost.toLowerCase() === 'localhost' ? '127.0.0.1' : rawHost;
            const port = Number(cfg.port || 11434);
            const protocol = (cfg.protocol === 'https') ? 'https' : 'http';
            const modelName = String(cfg.model || 'llama3');
            const numPredict = Number(cfg.numPredict || 256);
            const temperature = Number(cfg.temperature ?? 0.2);

            const payload = {
                model: modelName,
                prompt: prompt,
                stream: true,
                options: {
                    num_predict: numPredict,
                    temperature
                }
            };
            const data = JSON.stringify(payload);
            const dataBytes = Buffer.byteLength(data, 'utf8');

            const options = {
                hostname: host,
                port,
                path: '/api/generate',
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Content-Length': dataBytes
                }
            };

            const client = protocol === 'https' ? https : http;
            const req = client.request(options, (res) => {
                let fullText = "";
                
                if (res.statusCode < 200 || res.statusCode >= 300) {
                    let body = '';
                    res.on('data', (chunk) => body += chunk);
                    res.on('end', () => {
                        reject(new Error(`Ollama HTTP ${res.statusCode}: ${body || 'Unknown error'}`));
                    });
                    return;
                }

                res.on('data', (chunk) => {
                    const lines = chunk.toString().split('\n');
                    for (const line of lines) {
                        if (!line.trim()) continue;
                        try {
                            const parsed = JSON.parse(line);
                            if (parsed.error) {
                                reject(new Error(`Ollama error: ${parsed.error}`));
                                return;
                            }
                            if (parsed.response) {
                                fullText += parsed.response;
                                // Forward partial text to UI
                                onResponse({
                                    type: 'status',
                                    data: { 
                                        state: 'thinking', 
                                        message: fullText,
                                        isPartial: true,
                                        taskId: context.taskId
                                    }
                                });
                            }
                            if (parsed.done) {
                                resolve(fullText);
                            }
                        } catch (e) {
                            // Partials might be invalid JSON, skip
                        }
                    }
                });

                res.on('end', () => {
                    // done should have been handled by parsed.done
                    if (fullText.trim().length === 0) {
                        reject(new Error(`Ollama returned empty response (model: ${modelName}). Try a different model in Settings.`));
                    }
                });
            });

            req.on('error', (e) => {
                reject(new Error(`Ollama connection failed: ${e.message}. Make sure Ollama is running on ${host}:${port}`));
            });

            req.write(data);
            req.end();
        });
    }

    async callOpenAI(instruction, context, onResponse) {
        // Placeholder for OpenAI - in Phase 1, we expect user to provide API key in settings
        return "OpenAI integration requires an API key. Please configure it in Settings (Coming soon). For now, use Ollama for local AI.";
    }

    buildPrompt(instruction, context) {
        const fileContext = context.activeFile ? `Active File: ${context.activeFile}\n` : "";
        const selectionContext = context.selectedText ? `Selected Code:\n\`\`\`\n${context.selectedText}\n\`\`\`\n` : "";
        const projectContext = context.projectRoot ? `Project Root: ${context.projectRoot}\n` : "";
        const historyText = context.history?.length > 0 ? `Conversation History:\n${context.history.map(h => `${h.role}: ${h.content}`).join('\n')}\n` : "";
        
        return `You are Luna, an advanced AI Orchestrator. 
Your goal is to solve the user's request by thinking step-by-step and using tools if necessary.

Context:
${projectContext}${fileContext}${selectionContext}

${historyText}
User Instruction: ${instruction}

[Available Tools]
1. web_search(query): Search the web for latest info, documentation, or code samples.
2. terminal_run(command): Run a PowerShell command.
3. read_file(path): Read file content.
4. write_file(path, content): Write or update a file.

[Output Format]
If you need a tool:
THOUGHT: (Your reasoning)
TOOL: tool_name
INPUT: tool_input

If you have the final answer:
THOUGHT: (Final reasoning)
ANSWER: (Your final response to the user)

Rules:
- Be extremely fast and concise.
- Use tools only when you lack information or need to act.
- For code, always provide a complete snippet.`;
    }

    delay(ms) {
        return new Promise(resolve => setTimeout(resolve, ms));
    }
}

module.exports = { AgentRuntime };
