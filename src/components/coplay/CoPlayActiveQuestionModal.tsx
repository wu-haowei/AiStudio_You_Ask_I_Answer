import React from 'react';
import { Target, Sparkles, X, Check, CheckCircle2 } from 'lucide-react';
import { RoomQuestion } from '../../types';

/** A player may rank at most this many options. */
const MAX_PICKS = 2;

interface CoPlayActiveQuestionModalProps {
  activeQ: RoomQuestion | undefined;
  isTarget: boolean;
  isInitiator: boolean;
  partnerDisplayName: string;
  isAnswerModalDismissed: boolean;
  onDismissModal: () => void;
  /** Ordered picks; index 0 is the first preference. */
  selectedOptIndexes: number[];
  setSelectedOptIndexes: React.Dispatch<React.SetStateAction<number[]>>;
  answerExplanation: string;
  setAnswerExplanation: (val: string) => void;
  hasTargetAnswered: boolean;
  hasInitiatorGuessed: boolean;
  isSubmittingOpt: boolean;
  onSubmitOption: (activeQ: RoomQuestion) => void;
  onCancelActiveQuestion: () => void;
}

export const CoPlayActiveQuestionModal: React.FC<CoPlayActiveQuestionModalProps> = ({
  activeQ,
  isTarget,
  isInitiator,
  partnerDisplayName,
  isAnswerModalDismissed,
  onDismissModal,
  selectedOptIndexes,
  setSelectedOptIndexes,
  answerExplanation,
  setAnswerExplanation,
  hasTargetAnswered,
  hasInitiatorGuessed,
  isSubmittingOpt,
  onSubmitOption,
  onCancelActiveQuestion,
}) => {
  /**
   * Tapping an option appends it to the ordered list; tapping it again removes
   * it. Once two are chosen the oldest is dropped, so a third tap always works.
   */
  const togglePick = (idx: number) => {
    setSelectedOptIndexes((prev) => {
      if (prev.includes(idx)) return prev.filter((i) => i !== idx);
      if (prev.length < MAX_PICKS) return [...prev, idx];
      return [...prev.slice(1), idx];
    });
  };

  const rankOf = (idx: number) => selectedOptIndexes.indexOf(idx);
  const hasPicks = selectedOptIndexes.length > 0;
  const isOtherPicked = selectedOptIndexes.includes(4);

  if (!activeQ || activeQ.isRevealed || (!isTarget && !isInitiator) || isAnswerModalDismissed) {
    return null;
  }

  return (
    <div className="fixed inset-0 z-50 bg-black/40 backdrop-blur-xs flex items-center justify-center p-4 animate-fade-in overflow-y-auto">
      <div className="bg-[#FAF7F2] border border-[#D9C5B2] rounded-3xl p-4 sm:p-6 max-w-lg w-full shadow-2xl space-y-4 my-auto max-h-[92vh] overflow-y-auto">
        <div className="flex items-center justify-between border-b border-[#D9C5B2] pb-3">
          <div className="flex items-center gap-2.5">
            <div className="w-10 h-10 rounded-2xl bg-[#A68B6D] text-white flex items-center justify-center font-bold shadow-xs">
              <Target className="w-5 h-5" />
            </div>
            <div>
              <h3 className="text-base font-bold text-[#4A3F35]">作答</h3>
              <p className="text-xs text-[#7A6C5E]">
                {isTarget ? '請選擇你的真實答案' : `猜猜 ${partnerDisplayName} 的選擇`}
              </p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={onDismissModal}
              className="text-[#7A6C5E] hover:text-[#4A3F35] p-1.5 rounded-xl hover:bg-[#E8D8C4]/60 transition-colors cursor-pointer"
              title="關閉視窗"
            >
              <X className="w-5 h-5" />
            </button>
          </div>
        </div>

        {/* Question Card */}
        <div className="bg-white p-4 rounded-2xl border border-[#D9C5B2] space-y-1.5 shadow-2xs">
          <div className="text-xs font-bold text-[#A68B6D] flex items-center gap-1">
            <Sparkles className="w-3.5 h-3.5" />
            [{activeQ.category}]
          </div>
          <div className="text-xs sm:text-sm font-bold text-[#4A3F35] leading-relaxed">
            {activeQ.question}
          </div>
        </div>

        {/* Target Interaction (User B) */}
        {isTarget && (
          <div>
            {!hasTargetAnswered ? (
              <div className="space-y-3">
                <p className="text-xs font-bold text-[#5C4B3A]">
                  選擇你的真實答案
                  <span className="ml-1 font-medium text-[#7A6C5E]">（最多兩個，依順序）</span>
                </p>
                <div className="grid grid-cols-2 gap-2">
                  {activeQ.options.map((opt, idx) => (
                    <OptionButton
                      key={idx}
                      label={opt}
                      rank={rankOf(idx)}
                      accent="#A68B6D"
                      onClick={() => togglePick(idx)}
                    />
                  ))}

                  <OptionButton
                    label="其他 (自訂選項)"
                    rank={rankOf(4)}
                    accent="#A68B6D"
                    fullWidth
                    onClick={() => togglePick(4)}
                  />
                </div>

                {/* Explanation Input Field */}
                {hasPicks && (
                  <div className="space-y-1 pt-1 animate-fade-in">
                    <label className="text-[11px] font-bold text-[#5C4B3A] flex items-center gap-1">
                      <span>{isOtherPicked ? '自訂答案' : '補充說明（選填）'}</span>
                    </label>
                    <input
                      type="text"
                      value={answerExplanation}
                      onChange={(e) => setAnswerExplanation(e.target.value)}
                      placeholder={isOtherPicked ? '輸入你的答案' : '可填寫選擇原因'}
                      className="w-full px-3.5 py-2 text-xs rounded-xl milk-tea-input font-bold"
                    />
                  </div>
                )}

                <button
                  type="button"
                  onClick={() => onSubmitOption(activeQ)}
                  disabled={isSubmittingOpt || !hasPicks}
                  className="w-full mt-2 milk-tea-btn-primary py-3 rounded-2xl text-xs font-bold flex items-center justify-center gap-1.5 shadow-md disabled:opacity-50 cursor-pointer"
                >
                  <Check className="w-4 h-4" />
                  <span>送出真心話</span>
                </button>
              </div>
            ) : (
              <div className="p-4 bg-emerald-50 border border-emerald-200 rounded-2xl text-center space-y-2">
                <div className="text-xs font-bold text-emerald-900 flex items-center justify-center gap-1.5">
                  <CheckCircle2 className="w-4 h-4 text-emerald-600" />
                  已送出真心話
                </div>
                <p className="text-[11px] text-emerald-700 font-medium">
                  等待對方猜測，結果會顯示在對話框
                </p>
                <div className="pt-1 flex items-center justify-center gap-2">
                  <button
                    type="button"
                    onClick={onDismissModal}
                    className="px-3 py-1.5 rounded-xl bg-emerald-100 hover:bg-emerald-200 text-emerald-900 text-xs font-bold transition-colors cursor-pointer"
                  >
                    關閉
                  </button>
                  <button
                    type="button"
                    onClick={onCancelActiveQuestion}
                    className="px-3 py-1.5 rounded-xl bg-rose-50 hover:bg-rose-100 text-rose-700 text-xs font-bold border border-rose-200 transition-colors cursor-pointer"
                  >
                    取消這題
                  </button>
                </div>
              </div>
            )}
          </div>
        )}

        {/* Initiator Interaction (User A) */}
        {isInitiator && (
          <div>
            {!hasInitiatorGuessed ? (
              <div className="space-y-3">
                <p className="text-xs font-bold text-[#8C6D53]">
                  猜猜 {partnerDisplayName} 會選哪一個？
                  <span className="ml-1 font-medium text-[#7A6C5E]">（最多兩個，猜中一個就算對）</span>
                </p>
                <div className="grid grid-cols-2 gap-2">
                  {activeQ.options.map((opt, idx) => (
                    <OptionButton
                      key={idx}
                      label={opt}
                      rank={rankOf(idx)}
                      accent="#8C6D53"
                      onClick={() => togglePick(idx)}
                    />
                  ))}

                  <OptionButton
                    label="其他 (自訂猜測)"
                    rank={rankOf(4)}
                    accent="#8C6D53"
                    fullWidth
                    onClick={() => togglePick(4)}
                  />
                </div>

                {/* Explanation Input Field */}
                {hasPicks && (
                  <div className="space-y-1 pt-1 animate-fade-in">
                    <label className="text-[11px] font-bold text-[#8C6D53] flex items-center gap-1">
                      <span>{isOtherPicked ? '自訂猜測' : '補充說明（選填）'}</span>
                    </label>
                    <input
                      type="text"
                      value={answerExplanation}
                      onChange={(e) => setAnswerExplanation(e.target.value)}
                      placeholder={isOtherPicked ? '輸入你的猜測' : '可填寫猜測原因'}
                      className="w-full px-3.5 py-2 text-xs rounded-xl milk-tea-input font-bold"
                    />
                  </div>
                )}

                <button
                  type="button"
                  onClick={() => onSubmitOption(activeQ)}
                  disabled={isSubmittingOpt || !hasPicks}
                  className="w-full mt-2 milk-tea-btn-primary py-3 rounded-2xl text-xs font-bold flex items-center justify-center gap-1.5 shadow-md disabled:opacity-50 cursor-pointer"
                >
                  <Check className="w-4 h-4" />
                  <span>送出猜測</span>
                </button>
              </div>
            ) : (
              <div className="p-4 bg-emerald-50 border border-emerald-200 rounded-2xl text-center space-y-2">
                <div className="text-xs font-bold text-emerald-900 flex items-center justify-center gap-1.5">
                  <CheckCircle2 className="w-4 h-4 text-emerald-600" />
                  已送出猜測
                </div>
                <p className="text-[11px] text-emerald-700 font-medium">
                  等待對方作答，結果會顯示在對話框
                </p>
                <div className="pt-1 flex items-center justify-center gap-2">
                  <button
                    type="button"
                    onClick={onDismissModal}
                    className="px-3 py-1.5 rounded-xl bg-emerald-100 hover:bg-emerald-200 text-emerald-900 text-xs font-bold transition-colors cursor-pointer"
                  >
                    關閉
                  </button>
                  <button
                    type="button"
                    onClick={onCancelActiveQuestion}
                    className="px-3 py-1.5 rounded-xl bg-rose-50 hover:bg-rose-100 text-rose-700 text-xs font-bold border border-rose-200 transition-colors cursor-pointer"
                  >
                    取消這題
                  </button>
                </div>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
};

/** One selectable option. A rank badge shows its position when picked. */
const OptionButton: React.FC<{
  label: string;
  /** Position in the ordered picks, or -1 when unpicked. */
  rank: number;
  accent: string;
  fullWidth?: boolean;
  onClick: () => void;
}> = ({ label, rank, accent, fullWidth, onClick }) => {
  const isPicked = rank >= 0;

  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={isPicked}
      style={isPicked ? { backgroundColor: accent, borderColor: accent } : undefined}
      className={`relative p-3 pr-8 text-left text-xs rounded-xl border transition-all cursor-pointer ${
        fullWidth ? 'col-span-2' : ''
      } ${
        isPicked
          ? 'text-white font-bold shadow-xs'
          : 'bg-white text-[#4A3F35] border-[#D9C5B2] hover:border-[#A68B6D]'
      }`}
    >
      {label}
      {isPicked && (
        <span
          className="absolute top-2 right-2 w-5 h-5 rounded-full bg-white/25 text-white text-[10px] font-bold flex items-center justify-center"
          aria-label={`第 ${rank + 1} 順位`}
        >
          {rank + 1}
        </span>
      )}
    </button>
  );
};
