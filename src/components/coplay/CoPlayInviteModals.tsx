import React from 'react';
import { Gamepad2, X, ThumbsUp, Clock, XCircle, Target, Sparkles, Dices, Shuffle, Edit3 } from 'lucide-react';
import { FAQItem } from '../../types';

interface CoPlayInviteModalsProps {
  // Modal 1: Invitation Request for recipient
  isPendingInviteForMe: boolean;
  inviteStateSender: string;
  getNameByPasscode: (code: string) => string;
  onRespondInvite: (accept: boolean) => void;

  // Modal 1 Waiting: Invitation Waiting popup for sender
  isPendingInviteSender: boolean;
  partnerDisplayName: string;
  onCancelInvite: () => void;

  // Modal 2: Question Selector
  showQuestionModal: boolean;
  onCloseQuestionModal: () => void;
  onPublishGameQuestion: (e: React.FormEvent) => void;

  // Question Selector Form States
  questionCategory: string;
  setQuestionCategory: (cat: string) => void;
  customCategoryInput: string;
  setCustomCategoryInput: (val: string) => void;
  questionText: string;
  setQuestionText: (val: string) => void;
  optA: string;
  setOptA: (val: string) => void;
  optB: string;
  setOptB: (val: string) => void;
  optC: string;
  setOptC: (val: string) => void;
  optD: string;
  setOptD: (val: string) => void;
  isEditingPreset: boolean;
  setIsEditingPreset: (val: boolean) => void;

  // Question Selector Handlers
  handleCategoryChange: (cat: string) => void;
  handleRandomizeQuestionByCategory: () => void;
  handleSelectPresetFAQ: (f: FAQItem) => void;
  faqs: FAQItem[];
}

