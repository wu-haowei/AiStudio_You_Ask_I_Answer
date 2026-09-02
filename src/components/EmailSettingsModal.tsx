import React, { useEffect, useState } from 'react';
import { X, Mail } from 'lucide-react';
import { AuthError, lookupAccount, setRecoveryEmail } from '../lib/accounts';

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
    lookupAccount(name)
      .then((account) => {
        if (cancelled) return;
        setCurrentEmail(account.email || null);
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
          '請先確認身份',
          '為了安全，Firebase 要求重新驗證一次身份——已寄一封確認信到目前設定的 Email，請先點裡面的連結，完成後才會繼續寄驗證信到新的 Email',
          'info'
        );
      } else if (result === 'verification-sent') {
        showToast(
          '請至新 Email 收信',
          `已寄出驗證信到 ${submitted}，點裡面的連結完成驗證後，下次登入這裡就會換成新的救援 Email`,
          'info'
        );
      } else {
        setCurrentEmail(submitted);
        showToast('已更新救援 Email', undefined, 'success');
      }
    } catch (err) {
      setError(err instanceof AuthError ? err.message : '發生錯誤，請稍後再試');
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
            <h3 className="text-base font-bold text-[#3A2E2B]">救援 Email</h3>
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
              ? '讀取中…'
              : currentEmail
              ? <>目前設定的是 <span className="font-semibold text-[#4A3F35]">{currentEmail}</span>，忘記密碼時會寄重設信到這裡。</>
              : '目前還沒有設定救援 Email——設定好之後，忘記密碼時才能自己寄信重設，不用麻煩對方幫忙改。'}
          </p>

          <form onSubmit={handleSubmit} className="space-y-3">
            <div className="space-y-1.5">
              <label htmlFor="settings-email" className="block text-xs font-bold text-[#7A6C5E]">
                {currentEmail ? '換成新的 Email' : '設定 Email'}
              </label>
              <input
                id="settings-email"
                type="email"
                value={nextEmail}
                onChange={(e) => setNextEmail(e.target.value)}
                placeholder="輸入 Email"
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
                {currentEmail ? '關閉' : '先不要，之後再說'}
              </button>
              <button
                type="submit"
                disabled={!nextEmail.trim() || busy}
                className="milk-tea-btn-primary px-5 py-2.5 rounded-xl text-xs font-semibold disabled:opacity-50 cursor-pointer"
              >
                {busy ? '儲存中…' : '儲存'}
              </button>
            </div>
          </form>
        </div>
      </div>
    </div>
  );
};
