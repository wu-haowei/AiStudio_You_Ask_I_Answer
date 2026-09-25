import React, { useMemo, useState } from 'react';
import {
  Plus,
  Search,
  Edit2,
  Trash2,
  Circle,
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
  HelpCircle,
} from 'lucide-react';
import { Category, FAQItem, QuestionTranslations, UNFILED_CATEGORY } from '../types';
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
import { ConfirmDialog, type ConfirmRequest } from './admin/ConfirmDialog';
import { OptionsBadge } from './admin/OptionsBadge';
import { INTL_LOCALE, LANGS, useLang, useT, type Lang } from '../i18n';
import { displayCategory, hasTranslations } from '../i18n/content';
import { Rich } from './Rich';

/** One language's version of a question while it is being edited — everything is a plain string here; blanks are dropped on save. */
interface TranslationForm {
  question: string;
  answer: string;
  options: string[];
}

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
  /** True while this pair has no library of its own and is borrowing the default one. */
  isUsingDefaults?: boolean;
  /**
   * Which library is on screen. The default one is shared by every pair, so the
   * tools that only make sense for a conversation are hidden while it is open.
   */
  libraryTarget: 'room' | 'default';
  onChangeLibraryTarget: (target: 'room' | 'default') => void;
  /**
   * Whether to offer the default library at all. It is shared by every pair, so
   * it stays out of sight until the logo's triple tap asks for it.
   */
  canEditDefaults?: boolean;
  partnerName?: string;
  /** Backup and restore are scoped to this one conversation. */
  roomId: string;
  /** Questions this pair has already answered, offered for clean-up. */
  answeredFaqs?: FAQItem[];
  /**
   * Trimmed text of every question this pair has ever answered — passed
   * through to the cloud import picker so a question can show as already
   * answered even when it is not currently in the library under any id.
   */
  answeredQuestionTexts?: Set<string>;
  /**
   * Marks (or un-marks) a cloud question as answered directly by its text,
   * for the import picker — a question there has no faqId yet, so this is
   * separate from onToggleAnswered below.
   */
  onToggleAnsweredText?: (questionText: string, answered: boolean) => void | Promise<void>;
  onDeleteAnswered?: () => void | Promise<void>;
  /**
   * Marks a question played, or unplays it. The state lives on the room
   * document rather than the question, because "answered" is true of a pair,
   * not of the question itself — the same library is shared.
   */
  onToggleAnswered?: (faq: FAQItem, answered: boolean) => void | Promise<void>;
  /** Clears the played record for a batch of questions at once. */
  onRestoreAnswered?: (ids: string[]) => void | Promise<void>;
  isLoading?: boolean;
  onExportData: () => void;
  /** Re-opens the app explainer — the button here covers anyone who never saw it, or dismissed it before reading. */
  onOpenOnboarding: () => void;
  showToast: (title: string, description?: string, type?: 'success' | 'error' | 'info' | 'warning') => void;
}

