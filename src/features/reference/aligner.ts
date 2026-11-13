/**
 * Length-based bilingual alignment (Gale & Church, 1993) adapted for
 * Chinese → Vietnamese novels.
 *
 * A human translation of a web novel is usually paragraph-for-paragraph, but
 * the two editions rarely share chapter boundaries (e.g. 蛊真人 has 2334
 * chapters while one Vietnamese edition has 3811). We therefore treat the
 * reference translation as one continuous stream of paragraphs and align each
 * Chinese chapter against the next window of that stream with a "free end":
 * the DP decides where the chapter stops inside the Vietnamese stream.
 *
 * Pure and synchronous so it can be unit-tested in Node and run in the browser.
 */

export interface AlignBead {
  /** Indices into the Chinese unit array (relative to the call). */
  zh: number[];
  /** Indices into the Vietnamese unit array (relative to the call). */
  vi: number[];
}

export interface AlignUnitFeatures {
  /** Character length, spaces between words included (≈3.6 vi chars per zh char). */
  length: number;
  /** Unit opens with a quotation mark (dialogue). */
  quote: boolean;
}

export interface AlignOptions {
  /** Expected Vietnamese chars per Chinese char. */
  ratio: number;
  /** Variance per Chinese char of the length difference. */
  variance?: number;
  /** Allow the alignment to stop before the end of the Vietnamese units. */
  freeEnd?: boolean;
  /**
   * Allow skipping up to this many leading Vietnamese units (front matter,
   * translator notes) instead of forcing them into the first match.
   */
  skipStart?: number;
}

export interface AlignResult {
  beads: AlignBead[];
  /** Number of Vietnamese units consumed. */
  viConsumed: number;
  cost: number;
  /** Share of beads that are clean 1–1 matches with plausible lengths (0–1). */
  confidence: number;
}

type Op = readonly [number, number, number]; // [zh, vi, -ln(prior)]

const OPS: readonly Op[] = [
  [1, 1, -Math.log(0.89)],
  [1, 0, -Math.log(0.006)],
  [0, 1, -Math.log(0.006)],
  [2, 1, -Math.log(0.04)],
  [1, 2, -Math.log(0.04)],
  [2, 2, -Math.log(0.01)],
  [3, 1, -Math.log(0.004)],
  [1, 3, -Math.log(0.004)],
];

