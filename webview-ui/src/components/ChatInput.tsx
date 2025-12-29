/** Luna Soul Chat Input Component */
import { useState, useRef, useEffect } from 'react';
import { EditorContext } from '../types/protocol';
import './ChatInput.css';

interface ChatInputProps {
  onExecute: (instruction: string, model: string) => Promise<void>;
  onCancel: () => void;
  isExecuting: boolean;
  editorContext: EditorContext | null;
  onModelChange: (model: string) => void;
}

export function ChatInput({ onExecute, onCancel, isExecuting, editorContext, onModelChange }: ChatInputProps) {
  const [instruction, setInstruction] = useState('');
  const [model, setModel] = useState('luna-soul');
  const [isRecording, setIsRecording] = useState(false);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const recognitionRef = useRef<any>(null);

  useEffect(() => {
    const SpeechRecognition = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
    if (SpeechRecognition) {
      const recognition = new SpeechRecognition();
      recognition.continuous = true;
      recognition.interimResults = true;
      recognition.lang = 'ko-KR';
      recognition.onresult = (event: any) => {
        let transcript = '';
        for (let i = event.resultIndex; i < event.results.length; ++i) {
          transcript += event.results[i][0].transcript;
        }
        if (event.results[event.results.length - 1].isFinal) {
          setInstruction(prev => prev + (prev ? ' ' : '') + transcript);
        }
      };
      recognition.onerror = () => setIsRecording(false);
      recognition.onend = () => setIsRecording(false);
      recognitionRef.current = recognition;
    }
  }, []);

  const toggleRecording = () => {
    if (!recognitionRef.current) return alert('留덉씠??吏??遺덇?');
    if (isRecording) { recognitionRef.current.stop(); }
    else { recognitionRef.current.start(); setIsRecording(true); }
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!instruction.trim() || isExecuting) return;
    onExecute(instruction.trim(), model);
    setInstruction('');
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); handleSubmit(e); }
  };

  useEffect(() => {
    if (textareaRef.current) {
      textareaRef.current.style.height = 'auto';
      textareaRef.current.style.height = textareaRef.current.scrollHeight + 'px';
    }
  }, [instruction]);

  const getContextHint = () => {
    if (!editorContext) return null;
    const hints = [];
    if (editorContext.activeFile) hints.push('File: ' + editorContext.activeFile.split(/[\\\/]/).pop());
    if (editorContext.selection) hints.push('Selected');
    return hints.length > 0 ? hints.join(' ??') : null;
  };

  return (
    <div className="chat-input-section component-section">
      <div className="model-selector-container">
        <label htmlFor="model-select">Model:</label>
        <select id="model-select" value={model} onChange={(e) => { setModel(e.target.value); onModelChange(e.target.value); }} disabled={isExecuting} className="model-select">
          <option value="luna-soul">Luna Soul</option>
          <option value="vllm">vLLM High Speed</option>
          <option value="gpt-4o">GPT-4o</option>
          <option value="gpt-3.5-turbo">GPT-3.5 Turbo</option>
        </select>
      </div>
      {getContextHint() && <div className="context-hint">{getContextHint()}</div>}
      <form onSubmit={handleSubmit} className="chat-form">
        <div className="input-container">
          <textarea ref={textareaRef} value={instruction} onChange={(e) => setInstruction(e.target.value)} onKeyDown={handleKeyDown} placeholder="Ask Luna anything..." disabled={isExecuting} rows={1} className="instruction-input" />
          <div className="input-actions">
            <button type="button" className={'voice-button' + (isRecording ? ' recording' : '')} onClick={toggleRecording} title="Voice Input">
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z" fill={isRecording ? "#ff4d4d" : "currentColor"} />
                <path d="M19 10v2a7 7 0 0 1-14 0v-2" /><line x1="12" y1="19" x2="12" y2="23" /><line x1="8" y1="23" x2="16" y2="23" />
              </svg>
            </button>
            <div style={{ width: '8px' }}></div>
            {isExecuting ? <button type="button" onClick={onCancel} className="cancel-button">Cancel</button> : <button type="submit" disabled={!instruction.trim()} className="execute-button">Chat</button>}
          </div>
        </div>
      </form>
    </div>
  );
}