const translationsToForm = (translations: QuestionTranslations | undefined): Partial<Record<Lang, TranslationForm>> => {
  const form: Partial<Record<Lang, TranslationForm>> = {};
  for (const { code } of LANGS) {
    const entry = translations?.[code];
    if (entry) {
      form[code] = {
        question: entry.question ?? '',
        answer: entry.answer ?? '',
        options: entry.options ? [...entry.options] : [],
      };
    }
  }
  return form;
};

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
  libraryTarget,
  onChangeLibraryTarget,
  canEditDefaults = false,
  partnerName,
  roomId,
  answeredFaqs = [],
  answeredQuestionTexts,
  onToggleAnsweredText,
  onDeleteAnswered,
  onToggleAnswered,
  onRestoreAnswered,
  onExportData,
  onOpenOnboarding,
  isLoading = false,
  showToast,
}) => {
  const t = useT();
  const lang = useLang();
  const partnerLabel = partnerName || t('admin.partnerFallback');
  const isEditingDefaults = libraryTarget === 'default';

  const [search, setSearch] = useState('');
  const [selectedCategory, setSelectedCategory] = useState('all');

  // Modal States
  const [isEditModalOpen, setIsEditModalOpen] = useState(false);
  const [editingFaq, setEditingFaq] = useState<FAQItem | null>(null);

  // Form Field States
  const [formQuestion, setFormQuestion] = useState('');
  const [formAnswer, setFormAnswer] = useState('');
  const [formCategory, setFormCategory] = useState('');
  const [formOptions, setFormOptions] = useState<string[]>(['', '']);
  // Which tab of the editor is showing: the original wording, or one language's translation
  const [formTab, setFormTab] = useState<'original' | Lang>('original');
  const [formTranslations, setFormTranslations] = useState<Partial<Record<Lang, TranslationForm>>>({});


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

  /*
   * Every toolbar action confirms first. The buttons are icon-only and sit
   * shoulder to shoulder, so a mis-tap on a phone is easy — and two of them
   * (匯入預設題目, 搬移舊版資料) write to Firestore straight away.
   */
  const [pendingConfirm, setPendingConfirm] = useState<ConfirmRequest | null>(null);
  const [isConfirmRunning, setIsConfirmRunning] = useState(false);

  const runPendingConfirm = async () => {
    if (!pendingConfirm || isConfirmRunning) return;
    setIsConfirmRunning(true);
    try {
      await pendingConfirm.run();
      setPendingConfirm(null);
    } catch (err: any) {
      console.error('Toolbar action failed:', err);
      showToast(t('admin.opFailed'), err?.message || t('app.tryLater'), 'error');
      setPendingConfirm(null);
    } finally {
      setIsConfirmRunning(false);
    }
  };

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
      showToast(t('admin.deleteFailed'), err?.message || t('app.tryLater'), 'error');
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

  /*
   * Restoring only touches the ones that were actually played, so the count on
   * the button is the number of questions that will change — not the number
   * selected. Picking "select all" and pressing it therefore does the obvious
   * thing without needing the selection to be curated first.
   */
  const selectedAnsweredIds = useMemo(
    () => [...selectedIds].filter((id) => answeredIds.has(id)),
    [selectedIds, answeredIds]
  );

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
      showToast(t('admin.deletedQuestions'), t('admin.deletedCount', { count: ids.length }), 'info');
    } catch (err: any) {
      showToast(t('admin.deleteFailed'), err?.message || t('app.tryLater'), 'error');
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

      showToast(t('admin.backupDownloaded'), t('admin.backupDocs', { count: backup.documentCount }), 'success');
    } catch (err: any) {
      console.error('Backup failed:', err);
      showToast(t('admin.backupFailed'), err?.message || t('app.tryLater'), 'error');
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
          t('admin.wrongBackup'),
          t('admin.wrongBackupBody', { name: describeBackup(backup) }),
          'error'
        );
        return;
      }

      setPendingRestore(backup);
    } catch (err: any) {
      showToast(t('admin.cantReadBackup'), err?.message || t('admin.badFormat'), 'error');
    }
  };

  /** Empties every collection, then writes the backup back. */
  const handleConfirmRestore = async () => {
    if (!pendingRestore || isRestoring) return;

    setIsRestoring(true);
    try {
      setRestoreStatus(t('admin.clearing'));
      const removed = await wipeRoom(db, roomId, (count) =>
        setRestoreStatus(t('admin.clearingCount', { count }))
      );

      setRestoreStatus(t('admin.writing'));
      const report = await restoreRoomBackup(db, roomId, pendingRestore);

      setPendingRestore(null);
      showToast(
        t('admin.restored'),
        t('admin.restoredDetail', {
          removed,
          written: report.written,
          failedNote: report.failed > 0 ? t('admin.restoredFailedNote', { count: report.failed }) : '',
        }),
        report.failed > 0 ? 'warning' : 'success'
      );
    } catch (err: any) {
      console.error('Restore failed:', err);
      showToast(t('admin.restoreFailed'), err?.message || t('app.tryLater'), 'error');
    } finally {
      setIsRestoring(false);
      setRestoreStatus('');
    }
  };

  /** The options a translation has to line up with: the original's non-blank ones, in order. */
  const originalOptions = formOptions.map((o) => o.trim()).filter(Boolean);

  const updateTranslation = (lang: Lang, patch: Partial<TranslationForm>) => {
    setFormTranslations((prev) => ({
      ...prev,
      [lang]: { ...(prev[lang] ?? { question: '', answer: '', options: [] }), ...patch },
    }));
  };

  const updateTranslationOption = (lang: Lang, index: number, value: string) => {
    const options = [...(formTranslations[lang]?.options ?? [])];
    while (options.length <= index) options.push('');
    options[index] = value;
    updateTranslation(lang, { options });
  };

  /** True when a language has anything typed in it, for the dot on its tab. */
  const tabHasContent = (lang: Lang) => {
    const form = formTranslations[lang];
    return !!form && !!(form.question.trim() || form.answer.trim() || form.options.some((o) => o.trim()));
  };

  /** The language the question being edited is written in: recorded on it, or the current one for a new question. */
  const originalLang: Lang | undefined = editingFaq ? editingFaq.sourceLang : lang;

  const handleOpenAddModal = () => {
    setEditingFaq(null);
    setFormQuestion('');
    setFormAnswer('');
    setFormCategory(categories[0]?.name || UNFILED_CATEGORY);
    setFormOptions(['', '']);
    setFormTab('original');
    setFormTranslations({});
    setIsEditModalOpen(true);
  };

  const handleOpenEditModal = (faq: FAQItem) => {
    setEditingFaq(faq);
    setFormQuestion(faq.question);
    setFormAnswer(faq.answer);
    setFormCategory(faq.category);
    setFormOptions(faq.options?.length ? [...faq.options] : ['', '']);
    setFormTab('original');
    setFormTranslations(translationsToForm(faq.translations));
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
      showToast(t('admin.fillRequired'), undefined, 'warning');
      return;
    }

    const optionsArray = formOptions.map((o) => o.trim()).filter(Boolean);

    if (optionsArray.length === 1) {
      showToast(t('admin.optionsMin'), t('admin.optionsMinHint'), 'warning');
      return;
    }

    /*
     * Translated options are used all-or-nothing and must match the original one
     * to one (answers are stored as option positions). Catch a half-filled list
     * here, on the tab it is on, rather than saving something players would
     * silently never see.
     */
    const translations: QuestionTranslations = {};
    for (const { code, label } of LANGS) {
      const form = formTranslations[code];
      if (!form) continue;
      const options = optionsArray.map((_, i) => (form.options[i] ?? '').trim());
      const filled = options.filter(Boolean).length;
      if (filled > 0 && filled !== optionsArray.length) {
        setFormTab(code);
        showToast(t('tr.optionsMismatch', { language: label }), undefined, 'warning');
        return;
      }
      const entry: NonNullable<QuestionTranslations[Lang]> = {};
      if (form.question.trim()) entry.question = form.question.trim();
      if (form.answer.trim()) entry.answer = form.answer.trim();
      if (filled > 0) entry.options = options;
      if (Object.keys(entry).length > 0) translations[code] = entry;
    }
    const savedTranslations = hasTranslations(translations) ? translations : undefined;

    if (editingFaq) {
      onUpdateFAQ({
        ...editingFaq,
        question: formQuestion.trim(),
        answer: formAnswer.trim(),
        category: formCategory,
        options: optionsArray.length > 0 ? optionsArray : undefined,
        translations: savedTranslations,
        sourceLang: editingFaq.sourceLang,
        updatedAt: new Date().toISOString(),
      });
      showToast(t('admin.updated'), undefined, 'success');
    } else {
      onAddFAQ({
        question: formQuestion.trim(),
        answer: formAnswer.trim(),
        category: formCategory,
        options: optionsArray.length > 0 ? optionsArray : undefined,
        translations: savedTranslations,
        sourceLang: lang,
      });
      showToast(t('admin.added'), undefined, 'success');
    }

    setIsEditModalOpen(false);
  };

  return (
    <div className="space-y-6 pb-12">
      {/* Admin Control Bar */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 p-6 rounded-3xl bg-white border border-[#E8DFD3] shadow-xs">
        <div>
          <h1 className="text-xl sm:text-2xl font-bold text-[#3A2E2B] flex items-center gap-2">
            <span>{t('admin.title')}</span>
            <span className="text-xs px-2.5 py-0.5 rounded-full bg-[#F3E8DC] text-[#7A5230] font-semibold">
              {isLoading ? t('admin.loading') : t('app.questionCount', { count: faqs.length })}
            </span>
          </h1>

          {/* Which library is being edited — revealed by tapping the logo three times */}
          {canEditDefaults && (
            <div className="mt-2 inline-flex rounded-2xl border border-[#D0BFAC] bg-[#F5EFE6] p-1">
              {(['room', 'default'] as const).map((target) => (
                <button
                  key={target}
                  type="button"
                  onClick={() => onChangeLibraryTarget(target)}
                  className={`cursor-pointer rounded-xl px-3 py-1.5 text-xs font-bold transition-colors ${
                    libraryTarget === target
                      ? 'bg-white text-[#3A2E2B] shadow-xs'
                      : 'text-[#7A6C65] hover:text-[#3A2E2B]'
                  }`}
                >
                  {target === 'room' ? t('admin.libRoom') : t('admin.libDefault')}
                </button>
              ))}
            </div>
          )}

          <p className="text-xs sm:text-sm text-[#7A6C65] mt-2">
            {isEditingDefaults
              ? t('admin.descDefault')
              : isUsingDefaults
                ? t('admin.descBorrowing')
                : t('admin.descOwn', { name: partnerLabel })}
          </p>
        </div>

        {/* Action Group */}
        <div className="flex flex-wrap items-center gap-2 sm:gap-3">
          <button
            onClick={() => setIsJsonModalOpen(true)}
            className="px-3.5 py-2 rounded-xl text-xs sm:text-sm font-semibold bg-[#E6D8C8] text-[#4A3F35] hover:bg-[#DBC9B5] transition-all inline-flex items-center gap-1.5 border border-[#D0BFAC]"
          >
            <Upload className="w-4 h-4" />
            <span>{t('import.title')}</span>
          </button>

          <button
            onClick={handleOpenAddModal}
            className="milk-tea-btn-primary px-4 py-2 rounded-xl text-xs sm:text-sm font-semibold inline-flex items-center gap-1.5 shadow-sm"
          >
            <Plus className="w-4 h-4" />
            <span>{t('admin.add')}</span>
          </button>

          <button
            onClick={onOpenOnboarding}
            title={t('admin.helpTitle')}
            className="px-3.5 py-2 rounded-xl text-xs sm:text-sm font-semibold bg-white text-[#7A6C65] border border-[#D0BFAC] hover:text-[#3A2E2B] hover:bg-[#F4ECE1] transition-all inline-flex items-center gap-1.5 cursor-pointer"
          >
            <HelpCircle className="w-4 h-4" />
            <span>{t('header.howToUse')}</span>
          </button>

          {onDeleteAnswered && (
            <button
              onClick={() => setIsConfirmingAnswered(true)}
              disabled={answeredFaqs.length === 0}
              title={
                answeredFaqs.length === 0
                  ? t('admin.noAnswered')
                  : t('admin.deleteAnsweredTitle')
              }
              className="px-3.5 py-2 rounded-xl text-xs sm:text-sm font-semibold bg-white text-[#7A6C65] border border-[#D0BFAC] hover:text-rose-700 hover:border-rose-300 hover:bg-rose-50 disabled:opacity-40 disabled:hover:text-[#7A6C65] disabled:hover:border-[#D0BFAC] disabled:hover:bg-white transition-all inline-flex items-center gap-1.5 cursor-pointer"
            >
              <CheckCheck className="w-4 h-4" />
              <span>{t('admin.deleteAnswered', { count: answeredFaqs.length })}</span>
            </button>
          )}

          {/* Backup Tools */}
          <div className="flex items-center gap-1 border-l border-[#E8DFD3] pl-2">
            <button
              onClick={() =>
                setPendingConfirm({
                  title: t('admin.exportTitle'),
                  description: <Rich text={t('admin.exportBody', { faqs: faqs.length, cats: categories.length })} />,
                  note: t('admin.exportNote'),
                  confirmLabel: t('admin.exportConfirm'),
                  icon: Download,
                  run: onExportData,
                })
              }
              title={t('admin.exportTip')}
              className="p-2 rounded-xl text-[#7A6C65] hover:text-[#3A2E2B] hover:bg-[#F4ECE1] transition-colors cursor-pointer"
            >
              <Download className="w-4 h-4" />
            </button>
            {/* Conversation-only tools. The default library is shared by every
                pair, so it has no backup of its own, nothing to restore into,
                and no older room to migrate from. */}
            {!isEditingDefaults && (
              <>
              <button
                onClick={() =>
                  setPendingConfirm({
                    title: t('admin.backupTitle'),
                    description: t('admin.backupBody'),
                    note: t('admin.backupNote', { name: partnerLabel }),
                    confirmLabel: t('admin.backupConfirm'),
                    icon: DatabaseBackup,
                    run: handleFullBackup,
                  })
                }
                disabled={isBackingUp}
                title={t('admin.backupTip')}
                className="p-2 rounded-xl text-[#7A6C65] hover:text-[#3A2E2B] hover:bg-[#F4ECE1] transition-colors disabled:opacity-50 cursor-pointer"
              >
                <DatabaseBackup className={`w-4 h-4 ${isBackingUp ? 'animate-pulse' : ''}`} />
              </button>
              <label
                title={t('admin.restoreTip')}
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
                onClick={() =>
                  setPendingConfirm({
                    title: t('admin.resetTitle'),
                    description: <Rich text={t('admin.resetBody', { count: faqs.length })} />,
                    note: isUsingDefaults ? t('admin.resetNoteBorrowing') : t('admin.resetNoteOwn'),
                    confirmLabel: t('admin.resetConfirm'),
                    tone: isUsingDefaults ? 'neutral' : 'danger',
                    icon: RotateCcw,
                    run: onImportDefaults,
                  })
                }
                title={t('admin.resetTip')}
                className="p-2 rounded-xl text-[#7A6C65] hover:text-[#3A2E2B] hover:bg-[#F4ECE1] transition-colors cursor-pointer"
              >
                <RotateCcw className="w-4 h-4" />
              </button>
              <button
                onClick={() =>
                  setPendingConfirm({
                    title: t('admin.migrateTitle'),
                    description: t('admin.migrateBody'),
                    note: t('admin.migrateNote'),
                    confirmLabel: t('admin.migrateConfirm'),
                    icon: History,
                    run: onMigrateLegacy,
                  })
                }
                title={t('admin.migrateTip')}
                className="p-2 rounded-xl text-[#7A6C65] hover:text-[#3A2E2B] hover:bg-[#F4ECE1] transition-colors cursor-pointer"
              >
                <History className="w-4 h-4" />
              </button>
              </>
            )}
            <button
              onClick={() =>
                setPendingConfirm({
                  title: t('admin.cacheTitle'),
                  description: t('admin.cacheBody'),
                  note: t('admin.cacheNote', { version: CURRENT_APP_VERSION }),
                  confirmLabel: t('admin.cacheConfirm'),
                  tone: 'danger',
                  icon: Trash2,
                  run: () => {
                    clearAllStorageAndSession();
                    window.location.reload();
                  },
                })
              }
              title={t('admin.cacheTip', { version: CURRENT_APP_VERSION })}
              className="p-2 rounded-xl text-amber-700 hover:bg-amber-100 transition-colors cursor-pointer"
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
            placeholder={t('admin.search')}
            className="w-full pl-10 pr-4 py-2.5 text-sm rounded-xl milk-tea-input"
          />
        </div>

        <select
          value={selectedCategory}
          onChange={(e) => setSelectedCategory(e.target.value)}
          className="w-full sm:w-48 px-3.5 py-2.5 text-sm rounded-xl milk-tea-input shrink-0"
        >
          <option value="all">{t('import.allCategories', { count: faqs.length })}</option>
          {categories.map((c) => (
            <option key={c.id} value={c.name}>
              {displayCategory(c.name)}
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
            <span>{t('import.selectVisible', { count: filteredFaqs.length })}</span>
          </label>

          {selectedCount > 0 && (
            <div className="flex items-center gap-2">
              <span className="text-xs text-[#7A6C65]">{t('import.itemsSelected', { count: selectedCount })}</span>
              <button
                type="button"
                onClick={() => setSelectedIds(new Set())}
                className="px-3 py-1.5 rounded-xl text-xs font-semibold text-[#7A6C65] hover:bg-[#F4ECE1] transition-colors cursor-pointer"
              >
                {t('admin.deselect')}
              </button>

              {onRestoreAnswered && (
                <button
                  type="button"
                  disabled={selectedAnsweredIds.length === 0}
                  onClick={() =>
                    setPendingConfirm({
                      title: t('admin.restoreAnsweredTitle', { count: selectedAnsweredIds.length }),
                      description: t('admin.restoreAnsweredBody'),
                      note: t('admin.restoreAnsweredNote'),
                      confirmLabel: t('admin.restoreAnsweredConfirm', { count: selectedAnsweredIds.length }),
                      icon: RotateCcw,
                      run: () => onRestoreAnswered(selectedAnsweredIds),
                    })
                  }
                  title={
                    selectedAnsweredIds.length === 0
                      ? t('admin.noAnsweredSelected')
                      : undefined
                  }
                  className="px-3 py-1.5 rounded-xl text-xs font-semibold bg-[#E6D8C8] text-[#4A3F35] border border-[#D0BFAC] hover:bg-[#DBC9B5] disabled:opacity-40 disabled:hover:bg-[#E6D8C8] transition-colors cursor-pointer disabled:cursor-not-allowed inline-flex items-center gap-1.5"
                >
                  <RotateCcw className="w-3.5 h-3.5" />
                  {t('admin.restoreAnswered', { count: selectedAnsweredIds.length })}
                </button>
              )}

              <button
                type="button"
                onClick={() => setIsBulkDeleteOpen(true)}
                className="px-3 py-1.5 rounded-xl text-xs font-semibold bg-rose-600 hover:bg-rose-700 text-white transition-colors cursor-pointer inline-flex items-center gap-1.5"
              >
                <Trash2 className="w-3.5 h-3.5" />
                {t('admin.deleteSelected')}
              </button>
            </div>
          )}
        </div>
      )}

      {/* Q&A Data Cards List */}
      <div className="space-y-3">
        {filteredFaqs.length === 0 ? (
          <div className="text-center py-12 bg-white rounded-3xl border border-[#E8DFD3] text-[#7A6C65]">
            {t('admin.noMatch')}
          </div>
        ) : (
          filteredFaqs.map((faq) => {
            const isAnswered = answeredIds.has(faq.id);
            return (
            <div
              key={faq.id}
              className={`milk-tea-card rounded-2xl p-5 flex flex-col sm:flex-row sm:items-center justify-between gap-4 ${
                /* Answered questions stay editable — just quieter, so the
                   unplayed ones are what the eye lands on first. */
                isAnswered ? 'opacity-70 bg-[#F7F4EE]' : ''
              } ${selectedIds.has(faq.id) ? 'ring-2 ring-[#8C6D53]' : ''}`}
            >
              <input
                type="checkbox"
                checked={selectedIds.has(faq.id)}
                onChange={() => toggleSelected(faq.id)}
                aria-label={t('admin.selectQuestion', { question: faq.question })}
                className="w-4 h-4 accent-[#8C6D53] cursor-pointer shrink-0 self-start sm:self-center"
              />

              <div className="space-y-1.5 flex-1">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="text-xs px-2.5 py-0.5 rounded-full bg-[#F3E8DC] text-[#7A5230] font-semibold border border-[#E6D4C2]">
                    {displayCategory(faq.category)}
                  </span>
                  {isAnswered && (
                    <span className="text-[10px] font-bold text-[#7A6C65] bg-[#EFE7DC] px-2 py-0.5 rounded-md inline-flex items-center gap-0.5">
                      <CheckCheck className="w-3 h-3" /> {t('import.answered')}
                    </span>
                  )}
                  {faq.options && faq.options.length > 0 && (
                    <OptionsBadge options={faq.options} />
                  )}
                  {hasTranslations(faq.translations) && (
                    <span className="text-[10px] font-bold text-[#7A5230] bg-[#F3E8DC] px-2 py-0.5 rounded-md">
                      {t('tr.badge', {
                        languages: LANGS.filter((l) => hasTranslations({ [l.code]: faq.translations?.[l.code] }))
                          .map((l) => l.short)
                          .join(' · '),
                      })}
                    </span>
                  )}
                </div>

                <h3 className="text-base font-bold text-[#3A2E2B]">{faq.question}</h3>
                <p className="text-xs text-[#7A6C65] line-clamp-2">{faq.answer}</p>
              </div>

              {/* Action Column */}
              <div className="flex items-center gap-2 shrink-0 self-end sm:self-auto border-t sm:border-t-0 pt-2 sm:pt-0 border-[#E8DFD3]">
                {onToggleAnswered && (
                  <button
                    type="button"
                    onClick={() => onToggleAnswered(faq, !isAnswered)}
                    className={`p-2 rounded-xl transition-colors cursor-pointer ${
                      isAnswered
                        ? 'bg-[#E3D9CB] text-[#5C4B3A]'
                        : 'text-[#7A6C65] hover:bg-[#F4ECE1]'
                    }`}
                    title={
                      isAnswered
                        ? t('admin.markUnanswered')
                        : t('admin.markAnswered')
                    }
                  >
                    {isAnswered ? (
                      <CheckCheck className="w-4 h-4" />
                    ) : (
                      <Circle className="w-4 h-4" />
                    )}
                  </button>
                )}

                <button
                  onClick={() => handleOpenEditModal(faq)}
                  className="p-2 rounded-xl text-[#8C6D53] hover:bg-[#F4ECE1] transition-colors"
                  title={t('admin.edit')}
                >
                  <Edit2 className="w-4 h-4" />
                </button>

                <button
                  onClick={() => setDeletingId(faq.id)}
                  className="p-2 rounded-xl text-rose-600 hover:bg-rose-50 transition-colors"
                  title={t('admin.delete')}
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
                {editingFaq ? t('admin.editTitle') : t('admin.add')}
              </h3>
              <button
                onClick={() => setIsEditModalOpen(false)}
                className="p-1.5 rounded-xl text-[#7A6C65] hover:bg-[#EADDCB]"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <form onSubmit={handleSaveForm} className="p-6 space-y-4 overflow-y-auto flex-1">
              {/* Original wording, plus one tab per language it can be translated into */}
              <div className="flex flex-wrap gap-1.5" role="tablist">
                {(['original', ...LANGS.map((l) => l.code)] as const).map((tab) => {
                  const active = formTab === tab;
                  const originalLabel = originalLang
                    ? t('tr.tabOriginalIn', { language: LANGS.find((l) => l.code === originalLang)!.label })
                    : t('tr.tabOriginal');
                  const label = tab === 'original' ? originalLabel : LANGS.find((l) => l.code === tab)!.label;
                  // A new question has nothing to translate yet, and the original's own language never needs a translation
                  const isOriginalLang = tab !== 'original' && tab === originalLang && !tabHasContent(tab);
                  const disabled = tab !== 'original' && (!editingFaq || isOriginalLang);
                  return (
                    <button
                      key={tab}
                      type="button"
                      role="tab"
                      aria-selected={active}
                      onClick={() => setFormTab(tab)}
                      disabled={disabled}
                      title={
                        disabled ? (isOriginalLang ? t('tr.isOriginalLang') : t('tr.addFirst')) : undefined
                      }
                      className={`px-3 py-1.5 rounded-xl text-xs font-semibold border transition-colors inline-flex items-center gap-1.5 disabled:opacity-40 disabled:cursor-not-allowed ${
                        active
                          ? 'bg-[#8C6D53] text-white border-[#8C6D53] cursor-pointer'
                          : 'bg-white text-[#7A6C65] border-[#D0BFAC] hover:bg-[#F4ECE1] disabled:hover:bg-white cursor-pointer'
                      }`}
                    >
                      {label}
                      {tab !== 'original' && tabHasContent(tab) && (
                        <span className={`w-1.5 h-1.5 rounded-full ${active ? 'bg-white' : 'bg-[#8C6D53]'}`} />
                      )}
                    </button>
                  );
                })}
              </div>

              {formTab === 'original' ? (
              <>
              <div>
                <label className="block text-xs font-semibold text-[#3A2E2B] mb-1.5">
                  {t('admin.fieldQuestion')} <span className="text-rose-500">*</span>
                </label>
                <input
                  type="text"
                  required
                  value={formQuestion}
                  onChange={(e) => setFormQuestion(e.target.value)}
                  placeholder={t('admin.questionPh')}
                  className="w-full px-4 py-2.5 text-sm rounded-xl milk-tea-input"
                />
              </div>

              <div>
                <label className="block text-xs font-semibold text-[#3A2E2B] mb-1.5">
                  {t('admin.fieldNote')} <span className="text-rose-500">*</span>
                </label>
                <textarea
                  required
                  rows={3}
                  value={formAnswer}
                  onChange={(e) => setFormAnswer(e.target.value)}
                  placeholder={t('admin.notePh')}
                  className="w-full px-4 py-2.5 text-sm rounded-xl milk-tea-input resize-none"
                />
              </div>

              <div>
                <label className="block text-xs font-semibold text-[#3A2E2B] mb-1.5">
                  {t('admin.fieldCategory')}
                </label>
                <select
                  value={formCategory}
                  onChange={(e) => setFormCategory(e.target.value)}
                  className="w-full px-3.5 py-2.5 text-sm rounded-xl milk-tea-input"
                >
                  {categories.map((c) => (
                    <option key={c.id} value={c.name}>
                      {displayCategory(c.name)}
                    </option>
                  ))}
                </select>
              </div>

              {/* Options — free-length list */}
              <div className="border-t border-[#E8DFD3] pt-4 space-y-2.5">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-1.5 text-xs font-bold text-[#8C6D53]">
                    <Sparkles className="w-4 h-4" />
                    <span>{t('admin.fieldOptions', { count: formOptions.filter((o) => o.trim()).length })}</span>
                  </div>
                  <button
                    type="button"
                    onClick={addOption}
                    className="px-2.5 py-1 rounded-lg text-xs font-semibold text-[#8C6D53] hover:bg-[#F4ECE1] transition-colors inline-flex items-center gap-1 cursor-pointer"
                  >
                    <Plus className="w-3.5 h-3.5" />
                    {t('invite.addOption')}
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
                        placeholder={t('admin.optionPh', { letter: String.fromCharCode(65 + idx) })}
                        className="flex-1 min-w-0 px-3.5 py-2 text-sm rounded-xl milk-tea-input"
                      />
                      <button
                        type="button"
                        onClick={() => removeOption(idx)}
                        disabled={formOptions.length <= 2}
                        aria-label={t('admin.removeOption', { letter: String.fromCharCode(65 + idx) })}
                        className="shrink-0 p-2 rounded-xl text-[#7A6C65] hover:text-rose-600 hover:bg-rose-50 transition-colors disabled:opacity-30 disabled:cursor-not-allowed cursor-pointer"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  ))}
                </div>

                <p className="text-[11px] text-[#7A6C65]">
                  {t('admin.optionsBlankHint')}
                </p>
              </div>

              </>
              ) : (
                (() => {
                  const lang = formTab;
                  const language = LANGS.find((l) => l.code === lang)!.label;
                  const form = formTranslations[lang] ?? { question: '', answer: '', options: [] };
                  return (
                    <div className="space-y-4">
                      <p className="text-[11px] text-[#7A6C65]">{t('tr.tabHint')}</p>

                      <div>
                        <label className="block text-xs font-semibold text-[#3A2E2B] mb-1.5">
                          {t('tr.question', { language })}
                        </label>
                        <input
                          type="text"
                          value={form.question}
                          onChange={(e) => updateTranslation(lang, { question: e.target.value })}
                          placeholder={formQuestion}
                          className="w-full px-4 py-2.5 text-sm rounded-xl milk-tea-input"
                        />
                      </div>

                      <div>
                        <label className="block text-xs font-semibold text-[#3A2E2B] mb-1.5">
                          {t('tr.note', { language })}
                        </label>
                        <textarea
                          rows={3}
                          value={form.answer}
                          onChange={(e) => updateTranslation(lang, { answer: e.target.value })}
                          placeholder={formAnswer}
                          className="w-full px-4 py-2.5 text-sm rounded-xl milk-tea-input resize-none"
                        />
                      </div>

                      <div className="border-t border-[#E8DFD3] pt-4 space-y-2.5">
                        <div className="flex items-center gap-1.5 text-xs font-bold text-[#8C6D53]">
                          <Sparkles className="w-4 h-4" />
                          <span>{t('tr.options', { language })}</span>
                        </div>

                        {originalOptions.length === 0 ? (
                          <p className="text-[11px] text-[#7A6C65]">{t('tr.noOptions')}</p>
                        ) : (
                          <>
                            <div className="space-y-2">
                              {originalOptions.map((original, idx) => (
                                <div key={idx} className="flex items-center gap-2">
                                  <span className="w-5 shrink-0 text-xs font-bold text-[#A68B6D] text-center">
                                    {String.fromCharCode(65 + idx)}
                                  </span>
                                  <input
                                    type="text"
                                    value={form.options[idx] ?? ''}
                                    onChange={(e) => updateTranslationOption(lang, idx, e.target.value)}
                                    placeholder={original}
                                    className="flex-1 min-w-0 px-3.5 py-2 text-sm rounded-xl milk-tea-input"
                                  />
                                </div>
                              ))}
                            </div>
                            <p className="text-[11px] text-[#7A6C65]">{t('tr.optionsHint')}</p>
                          </>
                        )}
                      </div>
                    </div>
                  );
                })()
              )}
              <div className="pt-4 flex items-center justify-end gap-3 border-t border-[#E8DFD3]">
                <button
                  type="button"
                  onClick={() => setIsEditModalOpen(false)}
                  className="px-4 py-2 rounded-xl text-sm font-medium text-[#7A6C65] hover:bg-[#F2EBE1]"
                >
                  {t('common.cancel')}
                </button>
                <button
                  type="submit"
                  className="milk-tea-btn-primary px-5 py-2.5 rounded-xl text-sm font-semibold inline-flex items-center gap-1.5"
                >
                  <Check className="w-4 h-4" />
                  <span>{t('admin.saveChanges')}</span>
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
        answeredQuestionTexts={answeredQuestionTexts}
        onToggleAnsweredText={onToggleAnsweredText}
        showToast={showToast}
      />

      {/* Shared confirmation for every toolbar action */}
      <ConfirmDialog
        request={pendingConfirm}
        isBusy={isConfirmRunning}
        onConfirm={runPendingConfirm}
        onCancel={() => setPendingConfirm(null)}
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
                <h3 className="text-base font-bold text-[#3A2E2B]">{t('admin.delAnsweredTitle')}</h3>
                <p className="text-xs text-[#7A6C65] mt-1 leading-relaxed">
                  <Rich text={t('admin.delAnsweredBody', { count: answeredFaqs.length })} />
                </p>
              </div>
            </div>

            {isUsingDefaults && (
              <p className="text-[11px] text-[#7A6C65] leading-relaxed rounded-2xl bg-[#F5EFE6] border border-[#E8DFD3] p-3">
                {t('admin.delAnsweredDefaults', { count: faqs.length - answeredFaqs.length })}
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
                  {t('admin.andMore', { count: answeredFaqs.length - 8 })}
                </p>
              )}
            </div>

            <div className="flex items-center gap-2 pt-1">
              <button
                onClick={() => setIsConfirmingAnswered(false)}
                disabled={isDeletingAnswered}
                className="flex-1 px-4 py-2.5 rounded-xl text-sm font-semibold bg-white border border-[#D0BFAC] text-[#7A6C65] hover:bg-[#F4ECE1] disabled:opacity-50 transition-colors cursor-pointer"
              >
                {t('common.cancel')}
              </button>
              <button
                onClick={handleDeleteAnswered}
                disabled={isDeletingAnswered}
                className="flex-1 px-4 py-2.5 rounded-xl text-sm font-bold bg-rose-600 hover:bg-rose-700 text-white disabled:opacity-50 transition-colors inline-flex items-center justify-center gap-1.5 cursor-pointer"
              >
                <Trash2 className="w-4 h-4" />
                {isDeletingAnswered ? t('admin.deleting') : t('admin.deleteN', { count: answeredFaqs.length })}
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
                <h3 className="text-base font-bold text-[#3A2E2B]">{t('admin.restoreConfirmTitle')}</h3>
                <p className="text-xs text-[#7A6C65] mt-1 leading-relaxed">
                  <Rich text={t('admin.restoreConfirmBody', { name: partnerLabel })} />
                </p>
              </div>
            </div>

            <div className="rounded-2xl bg-[#F5EFE6] border border-[#E8DFD3] p-3.5 space-y-1 text-xs">
              <div className="flex justify-between">
                <span className="text-[#7A6C65]">{t('admin.backupTime')}</span>
                <span className="font-semibold text-[#3A2E2B]">
                  {new Date(pendingRestore.exportedAt).toLocaleString(INTL_LOCALE[lang])}
                </span>
              </div>
              <div className="flex justify-between">
                <span className="text-[#7A6C65]">{t('admin.docCount')}</span>
                <span className="font-semibold text-[#3A2E2B]">
                  {pendingRestore.documentCount != null ? t('admin.docCountValue', { count: pendingRestore.documentCount }) : '—'}
                </span>
              </div>
              <div className="flex justify-between">
                <span className="text-[#7A6C65]">{t('admin.backupOf')}</span>
                <span className="font-semibold text-[#3A2E2B]">
                  {describeBackup(pendingRestore)}
                </span>
              </div>
              <div className="flex justify-between">
                <span className="text-[#7A6C65]">{t('admin.schemaVersion')}</span>
                <span className="font-semibold text-[#3A2E2B]">
                  v{pendingRestore.schemaVersion ?? '?'}
                </span>
              </div>
            </div>

            <p className="text-[11px] text-[#7A6C65] leading-relaxed">
              {t('admin.restoreScope')}
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
                {t('common.cancel')}
              </button>
              <button
                onClick={handleConfirmRestore}
                disabled={isRestoring}
                className="px-4 py-2 rounded-xl text-xs font-semibold bg-rose-600 text-white hover:bg-rose-700 shadow-xs disabled:opacity-50"
              >
                {isRestoring ? t('common.processing') : t('admin.resetConfirm')}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Bulk Delete Confirmation */}
      {isBulkDeleteOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/40 backdrop-blur-xs animate-fade-in">
          <div className="bg-[#FCFAF6] rounded-3xl border border-[#E8DFD3] p-6 max-w-sm w-full space-y-4">
            <h3 className="text-base font-bold text-[#3A2E2B]">{t('admin.bulkTitle')}</h3>
            <p className="text-xs text-[#7A6C65] leading-relaxed">
              {t('admin.bulkBody', { count: selectedCount })}
            </p>
            <div className="flex items-center justify-end gap-3 pt-2">
              <button
                onClick={() => setIsBulkDeleteOpen(false)}
                disabled={isBulkDeleting}
                className="px-4 py-2 rounded-xl text-xs font-semibold text-[#7A6C65] hover:bg-[#F2EBE1] disabled:opacity-50"
              >
                {t('common.cancel')}
              </button>
              <button
                onClick={handleBulkDelete}
                disabled={isBulkDeleting}
                className="px-4 py-2 rounded-xl text-xs font-semibold bg-rose-600 text-white hover:bg-rose-700 shadow-xs disabled:opacity-50"
              >
                {isBulkDeleting ? t('admin.deleting') : t('admin.deleteN', { count: selectedCount })}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Delete Confirmation Modal */}
      {deletingId && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/40 backdrop-blur-xs animate-fade-in">
          <div className="bg-[#FCFAF6] rounded-3xl border border-[#E8DFD3] p-6 max-w-sm w-full space-y-4">
            <h3 className="text-base font-bold text-[#3A2E2B]">{t('admin.delOneTitle')}</h3>
            <div className="flex items-center justify-end gap-3 pt-2">
              <button
                onClick={() => setDeletingId(null)}
                className="px-4 py-2 rounded-xl text-xs font-semibold text-[#7A6C65] hover:bg-[#F2EBE1]"
              >
                {t('common.cancel')}
              </button>
              <button
                onClick={() => {
                  onDeleteFAQ(deletingId);
                  setDeletingId(null);
                  showToast(t('admin.deletedQuestions'), undefined, 'info');
                }}
                className="px-4 py-2 rounded-xl text-xs font-semibold bg-rose-600 text-white hover:bg-rose-700 shadow-xs"
              >
                {t('admin.confirmDelete')}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
