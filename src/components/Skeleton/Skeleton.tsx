import React from 'react';
import styles from './Skeleton.module.css';

export interface SkeletonProps {
  width?: string;
  height?: string;
  variant?: 'text' | 'rect' | 'circle';
  className?: string;
}

export const Skeleton: React.FC<SkeletonProps> = ({ 
  width = '100%', 
  height, 
  variant = 'text',
  className = ''
}) => {
  const style = {
    width,
    height: height || (variant === 'text' ? '1.2em' : '100%'),
  };

  return (
    <div 
      className={`${styles.skeleton} ${styles[variant]} ${className}`} 
      style={style}
      aria-hidden="true"
    />
  );
};
