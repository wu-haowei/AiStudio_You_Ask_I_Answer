import React, { useEffect, useMemo, useState } from 'react';
import { ActiveTab, Category, FAQItem, ToastMessage } from './types';
import { checkAndMigrateStorageVersion, CURRENT_APP_VERSION } from './utils/storage';
import { INITIAL_CATEGORIES, INITIAL_FAQS } from './data/initialData';
import {
  claimMembership,
  deleteRoomFaq,
  deleteRoomFaqs,
  ensureSignedIn,
  isInviteRequired,
  isMember,
  saveRoomFaq,
  saveRoomFaqs,
  subscribeToRoomFaqs,
} from './lib/firebase';
import { endSession, hasValidSession } from './lib/accounts';
import { useIdentity } from './lib/identity';
import { clearPresence } from './lib/pairing';
import {
  DEFAULT_PREFERENCES,
  savePreferences,
  subscribeToPreferences,
  type UserPreferences,
} from './lib/preferences';
import { AccessGate } from './components/AccessGate';
import { LoginView } from './components/LoginView';
import { ConversationListView } from './components/ConversationListView';
import { BackgroundSettingsModal } from './components/BackgroundSettingsModal';
import { Header } from './components/Header';
import { CoPlayView } from './components/CoPlayView';
import { AdminManageView } from './components/AdminManageView';
import { ToastContainer } from './components/Toast';
import { importLegacyFaqs, migrateLegacyRoom } from './lib/migration';

const ACTIVE_ROOM_KEY = 'milktea_active_room';

