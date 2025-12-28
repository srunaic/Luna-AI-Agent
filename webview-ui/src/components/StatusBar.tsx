import { AgentState } from '../types/protocol';
import './StatusBar.css';

interface StatusBarProps {
  status: AgentState;
  llmConnected: boolean;
  llmProvider: string | null;
}

export function StatusBar({ status, llmConnected, llmProvider }: StatusBarProps) {
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

  const statusInfo = getStatusInfo(status);

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
    </div>
  );
}
