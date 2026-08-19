import React, { useMemo, useState } from 'react';
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
  History,
  CheckCheck,
  DatabaseBackup,
  ArchiveRestore,
  AlertTriangle,
  X,
  Check,
} from 'lucide-react';
import { Category, FAQItem } from '../types';
import { db } from '../lib/firebase';
import {
  backupFileName,
  backupMatchesRoom,
  createRoomBackup,
  describeBackup,
  parseBackupFile,
  restoreRoomBackup,
  wipeRoom,
  type BackupFile,
} from '../lib/backup';
import { clearAllStorageAndSession, CURRENT_APP_VERSION } from '../utils/storage';
import { AdminJsonImportModal } from './admin/AdminJsonImportModal';

interface AdminManageViewProps {
  faqs: FAQItem[];
  categories: Category[];
  onAddFAQ: (faq: Omit<FAQItem, 'id' | 'updatedAt'>) => void;
  onUpdateFAQ: (faq: FAQItem) => void;
  onDeleteFAQ: (id: string) => void;
  onDeleteFAQs: (ids: string[]) => void | Promise<void>;
  /** Writes the built-in questions into this pair's library. */
  onImportDefaults: () => void | Promise<void>;
  /** Copies the old shared MAIN-ROOM content into this pair's room. */
  onMigrateLegacy: () => void | Promise<void>;
  onImportData: (jsonStr: string) => void | Promise<void>;
  /** True while this pair has no library of its own and is playing the built-in set. */
  isUsingDefaults?: boolean;
  partnerName?: string;
  /** Backup and restore are scoped to this one conversation. */
  roomId: string;
  /** Questions this pair has already answered, offered for clean-up. */
  answeredFaqs?: FAQItem[];
  onDeleteAnswered?: () => void | Promise<void>;
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
  onImportDefaults,
  onMigrateLegacy,
  onImportData,
  isUsingDefaults = false,
  partnerName,
  roomId,
  answeredFaqs = [],
  onDeleteAnswered,
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

  // Whole-database backup
  const [isBackingUp, setIsBackingUp] = useState(false);

  /** Answered ids, for dimming rows the pair has already played. */
  const answeredIds = useMemo(
    () => new Set(answeredFaqs.map((f) => f.id)),
    [answeredFaqs]
  );

  // Deleting answered questions is confirmed first — it cannot be undone
  const [isConfirmingAnswered, setIsConfirmingAnswered] = useState(false);
  const [isDeletingAnswered, setIsDeletingAnswered] = useState(false);

  const handleDeleteAnswered = async () => {
    if (!onDeleteAnswered || isDeletingAnswered) return;
    setIsDeletingAnswered(true);
    try {
      await onDeleteAnswered();
      setIsConfirmingAnswered(false);
    } catch (err: any) {
      console.error('Delete answered failed:', err);
      showToast('刪除失敗', err?.message || '請稍後再試', 'error');
    } finally {
      setIsDeletingAnswered(false);
    }
  };

  // Restore: a file is staged first so it can be confirmed before anything runs
  const [pendingRestore, setPendingRestore] = useState<BackupFile | null>(null);
  const [restoreStatus, setRestoreStatus] = useState('');
  const [isRestoring, setIsRestoring] = useState(false);

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

