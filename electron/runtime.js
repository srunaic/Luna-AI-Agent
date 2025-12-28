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
            const data = JSON.stringify({
                model: 'llama3', // Default local model
                prompt: prompt,
                stream: false
            });

            const options = {
                hostname: 'localhost',
                port: 11434,
                path: '/api/generate',
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Content-Length': data.length
                }
            };

            const req = http.request(options, (res) => {
                let body = '';
                res.on('data', (chunk) => body += chunk);
                res.on('end', () => {
                    try {
                        const parsed = JSON.parse(body);
                        resolve(parsed.response || "No response from Ollama.");
                    } catch (e) {
                        reject(new Error(`Ollama parse error: ${e.message}. Is Ollama running?`));
                    }
                });
            });

            req.on('error', (e) => {
                reject(new Error(`Ollama connection failed: ${e.message}. Make sure Ollama is running on localhost:11434`));
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

Please provide your response. If you suggest code changes, wrap them in triple backticks.`;
    }

    delay(ms) {
        return new Promise(resolve => setTimeout(resolve, ms));
    }
}

module.exports = { AgentRuntime };
