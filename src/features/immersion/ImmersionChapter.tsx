import React, { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { RotateCcw } from 'lucide-react';
import type { Sentence } from '../../types';
import { tokenize } from '../../utils/tokenizer';
import { WordToken } from '../dictionary/WordToken';
import { translationQueue } from '../translation/translationQueue';
import { useImmersionStore, HINT_EXPOSURES } from '../../stores/immersionStore';
import { groupParagraphs, readingUnits, type ReadingUnit } from './readingUnits';
import { matchWords, type WordMatch } from './wordMatcher';
import styles from './Immersion.module.css';

// Count an encounter once per sentence per session, when it is actually seen,
// and at most a few times per chapter: spaced encounters across chapters are
// what make a word stick, not twenty sightings on one page.
const seenSentences = new Set<string>();
const MAX_EXPOSURES_PER_CHAPTER = 3;
const chapterExposures = new Map<string, Map<string, number>>();

function spacedWords(chapterId: string, words: string[]): string[] {
  let counts = chapterExposures.get(chapterId);
  if (!counts) {
    counts = new Map();
    chapterExposures.set(chapterId, counts);
  }
  const result: string[] = [];
  for (const word of new Set(words)) {
    const count = counts.get(word) ?? 0;
    if (count >= MAX_EXPOSURES_PER_CHAPTER) continue;
    counts.set(word, count + 1);
    result.push(word);
  }
  return result;
}
const visibilityCallbacks = new WeakMap<Element, () => void>();
let observer: IntersectionObserver | null = null;

function observeOnce(element: Element, onVisible: () => void): () => void {
  if (typeof IntersectionObserver === 'undefined') {
    onVisible();
    return () => undefined;
  }
  observer ??= new IntersectionObserver(entries => {
    for (const entry of entries) {
      if (!entry.isIntersecting) continue;
      visibilityCallbacks.get(entry.target)?.();
      visibilityCallbacks.delete(entry.target);
      observer?.unobserve(entry.target);
    }
  }, { threshold: 0.6 });
  visibilityCallbacks.set(element, onVisible);
  observer.observe(element);
  return () => {
    visibilityCallbacks.delete(element);
    observer?.unobserve(element);
  };
}

interface WovenWordProps {
  match: WordMatch;
}

const WovenWord = memo(({ match }: WovenWordProps) => {
  const exposures = useImmersionStore(s => s.progress.get(match.zh)?.exposures ?? 0);
  const learning = useImmersionStore(s => s.learning.has(match.zh));
  const openCard = useImmersionStore(s => s.openCard);
  const peek = useImmersionStore(s => s.peek);
  const showHint = learning && exposures < HINT_EXPOSURES;

  const onClick = (event: React.MouseEvent<HTMLElement>) => {
    event.stopPropagation();
    if (learning && !showHint) peek(match.zh);
    const rect = event.currentTarget.getBoundingClientRect();
    openCard({
      word: match.zh,
      vi: match.vi,
      kind: match.kind,
      anchor: { x: rect.left, y: rect.top, width: rect.width, height: rect.height },
    });
  };

  const className = `${styles.woven} ${learning ? styles.learning : styles.known} ${showHint ? styles.withHint : ''}`;
  // The hint floats above the word so it never widens the Chinese characters.
  return (
    <span
      className={className}
      onClick={onClick}
      onKeyDown={event => { if (event.key === 'Enter' || event.key === ' ') onClick(event as unknown as React.MouseEvent<HTMLElement>); }}
      role="button"
      tabIndex={0}
      data-hint={showHint ? match.vi : undefined}
      aria-label={showHint ? `${match.zh}: ${match.vi}` : `${match.zh} — bấm để xem nghĩa`}
    >
      {match.zh}
    </span>
  );
});
WovenWord.displayName = 'WovenWord';

interface SentenceProps {
  unit: ReadingUnit;
  matches: WordMatch[];
  showingOriginal: boolean;
  onToggleOriginal: (sentenceId: string) => void;
}

const ImmersionSentence = memo(({ unit, matches, showingOriginal, onToggleOriginal }: SentenceProps) => {
  const ref = useRef<HTMLSpanElement>(null);
  const recordExposures = useImmersionStore(s => s.recordExposures);
  const { sentence, vietnamese } = unit;
  const words = useMemo(() => matches.map(match => match.zh), [matches]);

  useEffect(() => {
    const element = ref.current;
    if (!element || words.length === 0 || seenSentences.has(sentence.id)) return;
    return observeOnce(element, () => {
      if (seenSentences.has(sentence.id)) return;
      seenSentences.add(sentence.id);
      recordExposures(spacedWords(sentence.chapterId, words));
    });
  }, [sentence.id, words, recordExposures]);

  if (unit.merged) {
    return <span ref={ref} data-sentence-id={sentence.id} data-chapter-id={sentence.chapterId} />;
  }

  const select = () => onToggleOriginal(sentence.id);

  if (!vietnamese) {
    const status = sentence.translationStatus;
    return (
      <span ref={ref} className={styles.pending} data-sentence-id={sentence.id} data-chapter-id={sentence.chapterId}>
        {status === 'failed' ? (
          <button className={styles.retry} onClick={() => translationQueue.retry(sentence)}>
            <RotateCcw size={12} /> {sentence.chineseText}
          </button>
        ) : (
          <span className={styles.pendingText} onClick={select} title="Đang dịch — bấm để xem câu gốc">
            {sentence.chineseText}
          </span>
        )}{' '}
      </span>
    );
  }

  const parts: React.ReactNode[] = [];
  let cursor = 0;
  matches.forEach((match, position) => {
    if (match.viStart > cursor) parts.push(vietnamese.slice(cursor, match.viStart));
    parts.push(<WovenWord key={position} match={match} />);
    cursor = match.viEnd;
  });
  if (cursor < vietnamese.length) parts.push(vietnamese.slice(cursor));

  return (
    <span
      ref={ref}
      className={`${styles.sentence} ${showingOriginal ? styles.selected : ''} ${unit.source === 'machine' ? styles.machine : ''}`}
      data-sentence-id={sentence.id}
      data-chapter-id={sentence.chapterId}
      onClick={select}
    >
      {parts}{' '}
    </span>
  );
});
ImmersionSentence.displayName = 'ImmersionSentence';

function Original({ unit, matches }: { unit: ReadingUnit; matches: WordMatch[] }) {
  const highlighted = useMemo(() => new Set(matches.map(match => match.zh)), [matches]);
  const tokens = useMemo(() => tokenize(unit.chinese), [unit.chinese]);
  return (
    <p className={styles.original}>
      {tokens.map((token, index) =>
        token.isWord ? (
          <span key={index} className={highlighted.has(token.text) ? styles.originalHighlight : undefined}>
            <WordToken word={token.text} />
          </span>
        ) : (
          <span key={index}>{token.text}</span>
        ),
      )}
    </p>
  );
}

const NO_MATCHES: WordMatch[] = [];

interface ImmersionChapterProps {
  sentences: Sentence[];
}

/** Vietnamese-first rendering of one chapter, paragraph by paragraph. */
export function ImmersionChapter({ sentences }: ImmersionChapterProps) {
  const index = useImmersionStore(s => s.index);
  const learning = useImmersionStore(s => s.learning);
  const known = useImmersionStore(s => s.known);
  const [openOriginals, setOpenOriginals] = useState<Set<string>>(() => new Set());

  const units = useMemo(() => readingUnits(sentences), [sentences]);
  const allMatches = useMemo(() => {
    const result = new Map<string, WordMatch[]>();
    if (!index) return result;
    for (const unit of units) {
      if (unit.vietnamese) result.set(unit.sentence.id, matchWords(unit.chinese, unit.vietnamese, index));
    }
    return result;
  }, [units, index]);

  // Only words being learned or already known are woven in.
  const shownMatches = useMemo(() => {
    const result = new Map<string, WordMatch[]>();
    for (const [sentenceId, matches] of allMatches) {
      result.set(sentenceId, matches.filter(match => learning.has(match.zh) || known.has(match.zh)));
    }
    return result;
  }, [allMatches, learning, known]);

  const paragraphs = useMemo(() => groupParagraphs(units), [units]);

  const toggleOriginal = useCallback((sentenceId: string) => {
    setOpenOriginals(previous => {
      const next = new Set(previous);
      if (next.has(sentenceId)) next.delete(sentenceId);
      else next.add(sentenceId);
      return next;
    });
  }, []);

  return (
    <div className={styles.chapter}>
      {paragraphs.map(paragraph => {
        const first = paragraph[0]!.sentence.id;
        const opened = paragraph.filter(unit => openOriginals.has(unit.sentence.id));
        return (
          <div key={first} className={styles.paragraph}>
            <p className={styles.text}>
              {paragraph.map(unit => (
                <ImmersionSentence
                  key={unit.sentence.id}
                  unit={unit}
                  matches={shownMatches.get(unit.sentence.id) ?? NO_MATCHES}
                  showingOriginal={openOriginals.has(unit.sentence.id)}
                  onToggleOriginal={toggleOriginal}
                />
              ))}
            </p>
            {opened.map(unit => (
              <Original key={unit.sentence.id} unit={unit} matches={allMatches.get(unit.sentence.id) ?? []} />
            ))}
          </div>
        );
      })}
    </div>
  );
}
