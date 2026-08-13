import React, { useState, useEffect } from 'react';
import { ActiveTab, Category, FAQItem, ToastMessage, UserQuestion } from './types';
import {
  exportDataAsJSON,
  getStoredCategories,
  getStoredFAQs,
  getStoredUserQuestions,
  getVotedFAQIds,
  resetToDefaults,
  saveStoredCategories,
  saveStoredFAQs,
  saveStoredUserQuestions,
  saveVotedFAQId,
  getStoredNotionConfig,
  HARDCODED_NOTION_QUESTION_DB_ID,
} from './utils/storage';
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
  const [votedStatus, setVotedStatus] = useState<Record<string, 'helpful' | 'unhelpful'>>({});
  const [searchQuery, setSearchQuery] = useState('');
  const [isAskModalOpen, setIsAskModalOpen] = useState(false);
  const [toasts, setToasts] = useState<ToastMessage[]>([]);

  // Initialize data on mount
  useEffect(() => {
    setFaqs(getStoredFAQs());
    setCategories(getStoredCategories());
    setUserQuestions(getStoredUserQuestions());
    setVotedStatus(getVotedFAQIds());
  }, []);

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

  // Helper to auto sync question to Notion
  const syncQuestionToNotion = (item: {
    question: string;
    answer: string;
    category?: string;
    tags?: string[];
    options?: string[];
  }) => {
    try {
      const config = getStoredNotionConfig();
      if (config.token) {
        fetch('/api/notion/sync-question', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            token: config.token,
            databaseId: config.questionDatabaseId || HARDCODED_NOTION_QUESTION_DB_ID,
            question: item.question,
            answer: item.answer,
            category: item.category,
            tags: item.tags,
            options: item.options,
          }),
        }).catch((err) => console.error('Auto sync to Notion question DB failed:', err));
      }
    } catch (e) {
      console.warn('Sync question exception:', e);
    }
  };

  // FAQ CRUD handlers
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
    const updatedList = [created, ...faqs];
    setFaqs(updatedList);
    saveStoredFAQs(updatedList);

    // Auto sync new question to Notion Question DB
    syncQuestionToNotion(created);
  };

  const handleUpdateFAQ = (updatedFaq: FAQItem) => {
    const updatedList = faqs.map((f) => (f.id === updatedFaq.id ? updatedFaq : f));
    setFaqs(updatedList);
    saveStoredFAQs(updatedList);

    // Sync updated question to Notion without deleting old history
    syncQuestionToNotion(updatedFaq);
  };

  const handleDeleteFAQ = (id: string) => {
    const updatedList = faqs.filter((f) => f.id !== id);
    setFaqs(updatedList);
    saveStoredFAQs(updatedList);
  };

  // User Question Submission
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

    const updatedList = [newQuestion, ...userQuestions];
    setUserQuestions(updatedList);
    saveStoredUserQuestions(updatedList);
    showToast('自訂題目新增成功！', '已成功匯入雙人猜心連線題庫。', 'success');
  };

  // Export / Import / Reset
  const handleExportData = () => {
    const jsonStr = exportDataAsJSON();
    const blob = new Blob([jsonStr], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `qa_backup_${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
    URL.revokeObjectURL(url);
    showToast('已匯出題目備份檔', 'JSON 檔案已儲存至您的裝置。', 'success');
  };

  const handleImportData = (jsonStr: string) => {
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

      // Preserve historical FAQs! Merge imported items without deleting history
      const existingIds = new Set(faqs.map((f) => f.id));
      const existingQuestions = new Set(faqs.map((f) => f.question.trim()));

      const finalFaqs = [...faqs];
      for (const item of importedItems) {
        if (!item.question || !item.question.trim()) continue;

        if (existingIds.has(item.id)) {
          const idx = finalFaqs.findIndex((f) => f.id === item.id);
          if (idx !== -1) {
            finalFaqs[idx] = { ...finalFaqs[idx], ...item };
          }
        } else if (!existingQuestions.has(item.question.trim())) {
          finalFaqs.push(item);
          existingQuestions.add(item.question.trim());
        }

        // Auto sync imported item to Notion Question DB
        syncQuestionToNotion(item);
      }

      setFaqs(finalFaqs);
      saveStoredFAQs(finalFaqs);
    } catch (err: any) {
      console.error('Import parse error:', err);
      throw new Error(err.message || '解析 JSON 題目檔失敗');
    }
  };

  const handleResetData = () => {
    const restored = resetToDefaults();
    setFaqs(restored.faqs);
    setCategories(restored.categories);
    setUserQuestions(restored.userQuestions);
    setVotedStatus({});
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
        {(activeTab === 'co_play' || activeTab === 'co_play_notion') && (
          <CoPlayView faqs={faqs} showToast={showToast} />
        )}

        {activeTab === 'admin_manage' && (
          <AdminManageView
            faqs={faqs}
            categories={categories}
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
              後台管理與 Notion 設定
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
