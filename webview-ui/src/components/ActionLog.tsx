import { useRef, useEffect } from 'react';
import './ActionLog.css';

interface ActionLogEntry {
  id: string;
  timestamp: Date;
  action: string;
  input: string;
  result: string;
  success: boolean;
}

interface ActionLogProps {
  entries: ActionLogEntry[];
}

export function ActionLog({ entries }: ActionLogProps) {
  const logContainerRef = useRef<HTMLDivElement>(null);

  // Auto-scroll to bottom when new entries are added
  useEffect(() => {
    if (logContainerRef.current) {
      logContainerRef.current.scrollTop = logContainerRef.current.scrollHeight;
    }
  }, [entries]);

  const formatTimestamp = (timestamp: Date) => {
    return timestamp.toLocaleTimeString('en-US', {
      hour12: false,
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit'
    });
  };

  const truncateText = (text: string, maxLength: number = 100) => {
    if (text.length <= maxLength) return text;
    return text.substring(0, maxLength) + '...';
  };

  if (entries.length === 0) {
    return (
      <div className="action-log-section component-section">
        <h3>Action Log</h3>
        <div className="log-empty">
          No actions executed yet.
        </div>
      </div>
    );
  }

  return (
    <div className="action-log-section component-section">
      <h3>Action Log</h3>
      <div className="log-container" ref={logContainerRef}>
        {entries.map((entry) => (
          <div key={entry.id} className={`log-entry ${entry.success ? 'log-success' : 'log-error'}`}>
            <div className="log-header">
              <span className="log-timestamp">{formatTimestamp(entry.timestamp)}</span>
              <span className="log-action">{entry.action}</span>
              <span className={`log-status ${entry.success ? 'status-success' : 'status-error'}`}>
                {entry.success ? '✓' : '✗'}
              </span>
            </div>

            <div className="log-content">
              <div className="log-input">
                <strong>Input:</strong> {truncateText(entry.input)}
              </div>

              {entry.result && (
                <div className="log-result">
                  <strong>Result:</strong> {truncateText(entry.result)}
                </div>
              )}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