  /**
   * Downloads a JSON snapshot of this one conversation — its state, chat
   * history, round log and question library. Firestore's managed export needs
   * a paid plan, so the file is assembled client-side.
   */
  const handleFullBackup = async () => {
    if (isBackingUp) return;
    setIsBackingUp(true);

    try {
      const backup = await createRoomBackup(db, roomId);
      const blob = new Blob([JSON.stringify(backup, null, 2)], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = backupFileName(partnerName);
      link.click();
      URL.revokeObjectURL(url);

      showToast('備份已下載', `共 ${backup.documentCount} 筆文件`, 'success');
    } catch (err: any) {
      console.error('Backup failed:', err);
      showToast('備份失敗', err?.message || '請稍後再試', 'error');
    } finally {
      setIsBackingUp(false);
    }
  };

  /** Reads and validates a chosen file, then opens the confirmation dialog. */
  const handleRestoreFileChosen = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = ''; // allow picking the same file again after cancelling
    if (!file) return;

    try {
      const backup = parseBackupFile(await file.text());

      /*
       * Refuse a file from a different pair before anything is staged. The
       * check is on the room id rather than the names, so a renamed file — or
       * a whole-database backup from an older version — is judged by what is
       * actually inside it.
       */
      if (!backupMatchesRoom(backup, roomId)) {
        showToast(
          '這份備份不屬於這個對話',
          `檔案裡是【${describeBackup(backup)}】的資料，請切換到那組對話再還原`,
          'error'
        );
        return;
      }

      setPendingRestore(backup);
    } catch (err: any) {
      showToast('無法讀取備份檔', err?.message || '檔案格式不正確', 'error');
    }
  };

