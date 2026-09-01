import React, { useEffect, useState } from 'react';
import { KeyRound, XCircle } from 'lucide-react';
import { AuthError, completePasswordReset, verifyResetCode } from '../lib/accounts';

interface ResetPasswordViewProps {
  oobCode: string;
  /** Called once the new password is set and this browser is signed in as the account. */
  onDone: (name: string) => void;
  /** "This link doesn't work, go back" — never signs anyone in. */
  onCancel: () => void;
}

type Phase = 'verifying' | 'invalid' | 'form';

/**
 * Where the link in the password-reset email lands. It never goes through
 * the normal name → password → (maybe change) flow in LoginView — the whole
 * point is that the person doesn't have their password, so this proves who
 * they are a different way (the emailed code) and finishes by signing this
 * browser in exactly as if they had.
 */
export const ResetPasswordView: React.FC<ResetPasswordViewProps> = ({ oobCode, onDone, onCancel }) => {
  const [phase, setPhase] = useState<Phase>('verifying');
  const [email, setEmail] = useState('');
  const [nextPassword, setNextPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    let cancelled = false;
    verifyResetCode(oobCode)
      .then((verifiedEmail) => {
        if (cancelled) return;
        setEmail(verifiedEmail);
        setPhase('form');
      })
      .catch((err) => {
        if (cancelled) return;
        setError(err instanceof AuthError ? err.message : '這個連結已經失效或不存在');
        setPhase('invalid');
      });
    return () => {
      cancelled = true;
    };
  }, [oobCode]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (busy) return;

    if (nextPassword !== confirmPassword) {
      setError('兩次輸入的新密碼不一致');
      return;
    }

    setBusy(true);
    setError('');
    try {
      const account = await completePasswordReset(oobCode, nextPassword);
      onDone(account.name);
    } catch (err) {
      setError(err instanceof AuthError ? err.message : '發生錯誤，請稍後再試');
      console.warn('[reset-password]', err);
    } finally {
      setBusy(false);
    }
  };

  const field = 'w-full px-4 py-3 rounded-2xl border border-[#D9C5B2] bg-white text-sm font-semibold text-[#4A3F35] focus:outline-none focus:ring-2 focus:ring-[#8E7256]';
  const submit = 'milk-tea-btn-primary w-full py-3 rounded-2xl text-sm font-bold shadow-sm disabled:opacity-50 cursor-pointer';

  const shell = (icon: React.ReactNode, title: string, subtitle: string, body: React.ReactNode) => (
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
            <p className="text-xs text-[#7A6C5E]">{subtitle}</p>
          </div>
        </div>

        {body}

        {error && phase !== 'invalid' && (
          <p className="text-xs text-rose-600 font-semibold text-center leading-relaxed">{error}</p>
        )}
      </div>
    </div>
  );

  if (phase === 'verifying') {
    return shell(
      <KeyRound className="w-7 h-7" />,
      '設定新密碼',
      '確認連結中…',
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
      <button type="button" onClick={onCancel} className={submit}>
        回到登入畫面
      </button>
    );
  }

  return shell(
    <KeyRound className="w-7 h-7" />,
    '設定新密碼',
    email,
    <form onSubmit={handleSubmit} className="space-y-3">
      <div className="space-y-1.5">
        <label htmlFor="reset-new-password" className="block text-xs font-bold text-[#7A6C5E]">
          新密碼
        </label>
        <input
          id="reset-new-password"
          type="password"
          value={nextPassword}
          onChange={(e) => setNextPassword(e.target.value)}
          placeholder="至少 4 個字元"
          autoComplete="new-password"
          autoFocus
          className={field}
        />
      </div>
      <div className="space-y-1.5">
        <label htmlFor="reset-confirm-password" className="block text-xs font-bold text-[#7A6C5E]">
          再輸入一次
        </label>
        <input
          id="reset-confirm-password"
          type="password"
          value={confirmPassword}
          onChange={(e) => setConfirmPassword(e.target.value)}
          placeholder="確認新密碼"
          autoComplete="new-password"
          className={field}
        />
      </div>
      <button type="submit" disabled={!nextPassword || !confirmPassword || busy} className={submit}>
        {busy ? '設定中…' : '設定並登入'}
      </button>
      <button
        type="button"
        onClick={onCancel}
        className="w-full py-2 text-xs font-semibold text-[#7A6C5E] hover:text-[#4A3F35] cursor-pointer"
      >
        取消
      </button>
    </form>
  );
};
