import React from 'react';
import {
  Coffee,
  UserPlus,
  HeartHandshake,
  MessageCircleQuestion,
  Sparkles,
  BookOpen,
  HelpCircle,
  X,
} from 'lucide-react';
import { useT, type MessageKey } from '../i18n';

interface OnboardingModalProps {
  isOpen: boolean;
  onClose: () => void;
}

/** Message keys rather than text, so the steps read in whichever language is current. */
const steps: { icon: React.ReactNode; title: MessageKey; body: MessageKey }[] = [
  { icon: <UserPlus className="w-5 h-5" />, title: 'onboard.step1.title', body: 'onboard.step1.body' },
  { icon: <HeartHandshake className="w-5 h-5" />, title: 'onboard.step2.title', body: 'onboard.step2.body' },
  { icon: <MessageCircleQuestion className="w-5 h-5" />, title: 'onboard.step3.title', body: 'onboard.step3.body' },
  { icon: <Sparkles className="w-5 h-5" />, title: 'onboard.step4.title', body: 'onboard.step4.body' },
  { icon: <BookOpen className="w-5 h-5" />, title: 'onboard.step5.title', body: 'onboard.step5.body' },
];

/**
 * Explainer for what this app is and how a round works — shown automatically
 * the first time this browser sees a signed-in user. A corner tip rather than
 * a blocking modal, so it never demands a click before the rest of the screen
 * becomes usable. Reachable again afterwards from the player menu or the
 * admin screen's help button, which the closing note below points back to.
 */
export const OnboardingModal: React.FC<OnboardingModalProps> = ({ isOpen, onClose }) => {
  const t = useT();
  if (!isOpen) return null;

  return (
    <div
      role="dialog"
      aria-label={t('onboard.title')}
      style={{
        paddingBottom: 'env(safe-area-inset-bottom)',
        paddingRight: 'env(safe-area-inset-right)',
        paddingLeft: 'env(safe-area-inset-left)',
      }}
      className="fixed z-50 inset-x-3 bottom-3 sm:inset-x-auto sm:left-auto sm:right-4 sm:bottom-4 sm:w-[400px] animate-fade-in"
    >
      <div className="bg-[#FAF7F2] border border-[#D9C5B2] rounded-3xl shadow-2xl flex flex-col max-h-[min(640px,80vh)]">
        <div className="flex items-start justify-between gap-3 px-5 sm:px-6 pt-5 pb-4 border-b border-[#EFE5D8] shrink-0">
          <div className="flex items-center gap-3 min-w-0">
            <div className="w-10 h-10 rounded-2xl bg-[#A68B6D] flex items-center justify-center text-white shrink-0">
              <Coffee className="w-5 h-5" />
            </div>
            <div className="min-w-0">
              <h2 className="text-base font-bold text-[#4A3F35]">{t('onboard.title')}</h2>
              <p className="text-xs text-[#7A6C5E] truncate">{t('onboard.tagline')}</p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label={t('common.close')}
            className="p-1.5 rounded-xl text-[#7A6C5E] hover:bg-[#E8D8C4]/60 transition-colors cursor-pointer shrink-0"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="overflow-y-auto px-5 sm:px-6 py-5 space-y-4">
          <ol className="space-y-4">
            {steps.map((step, i) => (
              <li key={step.title} className="flex items-start gap-3">
                <div className="w-9 h-9 rounded-2xl bg-[#E8D8C4] text-[#5C4B3A] flex items-center justify-center shrink-0">
                  {step.icon}
                </div>
                <div className="min-w-0 pt-1">
                  <p className="text-sm font-bold text-[#4A3F35]">
                    {i + 1}. {t(step.title)}
                  </p>
                  <p className="text-xs text-[#7A6C5E] leading-relaxed mt-1">{t(step.body)}</p>
                </div>
              </li>
            ))}
          </ol>

          <div className="flex items-start gap-2.5 rounded-2xl bg-[#F1E7D6] px-4 py-3.5">
            <HelpCircle className="w-4 h-4 text-[#8C6D53] mt-0.5 shrink-0" />
            <p className="text-xs text-[#5C4B3A] leading-relaxed">
              <b className="font-bold">{t('onboard.forgetBold')}</b>
              {t('onboard.forgetRest')}
            </p>
          </div>
        </div>

        <div className="px-5 sm:px-6 pb-5 pt-1 shrink-0">
          <button
            type="button"
            onClick={onClose}
            className="milk-tea-btn-primary w-full py-3 rounded-2xl text-sm font-bold shadow-sm cursor-pointer"
          >
            {t('onboard.gotIt')}
          </button>
        </div>
      </div>
    </div>
  );
};
