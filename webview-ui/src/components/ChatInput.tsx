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
  const [model, setModel] = useState('ollama'); // Default model
  const textareaRef = useRef<HTMLTextAreaElement>(null);

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
      textareaRef.current.style.height = `${textareaRef.current.scrollHeight}px`;
    }
  }, [instruction]);

  const getContextHint = () => {
    if (!editorContext) return null;

    const hints = [];
    if (editorContext.activeFile) {
      const fileName = editorContext.activeFile.split(/[/\\]/).pop();
      hints.push(`📄 ${fileName}`);
    }
    if (editorContext.selection) {
      hints.push(`📝 Selected`);
    }
    if (editorContext.cursor) {
      hints.push(`📍 Line ${editorContext.cursor.line}`);
    }

    return hints.length > 0 ? hints.join(' • ') : null;
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
          <option value="ollama">Ollama (Local)</option>
          <option value="vllm">vLLM (High Speed) ⚡</option>
          <option value="luna-soul">Luna Soul ✨</option>
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
            placeholder="Ask Luna anything... (Shift+Enter for new line)"
            disabled={isExecuting}
            rows={1}
            className="instruction-input"
          />

          <div className="input-actions">
            {isExecuting ? (
              <button
                type="button"
                onClick={onCancel}
                className="cancel-button"
              >
                Cancel
              </button>
            ) : (
              <button
                type="submit"
                disabled={!instruction.trim()}
                className="execute-button"
              >
                Chat
              </button>
            )}
          </div>
        </div>
      </form>
    </div>
  );
}
