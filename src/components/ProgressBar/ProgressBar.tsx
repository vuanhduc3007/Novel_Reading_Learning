import React from 'react';
import styles from './ProgressBar.module.css';

export interface ProgressBarProps {
  value: number; // 0-100
  variant?: 'thin' | 'labeled';
  label?: string;
  showPercent?: boolean;
  color?: string;
  className?: string;
}

export const ProgressBar: React.FC<ProgressBarProps> = ({ 
  value = 0,
  variant = 'thin', 
  label, 
  showPercent,
  color = 'var(--color-accent, #007bff)',
  className = ''
}) => {
  // Consumers can be fed persisted data from older app versions. Never allow a
  // malformed value to become `NaN%`, which produces a broken progress bar.
  const clampedValue = Number.isFinite(value) ? Math.min(Math.max(value, 0), 100) : 0;

  return (
    <div className={`${styles.container} ${className}`}>
      {variant === 'labeled' && (label || showPercent) && (
        <div className={styles.header}>
          {label && <span className={styles.label}>{label}</span>}
          {showPercent && <span className={styles.percent}>{Math.round(clampedValue)}%</span>}
        </div>
      )}
      <div className={`${styles.track} ${styles[variant]}`}>
        <div 
          className={styles.fill} 
          style={{ width: `${clampedValue}%`, backgroundColor: color }}
        />
      </div>
    </div>
  );
};
