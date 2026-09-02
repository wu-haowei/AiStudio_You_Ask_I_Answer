import React, { useEffect, useState } from 'react';
import { CheckCircle2, ShieldCheck, XCircle } from 'lucide-react';
import { AuthError, completeEmailChangeReauth } from '../lib/accounts';

interface EmailChangeReauthViewProps {
  /** The full URL this app was opened with — carries Firebase's oobCode plus this app's own purpose/email params. */
  link: string;
  /** "Back to the app" — never signs anyone in, this link never touches the app's own session. */
  onDone: () => void;
}

type Phase = 'working' | 'done' | 'invalid';

/**
 * Where the "please confirm it's still you" link from setRecoveryEmail lands
 * — see that function's doc comment for why Firebase demands this detour.
 * Purely a relay: on success it has already sent the real change-email
 * verification link to the new address, so there is nothing to type here and
 * no session to sign into. The new address only actually takes effect once
 * that second link is clicked and syncVerifiedEmail notices on a later
 * sign-in — same as the direct (non-reauth) path.
 */
export const EmailChangeReauthView: React.FC<EmailChangeReauthViewProps> = ({ link, onDone }) => {
  const [phase, setPhase] = useState<Phase>('working');
  const [pendingEmail, setPendingEmail] = useState('');
  const [error, setError] = useState('');

  useEffect(() => {
    let cancelled = false;
    completeEmailChangeReauth(link)
      .then((email) => {
        if (cancelled) return;
        setPendingEmail(email);
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
      <ShieldCheck className="w-7 h-7" />,
      '確認身份中…',
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
    '身份確認完成',
    `驗證信已經寄到新的 Email（${pendingEmail}）了，去那邊點連結完成最後一步，下次登入這裡就會換成新的救援 Email。`,
    <button type="button" onClick={onDone} className={submit}>
      回到登入畫面
    </button>
  );
};