export default function App() {
  const { name: userName, isSignedIn, signIn, signOut } = useIdentity();
  const [activeTab, setActiveTab] = useState<ActiveTab>('co_play');

  /** Which pair room is open. Empty means the conversation list is showing. */
  const [activeRoom, setActiveRoom] = useState<{ id: string; partner: string } | null>(() => {
    try {
      const raw = sessionStorage.getItem(ACTIVE_ROOM_KEY);
      return raw ? JSON.parse(raw) : null;
    } catch {
      return null;
    }
  });

  const [roomFaqs, setRoomFaqs] = useState<FAQItem[]>([]);
  const [isLoadingContent, setIsLoadingContent] = useState(true);

  /** Allowlist state for this device. */
  const [access, setAccess] = useState<'checking' | 'blocked' | 'granted' | 'offline'>('checking');
  const [uid, setUid] = useState('');
  /** Live state reported by the open conversation, including how to start a round. */
  const [roomStatus, setRoomStatus] = useState<{
    onlineCount: number;
    isRoundActive: boolean;
    canInvite: boolean;
    onInvite?: () => void;
  }>({ onlineCount: 0, isRoundActive: false, canInvite: false });
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

  // Each pair owns its questions; an empty library falls back to the defaults.
  useEffect(() => {
    if (!activeRoom) {
      setRoomFaqs([]);
      setIsLoadingContent(false);
      return;
    }

    setIsLoadingContent(true);
    return subscribeToRoomFaqs(activeRoom.id, (items) => {
      setRoomFaqs([...items].sort((a, b) => (b.updatedAt || '').localeCompare(a.updatedAt || '')));
      setIsLoadingContent(false);
    });
  }, [activeRoom?.id]);

  /**
   * Questions actually offered. A pair that has never imported anything plays
   * with the built-in set; once they import, that becomes their own library and
   * emptying it is a deliberate, respected choice.
   */
  const faqs = useMemo(
    () => (roomFaqs.length > 0 ? roomFaqs : INITIAL_FAQS),
    [roomFaqs]
  );
  const isUsingDefaultFaqs = roomFaqs.length === 0;

  const categories: Category[] = useMemo(() => {
    const names: string[] = Array.from(
      new Set(faqs.map((f) => f.category).filter((c): c is string => !!c))
    );
    const known = new Map<string, Category>(
      INITIAL_CATEGORIES.map((c) => [c.name, c] as const)
    );
    return names.map(
      (name) =>
        known.get(name) || {
          id: `cat-${encodeURIComponent(name)}`,
          name,
          slug: encodeURIComponent(name),
          colorClass: 'badge-milktea' as const,
        }
    );
  }, [faqs]);

  // Display preferences follow the signed-in name, not the device
  useEffect(() => {
    if (!userName) {
      setPreferences(DEFAULT_PREFERENCES);
      return;
    }
    return subscribeToPreferences(userName, setPreferences);
  }, [userName]);

  const handleSavePreferences = async (patch: Partial<UserPreferences>) => {
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

  const openRoom = (id: string, partner: string) => {
    const next = { id, partner };
    setActiveRoom(next);
    sessionStorage.setItem(ACTIVE_ROOM_KEY, JSON.stringify(next));
    setActiveTab('co_play');
  };

  const leaveRoom = () => {
    setActiveRoom(null);
    sessionStorage.removeItem(ACTIVE_ROOM_KEY);
    setActiveTab('co_play');
    // Otherwise the header keeps showing the last room's presence
    setRoomStatus({ onlineCount: 0, isRoundActive: false, canInvite: false });
  };

  const handleSignOut = () => {
    clearPresence(userName);
    endSession();
    leaveRoom();
    signOut();
  };

  /*
   * A remembered name is not proof of anything — the session document is, and
   * it is tied to an anonymous uid that changes whenever site data is cleared.
   * If it no longer matches, send the person back to the password screen rather
   * than into an app where every write would be refused.
   */
  useEffect(() => {
    if (access !== 'granted' || !isSignedIn) return;

    (async () => {
      if (!(await hasValidSession(userName))) {
        leaveRoom();
        signOut();
        showToast('請重新登入', '這台裝置的登入狀態已失效', 'info');
      }
    })();
  }, [access, isSignedIn, userName]);

  /* Question library CRUD — always scoped to the open pair room. */
  const requireRoom = () => {
    if (!activeRoom) throw new Error('請先選擇一個對話');
    return activeRoom.id;
  };

  const handleAddFAQ = (newFaqData: Omit<FAQItem, 'id' | 'updatedAt'>) => {
    saveRoomFaq(requireRoom(), {
      ...newFaqData,
      id: `faq-${Date.now()}`,
      updatedAt: new Date().toISOString(),
    });
  };

  const handleUpdateFAQ = (updatedFaq: FAQItem) => {
    saveRoomFaq(requireRoom(), { ...updatedFaq, updatedAt: new Date().toISOString() });
  };

  const handleDeleteFAQ = (id: string) => {
    deleteRoomFaq(requireRoom(), id);
  };

  const handleDeleteFAQs = (ids: string[]) => deleteRoomFaqs(requireRoom(), ids);

  const handleExportData = () => {
    const jsonStr = JSON.stringify(
      { version: CURRENT_APP_VERSION, exportDate: new Date().toISOString(), faqs, categories },
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
    showToast('已匯出題目備份檔', undefined, 'success');
  };

  /** Shared by the JSON import and the logo shortcut. */
  const importQuestions = async (incoming: FAQItem[]) => {
    const roomId = requireRoom();

    // Merge against what is actually stored, not the fallback defaults
    const existingIds = new Set(roomFaqs.map((f) => f.id));
    const existingQuestions = new Set(roomFaqs.map((f) => f.question.trim()));
    const toWrite: FAQItem[] = [];

    for (const item of incoming) {
      if (!item.question || !item.question.trim()) continue;
      if (existingIds.has(item.id)) {
        const current = roomFaqs.find((f) => f.id === item.id)!;
        toWrite.push({ ...current, ...item, updatedAt: new Date().toISOString() });
      } else if (!existingQuestions.has(item.question.trim())) {
        toWrite.push({ ...item, updatedAt: item.updatedAt || new Date().toISOString() });
        existingQuestions.add(item.question.trim());
      }
    }

    if (toWrite.length === 0) {
      showToast('沒有新題目', '這些題目都已經在題庫裡了', 'info');
      return;
    }

    await saveRoomFaqs(roomId, toWrite);
    showToast('已匯入題目', `共新增或更新 ${toWrite.length} 題`, 'success');
  };

  const handleImportData = async (jsonStr: string) => {
    try {
      const parsed = JSON.parse(jsonStr);
      let importedItems: FAQItem[] = [];

      if (Array.isArray(parsed)) {
        importedItems = parsed.map((item, idx) => {
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

      if (importedItems.length === 0) throw new Error('未發現有效的題目列表');
      await importQuestions(importedItems);
    } catch (err: any) {
      console.error('Import parse error:', err);
      throw new Error(err.message || '解析 JSON 題目檔失敗');
    }
  };

  /**
   * Brings the pre-pairing data across. Copies rather than moves, so a mistake
   * here costs nothing — the old room stays exactly as it was.
   */
  const handleMigrateLegacy = async () => {
    if (!activeRoom) {
      showToast('請先選擇一個對話', undefined, 'warning');
      return;
    }

    try {
      const report = await migrateLegacyRoom(activeRoom.id);
      const faqCount = await importLegacyFaqs(activeRoom.id);
      showToast(
        '舊資料已搬移',
        `對話 ${report.messages} 筆、出題 ${report.rounds} 筆、題目 ${report.faqs + faqCount} 題` +
          `、已玩過 ${report.playedFaqIds} 題`,
        'success'
      );
    } catch (err: any) {
      console.error('Legacy migration failed:', err);
      showToast('搬移失敗', err?.message || '請稍後再試', 'error');
    }
  };

  /** The logo shortcut writes the built-in questions into this pair's library. */
  const handleImportDefaults = async () => {
    if (!activeRoom) {
      showToast('請先選擇一個對話', undefined, 'warning');
      return;
    }
    await importQuestions(INITIAL_FAQS);
  };

  if (access === 'checking') {
    return (
      <div className="h-full bg-[#F5E6D3] flex items-center justify-center text-sm text-[#7A6C5E]">
        連線中…
      </div>
    );
  }

  if (access === 'offline') {
    return (
      <div className="h-full bg-[#F5E6D3] flex flex-col items-center justify-center gap-2 p-6 text-center">
        <p className="text-sm font-bold text-[#4A3F35]">無法連線</p>
        <p className="text-xs text-[#7A6C5E]">請檢查網路後重新整理頁面</p>
      </div>
    );
  }

  if (access === 'blocked') {
    return <AccessGate onSubmit={handleClaimAccess} />;
  }

  if (!isSignedIn) {
    return <LoginView onSignedIn={signIn} />;
  }

  // The admin tab edits a pair's questions, so it needs a room to be open
  const currentTab: ActiveTab = activeRoom ? activeTab : 'co_play';

  return (
    <div
      style={{
        paddingBottom: 'env(safe-area-inset-bottom)',
        paddingLeft: 'env(safe-area-inset-left)',
        paddingRight: 'env(safe-area-inset-right)',
      }}
      className="h-full bg-[#F5E6D3] flex flex-col font-sans text-[#4A3F35] selection:bg-[#E8D8C4] overflow-hidden"
    >
      <Header
        activeTab={currentTab}
        setActiveTab={setActiveTab}
        onlineCount={roomStatus.onlineCount}
        partnerName={activeRoom?.partner}
        onLeaveRoom={activeRoom ? leaveRoom : undefined}
        onStartChallenge={currentTab === 'co_play' ? roomStatus.onInvite : undefined}
        canStartChallenge={roomStatus.canInvite}
        onOpenBackgroundSettings={() => setIsBackgroundModalOpen(true)}
        onImportDefaults={handleImportDefaults}
        onSignOut={handleSignOut}
        showToast={showToast}
      />

      <main
        className={`flex-1 min-h-0 max-w-7xl w-full mx-auto px-2 sm:px-6 lg:px-8 py-2 sm:py-3 flex flex-col ${
          currentTab === 'admin_manage' ? 'overflow-y-auto' : 'overflow-hidden'
        }`}
      >
        {!activeRoom ? (
          <ConversationListView me={userName} onOpenRoom={openRoom} showToast={showToast} />
        ) : currentTab === 'co_play' ? (
          <CoPlayView
            roomId={activeRoom.id}
            partnerName={activeRoom.partner}
            faqs={faqs}
            showToast={showToast}
            onStatusChange={setRoomStatus}
            background={preferences}
          />
        ) : (
          <AdminManageView
            faqs={faqs}
            categories={categories}
            isLoading={isLoadingContent}
            isUsingDefaults={isUsingDefaultFaqs}
            partnerName={activeRoom.partner}
            myName={userName}
            onAddFAQ={handleAddFAQ}
            onUpdateFAQ={handleUpdateFAQ}
            onDeleteFAQ={handleDeleteFAQ}
            onDeleteFAQs={handleDeleteFAQs}
            onImportDefaults={handleImportDefaults}
            onMigrateLegacy={handleMigrateLegacy}
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
