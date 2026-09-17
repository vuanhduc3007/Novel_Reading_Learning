import { Outlet, useMatch } from 'react-router-dom';
import { GlobalNav } from '../GlobalNav/GlobalNav';
import styles from './AppShell.module.css';

export function AppShell() {
  const isReaderRoute = useMatch('/reader/:bookId');

  return (
    <div className={styles.shell}>
      {!isReaderRoute && <GlobalNav />}
      <main className={`${styles.content} ${isReaderRoute ? styles.readerMode : ''}`}>
        <Outlet />
      </main>
    </div>
  );
}
