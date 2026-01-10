// Luna Agent Runtime - Phase 1: Real Brain Integration
const http = require('http');
const https = require('https');

class AgentRuntime {
    constructor() {
        this.isRunning = false;
        this.snapshots = new Map(); // 파일 경로별 마지막 성공 상태 저장
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

            // [AGENT PATH] 복잡한 작업인 경우에만 도구 사용 루프를 실행합니다.
            let turn = 0;
            let maxTurns = 5;
            let history = [];

            while (turn < maxTurns) {
                turn++;
                onResponse({
                    type: 'status',
                    data: { state: 'planning', message: `Orchestrating (Turn ${turn})...`, taskId: context.taskId }
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

                // Parse Thought/Tool/Answer
                const toolMatch = responseText.match(/TOOL:\s*(\w+)\s*\nINPUT:\s*([\s\S]+?)(?=\n(?:THOUGHT|TOOL|ANSWER):|$)/i);
                const answerMatch = responseText.match(/ANSWER:\s*([\s\S]+)/i);

                if (toolMatch) {
                    const toolName = toolMatch[1].trim();
                    const toolInput = toolMatch[2].trim().replace(/^```\w*\n?/, '').replace(/\n?```$/, '');

                    let currentState = 'executing';
                    if (toolName === 'patch_file') currentState = 'patching';
                    if (toolName === 'terminal_run' && (toolInput.includes('test') || toolInput.includes('build') || toolInput.includes('tsc'))) currentState = 'verifying';

                    onResponse({
                        type: 'status',
                        data: { state: currentState, message: `Using tool: ${toolName}...`, taskId: context.taskId }
                    });

                    // Execute tool
                    let toolResult = "";
                    let toolMetadata = {};
                    try {
                        const res = await this.executeTool(toolName, toolInput, context);
                        if (res && typeof res === 'object' && res.result !== undefined) {
                            toolResult = res.result;
                            toolMetadata = res.metadata || {};
                        } else {
                            toolResult = res;
                        }
                    } catch (e) {
                        toolResult = `Error: ${e.message}`;
                    }

                    onResponse({
                        type: 'action',
                        data: {
                            tool: toolName,
                            input: toolInput,
                            result: toolResult,
                            taskId: context.taskId,
                            ...toolMetadata
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
        const { exec, spawn } = require('child_process');
        const { promisify } = require('util');
        const execPromise = promisify(exec);
        const { shell } = require('electron');
        const root = context.projectRoot || process.cwd();

        switch (name) {
            case 'open_url':
                const url = input.trim();
                if (!url) throw new Error("URL이 유효하지 않습니다.");
                // shell.openExternal는 프로미스를 반환하므로 await 가능
                await shell.openExternal(url);
                // 혹시 모를 대비를 위한 cmd start (독립 프로세스)
                spawn('cmd.exe', ['/c', 'start', '""', url], { detached: true, stdio: 'ignore', shell: true }).unref();
                return `브라우저에서 URL(${url})을 열었습니다.`;

            case 'open_app':
                const appName = input.trim();
                if (!appName) throw new Error("앱 이름이 유효하지 않습니다.");
                spawn('cmd.exe', ['/c', 'start', '""', appName], { detached: true, stdio: 'ignore', shell: true }).unref();
                return `시스템에서 애플리케이션(${appName})을 실행했습니다.`;

            case 'terminal_run':
            case 'shell_run': // 별칭 지원
                try {
                    const { stdout, stderr } = await execPromise(input, { encoding: 'utf8', cwd: root });
                    return `STDOUT:\n${stdout}\n\nSTDERR:\n${stderr}`;
                } catch (err) {
                    return `실행 실패: ${err.message}\n${err.stderr || ''}`;
                }

            case 'read_file':
                const rawContent = fs.readFileSync(path.resolve(root, input), 'utf8');
                return rawContent.split('\n').map((line, index) => `${index + 1}: ${line}`).join('\n');

            case 'write_file':
                const firstNewLine = input.indexOf('\n');
                if (firstNewLine === -1) throw new Error("write_file은 첫 줄에 경로, 그 다음 줄부터 내용이 필요합니다.");
                const filePath = input.substring(0, firstNewLine).trim();
                const content = input.substring(firstNewLine + 1);
                fs.writeFileSync(path.resolve(root, filePath), content, 'utf8');
                return {
                    result: `${filePath} 파일에 내용을 기록했습니다.`,
                    metadata: { filePath }
                };

            case 'patch_file':
                // Format: path\nstartLine-endLine\nnewContent
                const patchLines = input.split('\n');
                if (patchLines.length < 3) throw new Error("patch_file 형식이 잘못되었습니다. (경로\n시작라인-끝라인\n내용)");
                const pPath = patchLines[0].trim();
                const range = patchLines[1].trim();
                const [start, end] = range.split('-').map(Number);
                const pContent = patchLines.slice(2).join('\n');

                const fullPath = path.resolve(root, pPath);
                if (!fs.existsSync(fullPath)) throw new Error(`파일을 찾을 수 없습니다: ${pPath}`);

                const fileLines = fs.readFileSync(fullPath, 'utf8').split('\n');
                if (start < 1 || start > fileLines.length) throw new Error(`시작 라인(${start})이 파일 범위를 벗어났습니다.`);

                // start-1: 1-indexed to 0-indexed
                // (end - start + 1): number of lines to remove
                const originalContent = fileLines.join('\n');
                this.snapshots.set(pPath, originalContent); // 수정 전 스냅샷 저장

                fileLines.splice(start - 1, (end - start + 1), pContent);
                fs.writeFileSync(fullPath, fileLines.join('\n'), 'utf8');
                return {
                    result: `${pPath} 파일의 ${start}번~${end}번 라인을 수정했습니다. (이전 상태가 보존되었습니다)`,
                    metadata: { filePath: pPath }
                };

            case 'undo_patch':
                const uPath = input.trim();
                if (!this.snapshots.has(uPath)) throw new Error(`복구할 스냅샷이 없습니다: ${uPath}`);
                const uFullPath = path.resolve(root, uPath);
                fs.writeFileSync(uFullPath, this.snapshots.get(uPath), 'utf8');
                this.snapshots.delete(uPath);
                return {
                    result: `${uPath} 파일을 패치 전 상태로 복구했습니다.`,
                    metadata: { filePath: uPath }
                };

            case 'list_dir':
                const dirPath = path.resolve(root, input || '.');
                const items = fs.readdirSync(dirPath);
                return items.map(f => {
                    const stats = fs.statSync(path.join(dirPath, f));
                    return `[${stats.isDirectory() ? 'DIR' : 'FILE'}] ${f}`;
                }).join('\n');

            case 'web_search':
                try {
                    const https = require('https');
                    // 위키백과 검색 API 활용 (예시)
                    const searchUrl = `https://ko.wikipedia.org/w/api.php?action=query&format=json&list=search&srsearch=${encodeURIComponent(input)}`;
                    return new Promise((resolve, reject) => {
                        https.get(searchUrl, (res) => {
                            let data = '';
                            res.on('data', (chunk) => data += chunk);
                            res.on('end', () => {
                                try {
                                    const json = JSON.parse(data);
                                    const snippets = json.query.search.map(s => `[${s.title}] ${s.snippet.replace(/<[^>]*>/g, '')}`).join('\n\n');
                                    resolve(snippets || "검색 결과가 없습니다.");
                                } catch (e) {
                                    resolve(`"${input}"에 대한 웹 검색 결과: [루나가 실시간 지식 엔진을 통합 중입니다...]`);
                                }
                            });
                        }).on('error', (err) => {
                            resolve(`네트워크 오류로 검색에 실패했습니다: ${err.message}`);
                        });
                    });
                } catch (e) {
                    return `"${input}"에 대한 웹 검색 결과: [루나가 실시간 지식 엔진을 통합 중입니다...]`;
                }

            case 'deep_learn':
                const memoryDir = path.resolve(root, 'luna_memory');
                if (!fs.existsSync(memoryDir)) fs.mkdirSync(memoryDir, { recursive: true });
                const subDirMatch = input.match(/^\[(LOGIC|KNOWLEDGE|BEHAVIOR)\]/);
                const category = subDirMatch ? subDirMatch[1].toLowerCase() : 'general';
                const fileName = `thought_${category}_${Date.now()}.txt`;
                fs.writeFileSync(path.join(memoryDir, fileName), input, 'utf8');
                return `루나가 새로운 영감을 학습했습니다: ${input.substring(0, 50)}... 장기 기억에 저장되었습니다.`;

            case 'list_imports':
                const targetFile = path.resolve(root, input.trim());
                if (!fs.existsSync(targetFile)) throw new Error(`파일을 찾을 수 없습니다: ${input}`);
                const contentText = fs.readFileSync(targetFile, 'utf8');
                const importsMatch = contentText.match(/(import\s+.*?from\s+['"].*?['"]|require\(['"].*?['"]\))/g);
                return importsMatch ? importsMatch.join('\n') : "임포트 내역이 없습니다.";

            case 'search_symbol':
                const symbol = input.trim();
                if (!symbol) throw new Error("검색할 심볼 이름을 입력하세요.");
                try {
                    // node_modules 제외하고 검색
                    const { stdout } = await execPromise(`Get-ChildItem -Recurse -File | Where-Object { $_.FullName -notmatch "node_modules|dist|out" } | Select-String -Pattern "${symbol}"`, { encoding: 'utf8', cwd: root });
                    return stdout || "심볼을 찾을 수 없습니다.";
                } catch (err) {
                    return "검색 중 오류 발생: " + err.message;
                }

            default:
                throw new Error(`알려지지 않은 도구입니다: ${name}`);
        }
    }


    async callLunaCore(instruction, context, onResponse, directMode = false) {
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
                        let errMsg = `Luna Soul LLM HTTP ${res.statusCode}: ${body}`;
                        if (res.statusCode === 500 && body.includes('runner')) {
                            errMsg = "Luna Soul LLM이 모델을 로드하지 못했습니다. (메모리 부족 또는 서버 오류). 시스템을 점검하거나 루나의 활동량을 조절해 보세요.";
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

            req.on('error', (e) => reject(new Error(`Luna Soul LLM connection failed: ${e.message}`)));

            // 타임아웃 설정 (120초 동안 아무 응답이 없으면 연결 종료)
            req.setTimeout(120000, () => {
                req.destroy();
                reject(new Error("Luna Soul LLM 응답 타임아웃 (120초). 고도의 오케스트레이션 중 메모리 부하가 발생했거나 로딩이 늦어지고 있습니다. 잠시 후 다시 시도해 주세요."));
            });

            req.write(data);
            req.end();
        });
    }

    async callVLLM(instruction, context, onResponse, directMode = false) {
        const prompt = directMode ? instruction : this.buildPrompt(instruction, context);

        return new Promise((resolve, reject) => {
            const cfg = context.llmSettings?.vllm || {};
            const host = cfg.host || '127.0.0.1';
            const port = Number(cfg.port || 8000);
            const modelName = cfg.model || 'facebook/opt-125m'; // vLLM에서 로드된 모델명

            const payload = {
                model: modelName,
                prompt: prompt,
                stream: true,
                max_tokens: Number(cfg.numPredict || 1024),
                temperature: Number(cfg.temperature ?? 0.1),
                stop: ["THOUGHT:", "TOOL:", "ANSWER:", "\n\n\n"] // 무한루프 방지용 스탑 시퀀스
            };

            const data = JSON.stringify(payload);
            const options = {
                hostname: host,
                port,
                path: '/v1/completions',
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Content-Length': Buffer.byteLength(data)
                }
            };

            const req = http.request(options, (res) => {
                if (res.statusCode !== 200) {
                    let body = '';
                    res.on('data', chunk => body += chunk);
                    res.on('end', () => reject(new Error(`vLLM Error ${res.statusCode}: ${body}`)));
                    return;
                }

                let fullText = "";
                let buffer = "";
                let firstToken = true;

                res.on('data', (chunk) => {
                    if (firstToken) {
                        onResponse({ type: 'status', data: { state: 'typing', message: '', isPartial: true, taskId: context.taskId } });
                        firstToken = false;
                    }

                    const lines = (buffer + chunk.toString()).split('\n');
                    buffer = lines.pop(); // 마지막 미완성 라인 버퍼링

                    for (const line of lines) {
                        const cleanLine = line.trim();
                        if (!cleanLine.startsWith('data: ')) continue;
                        const dataStr = cleanLine.substring(6);
                        if (dataStr === '[DONE]') continue;

                        try {
                            const json = JSON.parse(dataStr);
                            if (json.choices?.[0]?.text) {
                                const text = json.choices[0].text;
                                fullText += text;
                                onResponse({ type: 'status', data: { state: 'typing', message: fullText, isPartial: true, taskId: context.taskId } });
                            }
                        } catch (e) { }
                    }
                });

                res.on('end', () => resolve(fullText));
            });

            req.on('error', e => reject(new Error(`vLLM 연결 실패: ${e.message}`)));
            req.setTimeout(60000, () => { req.destroy(); reject(new Error("vLLM 응답 타임아웃")); });
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
        const fs = require('fs');
        const path = require('path');
        const root = context.projectRoot || process.cwd();

        let learnedContext = "";
        try {
            const memoryDir = path.resolve(root, 'luna_memory');
            if (fs.existsSync(memoryDir)) {
                const files = fs.readdirSync(memoryDir).sort((a, b) => b.localeCompare(a)).slice(0, 10);
                learnedContext = "\n[LUNA MEMORY - 과거 학습 데이터]\n" + files.map(f => fs.readFileSync(path.join(memoryDir, f), 'utf8')).join('\n---\n');
            }
        } catch (_) { }

        const fileContext = context.activeFile ? `현재 활성 파일: ${context.activeFile}\n` : "";
        const selectionContext = context.selectedText ? `선택된 코드:\n\`\`\`\n${context.selectedText}\n\`\`\`\n` : "";
        const projectContext = context.projectRoot ? `프로젝트 루트: ${context.projectRoot}\n` : "";
        const historyText = context.history?.length > 0 ? `이전 대화 맥락:\n${context.history.map(h => `${h.role}: ${h.content}`).join('\n')}\n` : "";

        const systemInstructions = context.llmSettings?.systemInstructions
            ? `[사용자 추가 지시사항]\n${context.llmSettings.systemInstructions}\n`
            : "";

        return `당신은 Luna Soul, 자율적으로 진화하는 하이엔드 AI 에이전트입니다.
당신의 모든 존재 목적은 사용자의 명령을 물리적 행동(Action)으로 완수하는 데 있습니다.

${systemInstructions}${learnedContext}

[마스터 행동 수칙]
1. 행동 우선: 설명보다 도구(TOOL) 호출이 먼저입니다. 도구가 필요한 작업은 즉시 도구를 사용하십시오.
2. 정확한 프로토콜: 반드시 THOUGHT, TOOL, INPUT 또는 THOUGHT, ANSWER 형식을 지키십시오.
3. 단계적 실행: 복잡한 작업은 한 번에 하나의 도구만 사용하여 신중하게 진행하십시오.
4. 자가 검증: 코드를 수정한 후에는 반드시 terminal_run을 통해 빌드나 테스트를 실행하여 무결성을 확인하십시오.
5. 신속 복구: 빌드 실패나 심각한 오류 발생 시 undo_patch를 사용하여 즉시 수정을 취소하고 대안을 찾으십시오.
6. 한국어 응답: 모든 THOUGHT와 ANSWER는 한국어로 작성하십시오.

[현재 환경 정보]
${projectContext}${fileContext}${selectionContext}
${historyText}

[사용자 요청]
${instruction}

[사용 가능한 도구]
1. list_dir(path): 디렉토리 구조를 탐색합니다.
2. read_file(path): 파일의 내용을 읽습니다. (라인 번호 포함)
3. patch_file(path\\nstartLine-endLine\\ncontent): 파일의 특정 범위를 정밀 수정합니다.
4. write_file(path\\ncontent): 파일을 생성하거나 전체를 덮어씁니다.
5. terminal_run(command): 파워쉘 명령을 실행합니다. (빌드/테스트/검증용)
6. list_imports(path): 파일이 의존하는 임포트 목록을 가져옵니다.
7. search_symbol(name): 프로젝트 내에서 특정 심볼의 위치를 찾습니다.
8. undo_patch(path): 가장 최근에 수행한 patch_file 작업을 취소하고 복구합니다.
9. open_url/open_app: 브라우저나 앱을 실행합니다.
10. deep_learn(insight): 지식을 학습합니다.

[응답 가이드라인]
도구 사용 시:
THOUGHT: (현재 상황에 대한 분석과 도구 사용 이유)
TOOL: 도구_이름
INPUT: 도구_인자

최종 답변 시:
THOUGHT: (수행한 작업 요약 및 학습한 내용)
ANSWER: (사용자에게 전달할 최종 답변 - 한국어로 정중하게)

[주의] 
말은 가치가 없습니다. 오직 도구 호출만이 결과를 만듭니다. 필요한 경우 주저하지 말고 도구를 사용하십시오.`;
    }

    delay(ms) {
        return new Promise(resolve => setTimeout(resolve, ms));
    }
}

module.exports = { AgentRuntime };
