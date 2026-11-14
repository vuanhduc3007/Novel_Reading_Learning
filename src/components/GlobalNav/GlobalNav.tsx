import { NavLink } from 'react-router-dom';
import { BookOpen, Library, Languages, Settings } from 'lucide-react';
import styles from './GlobalNav.module.css';
import { SyncNavStatus } from '../../features/sync/SyncWidgets';

export function GlobalNav() {
  return (
    <nav className={styles.nav}>
      <div className={styles.brand}>
        <BookOpen size={24} />
        <span className={styles.brandText}>Chinese Reader</span>
      </div>
      <div className={styles.links}>
        <NavLink to="/" className={({isActive}) => `${styles.link} ${isActive ? styles.active : ''}`} end>
          <Library size={18} />
          <span className={styles.linkText}>Library</span>
        </NavLink>
        <NavLink to="/vocabulary" className={({isActive}) => `${styles.link} ${isActive ? styles.active : ''}`}>
          <Languages size={18} />
          <span className={styles.linkText}>Vocabulary</span>
        </NavLink>
      </div>
      <div className={styles.links}>
        <SyncNavStatus />
        <NavLink to="/settings" className={({isActive}) => `${styles.iconBtn} ${isActive ? styles.active : ''}`} title="Settings">
          <Settings size={20} />
        </NavLink>
      </div>
    </nav>
  );
}
