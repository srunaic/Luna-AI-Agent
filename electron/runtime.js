// Luna Agent Runtime - Phase 1: Real Brain Integration (v0.1.28 Build)
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
            // [FAST PATH] 留뚯빟 ?⑥닚??吏덈Ц?닿굅????붾씪硫?蹂듭옟???먯씠?꾪듃 異붾줎 猷⑦봽瑜?嫄대꼫?곌퀬 利됱떆 ?ㅽ듃由щ컢?⑸땲??
            const isComplexTask = instruction.includes('?뚯씪') || instruction.includes('肄붾뱶') || instruction.includes('?곕???) || instruction.includes('遺꾩꽍') || instruction.length > 100;

            if (!isComplexTask) {
                onResponse({ type: 'status', data: { state: 'thinking', message: '', isPartial: true, taskId: context.taskId } });
                let fullText = "";
                if (model === 'ollama' || model === 'luna-soul') {
                    fullText = await this.callLunaCore(instruction, context, onResponse, true); // directMode: true
                } else if (model === 'vllm') {
                    fullText = await this.callVLLM(instruction, context, onResponse, true);
                } else if (model === 'openai') {
                    fullText = await this.callOpenAI(instruction, context, onResponse);
                } else if (model === 'luna-cloud') {
                    fullText = await this.callLunaCloud(instruction, context, onResponse);
                }
                onResponse({ type: 'done', data: { success: true, message: fullText, taskId: context.taskId } });
                return;
            }

            // [AGENT PATH] 蹂듭옟???묒뾽??寃쎌슦?먮쭔 ?꾧뎄 ?ъ슜 猷⑦봽瑜??ㅽ뻾?⑸땲??
            let turn = 0;
            let maxTurns = 5;
            let history = [];

            while (turn < maxTurns) {
                turn++;
                onResponse({
                    type: 'status',
                    data: { state: 'thinking', message: "?? 猷⑤굹媛 遺꾩꽍 以묒엯?덈떎...", taskId: context.taskId }
                });

                let responseText = "";
                if (model === 'ollama' || model === 'luna-soul') {
                    responseText = await this.callLunaCore(instruction, { ...context, history }, onResponse);
                } else if (model === 'vllm') {
                    responseText = await this.callVLLM(instruction, { ...context, history }, onResponse);
                } else if (model === 'openai') {
                    responseText = await this.callOpenAI(instruction, { ...context, history }, onResponse);
                } else if (model === 'luna-cloud') {
                    responseText = await this.callLunaCloud(instruction, { ...context, history }, onResponse);
                }

                const toolMatch = responseText.match(/TOOL:\s*(\w+)\s*\nINPUT:\s*([\s\S]+?)(?=\n(?:THOUGHT|TOOL|ANSWER):|$)/i);
                const answerMatch = responseText.match(/ANSWER:\s*([\s\S]+)/i);

                if (toolMatch) {
                    const toolName = toolMatch[1].trim();
                    const toolInput = toolMatch[2].trim().replace(/^`\w*\n?/, '').replace(/\n?`$/, '');

                    onResponse({
                        type: 'status',
                        data: { state: 'executing', message: "?? ?꾧뎄瑜??ъ슜?섎뒗 以묒엯?덈떎...", taskId: context.taskId }
                    });

                    let toolResult = "";
                    try {
                        toolResult = await this.executeTool(toolName, toolInput, context);
                    } catch (e) {
                        toolResult = "Error: " + e.message;
                    }

                    onResponse({
                        type: 'action',
                        data: { tool: toolName, input: toolInput, result: toolResult, taskId: context.taskId }
                    });

                    history.push({ role: 'assistant', content: responseText });
                    history.push({ role: 'system', content: "TOOL_RESULT: " + toolResult });
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
                data: { success: false, message: "Orchestration Error: " + error.message, taskId: context.taskId }
            });
        } finally {
            this.isRunning = false;
        }
    }

    async executeTool(name, input, context) {
        const fs = require('fs');
        const path = require('path');
        const { exec, spawn } = require('child_process');
        const { promisify } = require('util');
        const execPromise = promisify(exec);
        const { shell } = require('electron');
        const root = context.projectRoot || process.cwd();

        switch (name) {
            case 'open_url':
                const url = input.trim();
                await shell.openExternal(url);
                return "釉뚮씪?곗??먯꽌 URL???댁뿀?듬땲??";
            case 'open_app':
                const appName = input.trim();
                spawn('cmd.exe', ['/c', 'start', '""', appName], { detached: true, stdio: 'ignore', shell: true }).unref();
                return "?깆쓣 ?ㅽ뻾?덉뒿?덈떎.";
            case 'terminal_run':
                try {
                    const { stdout, stderr } = await execPromise(input, { encoding: 'utf8', cwd: root });
                    return "STDOUT:\n" + stdout + "\n\nSTDERR:\n" + stderr;
                } catch (err) {
                    return "?ㅽ뻾 ?ㅽ뙣: " + err.message;
                }
            case 'read_file':
                return fs.readFileSync(path.resolve(root, input), 'utf8');
            case 'write_file':
                const firstNewLine = input.indexOf('\n');
                const filePath = input.substring(0, firstNewLine).trim();
                const content = input.substring(firstNewLine + 1);
                fs.writeFileSync(path.resolve(root, filePath), content, 'utf8');
                return filePath + " ?뚯씪??湲곕줉?덉뒿?덈떎.";
            case 'list_dir':
                const dirPath = path.resolve(root, input || '.');
                return fs.readdirSync(dirPath).join('\n');
            case 'deep_learn':
                return "?숈뒿 ?꾨즺.";
            default:
                throw new Error("?뚮젮吏吏 ?딆? ?꾧뎄: " + name);
        }
    }

    async callLunaCore(instruction, context, onResponse, directMode = false) {
        const prompt = directMode ? instruction : this.buildPrompt(instruction, context);
        return new Promise((resolve, reject) => {
            const cfg = context.llmSettings?.ollama || {};
            const host = "127.0.0.1";
            const port = 11434;
            const modelName = context.model === 'luna-soul' ? 'luna-soul:latest' : 'luna-soul:latest';
            const payload = { model: modelName, prompt: prompt, stream: true, keep_alive: "60m" };
            const data = JSON.stringify(payload);
            const options = { hostname: host, port, path: '/api/generate', method: 'POST', headers: { 'Content-Type': 'application/json' } };
            const req = http.request(options, (res) => {
                let fullText = "";
                let buffer = "";
                res.on('data', (chunk) => {
                    buffer += chunk.toString();
                    let boundary = buffer.indexOf('}');
                    while (boundary !== -1) {
                        const jsonStr = buffer.substring(0, boundary + 1);
                        buffer = buffer.substring(boundary + 1);
                        try {
                            const json = JSON.parse(jsonStr);
                            if (json.response) {
                                fullText += json.response;
                                onResponse({ type: 'status', data: { state: 'typing', message: fullText, isPartial: true, taskId: context.taskId } });
                            }
                            if (json.done) { resolve(fullText); return; }
                        } catch (e) { }
                        boundary = buffer.indexOf('}');
                    }
                });
            });
            req.write(data);
            req.end();
        });
    }

    buildPrompt(instruction, context) {
        return "?뱀떊? Luna Soul?낅땲?? ?쒓뎅?대줈 ?듬??섏꽭??\n\n" + instruction;
    }
}

module.exports = { AgentRuntime };