import React from 'react';
import styles from './Chip.module.css';

export interface ChipProps {
  children: React.ReactNode;
  onClick?: () => void;
  variant?: 'active' | 'deleted';
  className?: string;
}

export const Chip: React.FC<ChipProps> = ({ 
  children, 
  onClick, 
  variant = 'active',
  className = ''
}) => {
  return (
    <div 
      className={`${styles.chip} ${styles[variant]} ${onClick && variant !== 'deleted' ? styles.clickable : ''} ${className}`}
      onClick={variant !== 'deleted' ? onClick : undefined}
    >
      {children}
    </div>
  );
};
