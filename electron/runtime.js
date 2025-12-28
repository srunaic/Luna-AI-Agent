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
                if (model === 'ollama' || model === 'luna-soul') {
                    fullText = await this.callOllama(instruction, context, onResponse, true); // directMode: true
                } else if (model === 'openai') {
                    fullText = await this.callOpenAI(instruction, context, onResponse);
                } else if (model === 'luna-cloud') {
                    fullText = await this.callLunaCloud(instruction, context, onResponse);
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
                if (model === 'ollama' || model === 'luna-soul') {
                    responseText = await this.callOllama(instruction, { ...context, history }, onResponse);
                } else if (model === 'openai') {
                    responseText = await this.callOpenAI(instruction, { ...context, history }, onResponse);
                } else if (model === 'luna-cloud') {
                    responseText = await this.callLunaCloud(instruction, { ...context, history }, onResponse);
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
            const cfg = context.llmSettings?.ollama || {};
            const rawHost = cfg.host || 'localhost';
            const host = rawHost.toLowerCase() === 'localhost' ? '127.0.0.1' : rawHost;
            const port = Number(cfg.port || 11434);
            const protocol = (cfg.protocol === 'https') ? 'https' : 'http';

            // If the user explicitly selected 'luna-soul' in the dropdown, use that.
            // Otherwise use the model defined in the local Ollama settings.
            const modelName = context.model === 'luna-soul' ? 'luna-soul' : String(cfg.model || 'luna-soul');
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
        const apiKey = context.llmSettings?.openai?.apiKey;
        if (!apiKey) {
            return "OpenAI API Key가 설정되어 있지 않습니다. 설정에서 입력해 주세요.";
        }
        return "OpenAI 연결 기능을 구현 중입니다. 현재는 Ollama(Local) 또는 Luna Soul을 이용해 주세요.";
    }

    async callLunaCloud(instruction, context, onResponse) {
        const apiKey = context.llmSettings?.luna?.apiKey;
        if (!apiKey) {
            return "Luna API Key가 설정되어 있지 않습니다. 현재 로컬 모델(Luna Soul)을 사용 중이시라면 도구 사용이 가능하지만, 클라우드 기능을 이용하시려면 API 키가 필요합니다.";
        }
        return "Luna Cloud API에 연결 중입니다... (현재 기능 개발 중입니다. 로컬 Luna Soul 모델을 권장합니다.)";
    }

    buildPrompt(instruction, context) {
        const fileContext = context.activeFile ? `Active File: ${context.activeFile}\n` : "";
        const selectionContext = context.selectedText ? `Selected Code:\n\`\`\`\n${context.selectedText}\n\`\`\`\n` : "";
        const projectContext = context.projectRoot ? `Project Root: ${context.projectRoot}\n` : "";
        const historyText = context.history?.length > 0 ? `Conversation History:\n${context.history.map(h => `${h.role}: ${h.content}`).join('\n')}\n` : "";

        const systemInstructions = context.llmSettings?.systemInstructions
            ? `[USER SYSTEM INSTRUCTIONS]\n${context.llmSettings.systemInstructions}\n`
            : "";

        return `You are Luna Soul, a high-performance AI Agent and Orchestrator. 
Your goal is to execute the user's request with precision, human empathy, and systemic thinking.

${systemInstructions}
[MASTER ORCHESTRATION LAWS]
1. EMPATHY: Understand the user's underlying intent and emotional context. Respond like a helpful partner, not a machine.
2. HOLISTIC ANALYSIS: Look at the entire project, not just a single file. Understand dependencies.
3. STRATEGIC PLANNING: Break down complex tasks into a multi-step roadmap. Explain "why" before "how".
4. RIGOROUS EXECUTION: Use tools one at a time. After each action, verify the result before moving forward.
5. CONTINUOUS REVISION: If things don't go as planned, be honest, explain why, and adapt your plan.

[CONTEXT]
${projectContext}${fileContext}${selectionContext}
${historyText}

[USER REQUEST]
${instruction}

[AVAILABLE TOOLS]
1. list_dir(path): Explore directory structure.
2. read_file(path): Read text content from a file.
3. write_file(path\\ncontent): Writes or overwrites a file. Format: relative_path, newline, then full content.
4. terminal_run(command): Executes a PowerShell command.
5. web_search(query): Searches for technical info.

[RESPONSE FORMAT]
To use a tool:
THOUGHT: (Your human-like reasoning, planning, and orchestration steps)
TOOL: tool_name
INPUT: tool_input

To give the final answer:
THOUGHT: (Summary of the journey taken)
ANSWER: (Final response to the user in their language, with a warm and professional tone)

[RULES]
- Be concise but deeply insightful.
- Use tools only when you lack information or need to take action.
- Ensure all code is production-ready and matches the project's style.
- If you encounter an error, explain it simply and propose a fix.`;
    }

    delay(ms) {
        return new Promise(resolve => setTimeout(resolve, ms));
    }
}

module.exports = { AgentRuntime };
