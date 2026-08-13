import React, { useState } from 'react';
import { X, Send, HelpCircle, User, Mail, MessageSquare } from 'lucide-react';
import { Category } from '../types';

interface AskQuestionModalProps {
  isOpen: boolean;
  onClose: () => void;
  categories: Category[];
  onSubmitQuestion: (questionData: {
    authorName: string;
    authorEmail: string;
    questionText: string;
    category: string;
  }) => void;
}

export const AskQuestionModal: React.FC<AskQuestionModalProps> = ({
  isOpen,
  onClose,
  categories,
  onSubmitQuestion,
}) => {
  const [authorName, setAuthorName] = useState('');
  const [authorEmail, setAuthorEmail] = useState('');
  const [category, setCategory] = useState(categories[0]?.name || '一般詢問');
  const [questionText, setQuestionText] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);

  if (!isOpen) return null;

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!authorName.trim() || !questionText.trim()) return;

    setIsSubmitting(true);
    setTimeout(() => {
      onSubmitQuestion({
        authorName: authorName.trim(),
        authorEmail: authorEmail.trim(),
        category,
        questionText: questionText.trim(),
      });
      setIsSubmitting(false);
      onClose();
      setQuestionText('');
      setAuthorName('');
      setAuthorEmail('');
    }, 400);
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/40 backdrop-blur-xs animate-fade-in">
      <div className="bg-[#FCFAF6] rounded-3xl border border-[#E8DFD3] shadow-2xl max-w-lg w-full overflow-hidden">
        {/* Modal Header */}
        <div className="px-6 py-5 bg-[#F5EFE6] border-b border-[#E8DFD3] flex items-center justify-between">
          <div className="flex items-center gap-2.5">
            <div className="w-9 h-9 rounded-xl bg-[#8C6D53] flex items-center justify-center text-white">
              <HelpCircle className="w-5 h-5" />
            </div>
            <div>
              <h3 className="text-base font-bold text-[#3A2E2B]">我要提問 / 客服諮詢</h3>
              <p className="text-xs text-[#7A6C65]">專人將會在第一時間檢視並回覆您的問題</p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-1.5 rounded-xl text-[#7A6C65] hover:text-[#3A2E2B] hover:bg-[#EADDCB] transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Modal Form */}
        <form onSubmit={handleSubmit} className="p-6 space-y-4">
          <div>
            <label className="block text-xs font-semibold text-[#3A2E2B] mb-1.5">
              您的稱呼 <span className="text-rose-500">*</span>
            </label>
            <div className="relative">
              <User className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-[#8C6D53]" />
              <input
                type="text"
                required
                value={authorName}
                onChange={(e) => setAuthorName(e.target.value)}
                placeholder="例如：林小姐、張先生"
                className="w-full pl-10 pr-4 py-2.5 text-sm rounded-xl milk-tea-input"
              />
            </div>
          </div>

          <div>
            <label className="block text-xs font-semibold text-[#3A2E2B] mb-1.5">
              電子郵件 (選填，以利收到私訊回覆通知)
            </label>
            <div className="relative">
              <Mail className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-[#8C6D53]" />
              <input
                type="email"
                value={authorEmail}
                onChange={(e) => setAuthorEmail(e.target.value)}
                placeholder="your.name@example.com"
                className="w-full pl-10 pr-4 py-2.5 text-sm rounded-xl milk-tea-input"
              />
            </div>
          </div>

          <div>
            <label className="block text-xs font-semibold text-[#3A2E2B] mb-1.5">
              問題分類
            </label>
            <select
              value={category}
              onChange={(e) => setCategory(e.target.value)}
              className="w-full px-3.5 py-2.5 text-sm rounded-xl milk-tea-input"
            >
              {categories.map((cat) => (
                <option key={cat.id} value={cat.name}>
                  {cat.name}
                </option>
              ))}
              <option value="其他疑問">其他疑問</option>
            </select>
          </div>

          <div>
            <label className="block text-xs font-semibold text-[#3A2E2B] mb-1.5">
              詳細提問內容 <span className="text-rose-500">*</span>
            </label>
            <div className="relative">
              <MessageSquare className="absolute left-3.5 top-3 w-4 h-4 text-[#8C6D53]" />
              <textarea
                required
                rows={4}
                value={questionText}
                onChange={(e) => setQuestionText(e.target.value)}
                placeholder="請詳細說明您遇到的問題、需求或對商品的疑問..."
                className="w-full pl-10 pr-4 py-2.5 text-sm rounded-xl milk-tea-input resize-none"
              />
            </div>
          </div>

          <div className="pt-2 flex items-center justify-end gap-3 border-t border-[#E8DFD3]">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2 rounded-xl text-sm font-medium text-[#7A6C65] hover:bg-[#F2EBE1]"
            >
              取消
            </button>
            <button
              type="submit"
              disabled={isSubmitting}
              className="milk-tea-btn-primary px-5 py-2.5 rounded-xl text-sm font-semibold inline-flex items-center gap-2 shadow-sm"
            >
              <Send className="w-4 h-4" />
              <span>{isSubmitting ? '傳送中...' : '確認送出提問'}</span>
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};