export const CoPlayInviteModals: React.FC<CoPlayInviteModalsProps> = ({
  isPendingInviteForMe,
  inviteStateSender,
  getNameByPasscode,
  onRespondInvite,

  isPendingInviteSender,
  partnerDisplayName,
  onCancelInvite,

  showQuestionModal,
  onCloseQuestionModal,
  onPublishGameQuestion,

  questionCategory,

  customCategoryInput,
  setCustomCategoryInput,
  questionText,
  setQuestionText,
  optA,
  setOptA,
  optB,
  setOptB,
  optC,
  setOptC,
  optD,
  setOptD,
  isEditingPreset,
  setIsEditingPreset,

  handleCategoryChange,
  handleRandomizeQuestionByCategory,
  handleSelectPresetFAQ,
  faqs,
}) => {
  return (
    <>
      {/* Modal Popup 1 - Challenge Invitation Request */}
      {isPendingInviteForMe && (
        <div className="fixed inset-0 z-50 bg-black/40 backdrop-blur-xs flex items-center justify-center p-4 animate-fade-in">
          <div className="bg-[#FAF7F2] border-2 border-[#D9C5B2] rounded-3xl p-6 max-w-md w-full shadow-2xl space-y-4">
            <div className="flex items-center justify-between border-b border-[#D9C5B2] pb-3">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-2xl bg-[#A68B6D] text-white flex items-center justify-center">
                  <Gamepad2 className="w-5 h-5" />
                </div>
                <div>
                  <h3 className="text-base font-bold text-[#4A3F35]">🎮 你問我答考驗邀請</h3>
                  <p className="text-xs text-[#7A6C5E]">發起人：{getNameByPasscode(inviteStateSender)}</p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => onRespondInvite(false)}
                className="text-[#7A6C5E] hover:text-[#4A3F35] p-1.5 rounded-xl hover:bg-[#E8D8C4]/60 transition-colors cursor-pointer"
                title="關閉 / 婉拒"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <p className="text-xs sm:text-sm font-bold text-[#4A3F35] leading-relaxed bg-white p-4 rounded-2xl border border-[#D9C5B2]">
              【{getNameByPasscode(inviteStateSender)}】向你發起了「你問我答」考驗！請問要接受考驗嗎？
            </p>

            <div className="flex items-center gap-3 pt-2">
              <button
                type="button"
                onClick={() => onRespondInvite(false)}
                className="flex-1 py-3 rounded-2xl text-xs font-bold text-[#7A6C5E] bg-[#E8D8C4]/60 hover:bg-[#D9C5B2] transition-colors cursor-pointer"
              >
                下次再玩 🙅
              </button>
              <button
                type="button"
                onClick={() => onRespondInvite(true)}
                className="flex-1 milk-tea-btn-primary py-3 rounded-2xl text-xs font-bold flex items-center justify-center gap-1.5 shadow-md cursor-pointer"
              >
                <ThumbsUp className="w-4 h-4" />
                <span>接受挑戰 👍</span>
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Modal Popup - Waiting Popup for Invite Sender */}
      {isPendingInviteSender && (
        <div className="fixed inset-0 z-50 bg-black/40 backdrop-blur-xs flex items-center justify-center p-4 animate-fade-in">
          <div className="bg-[#FAF7F2] border-2 border-[#D9C5B2] rounded-3xl p-6 max-w-md w-full shadow-2xl space-y-4">
            <div className="flex items-center justify-between border-b border-[#D9C5B2] pb-3">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-2xl bg-[#A68B6D] text-white flex items-center justify-center animate-pulse">
                  <Clock className="w-5 h-5 animate-spin" />
                </div>
                <div>
                  <h3 className="text-base font-bold text-[#4A3F35]">⏳ 等待對方回應中...</h3>
                  <p className="text-xs text-[#7A6C5E]">邀請對象：【{partnerDisplayName}】</p>
                </div>
              </div>
              <button
                type="button"
                onClick={onCancelInvite}
                className="text-[#7A6C5E] hover:text-[#4A3F35] p-1.5 rounded-xl hover:bg-[#E8D8C4]/60 transition-colors cursor-pointer"
                title="取消發起並關閉"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="bg-white p-4 rounded-2xl border border-[#D9C5B2] space-y-2 text-center">
              <p className="text-xs sm:text-sm font-bold text-[#4A3F35]">
                已向【{partnerDisplayName}】發出「你問我答」考驗邀請！
              </p>
              <p className="text-xs text-[#7A6C5E]">
                請等待對方點擊接受，您也可以隨時點擊下方按鈕取消發起。
              </p>
            </div>

            <div className="flex items-center justify-end pt-2">
              <button
                type="button"
                onClick={onCancelInvite}
                className="w-full py-3 rounded-2xl text-xs font-bold text-rose-700 bg-rose-50 border border-rose-200 hover:bg-rose-100 transition-colors flex items-center justify-center gap-1.5 cursor-pointer shadow-xs"
              >
                <XCircle className="w-4 h-4" />
                <span>取消發起邀請</span>
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Modal Popup 2 - Initiator Selects Category & Question */}
      {showQuestionModal && (
        <div className="fixed inset-0 z-50 bg-black/40 backdrop-blur-xs flex items-center justify-center p-4 animate-fade-in overflow-y-auto">
          <div className="bg-[#FAF7F2] border-2 border-[#D9C5B2] rounded-3xl p-5 sm:p-6 max-w-xl w-full shadow-2xl space-y-4 my-auto">
            <div className="flex items-center justify-between border-b border-[#D9C5B2] pb-3">
              <div className="flex items-center gap-2">
                <div className="w-9 h-9 rounded-xl bg-[#A68B6D] text-white flex items-center justify-center">
                  <Target className="w-5 h-5" />
                </div>
                <div>
                  <h3 className="text-sm sm:text-base font-bold text-[#4A3F35]">🎯 選擇/設定猜心題目 (問對方的真心話)</h3>
                  <p className="text-[11px] text-[#7A6C5E]">【{partnerDisplayName}】已準備好！設定題目後由你猜測對方的選擇</p>
                </div>
              </div>
              <button
                type="button"
                onClick={onCloseQuestionModal}
                className="text-[#7A6C5E] hover:text-[#4A3F35] p-1.5 rounded-xl hover:bg-[#E8D8C4]/60 transition-colors cursor-pointer"
                title="暫時關閉視窗 (可於對話框點擊按鈕重新開啟)"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <form onSubmit={onPublishGameQuestion} className="space-y-4">
              {/* Step 1: Select Category */}
              <div className="space-y-1.5 bg-white/90 p-3.5 rounded-2xl border border-[#D9C5B2] shadow-2xs">
                <div className="flex items-center justify-between gap-2">
                  <label className="text-xs font-bold text-[#4A3F35] flex items-center gap-1.5">
                    <Sparkles className="w-4 h-4 text-[#A68B6D]" />
                    <span>步驟 1：選擇題目種類</span>
                  </label>
                  <select
                    value={questionCategory}
                    onChange={(e) => handleCategoryChange(e.target.value)}
                    className="text-xs px-3 py-1.5 rounded-xl bg-white border border-[#D9C5B2] text-[#4A3F35] font-bold cursor-pointer hover:border-[#A68B6D] transition-colors"
                  >
                    <option value="習性與喜好">習性與喜好</option>
                    <option value="人生規劃與經歷">人生規劃與經歷</option>
                    <option value="感情相關">感情相關</option>
                    <option value="狀況劇">狀況劇</option>
                    <option value="敏感題">敏感題</option>
                    <option value="CUSTOM">✏️ 自訂種類 (自行輸入題目與選項)</option>
                  </select>
                </div>

                {questionCategory === 'CUSTOM' && (
                  <div className="pt-1.5">
                    <input
                      type="text"
                      required
                      value={customCategoryInput}
                      onChange={(e) => setCustomCategoryInput(e.target.value)}
                      placeholder="請輸入自訂種類名稱 (例如：休閒嗜好、理財觀念...)"
                      className="w-full px-3.5 py-2 text-xs rounded-xl milk-tea-input font-bold"
                    />
                  </div>
                )}
              </div>

              {/* Step 2: Category Randomization Preview OR Custom Text Input */}
              {questionCategory !== 'CUSTOM' ? (
                <div className="space-y-3">
                  <div className="bg-white p-4 rounded-2xl border border-[#D9C5B2] space-y-3 shadow-2xs">
                    <div className="flex items-center justify-between border-b border-dashed border-[#D9C5B2] pb-2">
                      <span className="text-xs font-bold text-[#A68B6D] flex items-center gap-1">
                        <Dices className="w-4 h-4 text-[#A68B6D]" />
                        已自動從「{questionCategory}」題庫為您隨機抽題
                      </span>
                      <button
                        type="button"
                        onClick={handleRandomizeQuestionByCategory}
                        className="px-2.5 py-1.5 rounded-xl bg-[#A68B6D] text-white text-[11px] font-bold hover:bg-[#8E7256] transition-colors flex items-center gap-1 cursor-pointer shadow-2xs"
                      >
                        <Shuffle className="w-3.5 h-3.5" />
                        <span>🎲 換一題 (隨機)</span>
                      </button>
                    </div>

                    <div>
                      <span className="text-[11px] font-bold text-[#7A6C5E] block mb-1">題目內容：</span>
                      <p className="text-xs sm:text-sm font-bold text-[#4A3F35] leading-relaxed bg-[#FAF7F2] p-3 rounded-xl border border-[#E8D8C4]">
                        {questionText || '點擊上方按鈕隨機抽題...'}
                      </p>
                    </div>

                    <div>
                      <span className="text-[11px] font-bold text-[#7A6C5E] block mb-1">作答選項預覽：</span>
                      <div className="grid grid-cols-2 gap-2 text-xs">
                        <div className="p-2.5 rounded-xl bg-[#FAF7F2] border border-[#E8D8C4] text-[#4A3F35] font-medium truncate">
                          <span className="font-bold text-[#A68B6D]">A.</span> {optA}
                        </div>
                        <div className="p-2.5 rounded-xl bg-[#FAF7F2] border border-[#E8D8C4] text-[#4A3F35] font-medium truncate">
                          <span className="font-bold text-[#A68B6D]">B.</span> {optB}
                        </div>
                        <div className="p-2.5 rounded-xl bg-[#FAF7F2] border border-[#E8D8C4] text-[#4A3F35] font-medium truncate">
                          <span className="font-bold text-[#A68B6D]">C.</span> {optC}
                        </div>
                        <div className="p-2.5 rounded-xl bg-[#FAF7F2] border border-[#E8D8C4] text-[#4A3F35] font-medium truncate">
                          <span className="font-bold text-[#A68B6D]">D.</span> {optD}
                        </div>
                      </div>
                    </div>

                    <div className="pt-1 flex items-center justify-between text-[11px]">
                      <button
                        type="button"
                        onClick={() => setIsEditingPreset(!isEditingPreset)}
                        className="text-[#A68B6D] hover:underline font-bold flex items-center gap-1 cursor-pointer"
                      >
                        <Edit3 className="w-3.5 h-3.5" />
                        <span>{isEditingPreset ? '隱藏手動修改' : '想要微調這題文字/選項內容？'}</span>
                      </button>
                    </div>
                  </div>

                  {isEditingPreset && (
                    <div className="space-y-3 bg-amber-50/70 p-3.5 rounded-2xl border border-amber-200/80 animate-fade-in">
                      <div>
                        <label className="text-xs font-bold text-[#4A3F35] mb-1 block">微調題目內容：</label>
                        <input
                          type="text"
                          required
                          value={questionText}
                          onChange={(e) => setQuestionText(e.target.value)}
                          className="w-full px-3.5 py-2 text-xs rounded-xl milk-tea-input font-bold"
                        />
                      </div>
                      <div>
                        <label className="text-xs font-bold text-[#4A3F35] mb-1 block">微調選項內容：</label>
                        <div className="grid grid-cols-2 gap-2">
                          <input
                            type="text"
                            required
                            value={optA}
                            onChange={(e) => setOptA(e.target.value)}
                            className="px-3 py-1.5 text-xs rounded-xl milk-tea-input"
                          />
                          <input
                            type="text"
                            required
                            value={optB}
                            onChange={(e) => setOptB(e.target.value)}
                            className="px-3 py-1.5 text-xs rounded-xl milk-tea-input"
                          />
                          <input
                            type="text"
                            required
                            value={optC}
                            onChange={(e) => setOptC(e.target.value)}
                            className="px-3 py-1.5 text-xs rounded-xl milk-tea-input"
                          />
                          <input
                            type="text"
                            required
                            value={optD}
                            onChange={(e) => setOptD(e.target.value)}
                            className="px-3 py-1.5 text-xs rounded-xl milk-tea-input"
                          />
                        </div>
                      </div>
                    </div>
                  )}

                  <div className="space-y-1.5">
                    <label className="text-[11px] font-bold text-[#7A6C5E] block">或從題庫中點選指定題目：</label>
                    <div className="flex flex-wrap gap-1.5 max-h-24 overflow-y-auto pr-1">
                      {faqs
                        .filter((f) => !f.category || f.category === questionCategory)
                        .map((f) => (
                          <button
                            key={f.id}
                            type="button"
                            onClick={() => handleSelectPresetFAQ(f)}
                            className="text-[11px] px-2.5 py-1 rounded-xl bg-white border border-[#D9C5B2] text-[#4A3F35] font-medium hover:border-[#A68B6D] hover:bg-[#E8D8C4]/40 transition-colors text-left truncate max-w-full cursor-pointer"
                          >
                            💡 {f.question}
                          </button>
                        ))}
                    </div>
                  </div>
                </div>
              ) : (
                <div className="space-y-3 bg-white p-4 rounded-2xl border border-[#D9C5B2] shadow-2xs animate-fade-in">
                  <div>
                    <label className="text-xs font-bold text-[#4A3F35] mb-1 block">
                      請輸入自訂題目內容 (問對方的真心話)：
                    </label>
                    <input
                      type="text"
                      required
                      value={questionText}
                      onChange={(e) => setQuestionText(e.target.value)}
                      placeholder="例如：你覺得我們第一次見面最深刻的事情是什麼？"
                      className="w-full px-3.5 py-2.5 text-xs rounded-xl milk-tea-input font-bold"
                    />
                  </div>

                  <div>
                    <label className="text-xs font-bold text-[#4A3F35] mb-1 block">請輸入 4 個作答選項：</label>
                    <div className="grid grid-cols-2 gap-2">
                      <input
                        type="text"
                        required
                        value={optA}
                        onChange={(e) => setOptA(e.target.value)}
                        placeholder="選項 A"
                        className="px-3 py-2 text-xs rounded-xl milk-tea-input"
                      />
                      <input
                        type="text"
                        required
                        value={optB}
                        onChange={(e) => setOptB(e.target.value)}
                        placeholder="選項 B"
                        className="px-3 py-2 text-xs rounded-xl milk-tea-input"
                      />
                      <input
                        type="text"
                        required
                        value={optC}
                        onChange={(e) => setOptC(e.target.value)}
                        placeholder="選項 C"
                        className="px-3 py-2 text-xs rounded-xl milk-tea-input"
                      />
                      <input
                        type="text"
                        required
                        value={optD}
                        onChange={(e) => setOptD(e.target.value)}
                        placeholder="選項 D"
                        className="px-3 py-2 text-xs rounded-xl milk-tea-input"
                      />
                    </div>
                  </div>
                </div>
              )}

              <div className="pt-2 flex items-center gap-2">
                <button
                  type="button"
                  onClick={onCloseQuestionModal}
                  className="px-4 py-3 rounded-2xl text-xs font-bold text-[#7A6C5E] bg-[#E8D8C4]/60 hover:bg-[#D9C5B2] transition-colors cursor-pointer"
                >
                  暫時關閉
                </button>
                <button
                  type="submit"
                  className="flex-1 milk-tea-btn-primary py-3 rounded-2xl text-xs font-bold flex items-center justify-center gap-1.5 shadow-md cursor-pointer"
                >
                  <Sparkles className="w-4 h-4" />
                  <span>發布考驗 (雙方於彈窗作答，答案揭曉於對話框)</span>
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </>
  );
};
