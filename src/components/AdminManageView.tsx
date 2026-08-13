import React, { useState } from 'react';
import {
  Plus,
  Search,
  Edit2,
  Trash2,
  Pin,
  Eye,
  EyeOff,
  Sparkles,
  Download,
  Upload,
  RotateCcw,
  Bot,
  Wand2,
  X,
  Check,
} from 'lucide-react';
import { Category, FAQItem } from '../types';
import { clearAllStorageAndSession, CURRENT_APP_VERSION } from '../utils/storage';
import { AdminJsonImportModal } from './admin/AdminJsonImportModal';

interface AdminManageViewProps {
  faqs: FAQItem[];
  categories: Category[];
  onAddFAQ: (faq: Omit<FAQItem, 'id' | 'updatedAt' | 'helpfulCount' | 'unhelpfulCount'>) => void;
  onUpdateFAQ: (faq: FAQItem) => void;
  onDeleteFAQ: (id: string) => void;
  onResetData: () => void;
  onImportData: (jsonStr: string) => void | Promise<void>;
  isLoading?: boolean;
  onExportData: () => void;
  showToast: (title: string, description?: string, type?: 'success' | 'error' | 'info' | 'warning') => void;
}

export const AdminManageView: React.FC<AdminManageViewProps> = ({
  faqs,
  categories,
  onAddFAQ,
  onUpdateFAQ,
  onDeleteFAQ,
  onResetData,
  onImportData,
  onExportData,
  isLoading = false,
  showToast,
}) => {
  const [search, setSearch] = useState('');
  const [selectedCategory, setSelectedCategory] = useState('all');

  // Modal States
  const [isEditModalOpen, setIsEditModalOpen] = useState(false);
  const [editingFaq, setEditingFaq] = useState<FAQItem | null>(null);

  // Form Field States
  const [formQuestion, setFormQuestion] = useState('');
  const [formAnswer, setFormAnswer] = useState('');
  const [formCategory, setFormCategory] = useState('');
  const [formTagsStr, setFormTagsStr] = useState('');
  const [formIsPinned, setFormIsPinned] = useState(false);
  const [formIsHidden, setFormIsHidden] = useState(false);
  const [formOptionsStr, setFormOptionsStr] = useState('');
  const [formCorrectIndex, setFormCorrectIndex] = useState(0);
  const [formExplanation, setFormExplanation] = useState('');

  // AI Generator Modal
  const [isAiModalOpen, setIsAiModalOpen] = useState(false);
  const [aiTopic, setAiTopic] = useState('');
  const [aiCategory, setAiCategory] = useState(categories[0]?.name || '習性與喜好');
  const [aiCount, setAiCount] = useState(3);
  const [isGenerating, setIsGenerating] = useState(false);

  // AI Answer Polish
  const [isPolishing, setIsPolishing] = useState(false);

  // JSON Template Modal
  const [isJsonModalOpen, setIsJsonModalOpen] = useState(false);

  // Delete Confirmation
  const [deletingId, setDeletingId] = useState<string | null>(null);

  const filteredFaqs = faqs.filter((f) => {
    if (selectedCategory !== 'all' && f.category !== selectedCategory) return false;
    if (search.trim()) {
      const q = search.toLowerCase();
      return (
        f.question.toLowerCase().includes(q) ||
        f.answer.toLowerCase().includes(q) ||
        f.tags?.some((t) => t.toLowerCase().includes(q))
      );
    }
    return true;
  });

  const handleOpenAddModal = () => {
    setEditingFaq(null);
    setFormQuestion('');
    setFormAnswer('');
    setFormCategory(categories[0]?.name || '習性與喜好');
    setFormTagsStr('');
    setFormIsPinned(false);
    setFormIsHidden(false);
    setFormOptionsStr('');
    setFormCorrectIndex(0);
    setFormExplanation('');
    setIsEditModalOpen(true);
  };

  const handleOpenEditModal = (faq: FAQItem) => {
    setEditingFaq(faq);
    setFormQuestion(faq.question);
    setFormAnswer(faq.answer);
    setFormCategory(faq.category);
    setFormTagsStr(faq.tags ? faq.tags.join(', ') : '');
    setFormIsPinned(!!faq.isPinned);
    setFormIsHidden(!!faq.isHidden);
    setFormOptionsStr(faq.options ? faq.options.join('\n') : '');
    setFormCorrectIndex(faq.correctOptionIndex || 0);
    setFormExplanation(faq.explanation || '');
    setIsEditModalOpen(true);
  };

  const handleSaveForm = (e: React.FormEvent) => {
    e.preventDefault();
    if (!formQuestion.trim() || !formAnswer.trim()) {
      showToast('請填寫題目與說明', undefined, 'warning');
      return;
    }

    const tagsArray = formTagsStr
      .split(/[,，\s]+/)
      .map((t) => t.trim())
      .filter(Boolean);

    const optionsArray = formOptionsStr
      .split('\n')
      .map((o) => o.trim())
      .filter(Boolean);

    if (editingFaq) {
      onUpdateFAQ({
        ...editingFaq,
        question: formQuestion.trim(),
        answer: formAnswer.trim(),
        category: formCategory,
        tags: tagsArray,
        isPinned: formIsPinned,
        isHidden: formIsHidden,
        options: optionsArray.length > 0 ? optionsArray : undefined,
        correctOptionIndex: optionsArray.length > 0 ? formCorrectIndex : undefined,
        explanation: formExplanation.trim() || undefined,
        updatedAt: new Date().toISOString(),
      });
      showToast('已更新', undefined, 'success');
    } else {
      onAddFAQ({
        question: formQuestion.trim(),
        answer: formAnswer.trim(),
        category: formCategory,
        tags: tagsArray,
        isPinned: formIsPinned,
        isHidden: formIsHidden,
        options: optionsArray.length > 0 ? optionsArray : undefined,
        correctOptionIndex: optionsArray.length > 0 ? formCorrectIndex : undefined,
        explanation: formExplanation.trim() || undefined,
      });
      showToast('已新增題目', undefined, 'success');
    }

    setIsEditModalOpen(false);
  };

  const handlePolishAnswer = async () => {
    if (!formQuestion.trim() || !formAnswer.trim()) {
      showToast('請先填寫問題與解答草稿', 'AI 需要參考原始草稿進行優化', 'error');
      return;
    }

    setIsPolishing(true);
    try {
      const res = await fetch('/api/polish-answer', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ question: formQuestion, answer: formAnswer }),
      });
      const data = await res.json();
      if (data.success && data.polishedAnswer) {
        setFormAnswer(data.polishedAnswer);
        showToast('AI 答案優化完成', '已修飾語氣與條理排版', 'success');
      } else {
        throw new Error(data.error || '潤飾失敗');
      }
    } catch (err: any) {
      showToast('AI 潤飾暫無法使用', err.message || '請確認 API 金鑰', 'error');
    } finally {
      setIsPolishing(false);
    }
  };

  const handleGenerateQA = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!aiTopic.trim()) return;

    setIsGenerating(true);
    try {
      const res = await fetch('/api/generate-qa', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ topic: aiTopic, category: aiCategory, count: aiCount }),
      });
      const data = await res.json();
      if (data.success && Array.isArray(data.items)) {
        data.items.forEach((item: any) => {
          onAddFAQ({
            question: item.question,
            answer: item.answer,
            category: item.category || aiCategory,
            tags: item.tags || ['AI生成'],
            options: item.options,
            correctOptionIndex: item.correctOptionIndex,
            explanation: item.explanation,
          });
        });
        showToast('AI 批次生成完成！', `已成功新增 ${data.items.length} 則常見問題！`, 'success');
        setIsAiModalOpen(false);
        setAiTopic('');
      } else {
        throw new Error(data.error || '生成失敗');
      }
    } catch (err: any) {
      showToast('AI 生成失敗', err.message || '請稍後再試', 'error');
    } finally {
      setIsGenerating(false);
    }
  };

  return (
    <div className="space-y-6 pb-12">
      {/* Admin Control Bar */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 p-6 rounded-3xl bg-white border border-[#E8DFD3] shadow-xs">
        <div>
          <h1 className="text-xl sm:text-2xl font-bold text-[#3A2E2B] flex items-center gap-2">
            <span>後台管理</span>
            <span className="text-xs px-2.5 py-0.5 rounded-full bg-[#F3E8DC] text-[#7A5230] font-semibold">
              {isLoading ? '雲端載入中…' : `共 ${faqs.length} 題`}
            </span>
          </h1>
          <p className="text-xs sm:text-sm text-[#7A6C65] mt-1">
            題庫即時同步至雲端，所有裝置共用。
          </p>
        </div>

        {/* Action Group */}
        <div className="flex flex-wrap items-center gap-2 sm:gap-3">
          <button
            onClick={() => setIsJsonModalOpen(true)}
            className="px-3.5 py-2 rounded-xl text-xs sm:text-sm font-semibold bg-[#E6D8C8] text-[#4A3F35] hover:bg-[#DBC9B5] transition-all inline-flex items-center gap-1.5 border border-[#D0BFAC]"
          >
            <Upload className="w-4 h-4" />
            <span>匯入題目</span>
          </button>

          <button
            onClick={handleOpenAddModal}
            className="milk-tea-btn-primary px-4 py-2 rounded-xl text-xs sm:text-sm font-semibold inline-flex items-center gap-1.5 shadow-sm"
          >
            <Plus className="w-4 h-4" />
            <span>新增題目</span>
          </button>

          {/* Backup Tools */}
          <div className="flex items-center gap-1 border-l border-[#E8DFD3] pl-2">
            <button
              onClick={onExportData}
              title="匯出題庫"
              className="p-2 rounded-xl text-[#7A6C65] hover:text-[#3A2E2B] hover:bg-[#F4ECE1] transition-colors"
            >
              <Download className="w-4 h-4" />
            </button>
            <button
              onClick={() => {
                if (confirm('確定要將雲端題庫重置為預設題目庫嗎？此動作會覆蓋所有裝置上的題庫內容。')) {
                  onResetData();

                }
              }}
              title="還原預設題庫"
              className="p-2 rounded-xl text-rose-600 hover:bg-rose-50 transition-colors"
            >
              <RotateCcw className="w-4 h-4" />
            </button>
            <button
              onClick={() => {
                if (confirm('確定要清除本機快取嗎？雲端題庫與對話紀錄不受影響，頁面將重新載入。')) {
                  clearAllStorageAndSession();
                  window.location.reload();
                }
              }}
              title={`一鍵清除本機快取（不影響雲端題庫，目前版本 v${CURRENT_APP_VERSION}）`}
              className="p-2 rounded-xl text-amber-700 hover:bg-amber-100 transition-colors"
            >
              <Trash2 className="w-4 h-4" />
            </button>
          </div>
        </div>
      </div>

      {/* Filter and Search Inputs */}
      <div className="flex flex-col sm:flex-row items-center gap-3">
        <div className="relative flex-1 w-full">
          <Search className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-[#8C6D53]" />
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="搜尋題目或標籤"
            className="w-full pl-10 pr-4 py-2.5 text-sm rounded-xl milk-tea-input"
          />
        </div>

        <select
          value={selectedCategory}
          onChange={(e) => setSelectedCategory(e.target.value)}
          className="w-full sm:w-48 px-3.5 py-2.5 text-sm rounded-xl milk-tea-input shrink-0"
        >
          <option value="all">全部分類 ({faqs.length})</option>
          {categories.map((c) => (
            <option key={c.id} value={c.name}>
              {c.name}
            </option>
          ))}
        </select>
      </div>

      {/* Q&A Data Cards List */}
      <div className="space-y-3">
        {filteredFaqs.length === 0 ? (
          <div className="text-center py-12 bg-white rounded-3xl border border-[#E8DFD3] text-[#7A6C65]">
            沒有符合條件的題目。
          </div>
        ) : (
          filteredFaqs.map((faq) => (
            <div
              key={faq.id}
              className={`milk-tea-card rounded-2xl p-5 flex flex-col sm:flex-row sm:items-center justify-between gap-4 ${
                faq.isHidden ? 'opacity-60 bg-[#F5F2EB]' : ''
              }`}
            >
              <div className="space-y-1.5 flex-1">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="text-xs px-2.5 py-0.5 rounded-full bg-[#F3E8DC] text-[#7A5230] font-semibold border border-[#E6D4C2]">
                    {faq.category}
                  </span>
                  {faq.isPinned && (
                    <span className="text-[10px] font-bold text-amber-800 bg-amber-100 px-2 py-0.5 rounded-md flex items-center gap-0.5">
                      <Pin className="w-3 h-3" /> 置頂
                    </span>
                  )}
                  {faq.isHidden && (
                    <span className="text-[10px] font-bold text-gray-600 bg-gray-200 px-2 py-0.5 rounded-md">
                      已隱藏
                    </span>
                  )}
                  {faq.options && faq.options.length > 0 && (
                    <span className="text-[10px] font-bold text-purple-700 bg-purple-100 px-2 py-0.5 rounded-md">
                      {faq.options.length} 個選項
                    </span>
                  )}
                </div>

                <h3 className="text-base font-bold text-[#3A2E2B]">{faq.question}</h3>
                <p className="text-xs text-[#7A6C65] line-clamp-2">{faq.answer}</p>
              </div>

              {/* Action Column */}
              <div className="flex items-center gap-2 shrink-0 self-end sm:self-auto border-t sm:border-t-0 pt-2 sm:pt-0 border-[#E8DFD3]">
                <button
                  onClick={() =>
                    onUpdateFAQ({ ...faq, isPinned: !faq.isPinned, updatedAt: new Date().toISOString() })
                  }
                  className={`p-2 rounded-xl transition-colors ${
                    faq.isPinned
                      ? 'bg-amber-100 text-amber-800'
                      : 'text-[#7A6C65] hover:bg-[#F4ECE1]'
                  }`}
                  title={faq.isPinned ? '取消置頂' : '置頂'}
                >
                  <Pin className="w-4 h-4" />
                </button>

                <button
                  onClick={() =>
                    onUpdateFAQ({ ...faq, isHidden: !faq.isHidden, updatedAt: new Date().toISOString() })
                  }
                  className={`p-2 rounded-xl transition-colors ${
                    faq.isHidden
                      ? 'bg-gray-200 text-gray-700'
                      : 'text-[#7A6C65] hover:bg-[#F4ECE1]'
                  }`}
                  title={faq.isHidden ? '顯示' : '隱藏'}
                >
                  {faq.isHidden ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                </button>

                <button
                  onClick={() => handleOpenEditModal(faq)}
                  className="p-2 rounded-xl text-[#8C6D53] hover:bg-[#F4ECE1] transition-colors"
                  title="編輯"
                >
                  <Edit2 className="w-4 h-4" />
                </button>

                <button
                  onClick={() => setDeletingId(faq.id)}
                  className="p-2 rounded-xl text-rose-600 hover:bg-rose-50 transition-colors"
                  title="刪除"
                >
                  <Trash2 className="w-4 h-4" />
                </button>
              </div>
            </div>
          ))
        )}
      </div>

      {/* Edit / Add Modal */}
      {isEditModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/40 backdrop-blur-xs animate-fade-in overflow-y-auto">
          <div className="bg-[#FCFAF6] rounded-3xl border border-[#E8DFD3] shadow-2xl max-w-2xl w-full max-h-[90vh] flex flex-col overflow-hidden my-auto">
            <div className="px-6 py-5 bg-[#F5EFE6] border-b border-[#E8DFD3] flex items-center justify-between">
              <h3 className="text-base font-bold text-[#3A2E2B]">
                {editingFaq ? '編輯題目' : '新增題目'}
              </h3>
              <button
                onClick={() => setIsEditModalOpen(false)}
                className="p-1.5 rounded-xl text-[#7A6C65] hover:bg-[#EADDCB]"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <form onSubmit={handleSaveForm} className="p-6 space-y-4 overflow-y-auto flex-1">
              <div>
                <label className="block text-xs font-semibold text-[#3A2E2B] mb-1.5">
                  題目名稱 <span className="text-rose-500">*</span>
                </label>
                <input
                  type="text"
                  required
                  value={formQuestion}
                  onChange={(e) => setFormQuestion(e.target.value)}
                  placeholder="例如：假日最喜歡的放鬆度過方式是什麼？"
                  className="w-full px-4 py-2.5 text-sm rounded-xl milk-tea-input"
                />
              </div>

              <div>
                <div className="flex items-center justify-between mb-1.5">
                  <label className="text-xs font-semibold text-[#3A2E2B]">
                    題目解析與說明 <span className="text-rose-500">*</span>
                  </label>
                  <button
                    type="button"
                    onClick={handlePolishAnswer}
                    disabled={isPolishing}
                    className="text-xs text-[#8C6D53] hover:underline flex items-center gap-1 font-semibold"
                  >
                    <Wand2 className="w-3.5 h-3.5" />
                    <span>{isPolishing ? 'AI 潤飾中...' : '使用 AI 潤飾語氣'}</span>
                  </button>
                </div>
                <textarea
                  required
                  rows={3}
                  value={formAnswer}
                  onChange={(e) => setFormAnswer(e.target.value)}
                  placeholder="題目說明或背景"
                  className="w-full px-4 py-2.5 text-sm rounded-xl milk-tea-input resize-none"
                />
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs font-semibold text-[#3A2E2B] mb-1.5">
                    題目方向分類
                  </label>
                  <select
                    value={formCategory}
                    onChange={(e) => setFormCategory(e.target.value)}
                    className="w-full px-3.5 py-2.5 text-sm rounded-xl milk-tea-input"
                  >
                    {categories.map((c) => (
                      <option key={c.id} value={c.name}>
                        {c.name}
                      </option>
                    ))}
                  </select>
                </div>

                <div>
                  <label className="block text-xs font-semibold text-[#3A2E2B] mb-1.5">
                    相關標籤 (用逗號隔開)
                  </label>
                  <input
                    type="text"
                    value={formTagsStr}
                    onChange={(e) => setFormTagsStr(e.target.value)}
                    placeholder="日常生活, 偏好, 習慣"
                    className="w-full px-4 py-2.5 text-sm rounded-xl milk-tea-input"
                  />
                </div>
              </div>

              {/* Options */}
              <div className="border-t border-[#E8DFD3] pt-4 space-y-3">
                <div className="flex items-center gap-1.5 text-xs font-bold text-[#8C6D53]">
                  <Sparkles className="w-4 h-4" />
                  <span>題目選項 (每行一個，共 4 個)</span>
                </div>

                <div>
                  <textarea
                    rows={4}
                    value={formOptionsStr}
                    onChange={(e) => setFormOptionsStr(e.target.value)}
                    placeholder="選項 1&#10;選項 2&#10;選項 3&#10;選項 4"
                    className="w-full px-3.5 py-2 text-xs rounded-xl milk-tea-input resize-none"
                  />
                </div>
              </div>

              <div className="pt-4 flex items-center justify-end gap-3 border-t border-[#E8DFD3]">
                <button
                  type="button"
                  onClick={() => setIsEditModalOpen(false)}
                  className="px-4 py-2 rounded-xl text-sm font-medium text-[#7A6C65] hover:bg-[#F2EBE1]"
                >
                  取消
                </button>
                <button
                  type="submit"
                  className="milk-tea-btn-primary px-5 py-2.5 rounded-xl text-sm font-semibold inline-flex items-center gap-1.5"
                >
                  <Check className="w-4 h-4" />
                  <span>儲存變更</span>
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* JSON Modal */}
      <AdminJsonImportModal
        isOpen={isJsonModalOpen}
        onClose={() => setIsJsonModalOpen(false)}
        onImportData={onImportData}
        showToast={showToast}
      />

      {/* Delete Confirmation Modal */}
      {deletingId && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/40 backdrop-blur-xs animate-fade-in">
          <div className="bg-[#FCFAF6] rounded-3xl border border-[#E8DFD3] p-6 max-w-sm w-full space-y-4">
            <h3 className="text-base font-bold text-[#3A2E2B]">確認要刪除此題目嗎？</h3>
            <div className="flex items-center justify-end gap-3 pt-2">
              <button
                onClick={() => setDeletingId(null)}
                className="px-4 py-2 rounded-xl text-xs font-semibold text-[#7A6C65] hover:bg-[#F2EBE1]"
              >
                取消
              </button>
              <button
                onClick={() => {
                  onDeleteFAQ(deletingId);
                  setDeletingId(null);
                  showToast('已刪除題目', undefined, 'info');
                }}
                className="px-4 py-2 rounded-xl text-xs font-semibold bg-rose-600 text-white hover:bg-rose-700 shadow-xs"
              >
                確認刪除
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
