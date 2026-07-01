import React from 'react';

const StepIndicator = ({ steps, current, onStepClick, canNavigateStep }) => {
  const currentLabel = steps[current] || '';
  const progressPercent = steps.length > 1 ? Math.round((current / (steps.length - 1)) * 100) : 100;

  return (
    <div className="wizard-step-shell">
      <div className="wizard-step-head">
        <div>
          <div className="wizard-step-kicker">진행 단계</div>
          <div className="wizard-step-current">{currentLabel}</div>
        </div>
        <div className="wizard-step-count">{current + 1} / {steps.length}</div>
      </div>

      <div className="wizard-step-track" role="tablist" aria-label="업로드 단계">
        {steps.map((step, index) => {
          const isDone = index < current;
          const isActive = index === current;
          const isDisabled = canNavigateStep ? !canNavigateStep(index) : false;
          const className = [
            'wizard-step-button',
            isDone ? 'done' : '',
            isActive ? 'active' : '',
            isDisabled ? 'disabled' : '',
          ].filter(Boolean).join(' ');

          return (
            <React.Fragment key={step}>
              <button
                type="button"
                className={className}
                onClick={() => !isDisabled && onStepClick?.(index)}
                disabled={isDisabled}
                role="tab"
                aria-selected={isActive}
                title={isDisabled ? '이전 필수 단계를 먼저 완료하세요.' : `${step} 단계로 이동`}
              >
                <span className="wizard-step-num">{isDone ? '✓' : index + 1}</span>
                <span className="wizard-step-label">{step}</span>
              </button>
              {index < steps.length - 1 && <span className={`wizard-step-line ${isDone ? 'done' : ''}`} />}
            </React.Fragment>
          );
        })}
      </div>

      <div className="wizard-step-progress" aria-hidden="true">
        <span style={{ width: `${progressPercent}%` }} />
      </div>
    </div>
  );
};

export default StepIndicator;
