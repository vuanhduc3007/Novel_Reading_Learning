import React from 'react';
import { MonitorSmartphone } from 'lucide-react';
import { useReaderStore } from '../../stores/readerStore';
import styles from './RemotePositionBanner.module.css';

/** Offers the position reached on another device while this one is open. */
export function RemotePositionBanner() {
  const remote = useReaderStore(s => s.remotePosition);
  const chapters = useReaderStore(s => s.chapters);
  const accept = useReaderStore(s => s.acceptRemotePosition);
  const dismiss = useReaderStore(s => s.dismissRemotePosition);
  if (!remote) return null;
  const title = chapters[remote.chapterIndex]?.title ?? `chương ${remote.chapterIndex + 1}`;
  return (
    <div className={styles.banner} role="status">
      <MonitorSmartphone size={16} />
      <span className={styles.text}>Bạn đã đọc tới <strong>{title}</strong> trên máy khác.</span>
      <button className={styles.primary} onClick={accept}>Đến chỗ đó</button>
      <button className={styles.secondary} onClick={dismiss}>Ở lại đây</button>
    </div>
  );
}
