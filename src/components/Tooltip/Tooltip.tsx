import React, { useState, useRef, useEffect } from 'react';
import styles from './Tooltip.module.css';

export interface TooltipProps {
  content: React.ReactNode;
  children: React.ReactElement;
  delay?: number;
  position?: 'top' | 'bottom' | 'auto';
}

export const Tooltip: React.FC<TooltipProps> = ({ content, children, delay = 150, position = 'auto' }) => {
  const [isVisible, setIsVisible] = useState(false);
  const [actualPosition, setActualPosition] = useState<'top' | 'bottom'>('top');
  const timeoutRef = useRef<NodeJS.Timeout>();
  const containerRef = useRef<HTMLDivElement>(null);

  const handleMouseEnter = () => {
    timeoutRef.current = setTimeout(() => setIsVisible(true), delay);
  };

  const handleMouseLeave = () => {
    if (timeoutRef.current) clearTimeout(timeoutRef.current);
    setIsVisible(false);
  };

  useEffect(() => {
    if (isVisible && position === 'auto' && containerRef.current) {
      const rect = containerRef.current.getBoundingClientRect();
      if (rect.top < 50) {
        setActualPosition('bottom');
      } else {
        setActualPosition('top');
      }
    } else if (position !== 'auto') {
      setActualPosition(position);
    }
  }, [isVisible, position]);

  return (
    <div 
      className={styles.container} 
      onMouseEnter={handleMouseEnter} 
      onMouseLeave={handleMouseLeave}
      ref={containerRef}
    >
      {children}
      {isVisible && (
        <div 
          className={`${styles.tooltip} ${styles[actualPosition]}`}
          role="tooltip"
        >
          {content}
        </div>
      )}
    </div>
  );
};
