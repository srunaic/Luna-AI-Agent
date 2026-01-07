/** Luna Chat Input */
import { useEffect, useRef, useState } from 'react';
import { EditorContext } from '../types/protocol';
import './ChatInput.css';

interface ChatInputProps {
  onExecute: (instruction: string, model: string) => Promise<void>;
  onCancel: () => void;
  onClear: () => void;
  isExecuting: boolean;
  editorContext: EditorContext | null;
  onModelChange: (model: string) => void;
}

export function ChatInput({ onExecute, onCancel, onClear, isExecuting, editorContext, onModelChange }: ChatInputProps) {
  const [instruction, setInstruction] = useState('');
  const [model, setModel] = useState('luna-soul');
  const [isRecording, setIsRecording] = useState(false);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const recognitionRef = useRef<any>(null);

  useEffect(() => {
    // Optional speech recognition (browser dependent)
    const SpeechRecognition = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
    if (!SpeechRecognition) return;

    const recognition = new SpeechRecognition();
    recognition.continuous = true;
    recognition.interimResults = true;
    recognition.lang = 'ko-KR';

    recognition.onresult = (event: any) => {
      let finalTranscript = '';
      for (let i = event.resultIndex; i < event.results.length; ++i) {
        if (event.results[i].isFinal) {
          finalTranscript += event.results[i][0].transcript;
        }
      }
      if (finalTranscript) {
        setInstruction((prev) => prev + (prev ? ' ' : '') + finalTranscript);
      }
    };

    recognition.onerror = (event: any) => {
      console.error('Speech recognition error:', event?.error);
      setIsRecording(false);
    };

    recognition.onend = () => {
      setIsRecording(false);
    };

    recognitionRef.current = recognition;
  }, []);

  const toggleRecording = () => {
    const rec = recognitionRef.current;
    if (!rec) {
      alert('Speech recognition is not available in this environment.');
      return;
    }

    if (isRecording) {
      rec.stop();
    } else {
      try {
        rec.start();
        setIsRecording(true);
      } catch (e) {
        console.error('Failed to start recognition:', e);
      }
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!instruction.trim() || isExecuting) return;
    await onExecute(instruction.trim(), model);
    setInstruction('');
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      void handleSubmit(e);
    }
  };

  useEffect(() => {
    if (textareaRef.current) {
      textareaRef.current.style.height = 'auto';
      textareaRef.current.style.height = `${textareaRef.current.scrollHeight}px`;
    }
  }, [instruction]);

  const getContextHint = () => {
    if (!editorContext) return null;
    const hints: string[] = [];
    if (editorContext.activeFile) {
      const fileName = editorContext.activeFile.split(/[/\\]/).pop();
      if (fileName) hints.push(`File: ${fileName}`);
    }
    if (editorContext.selection) hints.push('Selected');
    return hints.length > 0 ? hints.join(' ??') : null;
  };

  return (
    <div className="chat-input-section component-section">
      <div className="input-header-row" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '8px', gap: '10px' }}>
        <div className="model-selector-container" style={{ flex: 1, margin: 0 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px', width: '100%' }}>
            <label htmlFor="model-select">Model:</label>
            <select
              id="model-select"
              value={model}
              onChange={(e) => {
                const next = e.target.value;
                setModel(next);
                onModelChange(next);
              }}
              disabled={isExecuting}
              className="model-select"
            >
              <option value="luna-soul">Luna Soul</option>
              <option value="vllm">vLLM High Speed</option>
              <option value="gpt-4o">GPT-4o</option>
              <option value="gpt-3.5-turbo">GPT-3.5 Turbo</option>
            </select>
            <button type="button" className="clear-button" onClick={onClear} disabled={isExecuting} title="Clear chat">
              Clear
            </button>
          </div>
        </div>
      </div>

      {getContextHint() && <div className="context-hint">{getContextHint()}</div>}

      <form onSubmit={handleSubmit} className="chat-form">
        <div className="input-container">
          <textarea
            ref={textareaRef}
            value={instruction}
            onChange={(e) => setInstruction(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="Ask Luna anything..."
            disabled={isExecuting}
            rows={1}
            className="instruction-input"
          />

          <div className="input-actions">
            <button
              type="button"
              className={`voice-button ${isRecording ? 'recording' : ''}`}
              onClick={toggleRecording}
              title={isRecording ? 'Listening...' : 'Voice Input (ko-KR)'}
              disabled={isExecuting}
            >
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z" />
                <path d="M19 10v2a7 7 0 0 1-14 0v-2" />
                <line x1="12" y1="19" x2="12" y2="23" />
                <line x1="8" y1="23" x2="16" y2="23" />
              </svg>
            </button>
            <div style={{ width: '8px' }} />
            {isExecuting ? (
              <button type="button" onClick={onCancel} className="cancel-button">Cancel</button>
            ) : (
              <button type="submit" disabled={!instruction.trim()} className="execute-button">Chat</button>
            )}
          </div>
        </div>
      </form>
    </div>
  );
}
