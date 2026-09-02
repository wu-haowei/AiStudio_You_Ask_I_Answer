import React, { useEffect, useRef, useState } from 'react';
import { CheckCircle2, MailCheck, XCircle } from 'lucide-react';
import { AuthError, completeNewEmailConfirmation } from '../lib/accounts';

interface NewEmailConfirmationViewProps {
  /** The full URL this app was opened with — carries Firebase's oobCode plus this app's own pendingEmail/name params. */
  link: string;
  /** "Back to the app" — never signs anyone into a different session, this link only ever confirms an email. */
  onDone: () => void;
}

type Phase = 'working' | 'done' | 'invalid';

/**
 * Where the "confirm your new recovery email" link from setRecoveryEmail
 * lands, for the very first time an account sets one — see that function's
 * doc comment for why even a first-time setup has to be proven this way now,
 * not accepted on the spot. Can be opened on any device — it only proves
 * ownership of the address, nothing about this app's own session; the
 * address actually lands on the account the next time it signs in for real.
 */
export const NewEmailConfirmationView: React.FC<NewEmailConfirmationViewProps> = ({ link, onDone }) => {
  const [phase, setPhase] = useState<Phase>('working');
  const [confirmedEmail, setConfirmedEmail] = useState('');
  const [error, setError] = useState('');
  /**
   * The oobCode this confirms is single-use — a second attempt with the same
   * link fails with auth/invalid-action-code even though the first one
   * already succeeded. React's StrictMode deliberately double-invokes effects
   * in development to catch exactly this kind of unguarded side effect, so
   * the call itself has to be skipped outright on the second pass — a
   * "cancelled" flag tied to that pass's own cleanup is not enough, since
   * StrictMode's simulated unmount would flip it before the *first* (real)
   * call's result ever arrives, silently swallowing it instead of showing it.
   */
  const startedRef = useRef(false);

  useEffect(() => {
    if (startedRef.current) return;
    startedRef.current = true;
    completeNewEmailConfirmation(link)
      .then((email) => {
        setConfirmedEmail(email);
        setPhase('done');
      })
      .catch((err) => {
        setError(err instanceof AuthError ? err.message : '發生錯誤，請稍後再試');
        setPhase('invalid');
      });
  }, [link]);

  const submit = 'milk-tea-btn-primary w-full py-3 rounded-2xl text-sm font-bold shadow-sm cursor-pointer';

  const shell = (icon: React.ReactNode, title: string, subtitle: string, body?: React.ReactNode) => (
    <div
      style={{
        paddingTop: 'max(1rem, env(safe-area-inset-top))',
        paddingBottom: 'max(1rem, env(safe-area-inset-bottom))',
      }}
      className="h-full bg-[#F5E6D3] flex items-center justify-center px-4 font-sans text-[#4A3F35]"
    >
      <div className="bg-[#FAF7F2] border border-[#D9C5B2] rounded-3xl p-6 sm:p-8 max-w-sm w-full shadow-lg space-y-6">
        <div className="text-center space-y-3">
          <div className="w-14 h-14 bg-[#A68B6D] text-white rounded-2xl mx-auto flex items-center justify-center">
            {icon}
          </div>
          <div className="space-y-1">
            <h1 className="text-lg font-bold">{title}</h1>
            <p className="text-xs text-[#7A6C5E] leading-relaxed">{subtitle}</p>
          </div>
        </div>
        {body}
      </div>
    </div>
  );

  if (phase === 'working') {
    return shell(
      <MailCheck className="w-7 h-7" />,
      '確認 Email 中…',
      '請稍候',
      <div className="h-1.5 rounded-full bg-[#E8DFD3] overflow-hidden">
        <div className="h-full w-1/3 bg-[#8C6D53] animate-pulse" />
      </div>
    );
  }

  if (phase === 'invalid') {
    return shell(
      <XCircle className="w-7 h-7" />,
      '連結失效了',
      error,
      <button type="button" onClick={onDone} className={submit}>
        回到登入畫面
      </button>
    );
  }

  return shell(
    <CheckCircle2 className="w-7 h-7" />,
    'Email 確認完成',
    `${confirmedEmail} 已經確認過了。回到原本設定的裝置，重新登入一次，就會正式變成這個帳號的救援 Email。`,
    <button type="button" onClick={onDone} className={submit}>
      回到登入畫面
    </button>
  );
};
