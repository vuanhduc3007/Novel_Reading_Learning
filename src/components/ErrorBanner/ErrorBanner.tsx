import React from 'react';
import { AlertCircle, X } from 'lucide-react';
import { Button } from '../Button/Button';
import styles from './ErrorBanner.module.css';

export interface ErrorBannerProps {
  message: string;
  action?: {
    label: string;
    onClick: () => void;
  };
  onDismiss?: () => void;
  variant?: 'inline' | 'fullblock';
}

export const ErrorBanner: React.FC<ErrorBannerProps> = ({ 
  message, 
  action, 
  onDismiss, 
  variant = 'inline' 
}) => {
  return (
    <div className={`${styles.banner} ${styles[variant]}`} role="alert">
      <div className={styles.content}>
        <AlertCircle className={styles.icon} size={20} />
        <span className={styles.message}>{message}</span>
      </div>
      <div className={styles.actions}>
        {action && (
          <Button variant="destructive" size="sm" onClick={action.onClick}>
            {action.label}
          </Button>
        )}
        {onDismiss && (
          <button className={styles.dismissBtn} onClick={onDismiss} aria-label="Dismiss error">
            <X size={16} />
          </button>
        )}
      </div>
    </div>
  );
};