  /** Empties every collection, then writes the backup back. */
  const handleConfirmRestore = async () => {
    if (!pendingRestore || isRestoring) return;

    setIsRestoring(true);
    try {
      setRestoreStatus('清空這組對話…');
      const removed = await wipeRoom(db, roomId, (count) =>
        setRestoreStatus(`清空這組對話… 已刪除 ${count} 筆`)
      );

      setRestoreStatus('寫回備份資料…');
      const report = await restoreRoomBackup(db, roomId, pendingRestore);

      setPendingRestore(null);
      showToast(
        '還原完成',
        `刪除 ${removed} 筆，寫入 ${report.written} 筆` +
          (report.failed > 0 ? `，失敗 ${report.failed} 筆` : ''),
        report.failed > 0 ? 'warning' : 'success'
      );
    } catch (err: any) {
      console.error('Restore failed:', err);
      showToast('還原失敗', err?.message || '請稍後再試', 'error');
    } finally {
      setIsRestoring(false);
      setRestoreStatus('');
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
            {isUsingDefaults
              ? '目前使用內建預設題庫，新增或匯入後就會變成你們專屬的題庫。'
              : `這是你與${partnerName || '對方'}專屬的題庫，不會影響其他對話。`}
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

          {onDeleteAnswered && (
            <button
              onClick={() => setIsConfirmingAnswered(true)}
              disabled={answeredFaqs.length === 0}
              title={
                answeredFaqs.length === 0
                  ? '這組還沒有答過的題目'
                  : '刪除這組已經答過的題目'
              }
              className="px-3.5 py-2 rounded-xl text-xs sm:text-sm font-semibold bg-white text-[#7A6C65] border border-[#D0BFAC] hover:text-rose-700 hover:border-rose-300 hover:bg-rose-50 disabled:opacity-40 disabled:hover:text-[#7A6C65] disabled:hover:border-[#D0BFAC] disabled:hover:bg-white transition-all inline-flex items-center gap-1.5 cursor-pointer"
            >
              <CheckCheck className="w-4 h-4" />
              <span>刪除答過的 ({answeredFaqs.length})</span>
            </button>
          )}

          {/* Backup Tools */}
          <div className="flex items-center gap-1 border-l border-[#E8DFD3] pl-2">
            <button
              onClick={onExportData}
              title="匯出題庫 (只含題目與分類)"
              className="p-2 rounded-xl text-[#7A6C65] hover:text-[#3A2E2B] hover:bg-[#F4ECE1] transition-colors"
            >
              <Download className="w-4 h-4" />
            </button>
            <button
              onClick={handleFullBackup}
              disabled={isBackingUp}
              title="下載這組對話的備份 (含對話紀錄與出題歷史)"
              className="p-2 rounded-xl text-[#7A6C65] hover:text-[#3A2E2B] hover:bg-[#F4ECE1] transition-colors disabled:opacity-50"
            >
              <DatabaseBackup className={`w-4 h-4 ${isBackingUp ? 'animate-pulse' : ''}`} />
            </button>
            <label
              title="從備份還原 (只清空並還原這組對話)"
              className="p-2 rounded-xl text-[#7A6C65] hover:text-rose-600 hover:bg-rose-50 cursor-pointer transition-colors"
            >
              <ArchiveRestore className="w-4 h-4" />
              <input
                type="file"
                accept=".json,application/json"
                onChange={handleRestoreFileChosen}
                className="hidden"
              />
            </label>
            <button
              onClick={() => {
                if (confirm('要把內建預設題目匯入這組的題庫嗎？重複的題目會自動略過。')) {
                  onImportDefaults();
                }
              }}
              title="匯入內建預設題目"
              className="p-2 rounded-xl text-[#7A6C65] hover:text-[#3A2E2B] hover:bg-[#F4ECE1] transition-colors"
            >
              <RotateCcw className="w-4 h-4" />
            </button>
            <button
              onClick={() => {
                if (
                  confirm(
                    '要把舊版共用房間 (MAIN-ROOM) 的對話與題目搬到這組對話嗎？舊資料會保留不刪除。'
                  )
                ) {
                  onMigrateLegacy();
                }
              }}
              title="搬移舊版共用房間的資料"
              className="p-2 rounded-xl text-[#7A6C65] hover:text-[#3A2E2B] hover:bg-[#F4ECE1] transition-colors"
            >
              <History className="w-4 h-4" />
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
          filteredFaqs.map((faq) => {
            const isAnswered = answeredIds.has(faq.id);
            return (
            <div
              key={faq.id}
              className={`milk-tea-card rounded-2xl p-5 flex flex-col sm:flex-row sm:items-center justify-between gap-4 ${
                faq.isHidden ? 'opacity-60 bg-[#F5F2EB]' : ''
              } ${
                /* Answered questions stay editable — just quieter, so the
                   unplayed ones are what the eye lands on first. */
                isAnswered && !faq.isHidden ? 'opacity-70 bg-[#F7F4EE]' : ''
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
                  {isAnswered && (
                    <span className="text-[10px] font-bold text-[#7A6C65] bg-[#EFE7DC] px-2 py-0.5 rounded-md inline-flex items-center gap-0.5">
                      <CheckCheck className="w-3 h-3" /> 答過了
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
            );
          })
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

      {/* Answered clean-up confirmation */}
      {isConfirmingAnswered && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/40 backdrop-blur-xs animate-fade-in">
          <div className="bg-[#FCFAF6] rounded-3xl border border-[#E8DFD3] p-6 max-w-md w-full space-y-4">
            <div className="flex items-start gap-3">
              <div className="w-9 h-9 rounded-xl bg-rose-100 text-rose-700 flex items-center justify-center shrink-0">
                <AlertTriangle className="w-5 h-5" />
              </div>
              <div>
                <h3 className="text-base font-bold text-[#3A2E2B]">刪除答過的題目？</h3>
                <p className="text-xs text-[#7A6C65] mt-1 leading-relaxed">
                  這組已經答過
                  <span className="font-bold text-[#3A2E2B]"> {answeredFaqs.length} </span>
                  題，刪除後<span className="font-bold text-rose-700">無法復原</span>
                  。已經聊過的對話紀錄不受影響。
                </p>
              </div>
            </div>

            {isUsingDefaults && (
              <p className="text-[11px] text-[#7A6C65] leading-relaxed rounded-2xl bg-[#F5EFE6] border border-[#E8DFD3] p-3">
                目前用的是內建預設題庫。刪除會先把剩下的
                {' '}{faqs.length - answeredFaqs.length}{' '}
                題存成你們專屬的題庫，之後就跟其他對話互不影響。
              </p>
            )}

            <div className="rounded-2xl bg-[#F5EFE6] border border-[#E8DFD3] p-3.5 space-y-1.5 max-h-40 overflow-y-auto">
              {answeredFaqs.slice(0, 8).map((f) => (
                <p key={f.id} className="text-xs text-[#3A2E2B] truncate">
                  · {f.question}
                </p>
              ))}
              {answeredFaqs.length > 8 && (
                <p className="text-[11px] text-[#7A6C65]">
                  …還有 {answeredFaqs.length - 8} 題
                </p>
              )}
            </div>

            <div className="flex items-center gap-2 pt-1">
              <button
                onClick={() => setIsConfirmingAnswered(false)}
                disabled={isDeletingAnswered}
                className="flex-1 px-4 py-2.5 rounded-xl text-sm font-semibold bg-white border border-[#D0BFAC] text-[#7A6C65] hover:bg-[#F4ECE1] disabled:opacity-50 transition-colors cursor-pointer"
              >
                取消
              </button>
              <button
                onClick={handleDeleteAnswered}
                disabled={isDeletingAnswered}
                className="flex-1 px-4 py-2.5 rounded-xl text-sm font-bold bg-rose-600 hover:bg-rose-700 text-white disabled:opacity-50 transition-colors inline-flex items-center justify-center gap-1.5 cursor-pointer"
              >
                <Trash2 className="w-4 h-4" />
                {isDeletingAnswered ? '刪除中…' : `刪除 ${answeredFaqs.length} 題`}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Restore Confirmation */}
      {pendingRestore && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/40 backdrop-blur-xs animate-fade-in">
          <div className="bg-[#FCFAF6] rounded-3xl border border-[#E8DFD3] p-6 max-w-md w-full space-y-4">
            <div className="flex items-start gap-3">
              <div className="w-9 h-9 rounded-xl bg-rose-100 text-rose-700 flex items-center justify-center shrink-0">
                <AlertTriangle className="w-5 h-5" />
              </div>
              <div>
                <h3 className="text-base font-bold text-[#3A2E2B]">確認從備份還原？</h3>
                <p className="text-xs text-[#7A6C65] mt-1 leading-relaxed">
                  這會<span className="font-bold text-rose-700">先刪除</span>
                  你與 {partnerName || '對方'} 這一組的對話、出題紀錄與題庫，
                  再寫入備份內容。無法復原。
                </p>
              </div>
            </div>

            <div className="rounded-2xl bg-[#F5EFE6] border border-[#E8DFD3] p-3.5 space-y-1 text-xs">
              <div className="flex justify-between">
                <span className="text-[#7A6C65]">備份時間</span>
                <span className="font-semibold text-[#3A2E2B]">
                  {new Date(pendingRestore.exportedAt).toLocaleString()}
                </span>
              </div>
              <div className="flex justify-between">
                <span className="text-[#7A6C65]">文件數量</span>
                <span className="font-semibold text-[#3A2E2B]">
                  {pendingRestore.documentCount ?? '—'} 筆
                </span>
              </div>
              <div className="flex justify-between">
                <span className="text-[#7A6C65]">備份對象</span>
                <span className="font-semibold text-[#3A2E2B]">
                  {describeBackup(pendingRestore)}
                </span>
              </div>
              <div className="flex justify-between">
                <span className="text-[#7A6C65]">結構版本</span>
                <span className="font-semibold text-[#3A2E2B]">
                  v{pendingRestore.schemaVersion ?? '?'}
                </span>
              </div>
            </div>

            <p className="text-[11px] text-[#7A6C65] leading-relaxed">
              範圍只限這一組對話：房間狀態、對話紀錄、出題歷史、題庫。
              其他對話完全不受影響。建議先按左邊的備份鈕保存一份目前的狀態。
            </p>

            {restoreStatus && (
              <p className="text-xs font-semibold text-[#8C6D53]">{restoreStatus}</p>
            )}

            <div className="flex items-center justify-end gap-3 pt-1">
              <button
                onClick={() => setPendingRestore(null)}
                disabled={isRestoring}
                className="px-4 py-2 rounded-xl text-xs font-semibold text-[#7A6C65] hover:bg-[#F2EBE1] disabled:opacity-50"
              >
                取消
              </button>
              <button
                onClick={handleConfirmRestore}
                disabled={isRestoring}
                className="px-4 py-2 rounded-xl text-xs font-semibold bg-rose-600 text-white hover:bg-rose-700 shadow-xs disabled:opacity-50"
              >
                {isRestoring ? '處理中…' : '清空並還原'}
              </button>
            </div>
          </div>
        </div>
      )}

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
