import './ChatHistory.css';

export type ChatRole = 'user' | 'assistant' | 'system';

export interface ChatMessage {
  id: string;
  role: ChatRole;
  content: string;
  ts: number;
}

interface ChatHistoryProps {
  messages: ChatMessage[];
}

export function ChatHistory({ messages }: ChatHistoryProps) {
  if (!messages.length) return null;

  return (
    <div className="chat-history component-section">
      <div className="chat-history-title">Chat</div>
      <div className="chat-history-list">
        {messages.map(m => (
          <div key={m.id} className={`chat-msg chat-msg-${m.role}`}>
            <div className="chat-msg-meta">
              <span className="chat-msg-role">{m.role}</span>
              <span className="chat-msg-time">{new Date(m.ts).toLocaleTimeString()}</span>
            </div>
            <div className="chat-msg-content">{m.content}</div>
          </div>
        ))}
      </div>
    </div>
  );
}







