import React from 'react';

const StepIndicator = ({ steps, current }) => (
  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', marginBottom: '40px', padding: '0 20px' }}>
    {steps.map((step, index) => {
      const isDone = index < current;
      const isActive = index === current;

      return (
        <React.Fragment key={step}>
          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '8px', minWidth: '80px' }}>
            <div
              style={{
                width: '40px',
                height: '40px',
                borderRadius: '50%',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                fontSize: '1rem',
                fontWeight: 700,
                transition: 'all 0.3s',
                background: isDone ? '#10b981' : isActive ? '#6366f1' : '#f1f5f9',
                color: isDone || isActive ? 'white' : '#94a3b8',
                boxShadow: isActive ? '0 0 0 4px rgba(99,102,241,0.15)' : 'none',
                border: isDone ? '2px solid #10b981' : isActive ? '2px solid #6366f1' : '2px solid #e2e8f0',
              }}
            >
              {isDone ? '✓' : index + 1}
            </div>
            <span
              style={{
                fontSize: '0.72rem',
                fontWeight: isActive ? 700 : 500,
                color: isActive ? '#6366f1' : isDone ? '#10b981' : '#94a3b8',
                textAlign: 'center',
                whiteSpace: 'nowrap',
              }}
            >
              {step}
            </span>
          </div>
          {index < steps.length - 1 && (
            <div
              style={{
                flex: 1,
                height: '2px',
                margin: '0 4px',
                marginBottom: '22px',
                background: isDone ? '#10b981' : '#e2e8f0',
                transition: 'background 0.3s',
              }}
            />
          )}
        </React.Fragment>
      );
    })}
  </div>
);

export default StepIndicator;
