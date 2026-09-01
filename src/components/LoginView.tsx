import React, { useState } from 'react';
import { UserRound, KeyRound, ShieldCheck, MailCheck } from 'lucide-react';
import {
  AuthError,
  DEFAULT_PASSWORD,
  changePassword,
  lookupAccount,
  requestPasswordResetForName,
  signInWithPassword,
} from '../lib/accounts';

interface LoginViewProps {
  onSignedIn: (name: string) => void;
}

type Step = 'name' | 'password' | 'change' | 'forgot-sent';

/**
 * Name, then password, then a forced change if the account is still on the
 * default. Splitting the steps lets the password screen say whether this is a
 * brand new account, which is the difference between "type 0101" and "type
 * the password you chose".
 *
 * Setting up a recovery email is not part of this flow at all — App shows a
 * dismissible reminder for that after signing in, since making it a gate here
 * would lock someone out of their own conversation over a step they might
 * simply not want to do yet.
 *
 * "忘記密碼" on the password step already knows the name (it's right there on
 * screen), so it fires straight to forgot-sent — there is nothing left to ask.
 */
export const LoginView: React.FC<LoginViewProps> = ({ onSignedIn }) => {
  const [step, setStep] = useState<Step>('name');
  const [name, setName] = useState('');
  const [isNewAccount, setIsNewAccount] = useState(false);

  const [password, setPassword] = useState('');
  const [nextPassword, setNextPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');

  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const fail = (err: unknown) => {
    setError(err instanceof AuthError ? err.message : '發生錯誤，請稍後再試');
    console.warn('[login]', err);
  };

  const handleNameSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const clean = name.trim();
    if (!clean || busy) return;

    setBusy(true);
    setError('');
    try {
      const account = await lookupAccount(clean);
      setIsNewAccount(!account.exists);
      setPassword(account.exists ? '' : DEFAULT_PASSWORD);
      setStep('password');
    } catch (err) {
      fail(err);
    } finally {
      setBusy(false);
    }
  };

  const handlePasswordSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (busy) return;

    setBusy(true);
    setError('');
    try {
      const account = await signInWithPassword(name, password);
      if (account.mustChangePassword) {
        setStep('change');
      } else {
        onSignedIn(account.name);
      }
    } catch (err) {
      fail(err);
    } finally {
      setBusy(false);
    }
  };

  const handleChangeSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (busy) return;

    if (nextPassword !== confirmPassword) {
      setError('兩次輸入的新密碼不一致');
      return;
    }

    setBusy(true);
    setError('');
    try {
      await changePassword(name, password, nextPassword);
      onSignedIn(name.trim());
    } catch (err) {
      fail(err);
    } finally {
      setBusy(false);
    }
  };

  /** The name is already on screen — nothing left to ask before sending. */
  const handleForgotClick = async () => {
    if (busy) return;

    setBusy(true);
    setError('');
    try {
      await requestPasswordResetForName(name);
      setStep('forgot-sent');
    } catch (err) {
      fail(err);
    } finally {
      setBusy(false);
    }
  };

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

        {error && (
          <p className="text-xs text-rose-600 font-semibold text-center leading-relaxed">{error}</p>
        )}
      </div>
    </div>
  );

  const field = 'w-full px-4 py-3 rounded-2xl border border-[#D9C5B2] bg-white text-sm font-semibold text-[#4A3F35] focus:outline-none focus:ring-2 focus:ring-[#8E7256]';
  const submit = 'milk-tea-btn-primary w-full py-3 rounded-2xl text-sm font-bold shadow-sm disabled:opacity-50 cursor-pointer';

  if (step === 'name') {
    return shell(
      <UserRound className="w-7 h-7" />,
      '你問我答',
      '輸入姓名開始',
      <form onSubmit={handleNameSubmit} className="space-y-3">
        <div className="space-y-1.5">
          <label htmlFor="login-name" className="block text-xs font-bold text-[#7A6C5E]">
            姓名
          </label>
          <input
            id="login-name"
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="輸入你的姓名"
            autoComplete="username"
            maxLength={20}
            className={field}
          />
        </div>
        <button type="submit" disabled={!name.trim() || busy} className={submit}>
          {busy ? '確認中…' : '下一步'}
        </button>
      </form>
    );
  }

  if (step === 'password') {
    return shell(
      <KeyRound className="w-7 h-7" />,
      name.trim(),
      isNewAccount ? `新帳號，請用預設密碼 ${DEFAULT_PASSWORD}` : '輸入你的密碼',
      <form onSubmit={handlePasswordSubmit} className="space-y-3">
        <div className="space-y-1.5">
          <label htmlFor="login-password" className="block text-xs font-bold text-[#7A6C5E]">
            密碼
          </label>
          <input
            id="login-password"
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder="輸入密碼"
            autoComplete="current-password"
            autoFocus
            className={field}
          />
        </div>
        <button type="submit" disabled={!password || busy} className={submit}>
          {busy ? '登入中…' : '登入'}
        </button>
        <div className="flex items-center justify-between">
          <button
            type="button"
            onClick={() => {
              setStep('name');
              setPassword('');
              setError('');
            }}
            className="py-2 text-xs font-semibold text-[#7A6C5E] hover:text-[#4A3F35] cursor-pointer"
          >
            換一個姓名
          </button>
          {!isNewAccount && (
            <button
              type="button"
              onClick={handleForgotClick}
              disabled={busy}
              className="py-2 text-xs font-semibold text-[#7A6C5E] hover:text-[#4A3F35] cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {busy ? '寄送中…' : '忘記密碼？'}
            </button>
          )}
        </div>
      </form>
    );
  }

  if (step === 'change') {
    return shell(
      <ShieldCheck className="w-7 h-7" />,
      '設定新密碼',
      '第一次登入需要換掉預設密碼',
    <form onSubmit={handleChangeSubmit} className="space-y-3">
      <div className="space-y-1.5">
        <label htmlFor="new-password" className="block text-xs font-bold text-[#7A6C5E]">
          新密碼
        </label>
        <input
          id="new-password"
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
        <label htmlFor="confirm-password" className="block text-xs font-bold text-[#7A6C5E]">
          再輸入一次
        </label>
        <input
          id="confirm-password"
          type="password"
          value={confirmPassword}
          onChange={(e) => setConfirmPassword(e.target.value)}
          placeholder="確認新密碼"
          autoComplete="new-password"
          className={field}
        />
      </div>
      <button type="submit" disabled={!nextPassword || !confirmPassword || busy} className={submit}>
        {busy ? '設定中…' : '設定並進入'}
      </button>
    </form>
    );
  }

  return shell(
    <MailCheck className="w-7 h-7" />,
    '信寄出了',
    '請到信箱收信',
    <div className="space-y-3">
      <p className="text-xs text-[#7A6C5E] text-center leading-relaxed">
        重設密碼的信件已經寄到 {name.trim()} 設定的 Email 了。點信裡的連結，就能直接設定新密碼。
      </p>
      <button
        type="button"
        onClick={() => {
          setStep('name');
          setPassword('');
          setError('');
        }}
        className={submit}
      >
        返回登入
      </button>
    </div>
  );
};
