import React, { useState } from 'react';
import { Tags, Plus, Edit2, Trash2, Check, X, ShieldAlert } from 'lucide-react';
import { Category, FAQItem } from '../types';

interface AdminCategoryViewProps {
  categories: Category[];
  faqs: FAQItem[];
  onAddCategory: (category: Omit<Category, 'id'>) => void;
  onUpdateCategory: (category: Category) => void;
  onDeleteCategory: (id: string) => void;
  showToast: (title: string, description?: string, type?: 'success' | 'info' | 'error') => void;
}

export const AdminCategoryView: React.FC<AdminCategoryViewProps> = ({
  categories,
  faqs,
  onAddCategory,
  onUpdateCategory,
  onDeleteCategory,
  showToast,
}) => {
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [editingCategory, setEditingCategory] = useState<Category | null>(null);

  const [name, setName] = useState('');
  const [slug, setSlug] = useState('');
  const [colorClass, setColorClass] = useState<Category['colorClass']>('badge-milktea');
  const [description, setDescription] = useState('');

  const colorOptions: { label: string; value: Category['colorClass']; previewClass: string }[] = [
    { label: '奶茶暖棕', value: 'badge-milktea', previewClass: 'bg-[#F3E8DC] text-[#7A5230]' },
    { label: '抹茶靜綠', value: 'badge-matcha', previewClass: 'bg-[#EBF3EA] text-[#3A6337]' },
    { label: '玫瑰茶紅', value: 'badge-rosetea', previewClass: 'bg-[#F9EAE8] text-[#8C3B3B]' },
    { label: '芋香紫羅', value: 'badge-taro', previewClass: 'bg-[#EFEBF5] text-[#5B4378]' },
    { label: '伯爵藍灰', value: 'badge-earlgrey', previewClass: 'bg-[#E9EEF5] text-[#3A5678]' },
  ];

  const handleOpenAddModal = () => {
    setEditingCategory(null);
    setName('');
    setSlug('');
    setColorClass('badge-milktea');
    setDescription('');
    setIsModalOpen(true);
  };

  const handleOpenEditModal = (cat: Category) => {
    setEditingCategory(cat);
    setName(cat.name);
    setSlug(cat.slug);
    setColorClass(cat.colorClass);
    setDescription(cat.description || '');
    setIsModalOpen(true);
  };

  const handleSave = (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim()) return;

    if (editingCategory) {
      onUpdateCategory({
        ...editingCategory,
        name: name.trim(),
        slug: slug.trim() || name.toLowerCase(),
        colorClass,
        description: description.trim(),
      });
      showToast('已更新問題分類', '', 'success');
    } else {
      onAddCategory({
        name: name.trim(),
        slug: slug.trim() || name.toLowerCase(),
        colorClass,
        description: description.trim(),
      });
      showToast('已新增問題分類', '', 'success');
    }

    setIsModalOpen(false);
  };

  return (
    <div className="space-y-6 pb-12">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 p-6 rounded-3xl bg-white border border-[#E8DFD3] shadow-xs">
        <div>
          <h1 className="text-xl sm:text-2xl font-bold text-[#3A2E2B] flex items-center gap-2">
            <Tags className="w-6 h-6 text-[#8C6D53]" />
            <span>常見問題分類管理</span>
          </h1>
          <p className="text-xs sm:text-sm text-[#7A6C65] mt-1">
            新增或自定義常見問題的主題分類與色彩標籤。
          </p>
        </div>

        <button
          onClick={handleOpenAddModal}
          className="milk-tea-btn-primary px-4 py-2.5 rounded-xl text-xs sm:text-sm font-semibold inline-flex items-center gap-1.5 self-start sm:self-auto shadow-sm"
        >
          <Plus className="w-4 h-4" />
          <span>新增主題分類</span>
        </button>
      </div>

      {/* Category Cards Grid */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
        {categories.map((cat) => {
          const itemCount = faqs.filter((f) => f.category === cat.name).length;

          return (
            <div key={cat.id} className="milk-tea-card rounded-2xl p-5 flex flex-col justify-between space-y-4">
              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <span className={`text-xs font-bold px-3 py-1 rounded-full ${cat.colorClass}`}>
                    {cat.name}
                  </span>
                  <span className="text-xs text-[#7A6C65] font-medium">
                    包含 {itemCount} 則 Q&A
                  </span>
                </div>
                <p className="text-xs text-[#7A6C65] leading-relaxed">
                  {cat.description || '暫無分類描述說明'}
                </p>
              </div>

              <div className="flex items-center justify-end gap-2 pt-2 border-t border-[#E8DFD3]">
                <button
                  onClick={() => handleOpenEditModal(cat)}
                  className="p-2 rounded-xl text-[#8C6D53] hover:bg-[#F4ECE1] transition-colors"
                  title="編輯"
                >
                  <Edit2 className="w-4 h-4" />
                </button>
                <button
                  onClick={() => {
                    if (itemCount > 0) {
                      showToast('無法刪除非空分類', `該分類下仍有 ${itemCount} 則常見問題，請先移除或更換分類！`, 'error');
                      return;
                    }
                    if (confirm(`確定要刪除「${cat.name}」分類嗎？`)) {
                      onDeleteCategory(cat.id);
                      showToast('已刪除分類', '', 'info');
                    }
                  }}
                  className="p-2 rounded-xl text-rose-600 hover:bg-rose-50 transition-colors"
                  title="刪除"
                >
                  <Trash2 className="w-4 h-4" />
                </button>
              </div>
            </div>
          );
        })}
      </div>

      {/* Add / Edit Category Modal */}
      {isModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/40 backdrop-blur-xs animate-fade-in">
          <div className="bg-[#FCFAF6] rounded-3xl border border-[#E8DFD3] shadow-2xl max-w-md w-full overflow-hidden">
            <div className="px-6 py-5 bg-[#F5EFE6] border-b border-[#E8DFD3] flex items-center justify-between">
              <h3 className="text-base font-bold text-[#3A2E2B]">
                {editingCategory ? '編輯主題分類' : '新增主題分類'}
              </h3>
              <button
                onClick={() => setIsModalOpen(false)}
                className="p-1.5 rounded-xl text-[#7A6C65] hover:bg-[#EADDCB]"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <form onSubmit={handleSave} className="p-6 space-y-4">
              <div>
                <label className="block text-xs font-semibold text-[#3A2E2B] mb-1.5">
                  分類名稱 <span className="text-rose-500">*</span>
                </label>
                <input
                  type="text"
                  required
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="例如：發票與稅務、會員點數"
                  className="w-full px-4 py-2.5 text-sm rounded-xl milk-tea-input"
                />
              </div>

              <div>
                <label className="block text-xs font-semibold text-[#3A2E2B] mb-1.5">
                  標籤色彩樣式
                </label>
                <div className="grid grid-cols-2 gap-2">
                  {colorOptions.map((opt) => (
                    <button
                      type="button"
                      key={opt.value}
                      onClick={() => setColorClass(opt.value)}
                      className={`p-2.5 rounded-xl text-xs font-bold border text-left flex items-center justify-between ${
                        opt.previewClass
                      } ${colorClass === opt.value ? 'ring-2 ring-[#8C6D53]' : 'border-transparent'}`}
                    >
                      <span>{opt.label}</span>
                      {colorClass === opt.value && <Check className="w-4 h-4" />}
                    </button>
                  ))}
                </div>
              </div>

              <div>
                <label className="block text-xs font-semibold text-[#3A2E2B] mb-1.5">
                  分類簡介描述
                </label>
                <textarea
                  rows={3}
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  placeholder="簡述此分類涵蓋的答疑範圍..."
                  className="w-full px-4 py-2.5 text-sm rounded-xl milk-tea-input resize-none"
                />
              </div>

              <div className="pt-2 flex items-center justify-end gap-3 border-t border-[#E8DFD3]">
                <button
                  type="button"
                  onClick={() => setIsModalOpen(false)}
                  className="px-4 py-2 rounded-xl text-sm font-medium text-[#7A6C65] hover:bg-[#F2EBE1]"
                >
                  取消
                </button>
                <button
                  type="submit"
                  className="milk-tea-btn-primary px-5 py-2.5 rounded-xl text-sm font-semibold inline-flex items-center gap-1.5 shadow-sm"
                >
                  <Check className="w-4 h-4" />
                  <span>儲存分類</span>
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};
