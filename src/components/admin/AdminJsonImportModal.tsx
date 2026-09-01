import React, { useMemo, useRef, useState } from 'react';
import { Upload, X, Sparkles, Check, Cloud, Loader2, CheckCheck, Eye, EyeOff } from 'lucide-react';
import {
  DEFAULT_DRIVE_LINK,
  fetchDriveFiles,
  fetchGoogleDriveFileTextById,
  IS_MOCK_DRIVE,
  isJsonDriveFile,
  listDriveFolderFiles,
  resolveDriveInput,
  type DriveFileEntry,
  type FolderFetchProgress,
} from '../../lib/googleDrive';
import { UNFILED_CATEGORY } from '../../types';

interface AdminJsonImportModalProps {
  isOpen: boolean;
  onClose: () => void;
  onImportData: (jsonStr: string) => void | Promise<void>;
  /** Trimmed text of every question this pair has already answered, for the "已答過" badge in the cloud picker. */
  answeredQuestionTexts?: Set<string>;
  /** Marks (or un-marks) a cloud question as answered directly by its text, before it is ever imported. */
  onToggleAnsweredText?: (questionText: string, answered: boolean) => void | Promise<void>;
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

const questionTextOf = (item: DriveQuestion): string =>
  typeof item.question === 'string' ? item.question.trim() : '';

/*
 * Fixed row height, so the picker can virtualize: a cloud folder can hold
 * thousands of questions, and mounting one <label> per question froze the tab
 * long before you got to scroll through them. Only rows near the visible
 * window are ever in the DOM; a spacer div holds the scrollbar at the right
 * size for everything else. Fixed height is what makes the math work, so a
 * question wraps up to two lines (`line-clamp-2`) rather than growing freely —
 * every row gets the same height whether its text fills both lines or not.
 */
const ROW_HEIGHT = 46;
const LIST_HEIGHT = 230;
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
  answeredQuestionTexts,
  onToggleAnsweredText,
  showToast,
}) => {
  const [pastedJsonText, setPastedJsonText] = useState('');
  const [isFetchingDrive, setIsFetchingDrive] = useState(false);
  const [driveProgress, setDriveProgress] = useState<FolderFetchProgress | null>(null);

  /** JSON files found in a fetched folder, awaiting a pick of which ones to actually read. */
  const [driveFolderFiles, setDriveFolderFiles] = useState<DriveFileEntry[] | null>(null);
  /** Which of driveFolderFiles to read content from — defaults to all of them. */
  const [selectedFileIds, setSelectedFileIds] = useState<Set<string>>(new Set());

  /** Fetched cloud questions awaiting a pick, or null before any fetch / after import. */
  const [driveItems, setDriveItems] = useState<DriveQuestion[] | null>(null);
  /**
   * Indexes into driveItems — deliberately independent of the category filter,
   * so switching category only changes what is visible, never what is checked.
   */
  const [selectedIndexes, setSelectedIndexes] = useState<Set<number>>(new Set());
  const [categoryFilter, setCategoryFilter] = useState(ALL_CATEGORIES);
  const [listScrollTop, setListScrollTop] = useState(0);
  /**
   * The scrollable list div's own scrollTop lives in the DOM, not in React
   * state — resetting `listScrollTop` alone leaves the element itself still
   * scrolled down. Rows would then render as if scrolled to the top while the
   * browser keeps showing the old (now empty) scroll position, until the user
   * scrolls further and an onScroll event syncs the two back up. This ref lets
   * every place that resets `listScrollTop` reset the real element too.
   */
  const listScrollRef = useRef<HTMLDivElement | null>(null);
  /** Which row's options/answer are currently shown below the list — a fixed-height panel, not row expansion, since that would break the virtualization math. */
  const [previewIndex, setPreviewIndex] = useState<number | null>(null);

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

  const resetListScroll = () => {
    setListScrollTop(0);
    if (listScrollRef.current) listScrollRef.current.scrollTop = 0;
  };

  const loadDriveItems = (parsed: unknown[]) => {
    setDriveItems(parsed as DriveQuestion[]);
    setSelectedIndexes(new Set());
    setCategoryFilter(ALL_CATEGORIES);
    resetListScroll();
    setPreviewIndex(null);
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
        const files = (await listDriveFolderFiles(target.id)).filter(isJsonDriveFile);
        if (files.length === 0) {
          showToast('這個資料夾裡沒有 JSON 檔案', '', 'warning');
          return;
        }
        setDriveFolderFiles(files);
        setSelectedFileIds(new Set(files.map((f) => f.id)));
        setDriveItems(null);
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
        setDriveFolderFiles(null);
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

  const toggleFileId = (id: string) => {
    setSelectedFileIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const allFilesSelected =
    !!driveFolderFiles && driveFolderFiles.length > 0 && driveFolderFiles.every((f) => selectedFileIds.has(f.id));

  const toggleSelectAllFiles = () => {
    if (!driveFolderFiles) return;
    setSelectedFileIds((prev) => {
      if (allFilesSelected) return new Set();
      return new Set(driveFolderFiles.map((f) => f.id));
    });
  };

  const handleLoadSelectedFiles = async () => {
    if (!driveFolderFiles || selectedFileIds.size === 0) return;
    const files = driveFolderFiles.filter((f) => selectedFileIds.has(f.id));

    setIsFetchingDrive(true);
    setDriveProgress(null);
    try {
      const { items, loadedFiles, failedFiles, quotaExceeded } = await fetchDriveFiles(files, setDriveProgress);
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
        showToast('沒有讀到任何題目', failedFiles.length > 0 ? `選取的檔案都讀取失敗：${failedFiles.join('、')}` : '', 'warning');
        return;
      } else {
        showToast(
          '已讀取所選檔案',
          `讀取 ${loadedFiles.length} 個檔案，共 ${items.length} 筆資料${failedFiles.length > 0 ? `，${failedFiles.length} 個檔案讀取失敗：${failedFiles.join('、')}` : ''}，請在下方勾選要匯入的題目`,
          failedFiles.length > 0 ? 'warning' : 'success'
        );
      }
      loadDriveItems(items);
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

  /** Every question across every category, independent of the current filter — for the "全選全部" shortcut below. */
  const allItemsSelected = !!driveItems && driveItems.length > 0 && driveItems.every((_, idx) => selectedIndexes.has(idx));

  const toggleSelectAllItems = () => {
    if (!driveItems) return;
    setSelectedIndexes(allItemsSelected ? new Set() : new Set(driveItems.map((_, idx) => idx)));
  };

  const handleImportSelected = async () => {
    if (!driveItems || selectedIndexes.size === 0) return;
    const selectedItems = driveItems.filter((_, idx) => selectedIndexes.has(idx));
    try {
      await onImportData(JSON.stringify(selectedItems));
      onClose();
      setDriveItems(null);
      setSelectedIndexes(new Set());
      setDriveFolderFiles(null);
      setSelectedFileIds(new Set());
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
              讀取雲端資料夾或單一檔案；資料夾會先列出裡面的 JSON 檔案，可自己勾選要讀哪幾個
            </p>
            {IS_MOCK_DRIVE && (
              <p className="text-[11px] font-semibold text-amber-700 bg-amber-50 border border-amber-200 rounded-lg px-2 py-1">
                ⚠️ 測試模式：目前讀的是本機範本資料，不會連線 Google
              </p>
            )}
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

            {driveFolderFiles && !driveItems && (
              <div className="space-y-2 pt-1">
                <p className="text-[11px] text-[#7A6C65]">
                  資料夾裡有 {driveFolderFiles.length} 個 JSON 檔案，勾選要讀取的檔案：
                </p>
                <div className="flex items-center justify-between gap-2 px-3 py-2 rounded-xl bg-white border border-[#E8DFD3]">
                  <label className="flex items-center gap-2 text-xs font-semibold text-[#4A3F35] cursor-pointer select-none">
                    <input
                      type="checkbox"
                      checked={allFilesSelected}
                      onChange={toggleSelectAllFiles}
                      className="w-4 h-4 accent-[#8C6D53] cursor-pointer"
                    />
                    <span>全選</span>
                  </label>
                  <span className="text-xs text-[#7A6C65]">已選 {selectedFileIds.size} 個檔案</span>
                </div>

                <div className="max-h-48 overflow-y-auto rounded-xl border border-[#E8DFD3] bg-white divide-y divide-[#F0E9DE]">
                  {driveFolderFiles.map((file) => (
                    <label
                      key={file.id}
                      className="flex items-start gap-2 px-3 py-2 text-xs cursor-pointer hover:bg-[#F5EFE6]"
                    >
                      <input
                        type="checkbox"
                        checked={selectedFileIds.has(file.id)}
                        onChange={() => toggleFileId(file.id)}
                        className="w-4 h-4 mt-0.5 accent-[#8C6D53] cursor-pointer shrink-0"
                      />
                      <span className="min-w-0 flex-1 break-all text-[#3A2E2B]">{file.name}</span>
                    </label>
                  ))}
                </div>

                <button
                  type="button"
                  onClick={handleLoadSelectedFiles}
                  disabled={isFetchingDrive || selectedFileIds.size === 0}
                  className="milk-tea-btn-primary px-4 py-2 rounded-xl text-xs font-semibold flex items-center gap-1.5 cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed w-fit"
                >
                  {isFetchingDrive ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Check className="w-3.5 h-3.5" />}
                  <span>讀取所選檔案（{selectedFileIds.size}）</span>
                </button>
              </div>
            )}

            {driveItems && (
              <div className="space-y-2 pt-1">
                {driveFolderFiles && (
                  <button
                    type="button"
                    onClick={() => setDriveItems(null)}
                    className="text-[11px] text-[#8C6D53] font-semibold hover:underline cursor-pointer"
                  >
                    ← 重新選擇檔案
                  </button>
                )}
                <select
                  value={categoryFilter}
                  onChange={(e) => {
                    setCategoryFilter(e.target.value);
                    resetListScroll();
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
                  {categoryFilter !== ALL_CATEGORIES && (
                    <button
                      type="button"
                      onClick={toggleSelectAllItems}
                      className="text-xs font-semibold text-[#8C6D53] hover:underline cursor-pointer"
                    >
                      {allItemsSelected ? '取消全選（全部分類）' : `全選全部 ${driveItems.length} 題`}
                    </button>
                  )}
                  <span className="text-xs text-[#7A6C65]">已選 {selectedIndexes.size} 題</span>
                </div>

                <div
                  ref={listScrollRef}
                  className="overflow-y-auto rounded-xl border border-[#E8DFD3] bg-white"
                  style={{ height: LIST_HEIGHT }}
                  onScroll={(e) => setListScrollTop(e.currentTarget.scrollTop)}
                >
                  <div style={{ height: visibleIndexes.length * ROW_HEIGHT, position: 'relative' }}>
                    {renderedRows.map((idx, i) => {
                      const item = driveItems[idx];
                      const rowNumber = firstRenderedRow + i;
                      const questionText = questionTextOf(item);
                      const isAnswered = !!questionText && !!answeredQuestionTexts?.has(questionText);
                      return (
                        <label
                          key={idx}
                          style={{ position: 'absolute', top: rowNumber * ROW_HEIGHT, height: ROW_HEIGHT }}
                          className="flex items-start gap-2 px-2.5 py-1 text-xs cursor-pointer hover:bg-[#F5EFE6] w-full min-w-0"
                        >
                          <input
                            type="checkbox"
                            checked={selectedIndexes.has(idx)}
                            onChange={() => toggleIndex(idx)}
                            className="w-4 h-4 mt-0.5 accent-[#8C6D53] cursor-pointer shrink-0"
                          />
                          <span className="line-clamp-2 min-w-0 flex-1 leading-snug">
                            <span className="text-[10px] font-semibold text-[#8C6D53]">[{categoryOf(item)}] </span>
                            <span className="text-[#3A2E2B]">{questionText || '（沒有題目文字）'}</span>
                          </span>
                          <button
                            type="button"
                            onClick={(e) => {
                              // Inside a <label>, a click bubbling up would also
                              // toggle the checkbox — this button is for looking,
                              // not selecting.
                              e.preventDefault();
                              e.stopPropagation();
                              setPreviewIndex((prev) => (prev === idx ? null : idx));
                            }}
                            title="檢視選項"
                            className={`shrink-0 p-1 rounded-md cursor-pointer ${
                              previewIndex === idx
                                ? 'bg-[#E3D9CB] text-[#5C4B3A]'
                                : 'text-[#8C6D53] hover:bg-[#EADDCB]'
                            }`}
                          >
                            {previewIndex === idx ? <EyeOff className="w-3.5 h-3.5" /> : <Eye className="w-3.5 h-3.5" />}
                          </button>
                          {/* Rightmost: mark/un-mark this cloud question as answered, independent of importing it. */}
                          <button
                            type="button"
                            onClick={(e) => {
                              e.preventDefault();
                              e.stopPropagation();
                              if (!questionText || !onToggleAnsweredText) return;
                              onToggleAnsweredText(questionText, !isAnswered);
                            }}
                            disabled={!questionText || !onToggleAnsweredText}
                            title={isAnswered ? '標記為還沒答過' : '標記為答過了'}
                            className={`shrink-0 text-[10px] font-bold px-2 py-0.5 rounded-md inline-flex items-center gap-0.5 whitespace-nowrap cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed ${
                              isAnswered
                                ? 'bg-[#EFE7DC] text-[#7A6C65] hover:bg-[#E3D9CB]'
                                : 'bg-white border border-[#D0BFAC] text-[#7A6C65] hover:bg-[#F5EFE6]'
                            }`}
                          >
                            <CheckCheck className="w-3 h-3" /> {isAnswered ? '答過了' : '標記答過'}
                          </button>
                        </label>
                      );
                    })}
                  </div>
                </div>

                {previewIndex !== null && driveItems[previewIndex] && (
                  <div className="rounded-xl border border-[#E8DFD3] bg-white p-3 text-xs space-y-1.5">
                    <div className="flex items-start justify-between gap-2">
                      <p className="font-semibold text-[#3A2E2B]">
                        <span className="text-[10px] font-semibold text-[#8C6D53]">
                          [{categoryOf(driveItems[previewIndex])}]{' '}
                        </span>
                        {questionTextOf(driveItems[previewIndex]) || '（沒有題目文字）'}
                      </p>
                      <button
                        type="button"
                        onClick={() => setPreviewIndex(null)}
                        className="shrink-0 p-1 rounded-md text-[#7A6C65] hover:bg-[#F5EFE6] cursor-pointer"
                      >
                        <X className="w-3.5 h-3.5" />
                      </button>
                    </div>
                    {Array.isArray(driveItems[previewIndex].options) &&
                      (driveItems[previewIndex].options as unknown[]).length > 0 && (
                        <ul className="list-disc list-inside text-[#4A3F35] space-y-0.5">
                          {(driveItems[previewIndex].options as unknown[]).map((opt, i) => (
                            <li key={i}>{String(opt)}</li>
                          ))}
                        </ul>
                      )}
                    {typeof driveItems[previewIndex].answer === 'string' &&
                      (driveItems[previewIndex].answer as string).trim() && (
                        <p className="text-[#7A6C65] pt-1.5 border-t border-[#E8DFD3]">
                          {driveItems[previewIndex].answer as string}
                        </p>
                      )}
                  </div>
                )}

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
