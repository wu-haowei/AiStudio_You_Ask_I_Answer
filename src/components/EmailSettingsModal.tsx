import React, { useEffect, useState } from 'react';
import { X, Mail } from 'lucide-react';
import { AuthError, getRecoveryEmail, setRecoveryEmail } from '../lib/accounts';
import { useT } from '../i18n';

interface EmailSettingsModalProps {
  isOpen: boolean;
  onClose: () => void;
  /** The signed-in account's name — settings are always about "my own" email. */
  name: string;
  showToast: (
    title: string,
    description?: string,
    type?: 'success' | 'error' | 'info' | 'warning'
  ) => void;
}

/**
 * Lets a signed-in person see and change their own recovery email — the
 * mandatory setup at login only ever runs once, so this is the only way back
 * in if that address stops working (changed jobs, mistyped it, etc).
 *
 * Reuses setRecoveryEmail exactly as the login flow does: Firebase already
 * treats "link a first email" and "replace the one already linked" as the
 * same call from this account's side (see that function's doc comment), so
 * there is nothing special to do here for "change" versus "set".
 */
export const EmailSettingsModal: React.FC<EmailSettingsModalProps> = ({
  isOpen,
  onClose,
  name,
  showToast,
}) => {
  const t = useT();
  // The address sits in its own bold span mid-sentence, so the sentence is split around a marker
  // instead of concatenated — other languages put it in a different place.
  const [beforeEmail, afterEmail] = t('email.currentIs', { email: '@@EMAIL@@' }).split('@@EMAIL@@');
  const [currentEmail, setCurrentEmail] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [nextEmail, setNextEmail] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    if (!isOpen) return;
    let cancelled = false;
    setIsLoading(true);
    setError('');
    setNextEmail('');
    getRecoveryEmail(name)
      .then((email) => {
        if (cancelled) return;
        setCurrentEmail(email || null);
      })
      .catch(() => {
        if (!cancelled) setCurrentEmail(null);
      })
      .finally(() => {
        if (!cancelled) setIsLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [isOpen, name]);

  if (!isOpen) return null;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (busy || !nextEmail.trim()) return;

    setBusy(true);
    setError('');
    try {
      const result = await setRecoveryEmail(name, nextEmail);
      const submitted = nextEmail.trim();
      setNextEmail('');
      if (result === 'reauth-required') {
        showToast(
          t('email.confirmOldTitle'),
          t('email.confirmOldBody'),
          'info'
        );
      } else if (result === 'verification-sent') {
        showToast(
          t('email.checkInboxTitle'),
          t('email.checkInboxBody', { email: submitted }),
          'info'
        );
      } else {
        showToast(t('email.noChange'), t('email.noChangeBody'), 'info');
      }
    } catch (err) {
      setError(err instanceof AuthError ? err.message : t('common.genericError'));
      console.warn('[email-settings]', err);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/40 backdrop-blur-xs animate-fade-in">
      <div className="bg-[#FCFAF6] rounded-3xl border border-[#E8DFD3] shadow-2xl max-w-sm w-full overflow-hidden">
        <div className="px-6 py-5 bg-[#F5EFE6] border-b border-[#E8DFD3] flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Mail className="w-5 h-5 text-[#8C6D53]" />
            <h3 className="text-base font-bold text-[#3A2E2B]">{t('header.recoveryEmail')}</h3>
          </div>
          <button
            onClick={onClose}
            className="p-1.5 rounded-xl text-[#7A6C65] hover:bg-[#EADDCB] transition-colors cursor-pointer"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="p-6 space-y-4">
          <p className="text-xs text-[#7A6C65]">
            {isLoading
              ? t('email.loading')
              : currentEmail
              ? <>{beforeEmail}<span className="font-semibold text-[#4A3F35]">{currentEmail}</span>{afterEmail}</>
              : t('email.none')}
          </p>

          <form onSubmit={handleSubmit} className="space-y-3">
            <div className="space-y-1.5">
              <label htmlFor="settings-email" className="block text-xs font-bold text-[#7A6C5E]">
                {currentEmail ? t('email.changeLabel') : t('email.setLabel')}
              </label>
              <input
                id="settings-email"
                type="email"
                value={nextEmail}
                onChange={(e) => setNextEmail(e.target.value)}
                placeholder={t('email.placeholder')}
                autoComplete="email"
                className="w-full px-4 py-2.5 rounded-2xl border border-[#D9C5B2] bg-white text-sm font-semibold text-[#4A3F35] focus:outline-none focus:ring-2 focus:ring-[#8E7256]"
              />
            </div>

            {error && (
              <p className="text-xs text-rose-600 font-semibold leading-relaxed">{error}</p>
            )}

            <div className="flex items-center justify-end gap-3 pt-1">
              <button
                type="button"
                onClick={onClose}
                className="px-4 py-2 rounded-xl text-xs font-semibold text-[#7A6C65] hover:bg-[#F2EBE1] cursor-pointer"
              >
                {currentEmail ? t('common.close') : t('email.notNow')}
              </button>
              <button
                type="submit"
                disabled={!nextEmail.trim() || busy}
                className="milk-tea-btn-primary px-5 py-2.5 rounded-xl text-xs font-semibold disabled:opacity-50 cursor-pointer"
              >
                {busy ? t('common.saving') : t('common.save')}
              </button>
            </div>
          </form>
        </div>
      </div>
    </div>
  );
};
