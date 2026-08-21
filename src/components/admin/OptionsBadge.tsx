import React, { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { ListChecks } from 'lucide-react';

/**
 * The "N 個選項" badge, with the options themselves one tap away.
 *
 * The admin list shows the question but not what the player will be choosing
 * between, and spelling every option out inline would bury the questions. A tap
 * is enough — and it has to be a tap, not a `title` attribute, because that
 * never appears on a touch screen.
 */
export const OptionsBadge: React.FC<{ options: string[] }> = ({ options }) => {
  const [isOpen, setIsOpen] = useState(false);
  const [placeAbove, setPlaceAbove] = useState(false);
  const wrapRef = useRef<HTMLSpanElement | null>(null);

  useEffect(() => {
    if (!isOpen) return;
    const onPointerDown = (event: MouseEvent | TouchEvent) => {
      const node = wrapRef.current;
      if (node && !node.contains(event.target as Node)) setIsOpen(false);
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setIsOpen(false);
    };
    document.addEventListener('mousedown', onPointerDown);
    document.addEventListener('touchstart', onPointerDown);
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('mousedown', onPointerDown);
      document.removeEventListener('touchstart', onPointerDown);
      document.removeEventListener('keydown', onKeyDown);
    };
  }, [isOpen]);

  // A row near the bottom of a long library would open its list off-screen.
  useLayoutEffect(() => {
    if (!isOpen || !wrapRef.current) return;
    const rect = wrapRef.current.getBoundingClientRect();
    setPlaceAbove(window.innerHeight - rect.bottom < 220 && rect.top > 220);
  }, [isOpen]);

  if (options.length === 0) return null;

  return (
    <span ref={wrapRef} className="relative inline-flex">
      <button
        type="button"
        onClick={() => setIsOpen((v) => !v)}
        aria-expanded={isOpen}
        aria-label={`查看 ${options.length} 個選項`}
        className={`inline-flex cursor-pointer items-center gap-1 rounded-md px-2 py-0.5 text-[10px] font-bold transition-colors ${
          isOpen
            ? 'bg-purple-200 text-purple-900'
            : 'bg-purple-100 text-purple-700 hover:bg-purple-200'
        }`}
      >
        {options.length} 個選項
        <ListChecks className="h-3 w-3 opacity-70" />
      </button>

      {isOpen && (
        <div
          role="tooltip"
          className={`absolute left-0 z-30 w-max max-w-[min(20rem,70vw)] rounded-2xl border border-[#E8DFD3] bg-white px-3 py-2 shadow-lg ${
            placeAbove ? 'bottom-full mb-1.5' : 'top-full mt-1.5'
          }`}
        >
          <ol className="space-y-1">
            {options.map((opt, idx) => (
              <li key={idx} className="flex items-start gap-1.5 text-[11px] leading-relaxed">
                <span className="mt-px flex h-4 w-4 shrink-0 items-center justify-center rounded-md bg-purple-100 text-[9px] font-bold text-purple-700">
                  {idx + 1}
                </span>
                <span className="min-w-0 break-words text-[#3A2E2B]">{opt}</span>
              </li>
            ))}
          </ol>
        </div>
      )}
    </span>
  );
};
