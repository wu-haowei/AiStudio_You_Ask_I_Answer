import React, { useState } from 'react';
import { Upload, X, Sparkles, Check } from 'lucide-react';

interface AdminJsonImportModalProps {
  isOpen: boolean;
  onClose: () => void;
  onImportData: (jsonStr: string) => void | Promise<void>;
  showToast: (title: string, description?: string, type?: 'success' | 'error' | 'info' | 'warning') => void;
}

/*
 * Deliberately generic. Categories are whatever the imported questions say they
 * are, so naming a real one here would imply the list is fixed — it is not, and
 * typing a new name into that field is all it takes to create one.
 */
const sampleJsonTemplate = JSON.stringify(
  [
    {
      question: '題目寫在這裡？',
      answer: '這句只有後台清單看得到，寫出題用意就好。',
      category: '分類名稱自己取',
      options: ['選項一', '選項二', '選項三'],
    },
  ],
  null,
  2
);

export const AdminJsonImportModal: React.FC<AdminJsonImportModalProps> = ({
  isOpen,
  onClose,
  onImportData,
  showToast,
}) => {
  const [pastedJsonText, setPastedJsonText] = useState('');

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/40 backdrop-blur-xs animate-fade-in">
      <div className="bg-[#FCFAF6] rounded-3xl border border-[#E8DFD3] shadow-2xl max-w-2xl w-full max-h-[90vh] flex flex-col overflow-hidden">
        <div className="px-6 py-5 bg-[#F5EFE6] border-b border-[#E8DFD3] flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Upload className="w-5 h-5 text-[#8C6D53]" />
            <h3 className="text-base font-bold text-[#3A2E2B]">匯入題目</h3>
          </div>
          <button
            onClick={onClose}
            className="p-1.5 rounded-xl text-[#7A6C65] hover:bg-[#EADDCB] transition-colors cursor-pointer"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="p-6 space-y-5 overflow-y-auto flex-1">
          <div className="bg-[#F5EFE6] p-4 rounded-2xl border border-[#E8DFD3] space-y-2">
            <div className="flex items-center justify-between">
              <span className="text-xs font-bold text-[#3A2E2B] flex items-center gap-1.5">
                <Sparkles className="w-4 h-4 text-[#8C6D53]" />
                JSON 範本（options 數量不限）
              </span>
              <div className="flex items-center gap-2">
                <button
                  onClick={() => {
                    navigator.clipboard.writeText(sampleJsonTemplate);
                    showToast('已複製範本', '', 'success');
                  }}
                  className="px-2.5 py-1 text-xs rounded-lg bg-white border border-[#D0BFAC] text-[#4A3F35] font-semibold hover:bg-[#FAF7F2] cursor-pointer"
                >
                  複製範本
                </button>
                <button
                  onClick={() => {
                    const blob = new Blob([sampleJsonTemplate], { type: 'application/json' });
                    const url = URL.createObjectURL(blob);
                    const a = document.createElement('a');
                    a.href = url;
                    a.download = 'qa_template.json';
                    a.click();
                    URL.revokeObjectURL(url);
                    showToast('已下載範本檔', '', 'info');
                  }}
                  className="px-2.5 py-1 text-xs rounded-lg bg-[#8C6D53] text-white font-semibold hover:bg-[#785C44] cursor-pointer"
                >
                  下載範本
                </button>
              </div>
            </div>

            <pre className="text-[11px] font-mono bg-[#2C2421] text-[#EADDCB] p-3 rounded-xl overflow-x-auto max-h-40 leading-relaxed">
              {sampleJsonTemplate}
            </pre>
          </div>

          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <label className="block text-xs font-bold text-[#3A2E2B]">貼上 JSON 內容</label>
              <label className="px-2.5 py-1 text-xs rounded-lg bg-white border border-[#D0BFAC] text-[#4A3F35] font-semibold hover:bg-[#FAF7F2] cursor-pointer">
                選擇檔案
                <input
                  type="file"
                  accept=".json"
                  className="hidden"
                  onChange={(e) => {
                    const file = e.target.files?.[0];
                    if (!file) return;
                    const reader = new FileReader();
                    reader.onload = (event) => setPastedJsonText((event.target?.result as string) || '');
                    reader.onerror = () => showToast('讀取檔案失敗', undefined, 'error');
                    reader.readAsText(file);
                  }}
                />
              </label>
            </div>
            <textarea
              rows={6}
              value={pastedJsonText}
              onChange={(e) => setPastedJsonText(e.target.value)}
              placeholder="貼上 JSON 陣列內容..."
              className="w-full px-4 py-3 text-xs font-mono rounded-xl milk-tea-input resize-none"
            />
          </div>

          <div className="pt-3 flex items-center justify-end gap-3 border-t border-[#E8DFD3]">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2 rounded-xl text-xs font-semibold text-[#7A6C65] hover:bg-[#F2EBE1] cursor-pointer"
            >
              取消
            </button>
            <button
              type="button"
              onClick={async () => {
                if (!pastedJsonText.trim()) {
                  showToast('請先貼上 JSON 內容', '', 'warning');
                  return;
                }
                try {
                  await onImportData(pastedJsonText.trim());
                  onClose();
                  setPastedJsonText('');
                } catch (err: any) {
                  showToast('匯入失敗', err?.message || '請檢查 JSON 格式是否完整', 'error');
                }
              }}
              className="milk-tea-btn-primary px-5 py-2.5 rounded-xl text-xs font-semibold flex items-center gap-1.5 cursor-pointer"
            >
              <Check className="w-4 h-4" />
              <span>匯入</span>
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
