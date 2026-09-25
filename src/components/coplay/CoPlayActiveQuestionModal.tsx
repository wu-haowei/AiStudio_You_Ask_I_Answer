import React from 'react';
import { createPortal } from 'react-dom';
import { Target, Sparkles, X, Check, CheckCircle2 } from 'lucide-react';
import { OTHER_PICK_INDEX, RoomQuestion } from '../../types';
import { useLang, useT } from '../../i18n';
import { displayCategory, localizedRoundQuestion } from '../../i18n/content';

/** A player may rank at most this many options. */
const MAX_PICKS = 2;

/**
 * "The other one is waiting on you."
 *
 * This used to arrive as a stored system message in the transcript, one write
 * per submission. The same fact is already on the room document — it records
 * who has submitted — and that document is being listened to anyway, so saying
 * it here costs nothing and puts it where the player is actually looking.
 */
const PartnerReadyNote: React.FC<{ text: string }> = ({ text }) => (
  <p className="flex items-center gap-1.5 rounded-xl border border-emerald-200 bg-emerald-50 px-3 py-2 text-[11px] font-bold text-emerald-800 animate-fade-in">
    <CheckCircle2 className="h-3.5 w-3.5 shrink-0 text-emerald-600" />
    {text}
  </p>
);

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
  const t = useT();
  const lang = useLang();
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
  const isOtherPicked = selectedOptIndexes.includes(OTHER_PICK_INDEX);

  if (!activeQ || activeQ.isRevealed || (!isTarget && !isInitiator) || isAnswerModalDismissed) {
    return null;
  }

  // The round carries its own translations, so each player reads the question in their own language.
  const view = localizedRoundQuestion(activeQ, lang);
  const viewOptions = view.options ?? activeQ.options;

  /*
   * Portalled into <body> for the same reason as the invite dialogs: the
   * conversation panel is hidden rather than unmounted while the admin tab is
   * open, and `display: none` would hide a fixed-position child along with it.
   */
  return createPortal(
    <div className="fixed inset-0 z-50 bg-black/40 backdrop-blur-xs flex items-center justify-center p-4 animate-fade-in overflow-y-auto">
      <div className="bg-[#FAF7F2] border border-[#D9C5B2] rounded-3xl p-4 sm:p-6 max-w-lg w-full shadow-2xl space-y-4 my-auto max-h-[92vh] overflow-y-auto">
        <div className="flex items-center justify-between border-b border-[#D9C5B2] pb-3">
          <div className="flex items-center gap-2.5">
            <div className="w-10 h-10 rounded-2xl bg-[#A68B6D] text-white flex items-center justify-center font-bold shadow-xs">
              <Target className="w-5 h-5" />
            </div>
            <div>
              <h3 className="text-base font-bold text-[#4A3F35]">{t('answer.title')}</h3>
              <p className="text-xs text-[#7A6C5E]">
                {isTarget ? t('answer.subtitleTarget') : t('answer.subtitleGuess', { name: partnerDisplayName })}
              </p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={onDismissModal}
              className="text-[#7A6C5E] hover:text-[#4A3F35] p-1.5 rounded-xl hover:bg-[#E8D8C4]/60 transition-colors cursor-pointer"
              title={t('invite.closeWindow')}
            >
              <X className="w-5 h-5" />
            </button>
          </div>
        </div>

        {/* Question Card */}
        <div className="bg-white p-4 rounded-2xl border border-[#D9C5B2] space-y-1.5 shadow-2xs">
          <div className="text-xs font-bold text-[#A68B6D] flex items-center gap-1">
            <Sparkles className="w-3.5 h-3.5" />
            [{displayCategory(activeQ.category)}]
          </div>
          <div className="text-xs sm:text-sm font-bold text-[#4A3F35] leading-relaxed">
            {view.question}
          </div>
        </div>

        {/* Target Interaction (User B) */}
        {isTarget && (
          <div>
            {!hasTargetAnswered ? (
              <div className="space-y-3">
                <p className="text-xs font-bold text-[#5C4B3A]">
                  {t('answer.subtitleTarget')}
                  <span className="ml-1 font-medium text-[#7A6C5E]">{t('answer.maxTwoOrdered')}</span>
                </p>
                {hasInitiatorGuessed && (
                  <PartnerReadyNote text={t('answer.partnerGuessed', { name: partnerDisplayName })} />
                )}
                <div className="grid grid-cols-2 gap-2">
                  {viewOptions.map((opt, idx) => (
                    <OptionButton
                      key={idx}
                      label={opt}
                      rank={rankOf(idx)}
                      accent="#A68B6D"
                      onClick={() => togglePick(idx)}
                    />
                  ))}

                  <OptionButton
                    label={t('answer.otherOption')}
                    rank={rankOf(OTHER_PICK_INDEX)}
                    accent="#A68B6D"
                    fullWidth
                    onClick={() => togglePick(OTHER_PICK_INDEX)}
                  />
                </div>

                {/* Explanation Input Field */}
                {hasPicks && (
                  <div className="space-y-1 pt-1 animate-fade-in">
                    <label className="text-[11px] font-bold text-[#5C4B3A] flex items-center gap-1">
                      <span>{isOtherPicked ? t('answer.customAnswer') : t('answer.noteOptional')}</span>
                    </label>
                    <input
                      type="text"
                      value={answerExplanation}
                      onChange={(e) => setAnswerExplanation(e.target.value)}
                      placeholder={isOtherPicked ? t('answer.typeAnswer') : t('answer.reasonHint')}
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
                  <span>{t('answer.sendHonest')}</span>
                </button>
              </div>
            ) : (
              <div className="p-4 bg-emerald-50 border border-emerald-200 rounded-2xl text-center space-y-2">
                <div className="text-xs font-bold text-emerald-900 flex items-center justify-center gap-1.5">
                  <CheckCircle2 className="w-4 h-4 text-emerald-600" />
                  {t('answer.sentHonest')}
                </div>
                <p className="text-[11px] text-emerald-700 font-medium">
                  {t('answer.waitGuessResult')}
                </p>
                <div className="pt-1 flex items-center justify-center gap-2">
                  <button
                    type="button"
                    onClick={onDismissModal}
                    className="px-3 py-1.5 rounded-xl bg-emerald-100 hover:bg-emerald-200 text-emerald-900 text-xs font-bold transition-colors cursor-pointer"
                  >
                    {t('common.close')}
                  </button>
                  <button
                    type="button"
                    onClick={onCancelActiveQuestion}
                    className="px-3 py-1.5 rounded-xl bg-rose-50 hover:bg-rose-100 text-rose-700 text-xs font-bold border border-rose-200 transition-colors cursor-pointer"
                  >
                    {t('answer.cancelQuestion')}
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
                  {t('answer.guessWhich', { name: partnerDisplayName })}
                  <span className="ml-1 font-medium text-[#7A6C5E]">{t('answer.maxTwoOneRight')}</span>
                </p>
                {hasTargetAnswered && (
                  <PartnerReadyNote text={t('answer.partnerAnswered', { name: partnerDisplayName })} />
                )}
                <div className="grid grid-cols-2 gap-2">
                  {viewOptions.map((opt, idx) => (
                    <OptionButton
                      key={idx}
                      label={opt}
                      rank={rankOf(idx)}
                      accent="#8C6D53"
                      onClick={() => togglePick(idx)}
                    />
                  ))}

                  <OptionButton
                    label={t('answer.otherGuess')}
                    rank={rankOf(OTHER_PICK_INDEX)}
                    accent="#8C6D53"
                    fullWidth
                    onClick={() => togglePick(OTHER_PICK_INDEX)}
                  />
                </div>

                {/* Explanation Input Field */}
                {hasPicks && (
                  <div className="space-y-1 pt-1 animate-fade-in">
                    <label className="text-[11px] font-bold text-[#8C6D53] flex items-center gap-1">
                      <span>{isOtherPicked ? t('answer.customGuess') : t('answer.noteOptional')}</span>
                    </label>
                    <input
                      type="text"
                      value={answerExplanation}
                      onChange={(e) => setAnswerExplanation(e.target.value)}
                      placeholder={isOtherPicked ? t('answer.typeGuess') : t('answer.guessReasonHint')}
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
                  <span>{t('answer.sendGuess')}</span>
                </button>
              </div>
            ) : (
              <div className="p-4 bg-emerald-50 border border-emerald-200 rounded-2xl text-center space-y-2">
                <div className="text-xs font-bold text-emerald-900 flex items-center justify-center gap-1.5">
                  <CheckCircle2 className="w-4 h-4 text-emerald-600" />
                  {t('answer.sentGuess')}
                </div>
                <p className="text-[11px] text-emerald-700 font-medium">
                  {t('answer.waitAnswerResult')}
                </p>
                <div className="pt-1 flex items-center justify-center gap-2">
                  <button
                    type="button"
                    onClick={onDismissModal}
                    className="px-3 py-1.5 rounded-xl bg-emerald-100 hover:bg-emerald-200 text-emerald-900 text-xs font-bold transition-colors cursor-pointer"
                  >
                    {t('common.close')}
                  </button>
                  <button
                    type="button"
                    onClick={onCancelActiveQuestion}
                    className="px-3 py-1.5 rounded-xl bg-rose-50 hover:bg-rose-100 text-rose-700 text-xs font-bold border border-rose-200 transition-colors cursor-pointer"
                  >
                    {t('answer.cancelQuestion')}
                  </button>
                </div>
              </div>
            )}
          </div>
        )}
      </div>
    </div>,
    document.body
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
  const t = useT();
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
          aria-label={t('answer.rankAria', { n: rank + 1 })}
        >
          {rank + 1}
        </span>
      )}
    </button>
  );
};
