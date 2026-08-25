import React, { useMemo, useState } from 'react';
import { Upload, X, Sparkles, Check, Cloud, Loader2 } from 'lucide-react';
import {
  DEFAULT_DRIVE_LINK,
  fetchAllDriveFolderFiles,
  fetchGoogleDriveFileTextById,
  resolveDriveInput,
  type FolderFetchProgress,
} from '../../lib/googleDrive';
import { UNFILED_CATEGORY } from '../../types';

interface AdminJsonImportModalProps {
  isOpen: boolean;
  onClose: () => void;
  onImportData: (jsonStr: string) => void | Promise<void>;
  showToast: (title: string, description?: string, type?: 'success' | 'error' | 'info' | 'warning') => void;
}

/** Loosely typed — this is whatever a Drive JSON file happens to contain, sight unseen. */
interface DriveQuestion {
  question?: string;
  category?: string;
  [key: string]: unknown;
}

const ALL_CATEGORIES = '全部';

const categoryOf = (item: DriveQuestion): string =>
  (typeof item.category === 'string' && item.category.trim()) || UNFILED_CATEGORY;

/*
 * Fixed row height, so the picker can virtualize: a cloud folder can hold
 * thousands of questions, and mounting one <label> per question froze the tab
 * long before you got to scroll through them. Only rows near the visible
 * window are ever in the DOM; a spacer div holds the scrollbar at the right
 * size for everything else. Fixed height means one line of text — the
 * question is truncated rather than wrapped, which is what makes the math work.
 */
