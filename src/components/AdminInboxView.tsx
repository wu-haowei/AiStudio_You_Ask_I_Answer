import React, { useState } from 'react';
import {
  Inbox,
  CheckCircle2,
  Clock,
  Archive,
  Send,
  PlusCircle,
  Trash2,
  User,
  Mail,
  MessageSquare,
} from 'lucide-react';
import { FAQItem, UserQuestion } from '../types';

interface AdminInboxViewProps {
  userQuestions: UserQuestion[];
  onReplyQuestion: (id: string, replyText: string) => void;
  onConvertFAQ: (question: UserQuestion, officialAnswer: string) => void;
  onDeleteQuestion: (id: string) => void;
  showToast: (title: string, description?: string, type?: 'success' | 'info') => void;
}

export const AdminInboxView: React.FC<AdminInboxViewProps> = ({
  userQuestions,
  onReplyQuestion,
  onConvertFAQ,
  onDeleteQuestion,
  showToast,
}) => {
  const [filterStatus, setFilterStatus] = useState<'all' | 'pending' | 'answered'>('pending');
  const [replyingId, setReplyingId] = useState<string | null>(null);
  const [replyText, setReplyText] = useState('');

  const filteredQuestions = userQuestions.filter((uq) => {
    if (filterStatus === 'pending') return uq.status === 'pending';
    if (filterStatus === 'answered') return uq.status === 'answered';
    return true;
  });

  const handleSendReply = (uq: UserQuestion, convertToPublic: boolean) => {
    if (!replyText.trim()) return;

    onReplyQuestion(uq.id, replyText.trim());

    if (convertToPublic) {
      onConvertFAQ(uq, replyText.trim());
      showToast('已回覆並上架至常見問題！', '前台使用者現在可以搜尋並檢視此問題解答。', 'success');
    } else {
      showToast('已儲存回覆訊息', '該筆提問已標示為已處理。', 'info');
    }

    setReplyingId(null);
    setReplyText('');
  };

  return (
    <div className="space-y-6 pb-12">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 p-6 rounded-3xl bg-white border border-[#E8DFD3] shadow-xs">
        <div>
          <h1 className="text-xl sm:text-2xl font-bold text-[#3A2E2B] flex items-center gap-2">
            <Inbox className="w-6 h-6 text-[#8C6D53]" />
            <span>使用者提問與反饋收件匣</span>
          </h1>
          <p className="text-xs sm:text-sm text-[#7A6C65] mt-1">
            檢視前台訪客送出的諮詢提問，回覆訊息並可一鍵同步轉為公開 FAQ 常見問題。
          </p>
        </div>

        {/* Filter Switcher */}
        <div className="flex items-center gap-1.5 bg-[#F2EBE1] p-1 rounded-xl border border-[#E4D8C8] self-start sm:self-auto">
          <button
            onClick={() => setFilterStatus('pending')}
            className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition-all ${
              filterStatus === 'pending'
                ? 'bg-[#8C6D53] text-white shadow-xs'
                : 'text-[#7A6C65] hover:text-[#3A2E2B]'
            }`}
          >
            待處理 ({userQuestions.filter((q) => q.status === 'pending').length})
          </button>
          <button
            onClick={() => setFilterStatus('answered')}
            className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition-all ${
              filterStatus === 'answered'
                ? 'bg-[#8C6D53] text-white shadow-xs'
                : 'text-[#7A6C65] hover:text-[#3A2E2B]'
            }`}
          >
            已回覆 ({userQuestions.filter((q) => q.status === 'answered').length})
          </button>
          <button
            onClick={() => setFilterStatus('all')}
            className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition-all ${
              filterStatus === 'all'
                ? 'bg-[#8C6D53] text-white shadow-xs'
                : 'text-[#7A6C65] hover:text-[#3A2E2B]'
            }`}
          >
            全部 ({userQuestions.length})
          </button>
        </div>
      </div>

      {/* Questions List */}
      <div className="space-y-4">
        {filteredQuestions.length === 0 ? (
          <div className="text-center py-16 bg-white rounded-3xl border border-[#E8DFD3] text-[#7A6C65] space-y-2">
            <CheckCircle2 className="w-10 h-10 mx-auto text-[#8C6D53]" />
            <p className="font-bold text-base text-[#3A2E2B]">目前沒有符合條件的收件提問</p>
            <p className="text-xs">當前台訪客透過「我要提問」送出訊息時，會即時顯示在此處。</p>
          </div>
        ) : (
          filteredQuestions.map((uq) => {
            const isReplying = replyingId === uq.id;

            return (
              <div
                key={uq.id}
                className="milk-tea-card rounded-2xl p-5 sm:p-6 space-y-4 transition-all"
              >
                {/* Meta Row */}
                <div className="flex flex-wrap items-center justify-between gap-3 border-b border-[#E8DFD3]/60 pb-3">
                  <div className="flex items-center gap-3">
                    <div className="w-8 h-8 rounded-full bg-[#F4ECE1] text-[#8C6D53] flex items-center justify-center font-bold text-xs">
                      <User className="w-4 h-4" />
                    </div>
                    <div>
                      <div className="flex items-center gap-2">
                        <span className="font-bold text-sm text-[#3A2E2B]">{uq.authorName}</span>
                        {uq.authorEmail && (
                          <span className="text-xs text-[#7A6C65] flex items-center gap-1">
                            <Mail className="w-3 h-3 text-[#8C6D53]" /> {uq.authorEmail}
                          </span>
                        )}
                      </div>
                      <span className="text-[11px] text-[#8A7970]">
                        提問時間：{new Date(uq.createdAt).toLocaleString()}
                      </span>
                    </div>
                  </div>

                  <div className="flex items-center gap-2">
                    <span className="text-xs px-2.5 py-0.5 rounded-full bg-[#F3E8DC] text-[#7A5230] font-semibold">
                      {uq.category}
                    </span>
                    {uq.status === 'pending' ? (
                      <span className="text-[11px] font-bold text-amber-800 bg-amber-100 px-2.5 py-0.5 rounded-full flex items-center gap-1">
                        <Clock className="w-3 h-3" /> 待處理
                      </span>
                    ) : (
                      <span className="text-[11px] font-bold text-emerald-800 bg-emerald-100 px-2.5 py-0.5 rounded-full flex items-center gap-1">
                        <CheckCircle2 className="w-3 h-3" /> 已回覆
                      </span>
                    )}
                  </div>
                </div>

                {/* Question Body */}
                <div className="bg-[#FCFAF6] p-4 rounded-xl border border-[#E8DFD3]/60 text-sm text-[#3A2E2B] leading-relaxed">
                  <span className="text-xs font-bold text-[#8C6D53] block mb-1">【訪客提問】</span>
                  {uq.questionText}
                </div>

                {/* Existing Reply if Answered */}
                {uq.officialReply && (
                  <div className="bg-[#F4ECE1] p-4 rounded-xl border border-[#E4D8C8] text-sm text-[#4A3D39] leading-relaxed">
                    <span className="text-xs font-bold text-[#7A5230] block mb-1">【官方線上回覆】</span>
                    {uq.officialReply}
                  </div>
                )}

                {/* Reply Form Trigger & Actions */}
                <div className="flex items-center justify-between gap-3 pt-1">
                  {!isReplying ? (
                    <button
                      onClick={() => {
                        setReplyingId(uq.id);
                        setReplyText(uq.officialReply || '');
                      }}
                      className="milk-tea-btn-primary px-4 py-2 rounded-xl text-xs sm:text-sm font-semibold inline-flex items-center gap-1.5"
                    >
                      <MessageSquare className="w-4 h-4" />
                      <span>{uq.officialReply ? '編輯回覆內容' : '進行回覆 / 轉公開 FAQ'}</span>
                    </button>
                  ) : (
                    <span className="text-xs font-bold text-[#8C6D53]">撰寫官方客服回覆：</span>
                  )}

                  <button
                    onClick={() => {
                      if (confirm('確定要刪除這筆提問紀錄嗎？')) {
                        onDeleteQuestion(uq.id);
                        showToast('已刪除提問紀錄', '', 'info');
                      }
                    }}
                    className="p-2 rounded-xl text-rose-600 hover:bg-rose-50 transition-colors"
                    title="刪除"
                  >
                    <Trash2 className="w-4 h-4" />
                  </button>
                </div>

                {/* Inline Reply Textarea */}
                {isReplying && (
                  <div className="p-4 rounded-2xl bg-[#FCFAF6] border border-[#E8DFD3] space-y-3 animate-fade-in">
                    <textarea
                      rows={3}
                      value={replyText}
                      onChange={(e) => setReplyText(e.target.value)}
                      placeholder="輸入回覆訊息..."
                      className="w-full px-3.5 py-2.5 text-sm rounded-xl milk-tea-input resize-none"
                    />

                    <div className="flex flex-wrap items-center justify-end gap-2">
                      <button
                        onClick={() => setReplyingId(null)}
                        className="px-3.5 py-2 rounded-xl text-xs font-semibold text-[#7A6C65] hover:bg-[#F2EBE1]"
                      >
                        取消
                      </button>

                      <button
                        onClick={() => handleSendReply(uq, false)}
                        className="milk-tea-btn-secondary px-4 py-2 rounded-xl text-xs font-semibold inline-flex items-center gap-1"
                      >
                        <Send className="w-3.5 h-3.5" />
                        <span>僅回覆 (不公開)</span>
                      </button>

                      <button
                        onClick={() => handleSendReply(uq, true)}
                        className="milk-tea-btn-primary px-4 py-2 rounded-xl text-xs font-semibold inline-flex items-center gap-1 shadow-xs"
                      >
                        <PlusCircle className="w-3.5 h-3.5" />
                        <span>回覆並同步上架為前台 FAQ</span>
                      </button>
                    </div>
                  </div>
                )}
              </div>
            );
          })
        )}
      </div>
    </div>
  );
};
