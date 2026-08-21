import React, { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { Award, ListChecks, Reply } from 'lucide-react';
import { RoomQuestion } from '../../types';
import { readPicks } from '../../lib/firebase';

/**
 * The reveal message is stored as plain text so rounds written by older builds
 * keep rendering. This file parses that text back into chips; tapping one opens
 * the round's full option list, which the text alone cannot show.
 *
 * Shape produced by CoPlayView.handleSubmitOption:
 *
 *   猜對了！
 *   真心話：1. 在家追劇 ／ 2. 出門喝咖啡 (說明: 天氣太熱)
 *   猜測：1. 在家追劇
 */

/** The "其他 (自訂猜測)" slot, fixed at index 4 by the answer modal. */
const OTHER_INDEX = 4;

/** One ranked option inside a reveal line. */
interface RevealPick {
  /** Preference order as shown to the player, e.g. "1". Empty when unparsed. */
  rank: string;
  label: string;
}

interface RevealLine {
  /** "真心話" / "猜測". Empty when the line is not a picks line. */
  label: string;
  picks: RevealPick[];
  note?: string;
  /** Original text, rendered as-is when the line carries no picks. */
  raw: string;
}

const LINE_RE = /^(真心話|猜測)[:：]([\s\S]*)$/;
const NOTE_RE = /\s*[（(]\s*說明\s*[:：]\s*([\s\S]*?)\s*[)）]\s*$/;
/** Splits on the " ／ " joiner, but only where a new "N. " actually begins. */
const PICK_SPLIT_RE = /\s*[／/]\s*(?=\d+\.\s)/;
const PICK_RE = /^(\d+)\.\s*([\s\S]*)$/;

/** "1. 在家追劇 ／ 2. 出門喝咖啡 (說明: …)" → picks + note. */
const parsePickList = (body: string): { picks: RevealPick[]; note?: string } => {
  let rest = body.trim();
  let note: string | undefined;

  const noteMatch = rest.match(NOTE_RE);
  if (noteMatch && typeof noteMatch.index === 'number') {
    note = noteMatch[1];
    rest = rest.slice(0, noteMatch.index).trim();
  }

  const picks = rest
    .split(PICK_SPLIT_RE)
    .map((part) => part.trim())
    .filter(Boolean)
    .map<RevealPick>((part) => {
      const pick = part.match(PICK_RE);
      return pick ? { rank: pick[1], label: pick[2].trim() } : { rank: '', label: part };
    });

  return { picks, note };
};

export const parseRevealText = (text: string): RevealLine[] =>
  text.split('\n').map<RevealLine>((raw) => {
    const matched = raw.match(LINE_RE);
    if (!matched) return { label: '', picks: [], raw };

    const { picks, note } = parsePickList(matched[2]);
    if (picks.length === 0) return { label: '', picks: [], raw };
    return { label: matched[1], picks, note, raw };
  });

/** One row of the "all options" panel. */
interface OptionRow {
  index: number;
  label: string;
  /** 1-based preference order, when that side picked this option. */
  targetRank?: number;
  guessRank?: number;
}

/**
 * Rebuilds the round's whole option list, marking who picked what.
 *
 * The custom "其他" text only survives inside targetAnswerText /
 * initiatorGuessText, and those labels are written in the same order as the
 * stored index list — so zipping the two recovers it.
 */
export const buildOptionRows = (question: RoomQuestion): OptionRow[] => {
  const targetPicks = readPicks(question, 'target');
  const guessPicks = readPicks(question, 'initiator');

  const customLabels = new Map<number, string>();
  const collect = (text: string | undefined, picks: number[]) => {
    if (!text) return;
    parsePickList(text).picks.forEach((pick, i) => {
      const index = picks[i];
      if (index !== undefined && pick.label) customLabels.set(index, pick.label);
    });
  };
  collect(question.targetAnswerText, targetPicks);
  collect(question.initiatorGuessText, guessPicks);

  const rows: OptionRow[] = (question.options || []).map((label, index) => ({ index, label }));

  // Only a question with fewer than five options leaves index 4 free for "其他".
  const hasOther = targetPicks.includes(OTHER_INDEX) || guessPicks.includes(OTHER_INDEX);
  if (rows.length <= OTHER_INDEX && hasOther) {
    rows.push({ index: OTHER_INDEX, label: customLabels.get(OTHER_INDEX) || '其他' });
  }

  return rows.map((row) => {
    const target = targetPicks.indexOf(row.index);
    const guess = guessPicks.indexOf(row.index);
    return {
      ...row,
      targetRank: target >= 0 ? target + 1 : undefined,
      guessRank: guess >= 0 ? guess + 1 : undefined,
    };
  });
};

type ToneName = 'correct' | 'wrong';

interface Tone {
  card: string;
  chip: string;
  rank: string;
  popover: string;
  targetBadge: string;
  guessBadge: string;
}

const TONES: Record<ToneName, Tone> = {
  correct: {
    card: 'bg-emerald-50/90 border-emerald-300 text-emerald-900',
    chip: 'bg-white/70 border-emerald-300/80',
    rank: 'bg-emerald-600 text-white',
    popover: 'bg-white border-emerald-300 text-emerald-900',
    targetBadge: 'bg-emerald-100 text-emerald-800 border-emerald-300',
    guessBadge: 'bg-sky-100 text-sky-800 border-sky-300',
  },
  wrong: {
    card: 'bg-amber-50/90 border-amber-300 text-amber-900',
    chip: 'bg-white/70 border-amber-300/80',
    rank: 'bg-amber-600 text-white',
    popover: 'bg-white border-amber-300 text-amber-900',
    targetBadge: 'bg-amber-100 text-amber-800 border-amber-300',
    guessBadge: 'bg-sky-100 text-sky-800 border-sky-300',
  },
};

/** Hover tooltips are pointless on touch, and can fire spuriously after a tap. */
const useHasHover = () => {
  const [hasHover, setHasHover] = useState(false);
  useEffect(() => {
    if (typeof window.matchMedia !== 'function') return;
    const query = window.matchMedia('(hover: hover) and (pointer: fine)');
    setHasHover(query.matches);
    const onChange = (event: MediaQueryListEvent) => setHasHover(event.matches);
    query.addEventListener('change', onChange);
    return () => query.removeEventListener('change', onChange);
  }, []);
  return hasHover;
};

interface PickChipProps {
  pick: RevealPick;
  tone: Tone;
  isActive: boolean;
  isInteractive: boolean;
  onRequestOpen: (open: boolean) => void;
  hasHover: boolean;
}

const PickChip: React.FC<PickChipProps> = ({
  pick,
  tone,
  isActive,
  isInteractive,
  onRequestOpen,
  hasHover,
}) => (
  <button
    type="button"
    onClick={() => isInteractive && onRequestOpen(!isActive)}
    onMouseEnter={() => hasHover && isInteractive && onRequestOpen(true)}
    onMouseLeave={() => hasHover && isInteractive && onRequestOpen(false)}
    aria-expanded={isInteractive ? isActive : undefined}
    aria-label={isInteractive ? `${pick.label}（查看全部選項）` : undefined}
    className={`inline-flex max-w-[11rem] items-center gap-1.5 rounded-xl border px-2 py-1 text-left transition-colors sm:max-w-[18rem] ${
      tone.chip
    } ${isInteractive ? 'cursor-pointer hover:bg-white' : 'cursor-default'} ${
      isActive ? 'bg-white ring-2 ring-black/15' : ''
    }`}
  >
    {pick.rank && (
      <span
        className={`flex h-4 w-4 shrink-0 items-center justify-center rounded-md text-[9px] font-bold ${tone.rank}`}
      >
        {pick.rank}
      </span>
    )}
    <span className="truncate">{pick.label}</span>
    {isInteractive && <ListChecks className="h-3 w-3 shrink-0 opacity-50" />}
  </button>
);

interface OptionsPanelProps {
  question: RoomQuestion;
  rows: OptionRow[];
  /** Option index of the chip that was tapped, highlighted in the list. */
  activeIndex?: number;
  tone: Tone;
}

const OptionsPanel: React.FC<OptionsPanelProps> = ({ question, rows, activeIndex, tone }) => (
  <>
    <div className="mb-1.5 border-b border-black/10 pb-1.5 text-[10px] leading-snug font-bold break-words opacity-70">
      {question.question}
    </div>
    <ul className="space-y-0.5">
      {rows.map((row) => (
        <li
          key={row.index}
          className={`flex items-start gap-1.5 rounded-lg px-1.5 py-1 ${
            row.index === activeIndex ? 'bg-black/5' : ''
          }`}
        >
          <span className="mt-px flex h-4 w-4 shrink-0 items-center justify-center rounded-md bg-black/10 text-[9px] font-bold">
            {row.index === OTHER_INDEX && rows.length <= OTHER_INDEX + 1 ? '他' : row.index + 1}
          </span>
          <span className="min-w-0 flex-1 break-words">{row.label}</span>
          <span className="flex shrink-0 flex-wrap justify-end gap-1">
            {row.targetRank !== undefined && (
              <span
                className={`rounded-md border px-1 py-px text-[9px] font-bold ${tone.targetBadge}`}
              >
                真心話{rows.some((r) => r.targetRank === 2) ? ` ${row.targetRank}` : ''}
              </span>
            )}
            {row.guessRank !== undefined && (
              <span
                className={`rounded-md border px-1 py-px text-[9px] font-bold ${tone.guessBadge}`}
              >
                猜測{rows.some((r) => r.guessRank === 2) ? ` ${row.guessRank}` : ''}
              </span>
            )}
          </span>
        </li>
      ))}
    </ul>
  </>
);

interface RevealLineRowProps {
  line: RevealLine;
  lineIdx: number;
  tone: Tone;
  hasHover: boolean;
  question?: RoomQuestion;
  rows: OptionRow[];
  /** Option indexes this side picked, positionally matching line.picks. */
  pickedIndexes: number[];
  activeKey: string | null;
  onRequestOpen: (key: string, open: boolean) => void;
}

const RevealLineRow: React.FC<RevealLineRowProps> = ({
  line,
  lineIdx,
  tone,
  hasHover,
  question,
  rows,
  pickedIndexes,
  activeKey,
  onRequestOpen,
}) => {
  const rowRef = useRef<HTMLDivElement | null>(null);
  const [placeAbove, setPlaceAbove] = useState(false);

  const activePickIdx = line.picks.findIndex((_, i) => activeKey === `${lineIdx}:${i}`);
  const isOpen = activePickIdx >= 0;
  const canShowOptions = Boolean(question) && rows.length > 0;

  // A card near the bottom of the thread would open its panel off-screen.
  useLayoutEffect(() => {
    if (!isOpen || !rowRef.current) return;
    const rect = rowRef.current.getBoundingClientRect();
    setPlaceAbove(window.innerHeight - rect.bottom < 260 && rect.top > 260);
  }, [isOpen]);

  return (
    <div ref={rowRef} className="relative">
      <div className="flex flex-wrap items-center gap-1.5">
        <span className="shrink-0">{line.label}：</span>
        {line.picks.map((pick, pickIdx) => {
          const key = `${lineIdx}:${pickIdx}`;
          return (
            <PickChip
              key={key}
              pick={pick}
              tone={tone}
              isActive={activeKey === key}
              isInteractive={canShowOptions}
              onRequestOpen={(open) => onRequestOpen(key, open)}
              hasHover={hasHover}
            />
          );
        })}
      </div>

      {line.note && (
        <div className="mt-1 text-[11px] font-medium break-words opacity-70">說明：{line.note}</div>
      )}

      {isOpen && question && (
        <div
          role="tooltip"
          className={`absolute inset-x-0 z-20 rounded-2xl border px-3 py-2 text-[11px] leading-relaxed font-medium shadow-lg ${
            tone.popover
          } ${placeAbove ? 'bottom-full mb-1.5' : 'top-full mt-1.5'}`}
        >
          <OptionsPanel
            question={question}
            rows={rows}
            activeIndex={pickedIndexes[activePickIdx]}
            tone={tone}
          />
        </div>
      )}
    </div>
  );
};

interface RevealResultCardProps {
  text: string;
  isCorrect: boolean;
  /** Attached since the multi-select round; absent on older reveal messages. */
  question?: RoomQuestion;
  onReply: () => void;
}

export const RevealResultCard: React.FC<RevealResultCardProps> = ({
  text,
  isCorrect,
  question,
  onReply,
}) => {
  const tone = TONES[isCorrect ? 'correct' : 'wrong'];
  const hasHover = useHasHover();
  const containerRef = useRef<HTMLDivElement | null>(null);
  /** "lineIndex:pickIndex" of the chip whose option panel is showing. */
  const [activeKey, setActiveKey] = useState<string | null>(null);

  const lines = useMemo(() => parseRevealText(text), [text]);
  const rows = useMemo(() => (question ? buildOptionRows(question) : []), [question]);
  const targetPicks = useMemo(() => (question ? readPicks(question, 'target') : []), [question]);
  const guessPicks = useMemo(() => (question ? readPicks(question, 'initiator') : []), [question]);

  useEffect(() => {
    if (!activeKey) return;
    const onPointerDown = (event: MouseEvent | TouchEvent) => {
      const node = containerRef.current;
      if (node && !node.contains(event.target as Node)) setActiveKey(null);
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setActiveKey(null);
    };
    document.addEventListener('mousedown', onPointerDown);
    document.addEventListener('touchstart', onPointerDown);
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('mousedown', onPointerDown);
      document.removeEventListener('touchstart', onPointerDown);
      document.removeEventListener('keydown', onKeyDown);
    };
  }, [activeKey]);

  const requestOpen = useCallback(
    (key: string, open: boolean) =>
      setActiveKey((prev) => (open ? key : prev === key ? null : prev)),
    []
  );

  return (
    <div
      ref={containerRef}
      className={`w-full max-w-xl space-y-2 rounded-3xl border-2 p-4 shadow-md sm:p-5 ${tone.card}`}
    >
      <div className="flex items-center justify-between border-b border-black/10 pb-2">
        <div className="flex items-center gap-2 text-xs font-bold">
          <Award className="h-4 w-4" />
          <span>揭曉結果</span>
        </div>
        <button
          type="button"
          onClick={onReply}
          aria-label="回覆這則結果"
          className="cursor-pointer rounded-lg p-1.5 transition-colors hover:bg-black/5"
        >
          <Reply className="h-3.5 w-3.5" />
        </button>
      </div>

      <div className="space-y-1.5 pt-1 text-xs font-black leading-relaxed sm:text-sm">
        {lines.map((line, lineIdx) => {
          if (line.picks.length === 0) {
            // Verdict line, or anything written by an older build.
            return line.raw.trim() ? (
              <div key={lineIdx} className="whitespace-pre-line">
                {line.raw}
              </div>
            ) : null;
          }

          return (
            <RevealLineRow
              key={lineIdx}
              line={line}
              lineIdx={lineIdx}
              tone={tone}
              hasHover={hasHover}
              question={question}
              rows={rows}
              pickedIndexes={line.label === '真心話' ? targetPicks : guessPicks}
              activeKey={activeKey}
              onRequestOpen={requestOpen}
            />
          );
        })}
      </div>
    </div>
  );
};
