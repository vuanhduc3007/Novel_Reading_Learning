import React, { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { RotateCcw } from 'lucide-react';
import type { Sentence } from '../../types';
import { tokenize } from '../../utils/tokenizer';
import { WordToken } from '../dictionary/WordToken';
import { translationQueue } from '../translation/translationQueue';
import { useImmersionStore, HINT_EXPOSURES, canWeave } from '../../stores/immersionStore';
import { groupParagraphs, readingUnits, type ReadingUnit } from './readingUnits';
import { matchWords, type WordMatch } from './wordMatcher';
import { countEncounters } from './exposureTracker';
import { setNextLookupContext } from '../../stores/dictionaryStore';
import styles from './Immersion.module.css';

// An encounter is counted once per sentence per session, and only for text
// read for the first time (see exposureTracker).
const seenSentences = new Set<string>();
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
  chapterIndex: number;
  unit: ReadingUnit;
  matches: WordMatch[];
  showingOriginal: boolean;
  onToggleOriginal: (sentenceId: string) => void;
}

const ImmersionSentence = memo(({ chapterIndex, unit, matches, showingOriginal, onToggleOriginal }: SentenceProps) => {
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
      recordExposures(countEncounters(sentence.bookId, chapterIndex, sentence.index, words));
    });
  }, [sentence.id, sentence.bookId, sentence.index, chapterIndex, words, recordExposures]);

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

/**
 * The Chinese sentence. Words woven into the Vietnamese (being learned or
 * known) are marked, located by characters so the marking does not depend on
 * how the browser segments the sentence.
 */
function Original({ unit, matches }: { unit: ReadingUnit; matches: WordMatch[] }) {
  const parts = useMemo(() => {
    const chars = Array.from(unit.chinese);
    const marked = new Array<boolean>(chars.length).fill(false);
    const result: Array<{ text: string; woven: boolean }> = [];
    for (const word of new Set(matches.map(match => match.zh))) {
      const target = Array.from(word);
      for (let at = 0; at + target.length <= chars.length; at++) {
        if (target.every((char, k) => chars[at + k] === char)) {
          for (let k = 0; k < target.length; k++) marked[at + k] = true;
        }
      }
    }
    chars.forEach((char, at) => {
      const last = result[result.length - 1];
      if (last && last.woven === marked[at]) last.text += char;
      else result.push({ text: char, woven: marked[at]! });
    });
    return result;
  }, [unit.chinese, matches]);
  // A word looked up here can be paired with this translation (dictionary panel).
  const rememberContext = () => setNextLookupContext({ chinese: unit.chinese, vietnamese: unit.vietnamese ?? '' });
  return (
    <p className={styles.original} onClickCapture={rememberContext}>
      {parts.map((part, partIndex) =>
        tokenize(part.text).map((token, index) =>
          token.isWord ? (
            <span key={`${partIndex}-${index}`} className={part.woven ? styles.originalHighlight : undefined}>
              <WordToken word={token.text} />
            </span>
          ) : (
            <span key={`${partIndex}-${index}`}>{token.text}</span>
          ),
        ),
      )}
    </p>
  );
}

const NO_MATCHES: WordMatch[] = [];

interface ImmersionChapterProps {
  chapterIndex: number;
  sentences: Sentence[];
}

/** Vietnamese-first rendering of one chapter, paragraph by paragraph. */
export function ImmersionChapter({ chapterIndex, sentences }: ImmersionChapterProps) {
  const index = useImmersionStore(s => s.index);
  const learning = useImmersionStore(s => s.learning);
  const known = useImmersionStore(s => s.known);
  const sessionStart = useImmersionStore(s => s.sessionStart);
  const visibleFrom = useImmersionStore(s => s.visibleFrom);
  const metBefore = useImmersionStore(s => s.metBefore);
  const freeWords = useImmersionStore(s => s.freeWords);
  const userLexicon = useImmersionStore(s => s.userLexicon);
  const [openOriginals, setOpenOriginals] = useState<Set<string>>(() => new Set());

  const units = useMemo(() => readingUnits(sentences), [sentences]);
  // What is woven in: known words and words met in earlier sessions
  // everywhere; words new in this session only in text not read before, from
  // where each was introduced. Only words that may be shown here are matched
  // first, so a longer span not shown here cannot take their place; compounds
  // (古月方源 = 古月 + 方源) are matched as their parts (isCompound).
  const shownMatches = useMemo(() => {
    const result = new Map<string, WordMatch[]>();
    if (!index) return result;
    const state = { known, learning, visibleFrom, sessionStart, metBefore };
    for (const unit of units) {
      if (!unit.vietnamese) continue;
      const sentence = unit.sentence.index;
      const shown = (word: string) => canWeave(word, chapterIndex, sentence, state);
      const matches = matchWords(unit.chinese, unit.vietnamese, index, { prefer: shown, isFreeWord: word => freeWords.has(word), userLexicon });
      result.set(unit.sentence.id, matches.filter(match => shown(match.zh)));
    }
    return result;
  }, [units, index, learning, known, visibleFrom, sessionStart, metBefore, freeWords, userLexicon, chapterIndex]);

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
                  chapterIndex={chapterIndex}
                  unit={unit}
                  matches={shownMatches.get(unit.sentence.id) ?? NO_MATCHES}
                  showingOriginal={openOriginals.has(unit.sentence.id)}
                  onToggleOriginal={toggleOriginal}
                />
              ))}
            </p>
            {opened.map(unit => (
              <Original key={unit.sentence.id} unit={unit} matches={shownMatches.get(unit.sentence.id) ?? NO_MATCHES} />
            ))}
          </div>
        );
      })}
    </div>
  );
}
