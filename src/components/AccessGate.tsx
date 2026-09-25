import React, { useState } from 'react';
import { KeyRound } from 'lucide-react';
import { useT } from '../i18n';
import { LanguageSwitcher } from './LanguageSwitcher';

interface AccessGateProps {
  onSubmit: (code: string) => Promise<boolean>;
}

/**
 * Shown when this device is not yet on the allowlist. The submitted code is
 * verified by security rules against a config document the client cannot read,
 * so a wrong code fails server-side rather than here.
 */
export const AccessGate: React.FC<AccessGateProps> = ({ onSubmit }) => {
  const t = useT();
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
      setError(t('gate.wrongCode'));
      setIsChecking(false);
    }
  };

  return (
    <div className="relative h-full bg-[#F5E6D3] flex items-center justify-center p-4 font-sans text-[#4A3F35]">
      <LanguageSwitcher className="absolute top-3 right-3" />
      <div className="bg-[#FAF7F2] border border-[#D9C5B2] rounded-3xl p-6 sm:p-8 max-w-sm w-full shadow-lg space-y-6">
        <div className="text-center space-y-3">
          <div className="w-14 h-14 bg-[#A68B6D] text-white rounded-2xl mx-auto flex items-center justify-center">
            <KeyRound className="w-7 h-7" />
          </div>
          <div className="space-y-1">
            <h1 className="text-lg font-bold">{t('app.name')}</h1>
            <p className="text-xs text-[#7A6C5E]">{t('gate.subtitle')}</p>
          </div>
        </div>

        <form onSubmit={handleSubmit} className="space-y-3">
          <div className="space-y-1.5">
            <label htmlFor="invite-code" className="block text-xs font-bold text-[#7A6C5E]">
              {t('gate.codeLabel')}
            </label>
            <input
              id="invite-code"
              type="password"
              value={code}
              onChange={(e) => {
                setCode(e.target.value);
                setError('');
              }}
              placeholder={t('gate.codePlaceholder')}
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
            {isChecking ? t('gate.verifying') : t('gate.enter')}
          </button>
        </form>

        <p className="text-[11px] text-[#A69684] text-center leading-relaxed">
          {t('gate.remembered')}
        </p>
      </div>
    </div>
  );
};
