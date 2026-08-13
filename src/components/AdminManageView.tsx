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
  X,
  Check,
} from 'lucide-react';
import { Category, FAQItem } from '../types';
import { clearAllStorageAndSession, CURRENT_APP_VERSION } from '../utils/storage';
import { AdminJsonImportModal } from './admin/AdminJsonImportModal';

interface AdminManageViewProps {
  faqs: FAQItem[];
  categories: Category[];
  onAddFAQ: (faq: Omit<FAQItem, 'id' | 'updatedAt'>) => void;
  onUpdateFAQ: (faq: FAQItem) => void;
  onDeleteFAQ: (id: string) => void;
  onDeleteFAQs: (ids: string[]) => void | Promise<void>;
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
  onDeleteFAQs,
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
  const [formIsPinned, setFormIsPinned] = useState(false);
  const [formIsHidden, setFormIsHidden] = useState(false);
  const [formOptions, setFormOptions] = useState<string[]>(['', '']);


  // JSON Template Modal
  const [isJsonModalOpen, setIsJsonModalOpen] = useState(false);

  // Delete Confirmation
  const [deletingId, setDeletingId] = useState<string | null>(null);

  // Bulk selection
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [isBulkDeleteOpen, setIsBulkDeleteOpen] = useState(false);
  const [isBulkDeleting, setIsBulkDeleting] = useState(false);

  const filteredFaqs = faqs.filter((f) => {
    if (selectedCategory !== 'all' && f.category !== selectedCategory) return false;
    if (search.trim()) {
      const q = search.toLowerCase();
      return f.question.toLowerCase().includes(q) || f.answer.toLowerCase().includes(q);
    }
    return true;
  });

  const selectedCount = selectedIds.size;
  const allFilteredSelected =
    filteredFaqs.length > 0 && filteredFaqs.every((f) => selectedIds.has(f.id));

