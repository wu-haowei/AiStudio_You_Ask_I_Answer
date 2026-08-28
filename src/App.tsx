import React, { useEffect, useMemo, useState } from 'react';
import { ActiveTab, Category, FAQItem, ToastMessage, UNFILED_CATEGORY } from './types';
import { checkAndMigrateStorageVersion, CURRENT_APP_VERSION } from './utils/storage';
import {
  claimMembership,
  deleteRoomFaq,
  deleteRoomFaqs,
  ensureSignedIn,
  forgetPlayedFaqIds,
  loadDefaultFaqs,
  loadPlayedData,
  markFaqPlayed,
  setPlayedQuestionText,
  deleteDefaultFaq,
  deleteDefaultFaqs,
  clearPlayedFaqIds,
  replaceRoomFaqs,
  saveDefaultFaq,
  saveDefaultFaqs,
  subscribeToDefaultFaqs,
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
import { OnboardingModal } from './components/OnboardingModal';
import { Header } from './components/Header';
import { CoPlayView } from './components/CoPlayView';
import { AdminManageView } from './components/AdminManageView';
import { ToastContainer } from './components/Toast';
import { importLegacyFaqs, migrateLegacyRoom } from './lib/migration';

const ACTIVE_ROOM_KEY = 'milktea_active_room';
/** Local-device flag — the app-explainer panel auto-shows once per browser, not once per account. */
const ONBOARDING_SEEN_KEY = 'milktea_qa_onboarding_seen_v1';
/** Stable empty set for when the admin screen has nothing to compare against — a fresh Set() every render would be a new prop identity each time. */
const EMPTY_QUESTION_TEXTS = new Set<string>();

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
  /**
   * The library a pair falls back on. It lives in Firestore rather than in the
   * bundle so it can be edited from the admin screen, and it is fetched only
   * when something actually needs it — a pair with a library of its own never
   * pays for it.
   */
  const [defaultFaqs, setDefaultFaqs] = useState<FAQItem[]>([]);
  /** Which library the admin screen is editing. */
  const [libraryTarget, setLibraryTarget] = useState<'room' | 'default'>('room');
  /*
   * Whether the admin screen offers the default library at all.
   *
   * Hidden behind a triple tap on the logo, and not remembered: the default
   * library is shared by every pair, so an accidental edit there is the one
   * mistake that reaches beyond the conversation it was made in. Reloading puts
   * it away again.
   */
  const [canEditDefaults, setCanEditDefaults] = useState(false);
  /** Questions this pair has already answered, for the admin clean-up button. */
  const [playedFaqIds, setPlayedFaqIds] = useState<Set<string>>(new Set());
  /** Trimmed text of every question ever answered — survives the original library entry being deleted. */
  const [playedQuestionTexts, setPlayedQuestionTexts] = useState<Set<string>>(new Set());
  const [isLoadingContent, setIsLoadingContent] = useState(true);

  /** Allowlist state for this device. */
  const [access, setAccess] = useState<'checking' | 'blocked' | 'granted' | 'offline'>('checking');
  const [uid, setUid] = useState('');
  /** Live state reported by the open conversation, including how to start a round. */
  const [roomStatus, setRoomStatus] = useState<{
    onlineCount: number;
    isRoundActive: boolean;
    canInvite: boolean;
    /** Why the challenge button is unavailable, for its tooltip. */
    inviteHint?: string;
    onInvite?: () => void;
  }>({ onlineCount: 0, isRoundActive: false, canInvite: false });
  const [preferences, setPreferences] = useState<UserPreferences>(DEFAULT_PREFERENCES);
  const [isBackgroundModalOpen, setIsBackgroundModalOpen] = useState(false);
  const [isOnboardingOpen, setIsOnboardingOpen] = useState(false);
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

  /**
   * The app-explainer auto-shows once, the first time this browser sees a
   * signed-in user — not tied to the account, since a browser only ever holds
   * one anyway (see SETUP.md). Reachable again afterwards from the player menu
   * or the admin screen's own help button.
   */
  useEffect(() => {
    if (!isSignedIn) return;
    try {
      if (localStorage.getItem(ONBOARDING_SEEN_KEY)) return;
      localStorage.setItem(ONBOARDING_SEEN_KEY, '1');
    } catch {
      // Storage unavailable (private browsing, quota) — show it this once and move on.
    }
    setIsOnboardingOpen(true);
  }, [isSignedIn]);

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

  /*
   * Fetch the default library only when it is about to matter: this pair has
   * nothing of its own, or the admin screen has been switched over to edit it.
   * While the admin screen is on it, a live listener replaces the snapshot so
   * edits appear as they are made.
   */
  const isEditingDefaults = libraryTarget === 'default';
  /*
   * The `activeRoom` test earns its place: on the conversation list there is no
   * room, so roomFaqs is empty and loading has finished — which looks exactly
   * like a pair that needs the defaults, and would fetch them for a screen that
   * never shows a question.
   */
  const needsDefaults = !!activeRoom && roomFaqs.length === 0 && !isLoadingContent;

  useEffect(() => {
    if (!isEditingDefaults) return;
    return subscribeToDefaultFaqs(setDefaultFaqs);
  }, [isEditingDefaults]);

  useEffect(() => {
    if (isEditingDefaults || !needsDefaults) return;
    let cancelled = false;
    loadDefaultFaqs().then((items) => {
      if (!cancelled) setDefaultFaqs(items);
    });
    return () => {
      cancelled = true;
    };
  }, [isEditingDefaults, needsDefaults, activeRoom?.id]);

  /**
   * Questions actually offered. A pair that has never imported anything plays
   * with the default library; once they import, that becomes their own and
   * emptying it is a deliberate, respected choice.
   */
  const faqs = useMemo(
    () => (roomFaqs.length > 0 ? roomFaqs : defaultFaqs),
    [roomFaqs, defaultFaqs]
  );
  const isUsingDefaultFaqs = roomFaqs.length === 0;

  /**
   * What the admin screen shows and writes to, which is not always the library
   * being played with.
   *
   * "Answered" is a fact about a pair, not about a question, so it is withheld
   * entirely while the shared default library is the one on screen — there is
   * no pair for it to be true of.
   */
  const editedFaqs = isEditingDefaults ? defaultFaqs : faqs;

  /**
   * The categories on offer are exactly the ones the questions use — there is
   * no separate list to keep in step. Import a set of questions and its
   * categories arrive with it; a category no question is filed under stops
   * appearing, without anything having to delete it.
   *
   * Built from `editedFaqs` — whichever library the admin screen is actually
   * pointed at — not `faqs` (what this pair plays with). Otherwise switching
   * to "編輯預設題庫" still showed this room's own categories instead of the
   * default library's.
   *
   * Order follows first appearance in the library rather than being sorted, so
   * the picker reads in the order the questions were written.
   */
  const categories: Category[] = useMemo(() => {
    const names: string[] = [];
    for (const faq of editedFaqs) {
      if (faq.category && !names.includes(faq.category)) names.push(faq.category);
    }
    return names.map((name) => ({ id: `cat-${encodeURIComponent(name)}`, name }));
  }, [editedFaqs]);

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

  /**
   * The logo's triple tap.
   *
   * Revealing also opens the admin tab, since the switch it reveals lives
   * there and the gesture is only ever made to reach it. Putting it away steps
   * back off the default library too, so the screen is not left editing
   * something it no longer offers a way back from.
   */
  const handleToggleDefaultLibrary = () => {
    const next = !canEditDefaults;
    setCanEditDefaults(next);

    if (next) setActiveTab('admin_manage');
    else setLibraryTarget('room');

    showToast(
      next ? '預設題庫已解鎖' : '預設題庫已收起',
      next ? '後台管理標題下方多了一個切換' : undefined,
      'info'
    );
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

  /*
   * Every edit below goes to whichever library is being edited. Only the target
   * differs; a question is a question in either collection.
   */
  const handleAddFAQ = (newFaqData: Omit<FAQItem, 'id' | 'updatedAt'>) => {
    const faq: FAQItem = {
      ...newFaqData,
      id: `faq-${Date.now()}`,
      updatedAt: new Date().toISOString(),
    };
    if (isEditingDefaults) saveDefaultFaq(faq);
    else saveRoomFaq(requireRoom(), faq);
  };

  const handleUpdateFAQ = (updatedFaq: FAQItem) => {
    const faq: FAQItem = { ...updatedFaq, updatedAt: new Date().toISOString() };
    if (isEditingDefaults) saveDefaultFaq(faq);
    else saveRoomFaq(requireRoom(), faq);
  };

  const handleDeleteFAQ = (id: string) => {
    if (isEditingDefaults) deleteDefaultFaq(id);
    else deleteRoomFaq(requireRoom(), id);
  };

  const handleDeleteFAQs = (ids: string[]) =>
    isEditingDefaults ? deleteDefaultFaqs(ids) : deleteRoomFaqs(requireRoom(), ids);

  /*
   * The played list lives on the room document, which only the conversation
   * view listens to — and that view is unmounted while the admin tab is open.
   * Reading it once when the tab opens costs a single read and avoids keeping
   * a second listener alive for a number that barely changes.
   */
  useEffect(() => {
    if (!activeRoom || activeTab !== 'admin_manage') return;

    let cancelled = false;
    loadPlayedData(activeRoom.id).then(({ faqIds, questionTexts }) => {
      if (cancelled) return;
      setPlayedFaqIds(new Set(faqIds));
      setPlayedQuestionTexts(new Set(questionTexts));
    });
    return () => {
      cancelled = true;
    };
  }, [activeRoom?.id, activeTab]);

  /**
   * A question counts as answered by id (its library entry was marked
   * played) or by text (this exact wording was answered before under some
   * other entry — including one already deleted). The text match is what
   * lets a re-imported duplicate show as answered on the spot, without
   * having to be marked again.
   */
  const answeredFaqs = useMemo(
    () => faqs.filter((f) => playedFaqIds.has(f.id) || playedQuestionTexts.has(f.question.trim())),
    [faqs, playedFaqIds, playedQuestionTexts]
  );
  /** Same set as answeredFaqs, but as ids — for filtering rather than displaying. */
  const answeredIds = useMemo(() => new Set(answeredFaqs.map((f) => f.id)), [answeredFaqs]);

  /**
   * Clears out everything the pair has already answered.
   *
   * While a pair is still on the built-in set there is nothing in Firestore to
   * delete, so the questions worth keeping are written into their own library
   * first — after which "delete" means the same thing in both cases.
   */
  const handleDeleteAnswered = async () => {
    const roomId = requireRoom();
    if (answeredFaqs.length === 0) return;

    const ids = answeredFaqs.map((f) => f.id);

    if (isUsingDefaultFaqs) {
      await saveRoomFaqs(
        roomId,
        faqs.filter((f) => !answeredIds.has(f.id))
      );
    } else {
      await deleteRoomFaqs(roomId, ids);
    }

    await forgetPlayedFaqIds(roomId, ids);
    setPlayedFaqIds(new Set());
    showToast('已刪除答過的題目', `共 ${ids.length} 題`, 'success');
  };

  /**
   * Marks a question played, or puts it back into circulation.
   *
   * Local state is updated alongside the write because playedFaqIds is fetched
   * once when the admin tab opens rather than being subscribed to — a listener
   * on the room document for something only this screen reads would not pay for
   * itself.
   *
   * Marking answered also records the question's text (see
   * playedQuestionTexts), and that half is one-way: un-marking only frees the
   * id up for the replay filter, it does not make the text forget having been
   * answered. If it genuinely never happened, delete the question instead.
   */
  const handleToggleAnswered = async (faq: FAQItem, answered: boolean) => {
    const roomId = requireRoom();
    try {
      if (answered) await markFaqPlayed(roomId, faq.category, faq.id, faq.question);
      else await forgetPlayedFaqIds(roomId, [faq.id]);

      setPlayedFaqIds((prev) => {
        const next = new Set(prev);
        if (answered) next.add(faq.id);
        else next.delete(faq.id);
        return next;
      });
      if (answered) {
        setPlayedQuestionTexts((prev) => new Set(prev).add(faq.question.trim()));
      }
    } catch (err: any) {
      console.error('Toggle answered failed:', err);
      showToast('標記失敗', err?.message || '請稍後再試', 'error');
    }
  };

  /**
   * Same "已答過" concept, but for a question sitting in the cloud import
   * picker — it has no faqId yet, since it may never be imported, so this
   * writes straight to the text record instead of going through markFaqPlayed.
   * Unlike the library toggle above, this one is fully reversible: the picker
   * is the one place a mark can be undone outright, not just freed up for
   * replay.
   */
  const handleToggleAnsweredText = async (questionText: string, answered: boolean) => {
    const roomId = requireRoom();
    const text = questionText.trim();
    if (!text) return;
    try {
      await setPlayedQuestionText(roomId, text, answered);
      setPlayedQuestionTexts((prev) => {
        const next = new Set(prev);
        if (answered) next.add(text);
        else next.delete(text);
        return next;
      });
    } catch (err: any) {
      console.error('Toggle answered text failed:', err);
      showToast('標記失敗', err?.message || '請稍後再試', 'error');
    }
  };

  /**
   * Puts a batch of questions back into circulation.
   *
   * The one-by-one toggle is fine for a stray question, but a pair who has been
   * through most of the library wants the whole lot back without tapping thirty
   * times. Errors are left to the caller, which reports them in its dialog.
   */
  const handleRestoreAnswered = async (ids: string[]) => {
    const roomId = requireRoom();
    if (ids.length === 0) return;

    await forgetPlayedFaqIds(roomId, ids);
    setPlayedFaqIds((prev) => {
      const next = new Set(prev);
      ids.forEach((id) => next.delete(id));
      return next;
    });
    showToast('已復原', `${ids.length} 題可以再抽到了`, 'success');
  };

  const handleExportData = () => {
    const jsonStr = JSON.stringify(
      {
        version: CURRENT_APP_VERSION,
        exportDate: new Date().toISOString(),
        faqs: editedFaqs,
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
    showToast('已匯出題目備份檔', undefined, 'success');
  };

  /** Shared by the JSON import and the logo shortcut. */
  /**
   * Merges questions into whichever library the admin screen is pointed at.
   *
   * The comparison is against what is actually stored — for a room that means
   * `roomFaqs`, never the defaults it happens to be borrowing, or importing
   * would look like a no-op to a pair who has not imported anything yet.
   */
  const importQuestions = async (incoming: FAQItem[]) => {
    const roomId = isEditingDefaults ? '' : requireRoom();
    const stored = isEditingDefaults ? defaultFaqs : roomFaqs;

    const existingIds = new Set(stored.map((f) => f.id));
    const existingQuestions = new Set(stored.map((f) => f.question.trim()));
    const toWrite: FAQItem[] = [];

    for (const item of incoming) {
      if (!item.question || !item.question.trim()) continue;
      if (existingIds.has(item.id)) {
        const current = stored.find((f) => f.id === item.id)!;
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

    if (isEditingDefaults) await saveDefaultFaqs(toWrite);
    else await saveRoomFaqs(roomId, toWrite);

    showToast(
      '已匯入題目',
      `共新增或更新 ${toWrite.length} 題${isEditingDefaults ? '（預設題庫）' : ''}`,
      'success'
    );
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
            category: item.category || UNFILED_CATEGORY,
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
  /**
   * Resets this pair's library to the default one.
   *
   * A replacement, not a merge: whatever they had is deleted first, so the
   * library afterwards is exactly the default set. The played record goes with
   * it — its ids refer to questions that no longer exist, and nothing else ever
   * removes them.
   *
   * An empty default library aborts before deleting anything. Wiping a real
   * library to replace it with nothing is never what anybody meant.
   */
  const handleImportDefaults = async () => {
    const roomId = requireRoom();

    // Read it fresh rather than trusting a snapshot taken who knows when.
    const defaults = await loadDefaultFaqs();
    setDefaultFaqs(defaults);
    if (defaults.length === 0) {
      showToast('預設題庫是空的', '沒有東西可以還原，這組的題庫原封不動', 'warning');
      return;
    }

    const removed = await replaceRoomFaqs(roomId, defaults);
    await clearPlayedFaqIds(roomId);
    setPlayedFaqIds(new Set());

    showToast(
      '已還原成預設題庫',
      `刪除 ${removed} 題，寫入 ${defaults.length} 題`,
      'success'
    );
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
        challengeHint={roomStatus.inviteHint}
        onOpenBackgroundSettings={() => setIsBackgroundModalOpen(true)}
        onOpenOnboarding={() => setIsOnboardingOpen(true)}
        onToggleDefaultLibrary={handleToggleDefaultLibrary}
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
        ) : (
          <>
            {/*
              * The conversation stays mounted while the admin tab is in front.
              * Unmounting it used to drop the room listener and the heartbeat,
              * so an invitation sent while somebody was editing questions never
              * arrived — and this tab's player row was removed on the way out,
              * which made them look offline to their partner. It hides itself
              * instead; its dialogs are portalled to <body> so they still show.
              */}
            <CoPlayView
              roomId={activeRoom.id}
              partnerName={activeRoom.partner}
              faqs={faqs}
              showToast={showToast}
              onStatusChange={setRoomStatus}
              background={preferences}
              isActive={currentTab === 'co_play'}
            />

            {currentTab === 'admin_manage' && (
              <AdminManageView
                faqs={editedFaqs}
                categories={categories}
                isLoading={isLoadingContent}
                isUsingDefaults={isUsingDefaultFaqs && !isEditingDefaults}
                libraryTarget={libraryTarget}
                onChangeLibraryTarget={setLibraryTarget}
                canEditDefaults={canEditDefaults}
                partnerName={activeRoom.partner}
                answeredFaqs={isEditingDefaults ? [] : answeredFaqs}
                answeredQuestionTexts={isEditingDefaults ? EMPTY_QUESTION_TEXTS : playedQuestionTexts}
                onToggleAnsweredText={isEditingDefaults ? undefined : handleToggleAnsweredText}
                onDeleteAnswered={isEditingDefaults ? undefined : handleDeleteAnswered}
                onToggleAnswered={isEditingDefaults ? undefined : handleToggleAnswered}
                onRestoreAnswered={isEditingDefaults ? undefined : handleRestoreAnswered}
                roomId={activeRoom.id}
                onAddFAQ={handleAddFAQ}
                onUpdateFAQ={handleUpdateFAQ}
                onDeleteFAQ={handleDeleteFAQ}
                onDeleteFAQs={handleDeleteFAQs}
                onImportDefaults={handleImportDefaults}
                onMigrateLegacy={handleMigrateLegacy}
                onImportData={handleImportData}
                onExportData={handleExportData}
                onOpenOnboarding={() => setIsOnboardingOpen(true)}
                showToast={showToast}
              />
            )}
          </>
        )}
      </main>

      <BackgroundSettingsModal
        isOpen={isBackgroundModalOpen}
        onClose={() => setIsBackgroundModalOpen(false)}
        preferences={preferences}
        onSave={handleSavePreferences}
        showToast={showToast}
      />

      <OnboardingModal isOpen={isOnboardingOpen} onClose={() => setIsOnboardingOpen(false)} />

      <ToastContainer toasts={toasts} onDismiss={handleDismissToast} />
    </div>
  );
}
