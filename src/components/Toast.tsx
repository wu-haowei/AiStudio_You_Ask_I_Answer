import React, { useEffect } from 'react';
import { CheckCircle2, AlertCircle, Info, X, AlertTriangle } from 'lucide-react';
import { ToastMessage } from '../types';

interface ToastProps {
  toasts: ToastMessage[];
  onDismiss: (id: string) => void;
}

/** Never stack more than this many notifications at once. */
const MAX_VISIBLE_TOASTS = 2;

/** How long a notification stays on screen. */
const TOAST_DURATION_MS = 1500;

export const ToastContainer: React.FC<ToastProps> = ({ toasts, onDismiss }) => {
  // Keep the newest notifications; anything older is dropped immediately.
  const visible = toasts.slice(-MAX_VISIBLE_TOASTS);

  useEffect(() => {
    for (const toast of toasts.slice(0, -MAX_VISIBLE_TOASTS)) onDismiss(toast.id);
  }, [toasts, onDismiss]);

  return (
    <div className="fixed top-16 sm:top-20 right-3 sm:right-6 z-50 flex flex-col max-w-sm w-[calc(100%-1.5rem)] sm:w-full sm:gap-2.5 pointer-events-none">
      {visible.map((toast, idx) => (
        <div
          key={toast.id}
          /*
           * On phones the newest notification slides over the previous one so
           * the pair occupies roughly one card's height instead of two, keeping
           * the header underneath reachable.
           */
          className={idx > 0 ? '-mt-11 sm:mt-0' : ''}
          style={{ zIndex: idx + 1 }}
        >
          <ToastItem
            toast={toast}
            onDismiss={onDismiss}
            isCovered={idx < visible.length - 1}
          />
        </div>
      ))}
    </div>
  );
};

const ToastItem: React.FC<{
  toast: ToastMessage;
  onDismiss: (id: string) => void;
  isCovered: boolean;
}> = ({ toast, onDismiss, isCovered }) => {
  useEffect(() => {
    const timer = setTimeout(() => onDismiss(toast.id), TOAST_DURATION_MS);
    return () => clearTimeout(timer);
  }, [toast.id, onDismiss]);

  const getIcon = () => {
    switch (toast.type) {
      case 'success':
        return <CheckCircle2 className="w-5 h-5 text-emerald-600 shrink-0" />;
      case 'error':
        return <AlertCircle className="w-5 h-5 text-rose-600 shrink-0" />;
      case 'warning':
        return <AlertTriangle className="w-5 h-5 text-amber-600 shrink-0" />;
      default:
        return <Info className="w-5 h-5 text-amber-800 shrink-0" />;
    }
  };

  return (
    /*
     * The card itself never intercepts taps — only the close button does — so a
     * notification sitting over a button cannot swallow the tap meant for it.
     */
    <div
      className={`pointer-events-none flex items-start justify-between gap-3 px-3.5 py-3 sm:p-4 rounded-xl bg-white border border-[#E8DFD3] shadow-lg shadow-[#8C6D53]/10 animate-fade-in transition-all ${
        isCovered ? 'opacity-90 sm:opacity-100' : ''
      }`}
    >
      <div className="flex items-start gap-2.5 min-w-0">
        {getIcon()}
        <div className="min-w-0">
          <h4 className="text-sm font-semibold text-[#3A2E2B] truncate">{toast.title}</h4>
          {toast.description && (
            <p className="text-xs text-[#7A6C65] mt-0.5 leading-relaxed line-clamp-2">
              {toast.description}
            </p>
          )}
        </div>
      </div>
      <button
        onClick={() => onDismiss(toast.id)}
        className="pointer-events-auto shrink-0 p-1 rounded-lg text-[#7A6C65] hover:text-[#3A2E2B] hover:bg-[#F4ECE1] transition-colors"
        aria-label="關閉提示"
      >
        <X className="w-4 h-4" />
      </button>
    </div>
  );
};
