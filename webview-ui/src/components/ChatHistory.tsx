import './ChatHistory.css';

export type ChatRole = 'user' | 'assistant' | 'system';

export interface ChatMessage {
  id: string;
  role: ChatRole;
  content: string;
  ts: number;
  meta?: {
    taskId?: string;
    rlAction?: string;
  };
}

interface ChatHistoryProps {
  messages: ChatMessage[];
  onFeedback?: (taskId: string, reward: number, label: string) => void;
}

export function ChatHistory({ messages, onFeedback }: ChatHistoryProps) {
  if (!messages.length) return null;

  return (
    <div className="chat-history component-section">
      <div className="chat-history-title">Chat</div>
      <div className="chat-history-list">
        {messages.map((m) => (
          <div key={m.id} className={`chat-msg chat-msg-${m.role}`}>
            <div className="chat-msg-meta">
              <span className="chat-msg-role">{m.role}</span>
              <span className="chat-msg-time">{new Date(m.ts).toLocaleTimeString()}</span>
            </div>
            <div className="chat-msg-content">{m.content}</div>

            {m.role === 'assistant' && m.meta?.taskId && onFeedback && (
              <div className="chat-msg-feedback">
                <button className="chat-feedback-btn" onClick={() => onFeedback(m.meta!.taskId!, 1, 'like')} title="Like">
                  Like
                </button>
                <button className="chat-feedback-btn" onClick={() => onFeedback(m.meta!.taskId!, -1, 'dislike')} title="Dislike">
                  Dislike
                </button>
                <button
                  className="chat-feedback-btn chat-feedback-btn-solved"
                  onClick={() => onFeedback(m.meta!.taskId!, 2, 'solved')}
                  title="Solved"
                >
                  Solved
                </button>
                {m.meta?.rlAction && <span className="chat-feedback-meta">RL: {m.meta.rlAction}</span>}
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
