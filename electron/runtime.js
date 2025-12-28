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

        try {
            // [FAST PATH] 만약 단순한 질문이거나 대화라면 복잡한 에이전트 추론 루프를 건너뛰고 즉시 스트리밍합니다.
            const isComplexTask = instruction.includes('파일') || instruction.includes('코드') || instruction.includes('터미널') || instruction.length > 100;

            if (!isComplexTask) {
                onResponse({ type: 'status', data: { state: 'thinking', message: '', isPartial: true, taskId: context.taskId } });
                let fullText = "";
                if (model === 'ollama') {
                    fullText = await this.callOllama(instruction, context, onResponse, true); // directMode: true
                } else {
                    fullText = await this.callOpenAI(instruction, context, onResponse);
                }
                onResponse({ type: 'done', data: { success: true, message: fullText, taskId: context.taskId } });
                return;
            }

            // [AGENT PATH] 복잡한 작업인 경우에만 도구 사용 루프를 실행합니다.
            let turn = 0;
            let maxTurns = 5;
            let history = [];

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
                const toolMatch = responseText.match(/TOOL:\s*(\w+)\s*\nINPUT:\s*([\s\S]+?)(?=\n(?:THOUGHT|TOOL|ANSWER):|$)/i);
                const answerMatch = responseText.match(/ANSWER:\s*([\s\S]+)/i);

                if (toolMatch) {
                    const toolName = toolMatch[1].trim();
                    const toolInput = toolMatch[2].trim().replace(/^```\w*\n?/, '').replace(/\n?```$/, '');

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
        const fs = require('fs');
        const path = require('path');
        const root = context.projectRoot || process.cwd();

        switch (name) {
            case 'terminal_run':
                const { execSync } = require('child_process');
                return execSync(input, { encoding: 'utf8', cwd: root });
            case 'read_file':
                return fs.readFileSync(path.resolve(root, input), 'utf8');
            case 'write_file':
                // input format might be "path\ncontent" if the LLM is simplistic, 
                // but we prefer "path" and use the remaining as content.
                // For robustness, we check for a first line as path.
                const firstNewLine = input.indexOf('\n');
                if (firstNewLine === -1) throw new Error("write_file requires path followed by content on a new line.");
                const filePath = input.substring(0, firstNewLine).trim();
                const content = input.substring(firstNewLine + 1);
                fs.writeFileSync(path.resolve(root, filePath), content, 'utf8');
                return `Successfully wrote to ${filePath}`;
            case 'list_dir':
                const dirPath = path.resolve(root, input || '.');
                const files = fs.readdirSync(dirPath);
                return files.map(f => {
                    const stats = fs.statSync(path.join(dirPath, f));
                    return `[${stats.isDirectory() ? 'DIR' : 'FILE'}] ${f}`;
                }).join('\n');
            case 'web_search':
                return `Search results for "${input}": [Luna is integrating real-time search...]`;
            default:
                throw new Error(`Unknown tool: ${name}`);
        }
    }

    async callOllama(instruction, context, onResponse, directMode = false) {
        const prompt = directMode ? instruction : this.buildPrompt(instruction, context);

        return new Promise((resolve, reject) => {
            const cfg = context?.llmSettings?.ollama || { host: 'localhost', port: 11434, protocol: 'http' };
            const rawHost = String(cfg.host || 'localhost').trim();
            const host = rawHost.toLowerCase() === 'localhost' ? '127.0.0.1' : rawHost;
            const port = Number(cfg.port || 11434);
            const protocol = (cfg.protocol === 'https') ? 'https' : 'http';
            const modelName = String(cfg.model || 'llama3');
            const numPredict = Number(cfg.numPredict || 1024); // Increased for reasoning
            const temperature = Number(cfg.temperature ?? 0.1);

            const payload = {
                model: modelName,
                prompt: prompt,
                stream: true,
                options: {
                    num_predict: numPredict,
                    temperature,
                    num_ctx: 2048, // Slightly increased for protocol stability
                    top_k: 10,
                    top_p: 0.5,
                    repeat_penalty: 1.1
                },
                keep_alive: "5m"
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
                if (res.statusCode < 200 || res.statusCode >= 300) {
                    let body = '';
                    res.on('data', (chunk) => body += chunk);
                    res.on('end', () => {
                        let errMsg = `Ollama HTTP ${res.statusCode}: ${body}`;
                        if (res.statusCode === 500 && body.includes('runner')) {
                            errMsg = "Ollama가 모델을 로드하지 못했습니다. (메모리 부족 또는 서버 오류). Ollama를 재시작하거나 더 가벼운 모델을 사용해 보세요.";
                        }
                        reject(new Error(errMsg));
                    });
                    return;
                }

                let fullText = "";
                let buffer = "";
                let firstToken = true;

                res.on('data', (chunk) => {
                    if (firstToken) {
                        onResponse({
                            type: 'status',
                            data: { state: 'typing', message: '', isPartial: true, taskId: context.taskId }
                        });
                        firstToken = false;
                    }

                    buffer += chunk.toString();

                    let boundary = buffer.indexOf('}');
                    while (boundary !== -1) {
                        const jsonStr = buffer.substring(0, boundary + 1);
                        buffer = buffer.substring(boundary + 1);

                        try {
                            const json = JSON.parse(jsonStr);
                            if (json.response) {
                                fullText += json.response;
                                if (onResponse) {
                                    onResponse({
                                        type: 'status',
                                        data: { state: 'typing', message: fullText, isPartial: true, taskId: context.taskId }
                                    });
                                }
                            }
                            if (json.done) {
                                resolve(fullText);
                                return;
                            }
                        } catch (e) { }
                        boundary = buffer.indexOf('}');
                    }
                });

                res.on('end', () => resolve(fullText));
            });

            req.on('error', (e) => reject(new Error(`Ollama connection failed: ${e.message}`)));

            // 타임아웃 설정 (60초 동안 아무 응답이 없으면 연결 종료)
            req.setTimeout(60000, () => {
                req.destroy();
                reject(new Error("Ollama 응답 타임아웃 (60초). 서버가 너무 느리거나 모델 로드에 실패했습니다. Ollama를 재시작해 보세요."));
            });

            req.write(data);
            req.end();
        });
    }

    async callOpenAI(instruction, context, onResponse) {
        return "OpenAI integration requires an API key. Please configure it in Settings (Coming soon). For now, use Ollama for local AI.";
    }

    buildPrompt(instruction, context) {
        const fileContext = context.activeFile ? `Active File: ${context.activeFile}\n` : "";
        const selectionContext = context.selectedText ? `Selected Code:\n\`\`\`\n${context.selectedText}\n\`\`\`\n` : "";
        const projectContext = context.projectRoot ? `Project Root: ${context.projectRoot}\n` : "";
        const historyText = context.history?.length > 0 ? `Conversation History:\n${context.history.map(h => `${h.role}: ${h.content}`).join('\n')}\n` : "";

        const systemInstructions = context.llmSettings?.systemInstructions
            ? `[USER SYSTEM INSTRUCTIONS]\n${context.llmSettings.systemInstructions}\n`
            : "";

        return `You are Luna, a high-performance AI Agent and Orchestrator. 
Your goal is to execute the user's request with precision and systemic thinking.

${systemInstructions}
[MASTER PROTOCOL]
1. ANALYZE: Understand the core objective and constraints.
2. PLAN: Mentally map out the steps needed (e.g., list files -> read content -> modify -> verify).
3. ACT: Use one tool at a time. Do not assume outcomes.
4. REVISE: If a tool fails or provides unexpected data, adjust your plan.

[CONTEXT]
${projectContext}${fileContext}${selectionContext}
${historyText}

[USER REQUEST]
${instruction}

[AVAILABLE TOOLS]
1. list_dir(path): Lists files in a directory. Use "." for project root.
2. read_file(path): Reads text content from a file.
3. write_file(path\\ncontent): Writes or overwrites a file. Format: relative_path, newline, then full content.
4. terminal_run(command): Executes a PowerShell command.
5. web_search(query): Searches for technical info.

[RESPONSE FORMAT]
To use a tool:
THOUGHT: (Briefly explain your next step and reasoning)
TOOL: tool_name
INPUT: tool_input (No code blocks unless it's part of the file content)

To give the final answer:
THOUGHT: (Summary of actions taken)
ANSWER: (Final response to the user in their language)

[RULES]
- Stay in character as Luna.
- Be concise but thorough.
- ALWAYS use THOUGHT before any TOOL or ANSWER.
- If you are writing code, ensure it is production-ready.`;
    }

    delay(ms) {
        return new Promise(resolve => setTimeout(resolve, ms));
    }
}

module.exports = { AgentRuntime };
