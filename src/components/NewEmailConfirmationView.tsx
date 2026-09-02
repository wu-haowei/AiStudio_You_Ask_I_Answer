import React, { useEffect, useState } from 'react';
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
 * not accepted on the spot. Must be opened in the same browser that started
 * the setup (completeNewEmailConfirmation explains why); opening it anywhere
 * else surfaces as an ordinary failure message, not a crash.
 */
export const NewEmailConfirmationView: React.FC<NewEmailConfirmationViewProps> = ({ link, onDone }) => {
  const [phase, setPhase] = useState<Phase>('working');
  const [confirmedEmail, setConfirmedEmail] = useState('');
  const [error, setError] = useState('');

  useEffect(() => {
    let cancelled = false;
    completeNewEmailConfirmation(link)
      .then((email) => {
        if (cancelled) return;
        setConfirmedEmail(email);
        setPhase('done');
      })
      .catch((err) => {
        if (cancelled) return;
        setError(err instanceof AuthError ? err.message : '發生錯誤，請稍後再試');
        setPhase('invalid');
      });
    return () => {
      cancelled = true;
    };
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
    'Email 設定完成',
    `${confirmedEmail} 已經是這個帳號的救援 Email 了，忘記密碼時會寄重設信到這裡。`,
    <button type="button" onClick={onDone} className={submit}>
      回到登入畫面
    </button>
  );
};
