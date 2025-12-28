import { AgentState } from '../types/protocol';
import './StatusBar.css';

interface StatusBarProps {
  status: AgentState;
  llmConnected: boolean;
  llmProvider: string | null;
  update: {
    state: 'idle' | 'checking' | 'available' | 'none' | 'downloading' | 'downloaded' | 'error';
    progress?: {
      percent?: number;
      bytesPerSecond?: number;
      transferred?: number;
      total?: number;
    };
    message?: string;
  };
}

export function StatusBar({ status, llmConnected, llmProvider, update }: StatusBarProps) {
  const getStatusInfo = (status: AgentState) => {
    switch (status) {
      case 'idle':
        return {
          icon: '●',
          text: llmConnected
            ? `Ready (${(llmProvider || 'LLM')} connected)`
            : `Ready (${(llmProvider || 'LLM')} disconnected)`,
          color: llmConnected ? '#0e7a0d' : '#6c6c6c'
        };
      case 'thinking':
        return {
          icon: '🧠',
          text: 'Thinking...',
          color: '#007acc',
          animate: true
        };
      case 'planning':
        return {
          icon: '📋',
          text: 'Planning...',
          color: '#0e7a0d',
          animate: true
        };
      case 'executing':
        return {
          icon: '⚙️',
          text: 'Executing...',
          color: '#007acc',
          animate: true
        };
      case 'editing':
        return {
          icon: '✏️',
          text: 'Editing...',
          color: '#d13438'
        };
      case 'running':
        return {
          icon: '▶️',
          text: 'Running...',
          color: '#0e7a0d',
          animate: true
        };
      case 'failed':
        return {
          icon: '❌',
          text: 'Failed',
          color: '#d13438'
        };
      default:
        return {
          icon: '●',
          text: 'Unknown',
          color: '#6c6c6c'
        };
    }
  };

  const getUpdateInfo = () => {
    switch (update.state) {
      case 'checking':
        return { text: 'Checking updates…', color: '#007acc' as const, animate: true };
      case 'available':
        return { text: 'Update available…', color: '#d29922' as const, animate: true };
      case 'downloading': {
        const pct = typeof update.progress?.percent === 'number' ? Math.round(update.progress.percent) : null;
        return { text: pct !== null ? `Downloading… ${pct}%` : 'Downloading…', color: '#007acc' as const, animate: true };
      }
      case 'downloaded':
        return { text: 'Update ready (restart)', color: '#0e7a0d' as const, animate: false };
      case 'error':
        return { text: update.message ? `Update error: ${update.message}` : 'Update error', color: '#d13438' as const, animate: false };
      case 'none':
      case 'idle':
      default:
        return null;
    }
  };

  const statusInfo = getStatusInfo(status);
  const updateInfo = getUpdateInfo();

  return (
    <div className="status-bar">
      <div className={`status-indicator ${statusInfo.animate ? 'animate-pulse' : ''}`}>
        <span className="status-icon" style={{ color: statusInfo.color }}>
          {statusInfo.icon}
        </span>
        <span className="status-text" style={{ color: statusInfo.color }}>
          {statusInfo.text}
        </span>
      </div>

      {updateInfo && (
        <div className={`update-indicator ${updateInfo.animate ? 'animate-pulse' : ''}`}>
          <span className="update-dot" style={{ backgroundColor: updateInfo.color }} />
          <span className="update-text" style={{ color: updateInfo.color }}>
            {updateInfo.text}
          </span>
        </div>
      )}
    </div>
  );
}
