import React, { useState } from 'react';
import { KeyRound } from 'lucide-react';

interface AccessGateProps {
  onSubmit: (code: string) => Promise<boolean>;
}

/**
 * Shown when this device is not yet on the allowlist. The submitted code is
 * verified by security rules against a config document the client cannot read,
 * so a wrong code fails server-side rather than here.
 */
export const AccessGate: React.FC<AccessGateProps> = ({ onSubmit }) => {
  const [code, setCode] = useState('');
  const [isChecking, setIsChecking] = useState(false);
  const [error, setError] = useState('');

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const clean = code.trim();
    if (!clean || isChecking) return;

    setIsChecking(true);
    setError('');
    const ok = await onSubmit(clean);
    if (!ok) {
      setError('邀請碼不正確');
      setIsChecking(false);
    }
  };

  return (
    <div className="h-screen h-dvh bg-[#F5E6D3] flex items-center justify-center p-4 font-sans text-[#4A3F35]">
      <div className="bg-[#FAF7F2] border border-[#D9C5B2] rounded-3xl p-6 sm:p-8 max-w-sm w-full shadow-lg space-y-6">
        <div className="text-center space-y-3">
          <div className="w-14 h-14 bg-[#A68B6D] text-white rounded-2xl mx-auto flex items-center justify-center">
            <KeyRound className="w-7 h-7" />
          </div>
          <div className="space-y-1">
            <h1 className="text-lg font-bold">你問我答</h1>
            <p className="text-xs text-[#7A6C5E]">這是私人空間，請輸入邀請碼</p>
          </div>
        </div>

        <form onSubmit={handleSubmit} className="space-y-3">
          <div className="space-y-1.5">
            <label htmlFor="invite-code" className="block text-xs font-bold text-[#7A6C5E]">
              邀請碼
            </label>
            <input
              id="invite-code"
              type="password"
              value={code}
              onChange={(e) => {
                setCode(e.target.value);
                setError('');
              }}
              placeholder="輸入邀請碼"
              autoComplete="off"
              className="w-full px-4 py-3 rounded-2xl border border-[#D9C5B2] bg-white text-sm font-semibold focus:outline-none focus:ring-2 focus:ring-[#8E7256]"
            />
            {error && <p className="text-xs text-rose-600 font-semibold">{error}</p>}
          </div>

          <button
            type="submit"
            disabled={!code.trim() || isChecking}
            className="milk-tea-btn-primary w-full py-3 rounded-2xl text-sm font-bold shadow-sm disabled:opacity-50 cursor-pointer"
          >
            {isChecking ? '驗證中…' : '進入'}
          </button>
        </form>

        <p className="text-[11px] text-[#A69684] text-center leading-relaxed">
          驗證成功後這台裝置會被記住，下次不用再輸入。
        </p>
      </div>
    </div>
  );
};
