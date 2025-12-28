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

        console.log(`Agent Runtime processing with model: ${model}`, request);

        onResponse({
            type: 'status',
            data: { state: 'thinking', message: `Consulting ${model}...` }
        });

        try {
            let responseText = "";
            
            if (model === 'ollama') {
                responseText = await this.callOllama(instruction, context, onResponse);
            } else if (model.startsWith('gpt')) {
                responseText = await this.callOpenAI(instruction, context, onResponse);
            } else {
                throw new Error(`Unsupported model: ${model}`);
            }

            // Phase 1: Logic to detect if the response contains code edits
            if (responseText.includes('```')) {
                onResponse({
                    type: 'status',
                    data: { state: 'editing', message: 'Applying suggested changes...' }
                });
                
                // Simplified edit detection for Phase 1
                const codeMatch = responseText.match(/```(?:\w+)?\n([\s\S]*?)```/);
                if (codeMatch && codeMatch[1]) {
                    onResponse({
                        type: 'action',
                        data: {
                            tool: 'apply_diff',
                            filePath: context.activeFile,
                            newText: codeMatch[1]
                        }
                    });
                }
            }

            onResponse({
                type: 'done',
                data: { 
                    success: true, 
                    message: responseText 
                }
            });

        } catch (error) {
            console.error('Agent Runtime Error:', error);
            onResponse({
                type: 'status',
                data: { state: 'failed', message: `Error: ${error.message}` }
            });
            onResponse({
                type: 'done',
                data: { success: false, message: `Task failed: ${error.message}` }
            });
        } finally {
            this.isRunning = false;
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
                                        isPartial: true
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
        
        return `You are Luna, an AI coding assistant.
Context:
${fileContext}${selectionContext}
User Instruction: ${instruction}

Rules:
- Be concise and actionable.
- If you suggest code changes, wrap ONLY the changed code in triple backticks.
- Do not include hidden chain-of-thought.`;
    }

    delay(ms) {
        return new Promise(resolve => setTimeout(resolve, ms));
    }
}

module.exports = { AgentRuntime };
