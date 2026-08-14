import React, { useState, useEffect } from 'react';
import { ActiveTab, Category, FAQItem, ToastMessage } from './types';
import { checkAndMigrateStorageVersion, CURRENT_APP_VERSION } from './utils/storage';
import { INITIAL_CATEGORIES, INITIAL_FAQS, SEED_FAQ_IDS } from './data/initialData';
import {
  claimMembership,
  COLLECTIONS,
  deleteItem,
  deleteItems,
  ensureSignedIn,
  isInviteRequired,
  isMember,
  replaceCollection,
  saveItem,
  saveItems,
  seedCollectionIfEmpty,
  subscribeToCategories,
  subscribeToFAQs,
} from './lib/firebase';
import { useIdentity } from './lib/identity';
import {
  DEFAULT_PREFERENCES,
  savePreferences,
  subscribeToPreferences,
  type UserPreferences,
} from './lib/preferences';
import { AccessGate } from './components/AccessGate';
import { BackgroundSettingsModal } from './components/BackgroundSettingsModal';
import { Header } from './components/Header';
import { CoPlayView } from './components/CoPlayView';
import { AdminManageView } from './components/AdminManageView';
import { ToastContainer } from './components/Toast';

export default function App() {
  const { name: userName, isSignedIn } = useIdentity();
  const [activeTab, setActiveTab] = useState<ActiveTab>('co_play');
  const [faqs, setFaqs] = useState<FAQItem[]>([]);
  const [categories, setCategories] = useState<Category[]>([]);
  const [isLoadingContent, setIsLoadingContent] = useState(true);
  /** Allowlist state for this device. */
  const [access, setAccess] = useState<'checking' | 'blocked' | 'granted' | 'offline'>('checking');
  const [uid, setUid] = useState('');
  const [roomStatus, setRoomStatus] = useState({ onlineCount: 0, isRoundActive: false });
  const [preferences, setPreferences] = useState<UserPreferences>(DEFAULT_PREFERENCES);
  const [isBackgroundModalOpen, setIsBackgroundModalOpen] = useState(false);
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

  /*
   * Access check. The invite gate is a switch stored in Firestore
   * (config/access.requireInvite) so it can be turned on later without a
   * redeploy. While it is off, nobody signs in and nobody is asked for a code.
   */
  useEffect(() => {
    const wasUpdated = checkAndMigrateStorageVersion();
    if (wasUpdated) {
      showToast(`已自動升級至最新版本 (v${CURRENT_APP_VERSION})`, undefined, 'info');
    }

    (async () => {
      try {
        if (!(await isInviteRequired())) {
          setAccess('granted');
          return;
        }

        const user = await ensureSignedIn();
        setUid(user.uid);
        setAccess((await isMember(user.uid)) ? 'granted' : 'blocked');
      } catch (err) {
        console.error('Access check failed:', err);
        setAccess('offline');
      }
    })();
  }, []);

  // Once allowed in: seed defaults on a fresh database, then live-subscribe.
  useEffect(() => {
    if (access !== 'granted') return;

    let unsubscribers: Array<() => void> = [];

    (async () => {
      await Promise.all([
        seedCollectionIfEmpty(COLLECTIONS.FAQS, INITIAL_FAQS),
        seedCollectionIfEmpty(COLLECTIONS.CATEGORIES, INITIAL_CATEGORIES),
      ]);

      unsubscribers = [
        subscribeToFAQs((items) => {
          setFaqs([...items].sort((a, b) => (b.updatedAt || '').localeCompare(a.updatedAt || '')));
          setIsLoadingContent(false);
        }),
        subscribeToCategories(setCategories),
      ];
    })();

    return () => unsubscribers.forEach((fn) => fn());
  }, [access]);

  // Display preferences follow the signed-in name, not the device
  useEffect(() => {
    if (!userName) {
      setPreferences(DEFAULT_PREFERENCES);
      return;
    }
    return subscribeToPreferences(userName, setPreferences);
  }, [userName]);

  const handleSavePreferences = async (patch: Partial<UserPreferences>) => {
    // Optimistic so the preview reacts immediately
    setPreferences((prev) => ({ ...prev, ...patch }));
    try {
      await savePreferences(userName, patch);
    } catch {
      showToast('設定儲存失敗', '請檢查網路連線', 'error');
    }
  };

  const handleClaimAccess = async (code: string) => {
    const ok = await claimMembership(uid, code);
    if (ok) setAccess('granted');
    return ok;
  };

  // FAQ CRUD — writes go straight to Firestore; the subscription updates local state.
  const handleAddFAQ = (newFaqData: Omit<FAQItem, 'id' | 'updatedAt'>) => {
    saveItem(COLLECTIONS.FAQS, {
      ...newFaqData,
      id: `faq-${Date.now()}`,
      updatedAt: new Date().toISOString(),
    });
  };

  const handleUpdateFAQ = (updatedFaq: FAQItem) => {
    saveItem(COLLECTIONS.FAQS, { ...updatedFaq, updatedAt: new Date().toISOString() });
  };

  const handleDeleteFAQ = (id: string) => {
    deleteItem(COLLECTIONS.FAQS, id);
  };

  const handleDeleteFAQs = (ids: string[]) => deleteItems(COLLECTIONS.FAQS, ids);

  // Export / Import / Reset
  const handleExportData = () => {
    const jsonStr = JSON.stringify(
      {
        version: CURRENT_APP_VERSION,
        exportDate: new Date().toISOString(),
        faqs,
        categories,
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
        importedItems = parsed.map((item, idx) => {
          // Options are free-length; keep whatever the file provides, or none.
          const options = Array.isArray(item.options)
            ? item.options.map((o: unknown) => String(o).trim()).filter(Boolean)
            : [];

          return {
            id: item.id || `faq-imported-${idx}-${Date.now()}`,
            question: item.question,
            answer: item.answer || '對應真心話題目',
            category: item.category || '習性與喜好',
            options: options.length > 0 ? options : undefined,
            updatedAt: new Date().toISOString(),
          };
        });
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
    ]);
    showToast('已還原預設題庫', '雲端題庫已重設為出廠內容。', 'success');
  };

  if (access === 'checking') {
    return (
      <div className="h-screen h-dvh bg-[#F5E6D3] flex items-center justify-center text-sm text-[#7A6C5E]">
        連線中…
      </div>
    );
  }

  if (access === 'offline') {
    return (
      <div className="h-screen h-dvh bg-[#F5E6D3] flex flex-col items-center justify-center gap-2 p-6 text-center">
        <p className="text-sm font-bold text-[#4A3F35]">無法連線</p>
        <p className="text-xs text-[#7A6C5E]">請檢查網路後重新整理頁面</p>
      </div>
    );
  }

  if (access === 'blocked') {
    return <AccessGate onSubmit={handleClaimAccess} />;
  }

  // Keep a visitor who has not chosen a name out of the admin tab
  const currentTab: ActiveTab = isSignedIn ? activeTab : 'co_play';

  return (
    <div className="h-screen h-dvh bg-[#F5E6D3] flex flex-col font-sans text-[#4A3F35] selection:bg-[#E8D8C4] overflow-hidden">
      <Header
        activeTab={currentTab}
        setActiveTab={setActiveTab}
        onlineCount={roomStatus.onlineCount}
        isRoundActive={roomStatus.isRoundActive}
        onOpenBackgroundSettings={() => setIsBackgroundModalOpen(true)}
        showToast={showToast}
      />

      <main
        className={`flex-1 min-h-0 max-w-7xl w-full mx-auto px-2 sm:px-6 lg:px-8 py-2 sm:py-3 flex flex-col ${
          currentTab === 'admin_manage' ? 'overflow-y-auto' : 'overflow-hidden'
        }`}
      >
        {currentTab === 'co_play' && (
          <CoPlayView
            faqs={faqs}
            showToast={showToast}
            onStatusChange={setRoomStatus}
            background={preferences}
          />
        )}

        {currentTab === 'admin_manage' && (
          <AdminManageView
            faqs={faqs}
            categories={categories}
            isLoading={isLoadingContent}
            onAddFAQ={handleAddFAQ}
            onUpdateFAQ={handleUpdateFAQ}
            onDeleteFAQ={handleDeleteFAQ}
            onDeleteFAQs={handleDeleteFAQs}
            onResetData={handleResetData}
            onImportData={handleImportData}
            onExportData={handleExportData}
            showToast={showToast}
          />
        )}
      </main>

      <BackgroundSettingsModal
        isOpen={isBackgroundModalOpen}
        onClose={() => setIsBackgroundModalOpen(false)}
        preferences={preferences}
        onSave={handleSavePreferences}
        showToast={showToast}
      />

      <ToastContainer toasts={toasts} onDismiss={handleDismissToast} />
    </div>
  );
}
