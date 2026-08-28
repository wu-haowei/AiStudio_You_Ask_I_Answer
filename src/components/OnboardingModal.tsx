import React from 'react';
import { Coffee, UserPlus, HeartHandshake, MessageCircleQuestion, BookOpen, X } from 'lucide-react';

interface OnboardingModalProps {
  isOpen: boolean;
  onClose: () => void;
}

const steps: { icon: React.ReactNode; title: string; body: string }[] = [
  {
    icon: <UserPlus className="w-5 h-5" />,
    title: '邀請對方',
    body: '從「現在線上」名單邀請一個人，對方同意後就會開一間你們倆專屬的房間。',
  },
  {
    icon: <HeartHandshake className="w-5 h-5" />,
    title: '發起考驗',
    body: '在對話裡按「發起考驗」，對方接受挑戰後，由你從題庫挑一題出給對方。',
  },
  {
    icon: <MessageCircleQuestion className="w-5 h-5" />,
    title: '真心話與猜測',
    body: '對方先誠實回答「真心話」，接著換你猜猜看對方會怎麼答，猜對了就代表你真的懂對方！',
  },
  {
    icon: <BookOpen className="w-5 h-5" />,
    title: '專屬題庫',
    body: '還沒有自己的題庫時先借用預設題庫；到「後台」新增、匯入，或從 Google 雲端匯入題目，就會變成你們專屬的。',
  },
];

/**
 * Explainer for what this app is and how a round works — shown automatically
 * every time someone signs in, and reachable any time from the player menu
 * for anyone who wants a refresher mid-session.
 */
export const OnboardingModal: React.FC<OnboardingModalProps> = ({ isOpen, onClose }) => {
  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 bg-black/40 backdrop-blur-xs flex items-center justify-center p-4 animate-fade-in">
      <div className="bg-[#FAF7F2] border border-[#D9C5B2] rounded-3xl p-6 sm:p-8 max-w-md w-full shadow-2xl space-y-5">
        <div className="flex items-start justify-between gap-3">
          <div className="flex items-center gap-3">
            <div className="w-11 h-11 rounded-2xl bg-[#A68B6D] flex items-center justify-center text-white shrink-0">
              <Coffee className="w-5 h-5" />
            </div>
            <div>
              <h2 className="text-lg font-bold text-[#4A3F35]">歡迎使用你問我答</h2>
              <p className="text-xs text-[#7A6C5E]">跟另一半／好朋友一起玩的猜心問答</p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="關閉"
            className="p-1.5 rounded-xl text-[#7A6C5E] hover:bg-[#E8D8C4]/60 transition-colors cursor-pointer shrink-0"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        <ol className="space-y-3.5">
          {steps.map((step, i) => (
            <li key={step.title} className="flex items-start gap-3">
              <div className="w-9 h-9 rounded-2xl bg-[#E8D8C4] text-[#5C4B3A] flex items-center justify-center shrink-0">
                {step.icon}
              </div>
              <div className="min-w-0 pt-1">
                <p className="text-sm font-bold text-[#4A3F35]">
                  {i + 1}. {step.title}
                </p>
                <p className="text-xs text-[#7A6C5E] leading-relaxed mt-0.5">{step.body}</p>
              </div>
            </li>
          ))}
        </ol>

        <button
          type="button"
          onClick={onClose}
          className="milk-tea-btn-primary w-full py-3 rounded-2xl text-sm font-bold shadow-sm cursor-pointer"
        >
          開始使用
        </button>
      </div>
    </div>
  );
};
