import React, { useState, useEffect } from 'react';
import { ActiveTab, Category, FAQItem, ToastMessage, UserQuestion } from './types';
import { checkAndMigrateStorageVersion, CURRENT_APP_VERSION } from './utils/storage';
import {
  INITIAL_CATEGORIES,
  INITIAL_FAQS,
  INITIAL_USER_QUESTIONS,
  SEED_FAQ_IDS,
} from './data/initialData';
import {
  COLLECTIONS,
  deleteItem,
  replaceCollection,
  saveItem,
  saveItems,
  seedCollectionIfEmpty,
  subscribeToCategories,
  subscribeToFAQs,
  subscribeToUserQuestions,
} from './lib/firebase';
import { Header } from './components/Header';
import { CoPlayView } from './components/CoPlayView';
import { AskQuestionModal } from './components/AskQuestionModal';
import { AdminManageView } from './components/AdminManageView';
import { ToastContainer } from './components/Toast';

export default function App() {
  const [activeTab, setActiveTab] = useState<ActiveTab>('co_play');
  const [faqs, setFaqs] = useState<FAQItem[]>([]);
  const [categories, setCategories] = useState<Category[]>([]);
  const [userQuestions, setUserQuestions] = useState<UserQuestion[]>([]);
  const [searchQuery, setSearchQuery] = useState('');
  const [isAskModalOpen, setIsAskModalOpen] = useState(false);
  const [isLoadingContent, setIsLoadingContent] = useState(true);
  const [toasts, setToasts] = useState<ToastMessage[]>([]);

  const showToast = (
    title: string,
    description?: string,
    type: 'success' | 'info' | 'warning' | 'error' = 'success'
  ) => {
    const newToast: ToastMessage = {
      id: `toast-${Date.now()}-${Math.random().toString(36).substring(2, 6)}`,
      title,
      description,
      type,
    };
    setToasts((prev) => [...prev, newToast]);
  };

  const handleDismissToast = (id: string) => {
    setToasts((prev) => prev.filter((t) => t.id !== id));
  };

  // Seed defaults on a fresh database, then live-subscribe to Firestore content.
  useEffect(() => {
    const wasUpdated = checkAndMigrateStorageVersion();

    let unsubscribers: Array<() => void> = [];

    (async () => {
      await Promise.all([
        seedCollectionIfEmpty(COLLECTIONS.FAQS, INITIAL_FAQS),
        seedCollectionIfEmpty(COLLECTIONS.CATEGORIES, INITIAL_CATEGORIES),
        seedCollectionIfEmpty(COLLECTIONS.USER_QUESTIONS, INITIAL_USER_QUESTIONS),
      ]);

      unsubscribers = [
        subscribeToFAQs((items) => {
          setFaqs(
            [...items].sort((a, b) => (b.updatedAt || '').localeCompare(a.updatedAt || ''))
          );
          setIsLoadingContent(false);
        }),
        subscribeToCategories(setCategories),
        subscribeToUserQuestions((items) =>
          setUserQuestions(
            [...items].sort((a, b) => (b.createdAt || '').localeCompare(a.createdAt || ''))
          )
        ),
      ];
    })();

    if (wasUpdated) {
      showToast(
        `已自動升級至最新版本 (v${CURRENT_APP_VERSION})`,
        '資料已全面改由 Firebase 雲端同步，舊版本機快取已清除。',
        'info'
      );
    }

    return () => unsubscribers.forEach((fn) => fn());
  }, []);

  // FAQ CRUD — writes go straight to Firestore; the subscription updates local state.
  const handleAddFAQ = (
    newFaqData: Omit<FAQItem, 'id' | 'updatedAt' | 'helpfulCount' | 'unhelpfulCount'>
  ) => {
    const created: FAQItem = {
      ...newFaqData,
      id: `faq-${Date.now()}`,
      helpfulCount: 0,
      unhelpfulCount: 0,
      views: 0,
      updatedAt: new Date().toISOString(),
    };
    saveItem(COLLECTIONS.FAQS, created);
  };

  const handleUpdateFAQ = (updatedFaq: FAQItem) => {
    saveItem(COLLECTIONS.FAQS, { ...updatedFaq, updatedAt: new Date().toISOString() });
  };

  const handleDeleteFAQ = (id: string) => {
    deleteItem(COLLECTIONS.FAQS, id);
  };

  const handleSubmitUserQuestion = (data: {
    authorName: string;
    authorEmail: string;
    questionText: string;
    category: string;
  }) => {
    const newQuestion: UserQuestion = {
      id: `uq-${Date.now()}`,
      authorName: data.authorName,
      authorEmail: data.authorEmail,
      questionText: data.questionText,
      category: data.category,
      createdAt: new Date().toISOString(),
      status: 'pending',
    };
    saveItem(COLLECTIONS.USER_QUESTIONS, newQuestion);
    showToast('自訂題目新增成功！', '已同步至雲端雙人猜心題庫。', 'success');
  };

  // Export / Import / Reset
  const handleExportData = () => {
    const jsonStr = JSON.stringify(
      {
        version: CURRENT_APP_VERSION,
        exportDate: new Date().toISOString(),
        faqs,
        categories,
        userQuestions,
      },
      null,
      2
    );
    const blob = new Blob([jsonStr], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `qa_backup_${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
    URL.revokeObjectURL(url);
    showToast('已匯出題目備份檔', 'JSON 檔案已儲存至您的裝置。', 'success');
  };

  const handleImportData = async (jsonStr: string) => {
    try {
      const parsed = JSON.parse(jsonStr);
      let importedItems: FAQItem[] = [];
      if (Array.isArray(parsed)) {
        importedItems = parsed.map((item, idx) => ({
          id: item.id || `faq-imported-${idx}-${Date.now()}`,
          question: item.question,
          answer: item.answer || '對應真心話題目',
          category: item.category || '習性與喜好',
          tags: item.tags || ['匯入題目'],
          options: item.options || [item.answer, '選項 A', '選項 B', '選項 C'],
          updatedAt: new Date().toISOString(),
          helpfulCount: item.helpfulCount || 0,
          unhelpfulCount: item.unhelpfulCount || 0,
        }));
      } else if (parsed.faqs && Array.isArray(parsed.faqs)) {
        importedItems = parsed.faqs;
      }

      if (importedItems.length === 0) {
        throw new Error('未發現有效的題目列表');
      }

      // Merge, never wipe: existing ids are updated, duplicate questions skipped.
      const existingIds = new Set(faqs.map((f) => f.id));
      const existingQuestions = new Set(faqs.map((f) => f.question.trim()));
      const toWrite: FAQItem[] = [];

      for (const item of importedItems) {
        if (!item.question || !item.question.trim()) continue;
        if (existingIds.has(item.id)) {
          const current = faqs.find((f) => f.id === item.id)!;
          toWrite.push({ ...current, ...item, updatedAt: new Date().toISOString() });
        } else if (!existingQuestions.has(item.question.trim())) {
          toWrite.push({ ...item, updatedAt: item.updatedAt || new Date().toISOString() });
          existingQuestions.add(item.question.trim());
        }
      }

      await saveItems(COLLECTIONS.FAQS, toWrite);

      // The seeded sample questions are placeholders — once real content is
      // imported, drop whichever of them are still in the database.
      const importedIds = new Set(toWrite.map((f) => f.id));
      const leftoverSeeds = faqs.filter(
        (f) => SEED_FAQ_IDS.includes(f.id) && !importedIds.has(f.id)
      );

      if (leftoverSeeds.length > 0) {
        await Promise.all(leftoverSeeds.map((f) => deleteItem(COLLECTIONS.FAQS, f.id)));
        showToast(
          '已匯入題目',
          `新增 ${toWrite.length} 題，並移除 ${leftoverSeeds.length} 題預設範例。`,
          'success'
        );
      } else {
        showToast('已匯入題目', `共新增或更新 ${toWrite.length} 題。`, 'success');
      }
    } catch (err: any) {
      console.error('Import parse error:', err);
      throw new Error(err.message || '解析 JSON 題目檔失敗');
    }
  };

  const handleResetData = async () => {
    await Promise.all([
      replaceCollection(COLLECTIONS.FAQS, INITIAL_FAQS),
      replaceCollection(COLLECTIONS.CATEGORIES, INITIAL_CATEGORIES),
      replaceCollection(COLLECTIONS.USER_QUESTIONS, INITIAL_USER_QUESTIONS),
    ]);
    showToast('已還原預設題庫', '雲端題庫已重設為出廠內容。', 'success');
  };

  const pendingQuestionsCount = userQuestions.filter((q) => q.status === 'pending').length;

  return (
    <div className="h-screen h-dvh bg-[#F5E6D3] flex flex-col font-sans text-[#4A3F35] selection:bg-[#E8D8C4] overflow-hidden">
      {/* Top Navigation Header */}
      <Header
        activeTab={activeTab}
        setActiveTab={setActiveTab}
        pendingQuestionsCount={pendingQuestionsCount}
        onOpenAskModal={() => setIsAskModalOpen(true)}
        searchQuery={searchQuery}
        setSearchQuery={setSearchQuery}
      />

      {/* Main Content Area */}
      <main className={`flex-1 min-h-0 max-w-7xl w-full mx-auto px-3 sm:px-6 lg:px-8 py-2 sm:py-3 flex flex-col ${
        activeTab === 'admin_manage' ? 'overflow-y-auto' : 'overflow-hidden'
      }`}>
        {activeTab === 'co_play' && (
          <CoPlayView faqs={faqs} showToast={showToast} />
        )}

        {activeTab === 'admin_manage' && (
          <AdminManageView
            faqs={faqs}
            categories={categories}
            isLoading={isLoadingContent}
            onAddFAQ={handleAddFAQ}
            onUpdateFAQ={handleUpdateFAQ}
            onDeleteFAQ={handleDeleteFAQ}
            onResetData={handleResetData}
            onImportData={handleImportData}
            onExportData={handleExportData}
            showToast={showToast}
          />
        )}
      </main>

      {/* Modern Footer */}
      <footer className="shrink-0 border-t border-[#D9C5B2] bg-[#FAF7F2] py-2 sm:py-2.5 text-center text-xs text-[#7A6C5E]">
        <div className="max-w-7xl mx-auto px-4 flex flex-col sm:flex-row items-center justify-between gap-2">
          <p>© 2026 你問我答 ‧ Natural Tones 溫暖奶茶風</p>
          <div className="flex flex-wrap items-center justify-center gap-4 text-[11px]">
            <button onClick={() => setActiveTab('co_play')} className="hover:text-[#4A3F35] underline font-semibold">
              你問我答
            </button>
            <button onClick={() => setActiveTab('admin_manage')} className="hover:text-[#4A3F35] underline font-semibold">
              後台管理
            </button>
          </div>
        </div>
      </footer>

      {/* Custom Question Modal */}
      <AskQuestionModal
        isOpen={isAskModalOpen}
        onClose={() => setIsAskModalOpen(false)}
        categories={categories}
        onSubmitQuestion={handleSubmitUserQuestion}
      />

      {/* Floating Toast Notification */}
      <ToastContainer toasts={toasts} onDismiss={handleDismissToast} />
    </div>
  );
}