const QUOTE_RE = /^[“"「『‘']/u;
/** Cost of leaving one leading Vietnamese unit unmatched (cheaper than a 0–1 bead). */
const SKIP_START_COST = 1.5;

export function unitFeatures(text: string): AlignUnitFeatures {
  const trimmed = text.trim();
  return { length: trimmed.replace(/\s+/g, ' ').length, quote: QUOTE_RE.test(trimmed) };
}

// Abramowitz–Stegun 7.1.26 approximation of the standard normal tail.
function twoSidedTail(z: number): number {
  const x = Math.abs(z) / Math.SQRT2;
  const t = 1 / (1 + 0.3275911 * x);
  const erfc = t * (0.254829592 + t * (-0.284496736 + t * (1.421413741 + t * (-1.453152027 + t * 1.061405429)))) *
    Math.exp(-x * x);
  return Math.max(erfc, 1e-12);
}

function lengthCost(zhLength: number, viLength: number, ratio: number, variance: number): number {
  const mean = (zhLength + viLength / ratio) / 2;
  const delta = (viLength - zhLength * ratio) / Math.sqrt(Math.max(mean, 1) * variance);
  return -Math.log(twoSidedTail(delta));
}

export function alignUnits(zh: AlignUnitFeatures[], vi: AlignUnitFeatures[], options: AlignOptions): AlignResult {
  const ratio = options.ratio;
  const variance = options.variance ?? ratio * 2.2;
  const n = zh.length;
  const m = vi.length;
  const width = m + 1;
  const cost = new Float64Array((n + 1) * width).fill(Infinity);
  const back = new Uint8Array((n + 1) * width).fill(255);
  cost[0] = 0;
  const SKIPPED = 254;
  for (let j = 1; j <= Math.min(options.skipStart ?? 0, m); j++) {
    cost[j] = j * SKIP_START_COST;
    back[j] = SKIPPED;
  }

  for (let i = 0; i <= n; i++) {
    for (let j = 0; j <= m; j++) {
      const base = cost[i * width + j]!;
      if (base === Infinity) continue;
      for (let opIndex = 0; opIndex < OPS.length; opIndex++) {
        const [dz, dv, prior] = OPS[opIndex]!;
        const ni = i + dz;
        const nj = j + dv;
        if (ni > n || nj > m) continue;
        let step = prior;
        if (dz > 0 && dv > 0) {
          let zl = 0;
          let vl = 0;
          for (let k = i; k < ni; k++) zl += zh[k]!.length;
          for (let k = j; k < nj; k++) vl += vi[k]!.length;
          step += lengthCost(zl, vl, ratio, variance);
          if (zh[i]!.quote !== vi[j]!.quote) step += 1.5;
        }
        const next = base + step;
        const index = ni * width + nj;
        if (next < cost[index]!) {
          cost[index] = next;
          back[index] = opIndex;
        }
      }
    }
  }

  let end = m;
  if (options.freeEnd) {
    let best = Infinity;
    for (let j = 0; j <= m; j++) {
      const value = cost[n * width + j]!;
      if (value < best) {
        best = value;
        end = j;
      }
    }
  }

  const beads: AlignBead[] = [];
  let i = n;
  let j = end;
  while (i > 0 || j > 0) {
    const opIndex = back[i * width + j]!;
    if (opIndex === 255 || opIndex === SKIPPED) break;
    const [dz, dv] = OPS[opIndex]!;
    const bead: AlignBead = { zh: [], vi: [] };
    for (let k = i - dz; k < i; k++) bead.zh.push(k);
    for (let k = j - dv; k < j; k++) bead.vi.push(k);
    beads.push(bead);
    i -= dz;
    j -= dv;
  }
  beads.reverse();

  let clean = 0;
  for (const bead of beads) {
    if (bead.zh.length !== 1 || bead.vi.length !== 1) continue;
    const zl = zh[bead.zh[0]!]!.length;
    const vl = vi[bead.vi[0]!]!.length;
    if (lengthCost(zl, vl, ratio, variance) < 4.6) clean++; // within ~±2.6σ
  }

  return {
    beads,
    viConsumed: end,
    cost: cost[n * width + end]!,
    confidence: beads.length === 0 ? 0 : clean / beads.length,
  };
}

/**
 * Vietnamese paragraphs that carry no translated text: chapter headings and
 * edition metadata such as "Tập 1/49 • Phần 1 (…) • Mốc 00:23:08".
 */
export function isVietnameseHeading(paragraph: string): boolean {
  const text = paragraph.trim();
  return /^(chương|hồi|tập|quyển|phần)\s*[\dIVXLC]+\b/iu.test(text) && text.length < 200 ||
    /^mục\s*lục$/iu.test(text);
}

/** Chinese chapter/volume headings that have no counterpart paragraph. */
/**
 * Lines that are not part of the translation: web-novel EPUBs often carry
 * per-chapter promotions ("🔥 … Bấm nghe …", "▶️ Nghe Chương 5 …") or
 * separator lines. Ellipsis-only lines (“……”) are real text and are kept.
 */
export function isNoiseParagraph(paragraph: string): boolean {
  return /^\p{Extended_Pictographic}/u.test(paragraph)
    || /^[\s|│\-–—_=*~•·★☆✦✧◆◇●○※]+$/u.test(paragraph)
    // Edition metadata: "Tác giả: …", "Thể loại: …", "Biên tập & Hiệu đính: …".
    || (paragraph.length < 200
      && /^(tác giả|thể loại|biên tập|hiệu đính|dịch giả|người dịch|converter|editor)(?=[\s&:：])[^:：]{0,30}[:：]/iu.test(paragraph));
}

const PROMO_WORDS = /youtube|đăng ký kênh|subscribe/i;

/**
 * Paragraphs of one translated chapter without its promotional block. Such
 * blocks sit at the end of a chapter and may continue with lines that do not
 * start with an emoji ("(Nhớ bấm Đăng Ký Kênh YouTube …)"), so everything
 * from a noise line near the end is dropped.
 */
export function stripChapterNoise(paragraphs: string[]): string[] {
  const tailStart = Math.max(0, paragraphs.length - 6);
  const blockStart = paragraphs.findIndex((paragraph, index) => index >= tailStart && isNoiseParagraph(paragraph));
  const body = blockStart >= 0 ? paragraphs.slice(0, blockStart) : paragraphs;
  return body.filter(paragraph => !isNoiseParagraph(paragraph) && !(paragraph.length < 200 && PROMO_WORDS.test(paragraph)));
}

export function isChineseHeading(paragraph: string, chapterTitle?: string): boolean {
  const text = paragraph.trim();
  if (chapterTitle && text === chapterTitle.trim()) return true;
  return /^第[零〇一二两三四五六七八九十百千万\d]+[节章回卷集部篇]/u.test(text) && text.length < 40;
}

export interface StreamChapterResult {
  /** Beads with Vietnamese indices absolute in the stream. */
  beads: AlignBead[];
  accepted: boolean;
  confidence: number;
}

/**
 * Aligns chapters one after another against a continuous Vietnamese stream.
 * Rejected chapters (prefaces, author notes, missing chapters) do not move the
 * stream pointer, so one bad chapter cannot shift the rest of the book.
 */
/** A resync may move at most this share of the stream (or MIN_RESYNC_WINDOW units). */
const RESYNC_WINDOW_SHARE = 0.02;
const MIN_RESYNC_WINDOW = 400;
/** Chapters shorter than this are never placed by resync. */
const MIN_RESYNC_UNITS = 8;
/** Chapters shorter than this are left to machine translation. */
const MIN_CHAPTER_UNITS = 3;
const MIN_CHAPTER_CHARS = 150;
/** Leading Vietnamese units a chapter may leave unmatched (notes, front matter). */
const SKIP_START_UNITS = 12;

/**
 * Content check for a proposed chapter alignment: how strongly the paired
 * texts agree (e.g. Hán-Việt cognates and names per pair). Length-based
 * alignment alone can latch onto unrelated text of similar rhythm.
 */
export type LexicalScorer = (pairs: Array<{ zh: string; vi: string }>) => number;

/** Pairs scored per chapter (evenly sampled) to keep the check cheap. */
const LEXICAL_SAMPLE = 12;
/** Absolute floor, and share of the book's running average a chapter must reach. */
const LEXICAL_FLOOR = 0.3;
const LEXICAL_SHARE = 0.25;

export class StreamingAligner {
  private pointer = 0;
  private currentRatio: number;
  private readonly vi: AlignUnitFeatures[];
  private readonly viTexts: string[];
  private readonly logLengths: number[];
  private readonly scorer: LexicalScorer | null;
  private lexicalTotal = 0;
  private lexicalCount = 0;
  private lexicalOnlyRejections = 0;

  constructor(viUnits: string[], initialRatio = 3.6, scorer: LexicalScorer | null = null) {
    this.viTexts = viUnits;
    this.scorer = scorer;
    this.vi = viUnits.map(unitFeatures);
    this.logLengths = this.vi.map(unit => Math.log1p(unit.length));
    this.currentRatio = initialRatio;
  }

  get position(): number {
    return this.pointer;
  }

  /** Current Vietnamese/Chinese length ratio learned from accepted chapters. */
  get ratio(): number {
    return this.currentRatio;
  }

  get total(): number {
    return this.vi.length;
  }

  private alignAt(zh: AlignUnitFeatures[], start: number): AlignResult {
    let windowSize = Math.ceil(zh.length * 1.4) + 25;
    let result: AlignResult;
    for (;;) {
      const window = this.vi.slice(start, start + windowSize);
      result = alignUnits(zh, window, { ratio: this.currentRatio, freeEnd: true, skipStart: SKIP_START_UNITS });
      const exhausted = result.viConsumed >= window.length && start + window.length < this.vi.length;
      if (!exhausted || windowSize > zh.length * 4 + 200) break;
      windowSize *= 2;
    }
    return result;
  }

  /**
   * Finds likely start offsets of a chapter anywhere in the stream by comparing
   * the log-length profile of its first paragraphs (tolerating ±1 drift).
   * Editions sometimes reorder, merge or drop chapters; this lets alignment
   * recover instead of failing for the rest of the book.
   */
  private searchCandidates(zh: AlignUnitFeatures[], count: number, from: number, to: number): number[] {
    const probe = zh.slice(0, Math.min(zh.length, 30));
    if (probe.length < 6) return [];
    const target = probe.map(unit => Math.log1p(unit.length * this.currentRatio));
    const logs = this.logLengths;
    const best: Array<{ offset: number; score: number }> = [];
    const limit = Math.min(to, this.vi.length - probe.length);
    for (let offset = Math.max(0, from); offset <= limit; offset++) {
      let score = 0;
      for (let k = 0; k < probe.length; k++) {
        const index = offset + k;
        let local = Math.abs(logs[index]! - target[k]!);
        if (index + 1 < logs.length) local = Math.min(local, Math.abs(logs[index + 1]! - target[k]!) + 0.15);
        if (index > offset) local = Math.min(local, Math.abs(logs[index - 1]! - target[k]!) + 0.15);
        if (this.vi[index]!.quote !== probe[k]!.quote) local += 0.5;
        score += local;
        if (best.length === count && score >= best[best.length - 1]!.score) break;
      }
      if (best.length < count || score < best[best.length - 1]!.score) {
        best.push({ offset, score });
        best.sort((a, b) => a.score - b.score);
        if (best.length > count) best.pop();
      }
    }
    return best.map(candidate => candidate.offset);
  }

  /**
   * Whether an alignment's pairs agree in content. Uses an absolute floor and
   * a share of the running average (books differ in how many cognates they
   * have). If the check keeps rejecting otherwise confident alignments, the
   * book has no usable signal and the check switches itself off.
   */
  private lexicallyPlausible(zhUnits: string[], result: AlignResult, start: number): boolean {
    if (!this.scorer || this.lexicalOnlyRejections >= 20) return true;
    const groups = normalizeBeads(result.beads.map(bead => ({ zh: [...bead.zh], vi: [...bead.vi] })))
      .filter(group => group.zh.length > 0 && group.vi.length > 0);
    if (groups.length === 0) return false;
    const step = Math.max(1, groups.length / LEXICAL_SAMPLE);
    const pairs: Array<{ zh: string; vi: string }> = [];
    for (let position = 0; position < groups.length && pairs.length < LEXICAL_SAMPLE; position += step) {
      const group = groups[Math.floor(position)]!;
      pairs.push({
        zh: group.zh.map(index => zhUnits[index]!).join(''),
        vi: group.vi.map(index => this.viTexts[start + index]!).join(' '),
      });
    }
    const score = this.scorer(pairs);
    const average = this.lexicalCount >= 10 ? this.lexicalTotal / this.lexicalCount : null;
    const threshold = average === null ? LEXICAL_FLOOR : Math.min(LEXICAL_FLOOR, average * LEXICAL_SHARE);
    if (score < threshold) {
      this.lexicalOnlyRejections++;
      return false;
    }
    this.lexicalOnlyRejections = 0;
    this.lexicalTotal += score;
    this.lexicalCount++;
    return true;
  }

  /**
   * Align the next chapter.
   *
   * When the chapter does not match where the stream left off, nearby
   * offsets are searched. A match found that way is accepted only if it is
   * not far away and the following chapter (`lookahead`) also continues right
   * after it. Without these checks, short front matter or a chapter missing
   * from the translation can latch onto unrelated text far in the book (the
   * stream then snaps back on the next chapter, but the wrong text stays).
   */
  alignChapter(zhUnits: string[], options: { minConfidence?: number; lookahead?: string[] } = {}): StreamChapterResult {
    const minConfidence = options.minConfidence ?? 0.55;
    const zh = zhUnits.map(unitFeatures);
    if (zh.length === 0 || this.vi.length === 0) return { beads: [], accepted: false, confidence: 0 };

    // Volume titles, copyright pages and similar short pages carry no
    // reliable signal; aligning them only steals the neighbouring text.
    const zhLength = zh.reduce((sum, unit) => sum + unit.length, 0);
    if (zh.length < MIN_CHAPTER_UNITS || zhLength < MIN_CHAPTER_CHARS) return { beads: [], accepted: false, confidence: 0 };

    let start = this.pointer;
    let result = start < this.vi.length ? this.alignAt(zh, start) : null;
    if (result && result.confidence >= minConfidence && !this.lexicallyPlausible(zhUnits, result, start)) result = null;
    if (!result || result.confidence < minConfidence) {
      const lookahead = options.lookahead?.map(unitFeatures) ?? [];
      const maxJump = Math.max(MIN_RESYNC_WINDOW, Math.round(this.vi.length * RESYNC_WINDOW_SHARE));
      // Short chapters match too easily by length alone: never resync them.
      const candidates = zh.length < MIN_RESYNC_UNITS
        ? []
        : this.searchCandidates(zh, 4, this.pointer - maxJump, this.pointer + maxJump);
      for (const candidate of candidates) {
        const from = Math.max(0, candidate - 2);
        const attempt = this.alignAt(zh, from);
        if (attempt.confidence < minConfidence || (result && attempt.confidence <= result.confidence)) continue;
        if (lookahead.length > 0) {
          const next = this.alignAt(lookahead, from + attempt.viConsumed);
          if (next.confidence < minConfidence) continue;
        }
        if (!this.lexicallyPlausible(zhUnits, attempt, from)) continue;
        result = attempt;
        start = from;
      }
    }

    if (!result || result.confidence < minConfidence) {
      return { beads: [], accepted: false, confidence: result?.confidence ?? 0 };
    }

    // Vietnamese paragraphs before the first match belong to nothing in this
    // chapter (skipped notes, or slack left by a resync); never attach them.
    while (result.beads.length > 0 && result.beads[0]!.zh.length === 0) result.beads.shift();
    let zhChars = 0;
    let viChars = 0;
    for (const bead of result.beads) {
      for (const index of bead.zh) zhChars += zh[index]!.length;
      for (let k = 0; k < bead.vi.length; k++) {
        viChars += this.vi[start + bead.vi[k]!]!.length;
        bead.vi[k] = start + bead.vi[k]!;
      }
    }
    if (zhChars > 200 && viChars > 0) {
      // Track the translator's verbosity slowly; it differs between editions.
      this.currentRatio = this.currentRatio * 0.8 + (viChars / zhChars) * 0.2;
    }
    this.pointer = start + result.viConsumed;
    return { beads: result.beads, accepted: true, confidence: result.confidence };
  }
}

/**
 * Turns beads into groups that each contain at least one unit on both sides.
 * Unmatched units are merged into a neighbouring group so no translation text
 * is ever dropped and no Chinese unit is left dangling.
 */
export function normalizeBeads(beads: AlignBead[]): AlignBead[] {
  const groups: AlignBead[] = [];
  let pendingZh: number[] = [];
  let pendingVi: number[] = [];
  for (const bead of beads) {
    if (bead.zh.length > 0 && bead.vi.length > 0) {
      groups.push({ zh: [...pendingZh, ...bead.zh], vi: [...pendingVi, ...bead.vi] });
      pendingZh = [];
      pendingVi = [];
    } else if (groups.length > 0) {
      const last = groups[groups.length - 1]!;
      last.zh.push(...bead.zh);
      last.vi.push(...bead.vi);
    } else {
      pendingZh.push(...bead.zh);
      pendingVi.push(...bead.vi);
    }
  }
  if (groups.length === 0 && (pendingZh.length > 0 || pendingVi.length > 0)) {
    groups.push({ zh: pendingZh, vi: pendingVi });
  }
  return groups;
}
