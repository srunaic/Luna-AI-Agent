import { PlanStep } from '../types/protocol';
import './PlanView.css';

interface PlanViewProps {
  steps: PlanStep[];
}

export function PlanView({ steps }: PlanViewProps) {
  if (steps.length === 0) {
    return (
      <div className="plan-section component-section">
        <h3>Plan</h3>
        <div className="plan-empty">
          No plan available. Enter an instruction to get started.
        </div>
      </div>
    );
  }

  const getStatusIcon = (status: PlanStep['status']) => {
    switch (status) {
      case 'completed':
        return '✓';
      case 'in_progress':
        return '⟳';
      case 'failed':
        return '✗';
      case 'pending':
      default:
        return '○';
    }
  };

  const getStatusClass = (status: PlanStep['status']) => {
    switch (status) {
      case 'completed':
        return 'step-completed';
      case 'in_progress':
        return 'step-in-progress';
      case 'failed':
        return 'step-failed';
      case 'pending':
      default:
        return 'step-pending';
    }
  };

  return (
    <div className="plan-section component-section">
      <h3>Plan</h3>
      <div className="plan-steps">
        {steps.map((step, index) => (
          <div key={step.id} className={`plan-step ${getStatusClass(step.status)}`}>
            <div className="step-header">
              <span className="step-icon">{getStatusIcon(step.status)}</span>
              <span className="step-number">{index + 1}</span>
              <span className="step-title">{step.title}</span>
            </div>
            {step.description && (
              <div className="step-description">{step.description}</div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
