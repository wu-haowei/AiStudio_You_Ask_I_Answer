import React from 'react';
import { LANGS, setLang, useLang, type Lang } from '../i18n';

interface LanguageSwitcherProps {
  /**
   * Called after the language has changed, with the new one. Only the signed-in
   * app passes this, to save the choice against the person's name — before
   * sign-in there is nobody to save it for, and the device copy is enough.
   */
  onChange?: (lang: Lang) => void;
  /** Full names instead of the one-character labels — for roomier places like a menu. */
  full?: boolean;
  className?: string;
}

/** Three-way switch between the app's languages, each named in itself. */
export const LanguageSwitcher: React.FC<LanguageSwitcherProps> = ({ onChange, full = false, className = '' }) => {
  const current = useLang();

  return (
    <div
      role="group"
      aria-label="Language"
      className={`inline-flex items-center gap-0.5 p-0.5 rounded-xl bg-[#E8D8C4]/60 border border-[#D9C5B2] ${className}`}
    >
      {LANGS.map((lang) => {
        const active = lang.code === current;
        return (
          <button
            key={lang.code}
            type="button"
            title={lang.label}
            aria-pressed={active}
            onClick={() => {
              if (active) return;
              setLang(lang.code);
              onChange?.(lang.code);
            }}
            className={`px-2 py-1 rounded-lg text-[11px] font-bold transition-colors cursor-pointer ${
              active ? 'bg-white text-[#4A3F35] shadow-sm' : 'text-[#7A6C5E] hover:text-[#4A3F35]'
            }`}
          >
            {full ? lang.label : lang.short}
          </button>
        );
      })}
    </div>
  );
};
