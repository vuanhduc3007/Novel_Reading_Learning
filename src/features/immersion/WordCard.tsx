import React, { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { BookOpen, Check, Volume2, X, RotateCcw, EyeOff } from 'lucide-react';
import { useImmersionStore, AUTO_KNOWN_EXPOSURES } from '../../stores/immersionStore';
import { useDictionaryStore } from '../../stores/dictionaryStore';
import styles from './Immersion.module.css';

type PinyinFn = (text: string, options: { toneType: 'symbol'; type: 'array' }) => string[];
let pinyinLoader: Promise<PinyinFn> | null = null;
function loadPinyin(): Promise<PinyinFn> {
  pinyinLoader ??= import('pinyin-pro').then(module => module.pinyin as unknown as PinyinFn);
  return pinyinLoader;
}

function speak(text: string) {
  try {
    const utterance = new SpeechSynthesisUtterance(text);
    utterance.lang = 'zh-CN';
    utterance.rate = 0.8;
    window.speechSynthesis.cancel();
    window.speechSynthesis.speak(utterance);
  } catch {
    // Speech is optional.
  }
}

/** Card for a Chinese word woven into the Vietnamese text. */
export function WordCard() {
  const card = useImmersionStore(s => s.card);
  const closeCard = useImmersionStore(s => s.closeCard);
  const setStatus = useImmersionStore(s => s.setStatus);
  const data = useImmersionStore(s => s.data);
  const entry = useImmersionStore(s => (card ? s.progress.get(card.word) : undefined));
  const isKnown = useImmersionStore(s => (card ? s.known.has(card.word) : false));
  const [pinyin, setPinyin] = useState<string[] | null>(null);
  const ref = useRef<HTMLDivElement>(null);
  const [position, setPosition] = useState<{ left: number; top: number } | null>(null);

  useEffect(() => {
    setPinyin(null);
    if (!card) return;
    let cancelled = false;
    loadPinyin()
      .then(fn => { if (!cancelled) setPinyin(fn(card.word, { toneType: 'symbol', type: 'array' })); })
      .catch(() => undefined);
    return () => { cancelled = true; };
  }, [card]);

  useLayoutEffect(() => {
    if (!card || !ref.current) {
      setPosition(null);
      return;
    }
    const width = ref.current.offsetWidth;
    const height = ref.current.offsetHeight;
    const margin = 8;
    const left = Math.min(Math.max(margin, card.anchor.x + card.anchor.width / 2 - width / 2), window.innerWidth - width - margin);
    const below = card.anchor.y + card.anchor.height + margin;
    const top = below + height > window.innerHeight - margin ? Math.max(margin, card.anchor.y - height - margin) : below;
    setPosition({ left, top });
  }, [card, pinyin]);

  useEffect(() => {
    if (!card) return;
    const onKey = (event: KeyboardEvent) => { if (event.key === 'Escape') closeCard(); };
    const onPointer = (event: PointerEvent) => {
      if (ref.current && !ref.current.contains(event.target as Node)) closeCard();
    };
    const onScroll = () => closeCard();
    window.addEventListener('keydown', onKey);
    window.addEventListener('pointerdown', onPointer, true);
    document.getElementById('reader-scroll-container')?.addEventListener('scroll', onScroll, { passive: true });
    return () => {
      window.removeEventListener('keydown', onKey);
      window.removeEventListener('pointerdown', onPointer, true);
      document.getElementById('reader-scroll-container')?.removeEventListener('scroll', onScroll);
    };
  }, [card, closeCard]);

  if (!card) return null;

  const chars = Array.from(card.word);
  const viSyllables = card.vi.split(/\s+/);
  // A Hán-Việt match pairs every character with the syllable at its position;
  // otherwise show the dictionary reading of each character.
  const readings = chars.map((char, index) =>
    card.kind === 'hanviet' && viSyllables.length === chars.length
      ? viSyllables[index]!.toLowerCase()
      : data?.readings[char]?.split('|')[0] ?? '—');
  const exposures = entry?.exposures ?? 0;

  const lookUp = () => {
    closeCard();
    void useDictionaryStore.getState().handleWordClick(card.word);
  };

  return (
    <div
      ref={ref}
      className={styles.card}
      style={position ? { left: position.left, top: position.top } : { visibility: 'hidden', left: 0, top: 0 }}
      role="dialog"
      aria-label={`Từ ${card.word}`}
    >
      <div className={styles.cardHeader}>
        <span className={styles.cardWord}>{card.word}</span>
        <button className={styles.iconButton} onClick={() => speak(card.word)} aria-label="Nghe phát âm" title="Nghe phát âm">
          <Volume2 size={16} />
        </button>
        <button className={`${styles.iconButton} ${styles.cardClose}`} onClick={closeCard} aria-label="Đóng">
          <X size={16} />
        </button>
      </div>
      <div className={styles.cardPinyin}>{pinyin ? pinyin.join(' ') : '…'}</div>
      <div className={styles.cardChars}>
        {chars.map((char, index) => (
          <span key={index} className={styles.cardChar}>
            <span className={styles.cardCharHan}>{char}</span>
            <span className={styles.cardCharReading}>{readings[index]}</span>
          </span>
        ))}
      </div>
      <div className={styles.cardMeaning}>
        <span className={styles.cardLabel}>Nghĩa trong câu:</span> {card.vi}
      </div>
      <div className={styles.cardStatus}>
        {isKnown
          ? 'Đã thuộc — từ này luôn hiện bằng chữ Hán.'
          : entry?.status === 'ignored'
            ? 'Đã bỏ qua từ này.'
            : `Đang học · đã gặp ${exposures} lần (tự thuộc sau ${AUTO_KNOWN_EXPOSURES} lần)`}
      </div>
      <div className={styles.cardActions}>
        {isKnown ? (
          <button className={styles.cardButton} onClick={() => { setStatus(card.word, 'learning'); closeCard(); }}>
            <RotateCcw size={14} /> Học lại
          </button>
        ) : (
          <button className={`${styles.cardButton} ${styles.primary}`} onClick={() => { setStatus(card.word, 'known'); closeCard(); }}>
            <Check size={14} /> Đã nhớ
          </button>
        )}
        <button className={styles.cardButton} onClick={lookUp}>
          <BookOpen size={14} /> Từ điển
        </button>
        {!isKnown && (
          <button className={styles.cardButton} onClick={() => { setStatus(card.word, 'ignored'); closeCard(); }} title="Không chèn từ này nữa">
            <EyeOff size={14} /> Bỏ qua
          </button>
        )}
      </div>
    </div>
  );
}
