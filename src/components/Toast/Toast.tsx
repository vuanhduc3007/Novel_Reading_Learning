import React from 'react';
import { CheckCircle, Info, AlertCircle, X } from 'lucide-react';
import styles from './Toast.module.css';

export interface ToastProps {
  message: string;
  type: 'success' | 'info' | 'error';
  onClose: () => void;
}

export const Toast: React.FC<ToastProps> = ({ message, type, onClose }) => {
  const icons = {
    success: <CheckCircle className={styles.iconSuccess} size={20} />,
    info: <Info className={styles.iconInfo} size={20} />,
    error: <AlertCircle className={styles.iconError} size={20} />
  };

  return (
    <div className={`${styles.toast} ${styles[type]}`}>
      <div className={styles.icon}>{icons[type]}</div>
      <div className={styles.message}>{message}</div>
      <button className={styles.closeBtn} onClick={onClose} aria-label="Close toast">
        <X size={16} />
      </button>
    </div>
  );
};
