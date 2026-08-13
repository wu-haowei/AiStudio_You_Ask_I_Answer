import React, { useState, useEffect, useRef } from 'react';
import {
  Send,
  Sparkles,
  MessageSquare,
  PlusCircle,
  UserCheck,
  RefreshCw,
  Clock,
  Target,
  ArrowDown,
  Award,
  Edit3,
} from 'lucide-react';
import { CoPlayRoom, FAQItem, RoomMessage, RoomQuestion } from '../types';
import {
  appendMessage,
  ensureRoom,
  setActiveGameQuestion,
  setGameInvitation,
  prunePlayers,
  submitGameAnswer,
  subscribeToMessages,
  subscribeToRoom,
  touchPlayer,
  upsertPlayer,
} from '../lib/firebase';
import { CoPlayPasscodeModal } from './coplay/CoPlayPasscodeModal';
import { CoPlayInviteModals } from './coplay/CoPlayInviteModals';
import { CoPlayActiveQuestionModal } from './coplay/CoPlayActiveQuestionModal';

interface CoPlayViewProps {
  faqs: FAQItem[];
  showToast: (title: string, description?: string, type?: 'success' | 'info' | 'warning' | 'error') => void;
}

const PASSCODE_STORAGE_KEY = 'milktea_coplay_passcode';
const SESSION_PASSCODE_KEY = 'milktea_coplay_session_passcode';
const TAB_SESSION_ID_KEY = 'milktea_coplay_tab_id';

/** The single shared Firestore room for this two-player app. */
const ROOM_CODE = 'DUAL-1105-1115';

/** Author label used for reveal report cards in the message stream. */
const REVEAL_AUTHOR = '揭曉結果';

/** Presence heartbeat interval; a player counts as online for 30s after lastActive. */
const HEARTBEAT_MS = 12000;

/** Builds a message with both the display label and the Firestore ordering key. */
const buildMessage = (
  partial: Omit<RoomMessage, 'timestamp' | 'createdAt'>
): RoomMessage => {
  const now = new Date();
  return {
    ...partial,
    timestamp: now.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
    createdAt: now.toISOString(),
  };
};

