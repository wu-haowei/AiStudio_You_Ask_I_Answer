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

interface OnboardingModalProps {
  isOpen: boolean;
  onClose: () => void;
}

const steps: { icon: React.ReactNode; title: string; body: string }[] = [
  {
    icon: <UserPlus className="w-5 h-5" />,
    title: '邀請對方',
    body: '從「現在線上」名單邀請一個人，對方按下「同意並開始」，就會開一間你們倆專屬的房間。之後每次登入都能直接從「我的對話」點回去，不用重新配對。',
  },
  {
    icon: <HeartHandshake className="w-5 h-5" />,
    title: '發起考驗',
    body: '在對話頁按「發起考驗」，等對方按下「接受挑戰」才正式開始——沒接受之前題目不會出現，可以先聊聊天再開始。',
  },
  {
    icon: <MessageCircleQuestion className="w-5 h-5" />,
    title: '出題與真心話',
    body: '發起的一方從題庫（自己的，或還沒有時借用的預設題庫）挑一題送出去；對方要先誠實寫下自己的真心話，這時候出題者還看不到內容，避免用猜的作弊。',
  },
  {
    icon: <Sparkles className="w-5 h-5" />,
    title: '猜測與結果',
    body: '真心話送出鎖定後，換出題者猜猜對方會怎麼答，兩邊答案同時揭曉——猜對了就是「這麼懂你」的證據，猜錯了也是多認識彼此一點的機會。',
  },
  {
    icon: <BookOpen className="w-5 h-5" />,
    title: '題庫是你們的',
    body: '還沒有自己的題庫時先借用預設題庫；之後到「後台」新增、貼上 JSON、上傳檔案，或從 Google 雲端資料夾匯入，匯入過就會變成你們專屬的題庫。',
  },
];

/**
 * Explainer for what this app is and how a round works — shown automatically
 * the first time this browser sees a signed-in user. A corner tip rather than
 * a blocking modal, so it never demands a click before the rest of the screen
 * becomes usable. Reachable again afterwards from the player menu or the
 * admin screen's help button, which the closing note below points back to.
 */
export const OnboardingModal: React.FC<OnboardingModalProps> = ({ isOpen, onClose }) => {
  if (!isOpen) return null;

  return (
    <div
      role="dialog"
      aria-label="你問我答怎麼玩"
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
              <h2 className="text-base font-bold text-[#4A3F35]">你問我答怎麼玩</h2>
              <p className="text-xs text-[#7A6C5E] truncate">跟另一半／好朋友一起玩的猜心問答</p>
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

        <div className="overflow-y-auto px-5 sm:px-6 py-5 space-y-4">
          <ol className="space-y-4">
            {steps.map((step, i) => (
              <li key={step.title} className="flex items-start gap-3">
                <div className="w-9 h-9 rounded-2xl bg-[#E8D8C4] text-[#5C4B3A] flex items-center justify-center shrink-0">
                  {step.icon}
                </div>
                <div className="min-w-0 pt-1">
                  <p className="text-sm font-bold text-[#4A3F35]">
                    {i + 1}. {step.title}
                  </p>
                  <p className="text-xs text-[#7A6C5E] leading-relaxed mt-1">{step.body}</p>
                </div>
              </li>
            ))}
          </ol>

          <div className="flex items-start gap-2.5 rounded-2xl bg-[#F1E7D6] px-4 py-3.5">
            <HelpCircle className="w-4 h-4 text-[#8C6D53] mt-0.5 shrink-0" />
            <p className="text-xs text-[#5C4B3A] leading-relaxed">
              <b className="font-bold">忘記怎麼玩了也沒關係</b>
              ——右上角你的名字點開來，選單裡的「使用說明」隨時可以再打開這份導覽。
            </p>
          </div>
        </div>

        <div className="px-5 sm:px-6 pb-5 pt-1 shrink-0">
          <button
            type="button"
            onClick={onClose}
            className="milk-tea-btn-primary w-full py-3 rounded-2xl text-sm font-bold shadow-sm cursor-pointer"
          >
            知道了，開始玩
          </button>
        </div>
      </div>
    </div>
  );
};