  const toggleSelected = (id: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  /** Select-all applies to the current filter, not the whole library. */
  const toggleSelectAllFiltered = () => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (allFilteredSelected) filteredFaqs.forEach((f) => next.delete(f.id));
      else filteredFaqs.forEach((f) => next.add(f.id));
      return next;
    });
  };

  const handleBulkDelete = async () => {
    const ids = [...selectedIds];
    if (ids.length === 0) return;

    setIsBulkDeleting(true);
    try {
      await onDeleteFAQs(ids);
      setSelectedIds(new Set());
      setIsBulkDeleteOpen(false);
      showToast('已刪除題目', `共刪除 ${ids.length} 題`, 'info');
    } catch (err: any) {
      showToast('刪除失敗', err?.message || '請稍後再試', 'error');
    } finally {
      setIsBulkDeleting(false);
    }
  };

  const handleOpenAddModal = () => {
    setEditingFaq(null);
    setFormQuestion('');
    setFormAnswer('');
    setFormCategory(categories[0]?.name || '習性與喜好');
    setFormIsPinned(false);
    setFormIsHidden(false);
    setFormOptions(['', '']);
    setIsEditModalOpen(true);
  };

  const handleOpenEditModal = (faq: FAQItem) => {
    setEditingFaq(faq);
    setFormQuestion(faq.question);
    setFormAnswer(faq.answer);
    setFormCategory(faq.category);
    setFormIsPinned(!!faq.isPinned);
    setFormIsHidden(!!faq.isHidden);
    setFormOptions(faq.options?.length ? [...faq.options] : ['', '']);
    setIsEditModalOpen(true);
  };

  /** Options are a free-length list — at least two, no upper bound. */
  const updateOption = (index: number, value: string) => {
    setFormOptions((prev) => prev.map((o, i) => (i === index ? value : o)));
  };

  const addOption = () => setFormOptions((prev) => [...prev, '']);

  const removeOption = (index: number) => {
    setFormOptions((prev) => (prev.length <= 2 ? prev : prev.filter((_, i) => i !== index)));
  };

  const handleSaveForm = (e: React.FormEvent) => {
    e.preventDefault();
    if (!formQuestion.trim() || !formAnswer.trim()) {
      showToast('請填寫題目與說明', undefined, 'warning');
      return;
    }

    const optionsArray = formOptions.map((o) => o.trim()).filter(Boolean);

    if (optionsArray.length === 1) {
      showToast('選項至少要兩個', '請再補一個選項，或全部留白', 'warning');
      return;
    }

    if (editingFaq) {
      onUpdateFAQ({
        ...editingFaq,
        question: formQuestion.trim(),
        answer: formAnswer.trim(),
        category: formCategory,
        isPinned: formIsPinned,
        isHidden: formIsHidden,
        options: optionsArray.length > 0 ? optionsArray : undefined,
        updatedAt: new Date().toISOString(),
      });
      showToast('已更新', undefined, 'success');
    } else {
      onAddFAQ({
        question: formQuestion.trim(),
        answer: formAnswer.trim(),
        category: formCategory,
        isPinned: formIsPinned,
        isHidden: formIsHidden,
        options: optionsArray.length > 0 ? optionsArray : undefined,
      });
      showToast('已新增題目', undefined, 'success');
    }

    setIsEditModalOpen(false);
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

      {/* Selection Toolbar */}
      {filteredFaqs.length > 0 && (
        <div className="flex flex-wrap items-center justify-between gap-3 px-4 py-2.5 rounded-2xl bg-white border border-[#E8DFD3]">
          <label className="flex items-center gap-2 text-xs font-semibold text-[#4A3F35] cursor-pointer select-none">
            <input
              type="checkbox"
              checked={allFilteredSelected}
              onChange={toggleSelectAllFiltered}
              className="w-4 h-4 accent-[#8C6D53] cursor-pointer"
            />
            <span>全選目前 {filteredFaqs.length} 題</span>
          </label>

          {selectedCount > 0 && (
            <div className="flex items-center gap-2">
              <span className="text-xs text-[#7A6C65]">已選 {selectedCount} 題</span>
              <button
                type="button"
                onClick={() => setSelectedIds(new Set())}
                className="px-3 py-1.5 rounded-xl text-xs font-semibold text-[#7A6C65] hover:bg-[#F4ECE1] transition-colors cursor-pointer"
              >
                取消選取
              </button>
              <button
                type="button"
                onClick={() => setIsBulkDeleteOpen(true)}
                className="px-3 py-1.5 rounded-xl text-xs font-semibold bg-rose-600 hover:bg-rose-700 text-white transition-colors cursor-pointer inline-flex items-center gap-1.5"
              >
                <Trash2 className="w-3.5 h-3.5" />
                刪除所選
              </button>
            </div>
          )}
        </div>
      )}

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
              } ${selectedIds.has(faq.id) ? 'ring-2 ring-[#8C6D53]' : ''}`}
            >
              <input
                type="checkbox"
                checked={selectedIds.has(faq.id)}
                onChange={() => toggleSelected(faq.id)}
                aria-label={`選取「${faq.question}」`}
                className="w-4 h-4 accent-[#8C6D53] cursor-pointer shrink-0 self-start sm:self-center"
              />

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
                <label className="block text-xs font-semibold text-[#3A2E2B] mb-1.5">
                  題目解析與說明 <span className="text-rose-500">*</span>
                </label>
                <textarea
                  required
                  rows={3}
                  value={formAnswer}
                  onChange={(e) => setFormAnswer(e.target.value)}
                  placeholder="題目說明或背景"
                  className="w-full px-4 py-2.5 text-sm rounded-xl milk-tea-input resize-none"
                />
              </div>

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

              {/* Options — free-length list */}
              <div className="border-t border-[#E8DFD3] pt-4 space-y-2.5">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-1.5 text-xs font-bold text-[#8C6D53]">
                    <Sparkles className="w-4 h-4" />
                    <span>題目選項 ({formOptions.filter((o) => o.trim()).length} 個)</span>
                  </div>
                  <button
                    type="button"
                    onClick={addOption}
                    className="px-2.5 py-1 rounded-lg text-xs font-semibold text-[#8C6D53] hover:bg-[#F4ECE1] transition-colors inline-flex items-center gap-1 cursor-pointer"
                  >
                    <Plus className="w-3.5 h-3.5" />
                    新增選項
                  </button>
                </div>

                <div className="space-y-2">
                  {formOptions.map((opt, idx) => (
                    <div key={idx} className="flex items-center gap-2">
                      <span className="w-5 shrink-0 text-xs font-bold text-[#A68B6D] text-center">
                        {String.fromCharCode(65 + idx)}
                      </span>
                      <input
                        type="text"
                        value={opt}
                        onChange={(e) => updateOption(idx, e.target.value)}
                        placeholder={`選項 ${String.fromCharCode(65 + idx)}`}
                        className="flex-1 min-w-0 px-3.5 py-2 text-sm rounded-xl milk-tea-input"
                      />
                      <button
                        type="button"
                        onClick={() => removeOption(idx)}
                        disabled={formOptions.length <= 2}
                        aria-label={`移除選項 ${String.fromCharCode(65 + idx)}`}
                        className="shrink-0 p-2 rounded-xl text-[#7A6C65] hover:text-rose-600 hover:bg-rose-50 transition-colors disabled:opacity-30 disabled:cursor-not-allowed cursor-pointer"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  ))}
                </div>

                <p className="text-[11px] text-[#7A6C65]">
                  留白代表不設定選項；若要設定，至少需要兩個。
                </p>
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

      {/* Bulk Delete Confirmation */}
      {isBulkDeleteOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/40 backdrop-blur-xs animate-fade-in">
          <div className="bg-[#FCFAF6] rounded-3xl border border-[#E8DFD3] p-6 max-w-sm w-full space-y-4">
            <h3 className="text-base font-bold text-[#3A2E2B]">確認刪除所選題目？</h3>
            <p className="text-xs text-[#7A6C65] leading-relaxed">
              將永久刪除 {selectedCount} 題，所有裝置都會同步移除，此動作無法復原。
            </p>
            <div className="flex items-center justify-end gap-3 pt-2">
              <button
                onClick={() => setIsBulkDeleteOpen(false)}
                disabled={isBulkDeleting}
                className="px-4 py-2 rounded-xl text-xs font-semibold text-[#7A6C65] hover:bg-[#F2EBE1] disabled:opacity-50"
              >
                取消
              </button>
              <button
                onClick={handleBulkDelete}
                disabled={isBulkDeleting}
                className="px-4 py-2 rounded-xl text-xs font-semibold bg-rose-600 text-white hover:bg-rose-700 shadow-xs disabled:opacity-50"
              >
                {isBulkDeleting ? '刪除中…' : `刪除 ${selectedCount} 題`}
              </button>
            </div>
          </div>
        </div>
      )}

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
