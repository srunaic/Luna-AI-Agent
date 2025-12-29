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
    // Initialize Speech Recognition
    const SpeechRecognition = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
    if (SpeechRecognition) {
      const recognition = new SpeechRecognition();
      recognition.continuous = true;
      recognition.interimResults = true;
      recognition.lang = 'ko-KR'; // 湲곕낯 ?쒓뎅???ㅼ젙

      recognition.onresult = (event: any) => {
        let interimTranscript = '';
        let finalTranscript = '';

        for (let i = event.resultIndex; i < event.results.length; ++i) {
          if (event.results[i].isFinal) {
            finalTranscript += event.results[i][0].transcript;
          } else {
            interimTranscript += event.results[i][0].transcript;
          }
        }

        if (finalTranscript) {
          setInstruction(prev => prev + (prev ? ' ' : '') + finalTranscript);
        }
      };

      recognition.onerror = (event: any) => {
        console.error('Speech recognition error:', event.error);
        setIsRecording(false);
      };

      recognition.onend = () => {
        setIsRecording(false);
      };

      recognitionRef.current = recognition;
    }
  }, []);

  const toggleRecording = () => {
    if (!recognitionRef.current) {
      alert('??釉뚮씪?곗??먯꽌???뚯꽦 ?몄떇??吏?먰븯吏 ?딄굅??留덉씠??沅뚰븳??嫄곕??섏뿀?듬땲??');
      return;
    }

    if (isRecording) {
      recognitionRef.current.stop();
    } else {
      try {
        recognitionRef.current.start();
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
      handleSubmit(e);
    }
  };

  useEffect(() => {
    if (textareaRef.current) {
      textareaRef.current.style.height = 'auto';
      textareaRef.current.style.height = ${textareaRef.current.scrollHeight}px;
    }
  }, [instruction]);

  const getContextHint = () => {
    if (!editorContext) return null;
    const hints = [];
    if (editorContext.activeFile) {
      const fileName = editorContext.activeFile.split(/[/\\]/).pop();
      hints.push(File: );
    }
    if (editorContext.selection) hints.push('Selected');
    return hints.length > 0 ? hints.join(' ??') : null;
  };

  return (
    <div className="chat-input-section component-section">
      <div className="model-selector-container">
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
      </div>

      {getContextHint() && (
        <div className="context-hint">
          {getContextHint()}
        </div>
      )}

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
            {/* 留덉씠??踰꾪듉???낅젰? 諛붾줈 ???≪뀡 ?곸뿭?쇰줈 ?대룞?섏뿬 媛?쒖꽦 諛??묎렐??洹밸???*/}
            <button
              type="button"
              className={oice-button }
              onClick={toggleRecording}
              title={isRecording ? 'Listening...' : 'Voice Input (Korean)'}
              disabled={isExecuting}
            >
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z" fill={isRecording ? "#ff4d4d" : "currentColor"} />
                <path d="M19 10v2a7 7 0 0 1-14 0v-2" />
                <line x1="12" y1="19" x2="12" y2="23" />
                <line x1="8" y1="23" x2="16" y2="23" />
              </svg>
            </button>
            <div style={{ width: '8px' }}></div>
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