export const CoPlayView: React.FC<CoPlayViewProps> = ({ faqs, showToast }) => {
  // Helper to load saved display name for a passcode
  const getSavedNameForPasscode = (code: string) => {
    if (!code) return '';
    return localStorage.getItem(`milktea_username_${code}`) || `人員 ${code}`;
  };

  // Tab Unique Session ID to distinguish tabs/devices
  const [tabSessionId] = useState<string>(() => {
    let id = sessionStorage.getItem(TAB_SESSION_ID_KEY);
    if (!id) {
      id = `tab-${Date.now()}-${Math.random().toString(36).substring(2, 6)}`;
      sessionStorage.setItem(TAB_SESSION_ID_KEY, id);
    }
    return id;
  });

  // Passcode Auth State - Check sessionStorage first for per-tab identity
  const [passcode, setPasscode] = useState<string>(
    () => sessionStorage.getItem(SESSION_PASSCODE_KEY) || localStorage.getItem(PASSCODE_STORAGE_KEY) || '1105'
  );
  const [isAuthLoading, setIsAuthLoading] = useState(false);

  // User Name State for current passcode
  const [displayName, setDisplayName] = useState<string>(() =>
    getSavedNameForPasscode(passcode)
  );

  // Renaming inline state
  const [isEditingName, setIsEditingName] = useState(false);
  const [nameInput, setNameInput] = useState('');

  // Login passcode input for logged-out view
  const [loginCodeInput, setLoginCodeInput] = useState('1105');

  // Room State (room document + messages subcollection are tracked separately)
  const [currentRoom, setCurrentRoom] = useState<CoPlayRoom | null>(null);
  const [messages, setMessages] = useState<RoomMessage[]>([]);
  const [isLoadingHistory, setIsLoadingHistory] = useState(true);
  const [myPlayerId, setMyPlayerId] = useState<string>('');

  // Dialogue & Chat Input State
  const [chatMessageText, setChatMessageText] = useState('');

  // Game Creator Modal Form
  const [isQuestionModalOpen, setIsQuestionModalOpen] = useState(false);
  const [isQuestionModalDismissed, setIsQuestionModalDismissed] = useState(false);
  const [isAnswerModalDismissed, setIsAnswerModalDismissed] = useState(false);
  const [questionText, setQuestionText] = useState('');
  const [questionCategory, setQuestionCategory] = useState('習性與喜好');
  const [customCategoryInput, setCustomCategoryInput] = useState('');
  const [optA, setOptA] = useState('在家休息追劇');
  const [optB, setOptB] = useState('約朋友出門喝咖啡');
  const [optC, setOptC] = useState('戶外運動大自然');
  const [optD, setOptD] = useState('打電競遊戲一整天');
  const [isEditingPreset, setIsEditingPreset] = useState(false);

  // Option selection & explanation for active game question
  const [selectedOptIndex, setSelectedOptIndex] = useState<number | null>(null);
  const [answerExplanation, setAnswerExplanation] = useState('');
  const [isSubmittingOpt, setIsSubmittingOpt] = useState(false);

  // Scroll & New Messages Pill State
  const [hasNewMessages, setHasNewMessages] = useState(false);
  const isInitialLoadRef = useRef(true);
  const prevMsgCountRef = useRef<number>(0);
  const messagesEndRef = useRef<HTMLDivElement>(null);

  // Toast notification tracking
  const prevInviteIdRef = useRef<string | null>(null);
  const prevInviteAcceptedRef = useRef<string | null>(null);
  const prevQuestionIdRef = useRef<string | null>(null);

  // Keep currentRoomRef in sync to avoid effect dependency re-subscribe loops
  const currentRoomRef = useRef<CoPlayRoom | null>(currentRoom);
  useEffect(() => {
    currentRoomRef.current = currentRoom;
  }, [currentRoom]);

  // Scroll to bottom helper
  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
    setHasNewMessages(false);
  };

  // Sync displayName when passcode changes
  useEffect(() => {
    if (passcode) {
      const saved = getSavedNameForPasscode(passcode);
      setDisplayName(saved);
    }
  }, [passcode]);

  // Auto load room directly on mount if passcode exists
  useEffect(() => {
    if (passcode) {
      handleLoginWithPasscode(passcode, true);
    }
  }, []);

  // Issue 1: Handle new messages notification pill instead of forcing auto-scroll
  useEffect(() => {
    if (!messages) return;
    const currentCount = messages.length;

    if (isInitialLoadRef.current) {
      if (currentCount > 0) {
        scrollToBottom();
        isInitialLoadRef.current = false;
        prevMsgCountRef.current = currentCount;
      }
      return;
    }

    if (currentCount > prevMsgCountRef.current) {
      const lastMsg = messages[messages.length - 1];
      if (lastMsg && (lastMsg.author === passcode || lastMsg.author === displayName)) {
        // User's own message -> scroll to bottom directly
        scrollToBottom();
      } else {
        // Message from partner or system broadcast -> show notification pill button
        setHasNewMessages(true);
      }
      prevMsgCountRef.current = currentCount;
    }
  }, [messages]);

  // Toast alert when new invitation or question arrives via polling
  useEffect(() => {
    if (!currentRoom) return;

    // Invitation alert for target
    const invite = currentRoom.gameInvitation;
    if (invite && invite.status === 'pending' && invite.sender !== passcode) {
      if (prevInviteIdRef.current !== invite.id) {
        prevInviteIdRef.current = invite.id;
        showToast('收到考驗邀請', `來自 ${getNameByPasscode(invite.sender)}`, 'info');
      }
    }

    // Invitation accepted alert for initiator (sender)
    if (invite && invite.status === 'accepted' && invite.sender === passcode) {
      if (prevInviteAcceptedRef.current !== invite.id) {
        prevInviteAcceptedRef.current = invite.id;
        setIsQuestionModalDismissed(false);
        showToast('對方已接受挑戰', '請設定考驗題目', 'success');
      }
    }

    // Question alert
    const activeQ = currentRoom.activeGameQuestion;
    if (activeQ && activeQ.targetAnswer === undefined && passcode !== activeQ.initiator) {
      if (prevQuestionIdRef.current !== activeQ.id) {
        prevQuestionIdRef.current = activeQ.id;
        setIsAnswerModalDismissed(false);
        setSelectedOptIndex(null);
        setAnswerExplanation('');
        showToast('收到考驗題目', `來自 ${getNameByPasscode(activeQ.initiator)}`, 'info');
      }
    }
  }, [currentRoom, passcode]);

  // Auto reset modal dismiss states when invite or question ID changes
  useEffect(() => {
    if (currentRoom?.gameInvitation?.id) {
      setIsQuestionModalDismissed(false);
    }
  }, [currentRoom?.gameInvitation?.id]);

  useEffect(() => {
    if (currentRoom?.activeGameQuestion?.id) {
      setIsAnswerModalDismissed(false);
      setSelectedOptIndex(null);
      setAnswerExplanation('');
    }
  }, [currentRoom?.activeGameQuestion?.id]);

  /**
   * Firestore listeners. The room document carries live game state; the messages
   * subcollection carries chat history. The first messages snapshot delivers the
   * stored history, so entering the room restores every past conversation.
   */
  useEffect(() => {
    const roomCode = currentRoom?.code;
    if (!roomCode || !passcode) return;

    const unsubscribeRoom = subscribeToRoom(roomCode, (updatedRoom) => {
      currentRoomRef.current = updatedRoom;
      setCurrentRoom(updatedRoom);
    });

    const unsubscribeMessages = subscribeToMessages(roomCode, (history) => {
      setMessages(history);
      setIsLoadingHistory(false);
    });

    // Presence heartbeat so the online indicator stays accurate
    const heartbeat = setInterval(() => {
      if (myPlayerId) touchPlayer(roomCode, myPlayerId);
    }, HEARTBEAT_MS);

    return () => {
      clearInterval(heartbeat);
      unsubscribeRoom();
      unsubscribeMessages();
    };
  }, [currentRoom?.code, myPlayerId, passcode]);

  // Handle Saving Renamed Name
  const handleSaveName = (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    const clean = nameInput.trim();
    if (!clean) {
      showToast('請輸入名稱', undefined, 'warning');
      return;
    }
    setDisplayName(clean);
    localStorage.setItem(`milktea_username_${passcode}`, clean);
    setIsEditingName(false);
    showToast('名稱已更新', `${clean}`, 'success');
  };

  // Handle Logout
  const handleLogout = () => {
    setPasscode('');
    sessionStorage.removeItem(SESSION_PASSCODE_KEY);
    localStorage.removeItem(PASSCODE_STORAGE_KEY);
    setCurrentRoom(null);
    setMessages([]);
    showToast('已登出', undefined, 'info');
  };

  // Login / Switch Identity
  const handleLoginWithPasscode = async (codeToUse: string, silent = false) => {
    const cleanCode = codeToUse.trim();
    if (!cleanCode) {
      if (!silent) showToast('請輸入暗號', undefined, 'warning');
      return;
    }

    setIsAuthLoading(true);
    try {
      // Drop tab sessions that stopped sending heartbeats long ago
      await prunePlayers(ROOM_CODE);

      const room = await ensureRoom(ROOM_CODE, cleanCode);
      const thisPlayerId = `p-${cleanCode}-${tabSessionId}`;

      // Multi-tab co-play auto detection: if 1105 is already live elsewhere, become 1115.
      const isSessionExplicit = !!sessionStorage.getItem(SESSION_PASSCODE_KEY);
      if (!isSessionExplicit && cleanCode === '1105') {
        const otherActive1105 = room.players.find(
          (p) =>
            p.name === '1105' &&
            p.id !== thisPlayerId &&
            p.lastActive &&
            Date.now() - new Date(p.lastActive).getTime() < 30000
        );
        if (otherActive1105) {
          showToast('已自動切換為 1115', '1105 已在其他視窗連線中', 'info');
          setIsAuthLoading(false);
          return handleLoginWithPasscode('1115', silent);
        }
      }

      const existing = room.players.find((p) => p.id === thisPlayerId);
      await upsertPlayer(ROOM_CODE, {
        id: thisPlayerId,
        name: cleanCode,
        score: existing?.score ?? 0,
        isHost: existing?.isHost ?? cleanCode === '1105',
        lastActive: new Date().toISOString(),
      });

      setPasscode(cleanCode);
      sessionStorage.setItem(SESSION_PASSCODE_KEY, cleanCode);
      localStorage.setItem(PASSCODE_STORAGE_KEY, cleanCode);
      setCurrentRoom(room);
      setMyPlayerId(thisPlayerId);

      const loadedName = getSavedNameForPasscode(cleanCode);
      setDisplayName(loadedName);

      if (!silent) {
        showToast('已連線', `${loadedName} (${cleanCode})`, 'success');
      }
    } catch (err: any) {
      console.error('Failed to enter room:', err);
      if (!silent) showToast('連線失敗', err?.message || '請檢查網路連線', 'error');
    } finally {
      setIsAuthLoading(false);
    }
  };

  // Helper name resolvers
  const getNameByPasscode = (code: string) => {
    if (!code) return '';
    if (code === passcode && displayName) return displayName;
    return getSavedNameForPasscode(code);
  };

  const partnerPlayer = currentRoom?.players.find((p) => p.name !== passcode && p.id !== myPlayerId);
  const partnerPasscode = partnerPlayer ? partnerPlayer.name : (passcode === '1105' ? '1115' : '1105');
  const partnerDisplayName = partnerPlayer
    ? (getNameByPasscode(partnerPlayer.name) || partnerPlayer.name)
    : (getSavedNameForPasscode(partnerPasscode) || partnerPasscode);

  // Send Chat Message
  const handleSendChatMessage = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!currentRoom || !chatMessageText.trim()) return;

    const text = chatMessageText.trim();
    setChatMessageText('');

    try {
      await appendMessage(
        currentRoom.code,
        buildMessage({
          id: `msg-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
          author: displayName || passcode,
          text,
          type: 'chat',
        })
      );
      scrollToBottom();
    } catch (err: any) {
      setChatMessageText(text);
      showToast('發送失敗', err?.message || '請稍後再試', 'error');
    }
  };

  // Initiate Game Challenge
  const handleSendGameInvite = async () => {
    if (!currentRoom) return;
    setIsQuestionModalDismissed(false);
    setIsQuestionModalOpen(false);

    try {
      // Clear any leftover question from the previous round before inviting again
      await setActiveGameQuestion(currentRoom.code, null);
      await setGameInvitation(currentRoom.code, {
        id: `inv-${Date.now()}`,
        sender: passcode,
        target: partnerPasscode,
        status: 'pending',
        createdAt: new Date().toISOString(),
      });
      await appendMessage(
        currentRoom.code,
        buildMessage({
          id: `msg-inv-${Date.now()}`,
          author: '系統',
          text: `${getNameByPasscode(passcode)} 向 ${partnerDisplayName} 發起考驗，等待回應…`,
          type: 'invite',
        })
      );
      showToast('已發出邀請', `等待 ${partnerDisplayName} 回應`, 'info');
    } catch (err: any) {
      showToast('邀請失敗', err?.message || '請稍後再試', 'error');
    }
  };

  // Respond to Game Invite (Accept / Decline)
  const handleRespondInvite = async (accept: boolean) => {
    if (!currentRoom?.gameInvitation) return;

    try {
      await setGameInvitation(currentRoom.code, {
        ...currentRoom.gameInvitation,
        status: accept ? 'accepted' : 'declined',
      });
      await appendMessage(
        currentRoom.code,
        buildMessage({
          id: `msg-res-${Date.now()}`,
          author: '系統',
          text: accept
            ? `${getNameByPasscode(passcode)} 接受了考驗，等待出題。`
            : `${getNameByPasscode(passcode)} 婉拒了這次考驗。`,
          type: 'system',
        })
      );

      if (accept) {
        setIsAnswerModalDismissed(false);
        setIsQuestionModalDismissed(false);
        setSelectedOptIndex(null);
        setAnswerExplanation('');
        showToast('已接受挑戰', `等待 ${partnerDisplayName} 出題`, 'success');
      } else {
        showToast('已婉拒挑戰', undefined, 'info');
      }
    } catch (err: any) {
      showToast('回應失敗', err?.message || '請稍後再試', 'error');
    }
  };

  // Cancel Game Invitation
  const handleCancelInvite = async () => {
    if (!currentRoom) return;
    try {
      await setGameInvitation(currentRoom.code, null);
      await appendMessage(
        currentRoom.code,
        buildMessage({
          id: `msg-cancel-${Date.now()}`,
          author: '系統',
          text: `${getNameByPasscode(passcode)} 取消了邀請。`,
          type: 'system',
        })
      );
      showToast('已取消邀請', undefined, 'info');
    } catch (err: any) {
      showToast('取消失敗', err?.message || '請稍後再試', 'error');
    }
  };

  // Cancel Active Game Question
  const handleCancelActiveQuestion = async () => {
    if (!currentRoom) return;
    try {
      await setActiveGameQuestion(currentRoom.code, null);
      await appendMessage(
        currentRoom.code,
        buildMessage({
          id: `msg-cancel-q-${Date.now()}`,
          author: '系統',
          text: `${getNameByPasscode(passcode)} 取消了這題。`,
          type: 'system',
        })
      );
      setIsAnswerModalDismissed(false);
      showToast('已取消題目', undefined, 'info');
    } catch (err: any) {
      showToast('取消失敗', err?.message || '請稍後再試', 'error');
    }
  };

  // Helper to randomize a question given a category
  const randomizeQuestionForCategory = (cat: string) => {
    let pool = faqs;
    if (cat && cat !== 'CUSTOM') {
      const match = faqs.filter((f) => f.category === cat);
      if (match.length > 0) pool = match;
    }
    if (pool.length === 0) return;

    const randomFaq = pool[Math.floor(Math.random() * pool.length)];
    setQuestionText(randomFaq.question);
    if (randomFaq.category) setQuestionCategory(randomFaq.category);
    if (randomFaq.options && randomFaq.options.length >= 4) {
      setOptA(randomFaq.options[0]);
      setOptB(randomFaq.options[1]);
      setOptC(randomFaq.options[2]);
      setOptD(randomFaq.options[3]);
    }
  };

  const handleCategoryChange = (cat: string) => {
    setQuestionCategory(cat);
    setIsEditingPreset(false);
    if (cat === 'CUSTOM') {
      setQuestionText('');
      setOptA('');
      setOptB('');
      setOptC('');
      setOptD('');
    } else {
      randomizeQuestionForCategory(cat);
    }
  };

  const handleSelectPresetFAQ = (f: FAQItem) => {
    setQuestionText(f.question);
    if (f.category) setQuestionCategory(f.category);
    if (f.options && f.options.length >= 4) {
      setOptA(f.options[0]);
      setOptB(f.options[1]);
      setOptC(f.options[2]);
      setOptD(f.options[3]);
    }
    showToast('已套用題目', f.question, 'info');
  };

  // Randomize Question by Category using imported FAQ data
  const handleRandomizeQuestionByCategory = () => {
    const activeCat = questionCategory === 'CUSTOM' ? customCategoryInput.trim() : questionCategory;
    let pool = faqs;
    if (activeCat && activeCat !== 'CUSTOM' && activeCat !== '') {
      const match = faqs.filter((f) => f.category === activeCat);
      if (match.length > 0) pool = match;
    }
    if (pool.length === 0) pool = faqs;
    if (pool.length === 0) {
      showToast('題庫沒有題目', undefined, 'warning');
      return;
    }

    const randomFaq = pool[Math.floor(Math.random() * pool.length)];
    setQuestionText(randomFaq.question);
    if (randomFaq.category) {
      setQuestionCategory(randomFaq.category);
    }
    if (randomFaq.options && randomFaq.options.length >= 4) {
      setOptA(randomFaq.options[0]);
      setOptB(randomFaq.options[1]);
      setOptC(randomFaq.options[2]);
      setOptD(randomFaq.options[3]);
    }
    showToast('已換題', randomFaq.category || '自訂題庫', 'success');
  };

  // Submit Chosen Question & Options
  const handlePublishGameQuestion = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!currentRoom || !questionText.trim()) {
      showToast('請輸入題目', undefined, 'warning');
      return;
    }

    const finalCategory =
      questionCategory === 'CUSTOM' ? customCategoryInput.trim() || '自訂種類' : questionCategory;
    const options = [optA, optB, optC, optD].filter((o) => o.trim() !== '');

    const gameQuestion: RoomQuestion = {
      id: `gq-${Date.now()}`,
      initiator: passcode,
      target: partnerPasscode,
      question: questionText.trim(),
      category: finalCategory,
      options,
      createdAt: new Date().toISOString(),
    };

    try {
      await setActiveGameQuestion(currentRoom.code, gameQuestion);
      await setGameInvitation(currentRoom.code, null);
      await appendMessage(
        currentRoom.code,
        buildMessage({
          id: `msg-gq-${Date.now()}`,
          author: '系統',
          text: `新題目：${gameQuestion.question}\n等待 ${partnerDisplayName} 作答…`,
          type: 'system',
          gameQuestion,
        })
      );

      setIsQuestionModalOpen(false);
      setQuestionText('');
      setSelectedOptIndex(null);
      setAnswerExplanation('');
      scrollToBottom();
      showToast('題目已發布', finalCategory, 'success');
    } catch (err: any) {
      showToast('發布失敗', err?.message || '請稍後再試', 'error');
    }
  };

  /**
   * Submit an option — the target's true answer, or the initiator's guess.
   * The write runs in a Firestore transaction so simultaneous submissions from
   * both devices cannot overwrite each other, and only the submission that
   * completes the pair publishes the reveal report.
   */
  const handleSubmitOption = async (q: RoomQuestion) => {
    if (selectedOptIndex === null) {
      showToast('請先選擇選項', undefined, 'warning');
      return;
    }
    if (!currentRoom) return;

    let selectedText = '';
    if (selectedOptIndex === 4) {
      const exp = answerExplanation.trim();
      selectedText = exp ? `其他: ${exp}` : '其他 (未填說明)';
    } else {
      const baseOpt = q.options[selectedOptIndex] || `選項 ${selectedOptIndex + 1}`;
      const exp = answerExplanation.trim();
      selectedText = exp ? `${baseOpt} (說明: ${exp})` : baseOpt;
    }

    const isTargetSubmitting = passcode === q.target;

    setIsSubmittingOpt(true);
    try {
      const updatedQ = await submitGameAnswer(currentRoom.code, {
        isTarget: isTargetSubmitting,
        optionIndex: selectedOptIndex,
        optionText: selectedText,
      });

      setSelectedOptIndex(null);
      setAnswerExplanation('');

      await appendMessage(
        currentRoom.code,
        buildMessage({
          id: `msg-opt-${Date.now()}`,
          author: '系統',
          text: isTargetSubmitting
            ? `${getNameByPasscode(passcode)} 已送出真心話。`
            : `${getNameByPasscode(passcode)} 已送出猜測。`,
          type: 'system',
        })
      );

      // Only the submission that completed the pair publishes the reveal.
      if (updatedQ?.isRevealed) {
        const resultText = updatedQ.isCorrect
          ? `猜對了！\n真心話答案是「${updatedQ.targetAnswerText}」。`
          : `沒猜中。\n真心話是「${updatedQ.targetAnswerText}」\n猜測是「${updatedQ.initiatorGuessText}」。`;

        await appendMessage(
          currentRoom.code,
          buildMessage({
            id: `msg-rev-${Date.now()}`,
            author: REVEAL_AUTHOR,
            text: resultText,
            type: 'system',
          })
        );
        scrollToBottom();
      }

      showToast(
        isTargetSubmitting ? '真心話已送出' : '猜測已送出',
        isTargetSubmitting ? '等待對方猜測' : '等待對方作答',
        'success'
      );
    } catch (err: any) {
      showToast('作答失敗', err?.message || '請稍後再試', 'error');
    } finally {
      setIsSubmittingOpt(false);
    }
  };

  // Helper to fill preset question into creation form

  const inviteState = currentRoom?.gameInvitation;
  const isPendingInviteForMe = inviteState?.status === 'pending' && inviteState.sender !== passcode;
  const isPendingInviteSender = inviteState?.status === 'pending' && inviteState.sender === passcode;
  const isAcceptedWaitingInitiator = inviteState?.status === 'accepted' && inviteState.sender === passcode;
  const isAcceptedWaitingTarget = inviteState?.status === 'accepted' && inviteState.sender !== passcode;

  const activeQ = currentRoom?.activeGameQuestion;
  const isTarget = activeQ ? passcode !== activeQ.initiator : false;
  const isInitiator = activeQ ? passcode === activeQ.initiator : false;
  const hasTargetAnswered = activeQ ? activeQ.targetAnswer !== undefined : false;
  const hasInitiatorGuessed = activeQ ? activeQ.initiatorGuess !== undefined : false;

  // A player counts as online while their heartbeat is less than 30s old
  const onlinePlayerCount =
    currentRoom?.players.filter(
      (p) => p.lastActive && Date.now() - new Date(p.lastActive).getTime() < 30000
    ).length || 0;

  // Identity conflict detection: another active client has the exact same passcode
  const activeConflictPlayer = currentRoom?.players.find(
    (p) =>
      p.name === passcode &&
      p.id !== myPlayerId &&
      p.lastActive &&
      Date.now() - new Date(p.lastActive).getTime() < 30000
  );
  const isDuplicateActiveAccount = !!activeConflictPlayer;

  if (!passcode) {
    return (
      <CoPlayPasscodeModal
        loginCodeInput={loginCodeInput}
        setLoginCodeInput={setLoginCodeInput}
        isAuthLoading={isAuthLoading}
        onLogin={handleLoginWithPasscode}
      />
    );
  }

  return (
    <div className="flex-1 min-h-0 flex flex-col space-y-2 sm:space-y-3 h-full animate-fade-in overflow-hidden">
      {/* Duplicate identity hint */}
      {isDuplicateActiveAccount && (
        <div className="shrink-0 px-3 py-2 rounded-xl bg-amber-50 border border-amber-200 text-amber-900 text-xs flex items-center justify-between gap-3">
          <span className="truncate">另一台裝置也在使用【{passcode}】，請切換帳號才能正常對決</span>
          <button
            type="button"
            onClick={() => handleLoginWithPasscode(passcode === '1105' ? '1115' : '1105', false)}
            className="shrink-0 px-2.5 py-1 rounded-lg bg-amber-600 hover:bg-amber-700 text-white font-semibold transition-colors cursor-pointer"
          >
            切換為 {passcode === '1105' ? '1115' : '1105'}
          </button>
        </div>
      )}

      {/* Top Bar: Identity & Actions */}
      <div className="shrink-0 p-3 sm:p-4 rounded-2xl bg-[#FAF7F2] border border-[#D9C5B2] flex flex-wrap items-center justify-between gap-3 shadow-2xs">
        <div className="flex flex-wrap items-center gap-3">
          <div>
            {isEditingName ? (
              <form onSubmit={handleSaveName} className="flex items-center gap-1.5">
                <input
                  type="text"
                  value={nameInput}
                  onChange={(e) => setNameInput(e.target.value)}
                  placeholder="輸入名稱..."
                  className="px-2.5 py-1 text-xs border border-[#A68B6D] rounded-lg bg-white text-[#4A3F35] font-bold focus:outline-none focus:ring-2 focus:ring-[#A68B6D]"
                  autoFocus
                  maxLength={12}
                />
                <button
                  type="submit"
                  className="px-2.5 py-1 text-xs bg-[#A68B6D] text-white rounded-lg font-bold hover:bg-[#8E7256] transition-colors cursor-pointer"
                >
                  儲存
                </button>
                <button
                  type="button"
                  onClick={() => setIsEditingName(false)}
                  className="px-2 py-1 text-xs bg-[#E8D8C4] text-[#4A3F35] rounded-lg font-bold hover:bg-[#D9C5B2] transition-colors cursor-pointer"
                >
                  取消
                </button>
              </form>
            ) : (
              <div className="flex flex-wrap items-center gap-2">
                <div className="flex items-center gap-1.5 bg-white/80 px-2.5 py-1 rounded-xl border border-[#D9C5B2]">
                  <span className="text-xs sm:text-sm font-bold text-[#4A3F35]">
                    {displayName} <span className="text-[10px] text-[#A68B6D]">({passcode})</span>
                  </span>
                </div>

                {/* Online Indicator */}
                <div className="flex items-center gap-1.5 px-2.5 py-1 rounded-xl bg-emerald-50 border border-emerald-300 text-emerald-800 text-xs font-bold shadow-2xs">
                  <span className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse" />
                  <span>線上 ({onlinePlayerCount || 1} 人)</span>
                </div>

                {/* Edit Name Button */}
                <button
                  type="button"
                  onClick={() => {
                    setNameInput(displayName);
                    setIsEditingName(true);
                  }}
                  className="px-2.5 py-1 rounded-xl bg-[#E8D8C4] text-[#4A3F35] text-xs font-bold hover:bg-[#D9C5B2] transition-colors flex items-center gap-1 cursor-pointer"
                  title="修改名稱"
                >
                  <Edit3 className="w-3.5 h-3.5" />
                  <span>改名</span>
                </button>

                {/* Switch Account Button */}
                <button
                  type="button"
                  onClick={handleLogout}
                  className="px-2.5 py-1 rounded-xl bg-[#E8D8C4] text-[#4A3F35] text-xs font-bold hover:bg-[#D9C5B2] transition-colors flex items-center gap-1 cursor-pointer"
                  title="切換其他帳號"
                >
                  <UserCheck className="w-3.5 h-3.5" />
                  <span>切換帳號</span>
                </button>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Invite and Question Selection Modals */}
      <CoPlayInviteModals
        isPendingInviteForMe={isPendingInviteForMe}
        inviteStateSender={inviteState?.sender || ''}
        getNameByPasscode={getNameByPasscode}
        onRespondInvite={handleRespondInvite}
        isPendingInviteSender={isPendingInviteSender}
        partnerDisplayName={partnerDisplayName}
        onCancelInvite={handleCancelInvite}
        showQuestionModal={(isAcceptedWaitingInitiator || (isQuestionModalOpen && inviteState?.status === 'accepted')) && !isQuestionModalDismissed}
        onCloseQuestionModal={() => {
          setIsQuestionModalDismissed(true);
          setIsQuestionModalOpen(false);
        }}
        onPublishGameQuestion={handlePublishGameQuestion}
        questionCategory={questionCategory}
        setQuestionCategory={setQuestionCategory}
        customCategoryInput={customCategoryInput}
        setCustomCategoryInput={setCustomCategoryInput}
        questionText={questionText}
        setQuestionText={setQuestionText}
        optA={optA}
        setOptA={setOptA}
        optB={optB}
        setOptB={setOptB}
        optC={optC}
        setOptC={setOptC}
        optD={optD}
        setOptD={setOptD}
        isEditingPreset={isEditingPreset}
        setIsEditingPreset={setIsEditingPreset}
        handleCategoryChange={handleCategoryChange}
        handleRandomizeQuestionByCategory={handleRandomizeQuestionByCategory}
        handleSelectPresetFAQ={handleSelectPresetFAQ}
        faqs={faqs}
      />

      {/* Waiting Indicator for Target when Initiator is selecting question */}
      {isAcceptedWaitingTarget && (
        <div className="p-3 bg-emerald-50 border border-emerald-200 rounded-2xl flex items-center justify-between text-xs text-emerald-900 font-bold shrink-0 shadow-2xs mb-2">
          <span className="flex items-center gap-2">
            <Clock className="w-4 h-4 animate-spin text-emerald-600" />
            已接受挑戰，等待【{partnerDisplayName}】出題…
          </span>
        </div>
      )}

      {/* Banner 1: Waiting Initiator to set question when Modal 2 is dismissed */}
      {isAcceptedWaitingInitiator && isQuestionModalDismissed && (
        <div className="p-3 bg-amber-50 border border-amber-300 rounded-2xl flex items-center justify-between text-xs text-amber-900 font-bold shrink-0 shadow-2xs animate-fade-in mb-2">
          <span className="flex items-center gap-2 truncate pr-2">
            <Sparkles className="w-4 h-4 text-amber-600 shrink-0 animate-pulse" />
            <span className="truncate">【{partnerDisplayName}】已接受挑戰，請出題</span>
          </span>
          <div className="flex items-center gap-2 shrink-0">
            <button
              type="button"
              onClick={() => {
                setIsQuestionModalDismissed(false);
                setIsQuestionModalOpen(true);
              }}
              className="px-3 py-1.5 rounded-xl bg-[#A68B6D] hover:bg-[#8E7256] text-white text-xs font-bold transition-colors cursor-pointer shadow-2xs"
            >
              出題
            </button>
            <button
              type="button"
              onClick={handleCancelInvite}
              className="px-2 py-1.5 rounded-xl bg-rose-50 hover:bg-rose-100 text-rose-700 text-xs font-bold border border-rose-200 transition-colors cursor-pointer"
            >
              取消
            </button>
          </div>
        </div>
      )}

      {/* Banner 2: Active question in progress when Modal 3 is dismissed */}
      {activeQ && !activeQ.isRevealed && (isTarget || isInitiator) && isAnswerModalDismissed && (
        <div className="p-3 bg-amber-50 border border-amber-300 rounded-2xl flex items-center justify-between text-xs text-amber-900 font-bold shrink-0 shadow-2xs animate-fade-in mb-2">
          <div className="flex items-center gap-2 truncate pr-2">
            <Target className="w-4 h-4 text-amber-600 shrink-0 animate-pulse" />
            <span className="truncate">
              作答中 [{activeQ.category}]：{activeQ.question}
            </span>
          </div>
          <div className="flex items-center gap-2 shrink-0">
            <button
              type="button"
              onClick={() => setIsAnswerModalDismissed(false)}
              className="px-3 py-1.5 rounded-xl bg-[#A68B6D] hover:bg-[#8E7256] text-white text-xs font-bold transition-colors cursor-pointer shadow-2xs"
            >
              開啟作答
            </button>
            <button
              type="button"
              onClick={handleCancelActiveQuestion}
              className="px-2 py-1.5 rounded-xl bg-rose-50 hover:bg-rose-100 text-rose-700 text-xs font-bold border border-rose-200 transition-colors cursor-pointer"
            >
              取消
            </button>
          </div>
        </div>
      )}

      {/* Modal Popup 3 - Active Question Answering & Guessing Modal */}
      <CoPlayActiveQuestionModal
        activeQ={activeQ}
        isTarget={isTarget}
        isInitiator={isInitiator}
        partnerDisplayName={partnerDisplayName}
        isAnswerModalDismissed={isAnswerModalDismissed}
        onDismissModal={() => setIsAnswerModalDismissed(true)}
        selectedOptIndex={selectedOptIndex}
        setSelectedOptIndex={setSelectedOptIndex}
        answerExplanation={answerExplanation}
        setAnswerExplanation={setAnswerExplanation}
        hasTargetAnswered={hasTargetAnswered}
        hasInitiatorGuessed={hasInitiatorGuessed}
        isSubmittingOpt={isSubmittingOpt}
        onSubmitOption={handleSubmitOption}
        onCancelActiveQuestion={handleCancelActiveQuestion}
      />

      {/* Main Dialogue Box */}
      <div className="milk-tea-card rounded-3xl p-3 sm:p-5 border border-[#D9C5B2] shadow-xs flex-1 min-h-0 flex flex-col justify-between overflow-hidden relative">
        {/* Dialogue Header */}
        <div className="flex items-center justify-between border-b border-[#D9C5B2] pb-2.5 mb-2.5 shrink-0">
          <div className="flex items-center gap-2">
            <div className="w-8 h-8 rounded-xl bg-[#E8D8C4] text-[#5C4B3A] flex items-center justify-center font-bold">
              <MessageSquare className="w-4 h-4 text-[#A68B6D]" />
            </div>
            <div>
              <h3 className="text-sm font-bold text-[#4A3F35]">對話</h3>
              <p className="text-[10px] text-[#7A6C5E]">
                {isLoadingHistory ? '載入中…' : `${messages.length} 則訊息 ‧ 雲端同步`}
              </p>
            </div>
          </div>

          <button
            type="button"
            onClick={handleSendGameInvite}
            className="px-3 py-1.5 rounded-xl bg-[#E8D8C4] hover:bg-[#D9C5B2] text-[#4A3F35] text-xs font-bold flex items-center gap-1 transition-colors"
          >
            <PlusCircle className="w-3.5 h-3.5" />
            <span>發起考驗</span>
          </button>
        </div>

        {/* Issue 1: Floating Scroll Down Notification Pill */}
        {hasNewMessages && (
          <div className="sticky top-2 z-30 flex justify-center pointer-events-none animate-bounce mb-2">
            <button
              type="button"
              onClick={scrollToBottom}
              className="pointer-events-auto px-4 py-2 rounded-full bg-[#A68B6D] text-white text-xs font-bold shadow-lg flex items-center gap-2 hover:bg-[#8E7256] transition-colors border border-white/20 cursor-pointer"
            >
              <ArrowDown className="w-4 h-4" />
              <span>有新訊息</span>
            </button>
          </div>
        )}

        {/* Embedded Dialogue Stream */}
        <div className="flex-1 min-h-0 overflow-y-auto space-y-3.5 pr-1.5 scrollbar-thin relative">
          {!currentRoom || isLoadingHistory ? (
            <div className="flex items-center justify-center h-full text-xs text-[#7A6C5E] gap-2">
              <RefreshCw className="w-4 h-4 animate-spin text-[#A68B6D]" />
              <span>正在從雲端載入歷史對話...</span>
            </div>
          ) : messages.length === 0 ? (
            <div className="flex items-center justify-center h-full text-xs text-[#7A6C5E]">
              <span>還沒有任何對話</span>
            </div>
          ) : (
            messages.map((m, idx) => {
              const isSystem = m.author.includes('系統');
              const isMe = m.author === passcode;
              // Legacy messages used a decorated author label; keep both working.
              const isResultReport =
                m.author === REVEAL_AUTHOR ||
                m.author === '🎯 揭曉報告' ||
                m.text.includes('【猜心結果揭曉');
              const messageKey = m.id ? `${m.id}-${idx}` : `msg-${idx}`;

              // Issue 2 Requirement: Result Report Cards in Dialogue Stream
              if (isResultReport) {
                const isCorrect = m.text.includes('猜對了');
                return (
                  <div key={messageKey} className="flex flex-col items-center my-3 animate-fade-in w-full">
                    <div className={`w-full max-w-xl p-4 sm:p-5 rounded-3xl border-2 ${
                      isCorrect
                        ? 'bg-emerald-50/90 border-emerald-300 text-emerald-900'
                        : 'bg-amber-50/90 border-amber-300 text-amber-900'
                    } shadow-md space-y-2`}>
                      <div className="flex items-center justify-between border-b border-black/10 pb-2">
                        <div className="flex items-center gap-2 font-bold text-xs">
                          <Award className="w-4 h-4" />
                          <span>揭曉結果</span>
                        </div>
                      </div>
                      <div className="text-xs sm:text-sm font-black whitespace-pre-line leading-relaxed pt-1">
                        {m.text}
                      </div>
                    </div>
                  </div>
                );
              }

              // Standard Chat or System Messages
              return (
                <div
                  key={messageKey}
                  className={`flex flex-col ${
                    isSystem ? 'items-center' : isMe ? 'items-end' : 'items-start'
                  }`}
                >
                  <div className="flex items-center gap-1.5 mb-1 text-[10px] text-[#7A6C5E]">
                    <span className="font-bold text-[#4A3F35]">
                      {m.author === passcode ? displayName : m.author === partnerPasscode ? partnerDisplayName : m.author} {isMe && '(你)'}
                    </span>
                    <span>• {m.timestamp}</span>
                  </div>

                  <div
                    className={`max-w-[85%] sm:max-w-[75%] p-3.5 rounded-2xl text-xs leading-relaxed whitespace-pre-line shadow-2xs ${
                      isSystem
                        ? 'bg-[#E8D8C4]/40 text-[#5C4B3A] border border-[#D9C5B2] text-center w-full'
                        : isMe
                        ? 'bg-[#A68B6D] text-white rounded-br-none font-medium'
                        : 'bg-white text-[#4A3F35] border border-[#D9C5B2] rounded-bl-none'
                    }`}
                  >
                    {m.text}
                  </div>
                </div>
              );
            })
          )}
          <div ref={messagesEndRef} />
        </div>

        {/* Bottom Input Area inside Dialogue Box */}
        <div className="pt-3 border-t border-[#D9C5B2] shrink-0">
          <form onSubmit={handleSendChatMessage} className="flex items-center gap-2">
            <input
              type="text"
              value={chatMessageText}
              onChange={(e) => setChatMessageText(e.target.value)}
              placeholder={`以 ${displayName} 發送訊息…`}
              className="flex-1 px-4 py-3 text-xs rounded-2xl milk-tea-input font-medium"
            />
            <button
              type="submit"
              className="milk-tea-btn-primary px-5 py-3 rounded-2xl text-xs font-bold inline-flex items-center gap-1.5 shadow-xs shrink-0"
            >
              <Send className="w-3.5 h-3.5" />
              <span>發送</span>
            </button>
          </form>
        </div>
      </div>
    </div>
  );
};