const ROW_HEIGHT = 34;
const LIST_HEIGHT = 224;
const OVERSCAN = 6;

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
  const [isFetchingDrive, setIsFetchingDrive] = useState(false);
  const [driveProgress, setDriveProgress] = useState<FolderFetchProgress | null>(null);

  /** Fetched cloud questions awaiting a pick, or null before any fetch / after import. */
  const [driveItems, setDriveItems] = useState<DriveQuestion[] | null>(null);
  /**
   * Indexes into driveItems — deliberately independent of the category filter,
   * so switching category only changes what is visible, never what is checked.
   */
  const [selectedIndexes, setSelectedIndexes] = useState<Set<number>>(new Set());
  const [categoryFilter, setCategoryFilter] = useState(ALL_CATEGORIES);
  const [listScrollTop, setListScrollTop] = useState(0);

  /** One pass over every item rather than re-filtering the whole array per category in the dropdown. */
  const categoryCounts = useMemo(() => {
    const counts = new Map<string, number>();
    (driveItems || []).forEach((item) => {
      const c = categoryOf(item);
      counts.set(c, (counts.get(c) || 0) + 1);
    });
    return counts;
  }, [driveItems]);

  const categories = useMemo(() => Array.from(categoryCounts.keys()), [categoryCounts]);

  const visibleIndexes = useMemo(() => {
    if (!driveItems) return [];
    return driveItems
      .map((item, idx) => (categoryFilter === ALL_CATEGORIES || categoryOf(item) === categoryFilter ? idx : -1))
      .filter((idx) => idx !== -1);
  }, [driveItems, categoryFilter]);

  const firstRenderedRow = Math.max(0, Math.floor(listScrollTop / ROW_HEIGHT) - OVERSCAN);
  const lastRenderedRow = Math.min(
    visibleIndexes.length,
    Math.ceil((listScrollTop + LIST_HEIGHT) / ROW_HEIGHT) + OVERSCAN
  );
  const renderedRows = visibleIndexes.slice(firstRenderedRow, lastRenderedRow);

  if (!isOpen) return null;

  const loadDriveItems = (parsed: unknown[]) => {
    setDriveItems(parsed as DriveQuestion[]);
    setSelectedIndexes(new Set());
    setCategoryFilter(ALL_CATEGORIES);
    setListScrollTop(0);
  };

  const handleFetchFromDrive = async () => {
    if (!DEFAULT_DRIVE_LINK) {
      showToast('尚未設定雲端連結', '請先設定 VITE_GOOGLE_API_URL', 'warning');
      return;
    }
    const target = resolveDriveInput(DEFAULT_DRIVE_LINK);
    if (!target) {
      showToast('看不出這是 Google Drive 的連結或 ID', '', 'error');
      return;
    }

    setIsFetchingDrive(true);
    setDriveProgress(null);
    try {
      if (target.type === 'folder') {
        const { items, loadedFiles, failedFiles, quotaExceeded } = await fetchAllDriveFolderFiles(
          target.id,
          setDriveProgress
        );
        if (quotaExceeded) {
          showToast(
            'Google Drive 用量已達上限',
            loadedFiles.length > 0
              ? `讀到 ${loadedFiles.length} 個檔案後開始被限流，先中止其餘 ${failedFiles.length} 個，請稍後再試一次補齊`
              : '請求被連續拒絕，這批用量大概是被之前的測試用完了，過幾分鐘再試一次',
            'warning'
          );
          if (loadedFiles.length === 0) return;
        } else if (loadedFiles.length === 0) {
          showToast(
            '沒有讀到任何題目',
            failedFiles.length > 0 ? `資料夾裡的 JSON 檔案都讀取失敗：${failedFiles.join('、')}` : '這個資料夾裡沒有 JSON 檔案',
            'warning'
          );
          return;
        } else {
          showToast(
            '已合併資料夾內容',
            `讀取 ${loadedFiles.length} 個檔案，共 ${items.length} 筆資料${failedFiles.length > 0 ? `，${failedFiles.length} 個檔案讀取失敗：${failedFiles.join('、')}` : ''}，請在下方勾選要匯入的題目`,
            failedFiles.length > 0 ? 'warning' : 'success'
          );
        }
        loadDriveItems(items);
      } else {
        const text = await fetchGoogleDriveFileTextById(target.id);
        let parsed: unknown;
        try {
          parsed = JSON.parse(text);
        } catch {
          setPastedJsonText(text);
          showToast('已讀取雲端檔案', '內容看起來不是合法的 JSON，請在下方文字框檢查內容', 'warning');
          return;
        }
        if (!Array.isArray(parsed)) {
          setPastedJsonText(text);
          showToast('已讀取雲端檔案', '內容不是題目陣列，請在下方文字框檢查內容', 'warning');
          return;
        }
        loadDriveItems(parsed);
        showToast('已讀取雲端檔案', `共讀到 ${parsed.length} 筆資料，請在下方勾選要匯入的題目`, 'success');
      }
    } catch (err: any) {
      showToast('讀取雲端檔案失敗', err?.message, 'error');
    } finally {
      setIsFetchingDrive(false);
      setDriveProgress(null);
    }
  };

  const toggleIndex = (idx: number) => {
    setSelectedIndexes((prev) => {
      const next = new Set(prev);
      if (next.has(idx)) next.delete(idx);
      else next.add(idx);
      return next;
    });
  };

  const allVisibleSelected = visibleIndexes.length > 0 && visibleIndexes.every((idx) => selectedIndexes.has(idx));

  const toggleSelectAllVisible = () => {
    setSelectedIndexes((prev) => {
      const next = new Set(prev);
      if (allVisibleSelected) visibleIndexes.forEach((idx) => next.delete(idx));
      else visibleIndexes.forEach((idx) => next.add(idx));
      return next;
    });
  };

  const handleImportSelected = async () => {
    if (!driveItems || selectedIndexes.size === 0) return;
    const selectedItems = driveItems.filter((_, idx) => selectedIndexes.has(idx));
    try {
      await onImportData(JSON.stringify(selectedItems));
      onClose();
      setDriveItems(null);
      setSelectedIndexes(new Set());
    } catch (err: any) {
      showToast('匯入失敗', err?.message || '請檢查題目格式是否完整', 'error');
    }
  };

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

          <div className="bg-[#F5EFE6] p-4 rounded-2xl border border-[#E8DFD3] space-y-2">
            <span className="text-xs font-bold text-[#3A2E2B] flex items-center gap-1.5">
              <Cloud className="w-4 h-4 text-[#8C6D53]" />
              從 Google 雲端匯入
            </span>
            <p className="text-[11px] text-[#7A6C65]">
              讀取後台設定的雲端資料夾，自動合併裡面所有 JSON 檔案（需先設定「知道連結的人皆可查看」）
            </p>
            <button
              type="button"
              onClick={handleFetchFromDrive}
              disabled={isFetchingDrive}
              className="px-3 py-2 text-xs rounded-lg bg-[#8C6D53] text-white font-semibold hover:bg-[#785C44] cursor-pointer disabled:opacity-60 disabled:cursor-not-allowed flex items-center gap-1.5 w-fit"
            >
              {isFetchingDrive ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Cloud className="w-3.5 h-3.5" />}
              <span>從雲端讀取</span>
            </button>

            {isFetchingDrive && driveProgress && driveProgress.total > 0 && (
              <div className="space-y-1">
                <div className="h-1.5 rounded-full bg-[#E8DFD3] overflow-hidden">
                  <div
                    className="h-full bg-[#8C6D53] transition-[width] duration-200"
                    style={{ width: `${Math.round((driveProgress.completed / driveProgress.total) * 100)}%` }}
                  />
                </div>
                <p className="text-[11px] text-[#7A6C65]">
                  已處理 {driveProgress.completed} / {driveProgress.total} 個檔案（
                  {Math.round((driveProgress.completed / driveProgress.total) * 100)}%）
                </p>
              </div>
            )}

            {driveItems && (
              <div className="space-y-2 pt-1">
                <select
                  value={categoryFilter}
                  onChange={(e) => {
                    setCategoryFilter(e.target.value);
                    setListScrollTop(0);
                  }}
                  className="w-full px-3 py-2 text-xs rounded-xl milk-tea-input"
                >
                  <option value={ALL_CATEGORIES}>全部分類 ({driveItems.length})</option>
                  {categories.map((c) => (
                    <option key={c} value={c}>
                      {c} ({categoryCounts.get(c)})
                    </option>
                  ))}
                </select>

                <div className="flex flex-wrap items-center justify-between gap-2 px-3 py-2 rounded-xl bg-white border border-[#E8DFD3]">
                  <label className="flex items-center gap-2 text-xs font-semibold text-[#4A3F35] cursor-pointer select-none">
                    <input
                      type="checkbox"
                      checked={allVisibleSelected}
                      onChange={toggleSelectAllVisible}
                      className="w-4 h-4 accent-[#8C6D53] cursor-pointer"
                    />
                    <span>全選目前 {visibleIndexes.length} 題</span>
                  </label>
                  <span className="text-xs text-[#7A6C65]">已選 {selectedIndexes.size} 題</span>
                </div>

                <div
                  className="overflow-y-auto rounded-xl border border-[#E8DFD3] bg-white"
                  style={{ height: LIST_HEIGHT }}
                  onScroll={(e) => setListScrollTop(e.currentTarget.scrollTop)}
                >
                  <div style={{ height: visibleIndexes.length * ROW_HEIGHT, position: 'relative' }}>
                    {renderedRows.map((idx, i) => {
                      const item = driveItems[idx];
                      const rowNumber = firstRenderedRow + i;
                      return (
                        <label
                          key={idx}
                          style={{ position: 'absolute', top: rowNumber * ROW_HEIGHT, height: ROW_HEIGHT }}
                          className="flex items-center gap-2 px-2.5 text-xs cursor-pointer hover:bg-[#F5EFE6] w-full min-w-0"
                        >
                          <input
                            type="checkbox"
                            checked={selectedIndexes.has(idx)}
                            onChange={() => toggleIndex(idx)}
                            className="w-4 h-4 accent-[#8C6D53] cursor-pointer shrink-0"
                          />
                          <span className="truncate min-w-0 flex-1">
                            <span className="text-[10px] font-semibold text-[#8C6D53]">[{categoryOf(item)}] </span>
                            <span className="text-[#3A2E2B]">
                              {typeof item.question === 'string' && item.question ? item.question : '（沒有題目文字）'}
                            </span>
                          </span>
                        </label>
                      );
                    })}
                  </div>
                </div>

                <button
                  type="button"
                  onClick={handleImportSelected}
                  disabled={selectedIndexes.size === 0}
                  className="milk-tea-btn-primary px-4 py-2 rounded-xl text-xs font-semibold flex items-center gap-1.5 cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed w-fit"
                >
                  <Check className="w-3.5 h-3.5" />
                  <span>匯入所選（{selectedIndexes.size}）</span>
                </button>
              </div>
            )}
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
