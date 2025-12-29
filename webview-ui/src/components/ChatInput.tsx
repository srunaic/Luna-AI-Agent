import { useState, useRef, useEffect } from 'react';
import './ChatInput.css';

export function ChatInput({ onExecute, onCancel, isExecuting, editorContext, onModelChange }: any) {
  const [instruction, setInstruction] = useState('');
  const [isRecording, setIsRecording] = useState(false);
  const recognitionRef = useRef<any>(null);

  useEffect(() => {
    const SpeechRecognition = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
    if (SpeechRecognition) {
      const recognition = new SpeechRecognition();
      recognition.continuous = true;
      recognition.lang = 'ko-KR';
      recognition.onresult = (event: any) => {
        const transcript = Array.from(event.results).map((result: any) => result[0].transcript).join('');
        setInstruction(transcript);
      };
      recognition.onend = () => setIsRecording(false);
      recognitionRef.current = recognition;
    }
  }, []);

  const toggleRecording = () => {
    if (!recognitionRef.current) return alert('??? ??? ?????);
    if (isRecording) { recognitionRef.current.stop(); }
    else { recognitionRef.current.start(); setIsRecording(true); }
  };

  return (
    <div className="chat-input-section">
      <form onSubmit={(e) => { e.preventDefault(); onExecute(instruction, 'luna-soul'); setInstruction(''); }}>
        <div className="input-container">
          <textarea value={instruction} onChange={(e) => setInstruction(e.target.value)} placeholder="Ask Luna..." />
          <div className="input-actions">
            <button type="button" className={oice-button \} onClick={toggleRecording}>
              <svg width="20" height="20" viewBox="0 0 24 24"><path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z" fill={isRecording ? "red" : "currentColor"}/><path d="M19 10v2a7 7 0 0 1-14 0v-2"/><line x1="12" y1="19" x2="12" y2="23"/><line x1="8" y1="23" x2="16" y2="23"/></svg>
            </button>
            <button type="submit">Chat</button>
          </div>
        </div>
      </form>
    </div>
  );
}