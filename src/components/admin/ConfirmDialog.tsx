import React, { useEffect } from 'react';
import { AlertTriangle, type LucideIcon } from 'lucide-react';

/**
 * The admin toolbar is a row of icon-only buttons — easy to hit by accident on
 * a phone — so every one of them confirms first. This is the shared dialog they
 * all go through, replacing the native confirm() that earlier versions used.
 */

export type ConfirmTone = 'neutral' | 'danger';

export interface ConfirmRequest {
  title: string;
  description: React.ReactNode;
  /** Optional secondary panel, for caveats worth setting apart. */
  note?: React.ReactNode;
  confirmLabel: string;
  tone?: ConfirmTone;
  icon?: LucideIcon;
  /** Runs on confirm; the dialog stays open and busy until it settles. */
  run: () => void | Promise<void>;
}

interface ConfirmDialogProps {
  request: ConfirmRequest | null;
  isBusy: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}

const TONES: Record<ConfirmTone, { badge: string; confirm: string }> = {
  neutral: {
    badge: 'bg-[#EFE3D4] text-[#8C6D53]',
    confirm: 'milk-tea-btn-primary',
  },
  danger: {
    badge: 'bg-rose-100 text-rose-700',
    confirm: 'bg-rose-600 hover:bg-rose-700 text-white',
  },
};

export const ConfirmDialog: React.FC<ConfirmDialogProps> = ({
  request,
  isBusy,
  onConfirm,
  onCancel,
}) => {
  const isOpen = Boolean(request);

  useEffect(() => {
    if (!isOpen) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && !isBusy) onCancel();
    };
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [isOpen, isBusy, onCancel]);

  if (!request) return null;

  const tone = TONES[request.tone || 'neutral'];
  const Icon = request.icon || AlertTriangle;

  return (
    <div
      className="animate-fade-in fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4 backdrop-blur-xs"
      onClick={() => !isBusy && onCancel()}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label={request.title}
        onClick={(event) => event.stopPropagation()}
        className="w-full max-w-md space-y-4 rounded-3xl border border-[#E8DFD3] bg-[#FCFAF6] p-6"
      >
        <div className="flex items-start gap-3">
          <div
            className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-xl ${tone.badge}`}
          >
            <Icon className="h-5 w-5" />
          </div>
          <div className="min-w-0">
            <h3 className="text-base font-bold text-[#3A2E2B]">{request.title}</h3>
            <div className="mt-1 text-xs leading-relaxed text-[#7A6C65]">{request.description}</div>
          </div>
        </div>

        {request.note && (
          <div className="rounded-2xl border border-[#E8DFD3] bg-[#F5EFE6] p-3 text-[11px] leading-relaxed text-[#7A6C65]">
            {request.note}
          </div>
        )}

        <div className="flex items-center gap-2 pt-1">
          <button
            type="button"
            onClick={onCancel}
            disabled={isBusy}
            className="flex-1 cursor-pointer rounded-xl border border-[#D0BFAC] bg-white px-4 py-2.5 text-sm font-semibold text-[#7A6C65] transition-colors hover:bg-[#F4ECE1] disabled:opacity-50"
          >
            取消
          </button>
          <button
            type="button"
            onClick={onConfirm}
            disabled={isBusy}
            className={`inline-flex flex-1 cursor-pointer items-center justify-center gap-1.5 rounded-xl px-4 py-2.5 text-sm font-bold transition-colors disabled:opacity-50 ${tone.confirm}`}
          >
            <Icon className="h-4 w-4" />
            {isBusy ? '處理中…' : request.confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
};
