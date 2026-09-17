import React from 'react';
import { Search, X } from 'lucide-react';
import { Input } from '../Input/Input';
import styles from './SearchBar.module.css';

export interface SearchBarProps {
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  onClear?: () => void;
  className?: string;
  compact?: boolean;
}

export const SearchBar: React.FC<SearchBarProps> = ({ 
  value, 
  onChange, 
  placeholder = 'Search...', 
  onClear,
  className = '',
  compact = false
}) => {
  if (compact) {
    return (
      <button className={`${styles.compactBtn} ${className}`} aria-label="Search">
        <Search size={20} />
      </button>
    );
  }

  return (
    <div className={`${styles.container} ${className}`}>
      <Input
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        leftIcon={<Search size={18} />}
        className={styles.inputWrapper}
      />
      {value && onClear && (
        <button className={styles.clearBtn} onClick={onClear} aria-label="Clear search">
          <X size={16} />
        </button>
      )}
    </div>
  );
};
