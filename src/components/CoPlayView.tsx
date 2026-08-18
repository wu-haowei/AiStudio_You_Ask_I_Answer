import React, { useCallback, useState, useEffect, useLayoutEffect, useMemo, useRef } from 'react';
import {
  Send,
  Sparkles,
  MessageSquare,
  PlusCircle,
  RefreshCw,
  Clock,
  Target,
  ArrowDown,
  Award,
  ChevronUp,
  Reply,
  X,
} from 'lucide-react';
import {
  CoPlayRoom,
  DATA_SCHEMA_VERSION,
  FAQItem,
  MessageReplyRef,
  RoomMessage,
  RoomQuestion,
} from '../types';
import {
  appendMessage,
  ensureRoom,
  loadOlderMessages,
  MESSAGE_PAGE_SIZE,
  type MessageCursor,
  setActiveGameQuestion,
  setGameInvitation,
  prunePlayers,
  readPicks,
  recordRound,
  resetPlayedCategory,
  submitGameAnswer,
  subscribeToMessages,
  subscribeToRoom,
  touchPlayer,
  upsertPlayer,
} from '../lib/firebase';
import { useIdentity } from '../lib/identity';
import { sameName } from '../lib/pairing';
import { CoPlayInviteModals } from './coplay/CoPlayInviteModals';
import { CoPlayActiveQuestionModal } from './coplay/CoPlayActiveQuestionModal';

interface CoPlayViewProps {
  /** The pair room this conversation belongs to. */
  roomId: string;
  /** The other person in the pair, known before either side connects. */
  partnerName: string;
  faqs: FAQItem[];
  showToast: (title: string, description?: string, type?: 'success' | 'info' | 'warning' | 'error') => void;
  /**
   * Reports presence and round state up to the header, along with the way to
   * start a round — on phones that button lives in the top bar, where there is
   * no second row for it.
   */
  onStatusChange?: (status: {
    onlineCount: number;
    isRoundActive: boolean;
    canInvite: boolean;
    onInvite: () => void;
  }) => void;
  /** Personal chat background; empty image means the plain milk-tea surface. */
  background?: { chatBackground: string; backgroundFade: number };
}

const TAB_SESSION_ID_KEY = 'milktea_coplay_tab_id';

/** Sentinel value for the "write my own" entry in the category dropdown. */
const CUSTOM_CATEGORY_KEY = 'CUSTOM';

/** Category label written on questions created with the custom option. */
const CUSTOM_CATEGORY_LABEL = '自訂';

/** Author label used for reveal report cards in the message stream. */
const REVEAL_AUTHOR = '揭曉結果';

/*
 * Presence heartbeat.
 *
 * Every heartbeat writes the room document, and every write pushes a fresh
 * snapshot to all connected devices — one billed read each. A slow beat is
 * therefore the single biggest lever on read volume; the online window is
 * three beats wide so a missed one does not flap the indicator.
 */
const HEARTBEAT_MS = 60000;
const ONLINE_WINDOW_MS = 3 * HEARTBEAT_MS;

/** Window for the "recently played" counter in the dialogue header. */
const RECENT_ACTIVITY_MS = 3 * 60 * 60 * 1000;


/**
 * Invite / decline / cancel notices are no longer recorded — they cluttered the
 * transcript. Rooms created earlier still contain them, so they are filtered out
 * of the stream instead of being migrated away.
 *
 * The patterns are whole sentences on purpose. An earlier version matched the
 * bare word 「婉拒」, which also swallowed any reveal card whose answer option
 * happened to contain it — the round was recorded, but the result never
 * appeared in the conversation.
 */
const RETIRED_NOTICE_PATTERNS = [
  '發起考驗，等待回應',
  '發起了猜心考驗',
  '婉拒了這次考驗',
  '婉拒了考驗',
  '取消了邀請',
  '取消了猜心考驗發起',
];

const isRetiredNotice = (m: RoomMessage) => {
  if (m.type === 'invite') return true;
  // Only the old system notices are candidates; never a reveal or a chat line
  if (m.type !== 'system' || m.author === REVEAL_AUTHOR) return false;
  return RETIRED_NOTICE_PATTERNS.some((pattern) => m.text.includes(pattern));
};

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

export const CoPlayView: React.FC<CoPlayViewProps> = ({
  roomId,
  partnerName,
  faqs,
  showToast,
  onStatusChange,
  background,
}) => {
  // The signed-in name is the player's identity throughout the room.
  const { name: passcode } = useIdentity();
  const displayName = passcode;

  // Tab-unique session id so two windows on one device are separate players
  const [tabSessionId] = useState<string>(() => {
    let id = sessionStorage.getItem(TAB_SESSION_ID_KEY);
    if (!id) {
      id = `tab-${Date.now()}-${Math.random().toString(36).substring(2, 6)}`;
      sessionStorage.setItem(TAB_SESSION_ID_KEY, id);
    }
    return id;
  });


  // Room State (room document + messages subcollection are tracked separately)
  const [currentRoom, setCurrentRoom] = useState<CoPlayRoom | null>(null);
  /** Live window: the newest MESSAGE_PAGE_SIZE messages, kept in sync by the listener. */
  const [messages, setMessages] = useState<RoomMessage[]>([]);
  /** Older pages fetched on demand when scrolling up. */
  const [olderMessages, setOlderMessages] = useState<RoomMessage[]>([]);
  const [hasMoreHistory, setHasMoreHistory] = useState(true);
  /** Firestore cursor pointing at the oldest message currently loaded. */
  const [historyCursor, setHistoryCursor] = useState<MessageCursor>(null);
  const [isLoadingMore, setIsLoadingMore] = useState(false);
  const [isLoadingHistory, setIsLoadingHistory] = useState(true);
  const [myPlayerId, setMyPlayerId] = useState<string>('');

  // Dialogue & Chat Input State
  const [chatMessageText, setChatMessageText] = useState('');
  /** The message the composer is currently replying to, if any. */
  const [replyTarget, setReplyTarget] = useState<MessageReplyRef | null>(null);
  /** Message briefly highlighted after jumping to it from a quote. */
  const [highlightedId, setHighlightedId] = useState<string | null>(null);
  const chatInputRef = useRef<HTMLInputElement>(null);
  const messageRefs = useRef<Record<string, HTMLDivElement | null>>({});
  const streamRef = useRef<HTMLDivElement>(null);
  /** Scroll height captured before prepending a page, so the view can stay put. */
  const pendingScrollAdjustRef = useRef<number | null>(null);
  /** Synchronous guard — scroll events fire faster than state updates. */
  const isLoadingMoreRef = useRef(false);
  /** Previous live window, used to catch messages pushed out of it. */
  const prevLiveMessagesRef = useRef<RoomMessage[]>([]);
  /** Guards the initial paging setup against later live snapshots. */
  const historyInitialisedRef = useRef(false);

  // Game Creator Modal Form
  const [isQuestionModalOpen, setIsQuestionModalOpen] = useState(false);
  const [isQuestionModalDismissed, setIsQuestionModalDismissed] = useState(false);
  const [isAnswerModalDismissed, setIsAnswerModalDismissed] = useState(false);
  const [questionText, setQuestionText] = useState('');
  const [questionCategory, setQuestionCategory] = useState('');
  // Left blank on purpose — a question is drawn when the form opens, so
  // placeholder options can never sit under an empty question.
  const [optA, setOptA] = useState('');
  const [optB, setOptB] = useState('');
  const [optC, setOptC] = useState('');
  const [optD, setOptD] = useState('');
  const [isEditingPreset, setIsEditingPreset] = useState(false);

  /** Ordered picks for the active question — first entry is the top preference. */
  const [selectedOptIndexes, setSelectedOptIndexes] = useState<number[]>([]);
  const [answerExplanation, setAnswerExplanation] = useState('');
  const [isSubmittingOpt, setIsSubmittingOpt] = useState(false);

  // Scroll & New Messages Pill State
  const [hasNewMessages, setHasNewMessages] = useState(false);
  const isInitialLoadRef = useRef(true);
  const lastSeenMessageIdRef = useRef<string | null>(null);
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

  /** Starts a reply and focuses the composer. */
  const handleStartReply = (m: RoomMessage) => {
    setReplyTarget({ id: m.id, author: m.author, text: m.text });
    chatInputRef.current?.focus();
  };

  /** Jumps to a quoted message and flashes it, when it is still loaded. */
  const handleJumpToMessage = (id: string) => {
    const node = messageRefs.current[id];
    if (!node) {
      showToast('找不到原訊息', '可能已不在載入範圍內', 'info');
      return;
    }
    node.scrollIntoView({ behavior: 'smooth', block: 'center' });
    setHighlightedId(id);
    window.setTimeout(() => setHighlightedId((cur) => (cur === id ? null : cur)), 1600);
  };

  /** Paged-in history followed by the live window, de-duplicated by id. */
  const visibleMessages = useMemo(() => {
    const seen = new Set<string>();
    const merged: RoomMessage[] = [];
    for (const m of [...olderMessages, ...messages]) {
      if (m.id && seen.has(m.id)) continue;
      if (isRetiredNotice(m)) continue;
      if (m.id) seen.add(m.id);
      merged.push(m);
    }
    return merged;
  }, [olderMessages, messages]);

  /** Fetches the next page of older messages, keeping the viewport anchored. */
  const handleLoadOlder = async () => {
    if (!currentRoom || !historyCursor || isLoadingMoreRef.current || !hasMoreHistory) return;

    isLoadingMoreRef.current = true;
    setIsLoadingMore(true);
    pendingScrollAdjustRef.current = streamRef.current?.scrollHeight ?? null;
    try {
      const page = await loadOlderMessages(currentRoom.code, historyCursor, MESSAGE_PAGE_SIZE);
      setHasMoreHistory(page.hasMore);
      if (page.messages.length > 0) {
        setOlderMessages((prev) => [...page.messages, ...prev]);
        if (page.cursor) setHistoryCursor(page.cursor);
      } else {
        pendingScrollAdjustRef.current = null;
      }
    } catch {
      pendingScrollAdjustRef.current = null;
    } finally {
      isLoadingMoreRef.current = false;
      setIsLoadingMore(false);
    }
  };

  /**
   * The live window only holds the newest page. When a new message pushes an
   * older one out of it, keep that one on screen by moving it into the paged
   * history — otherwise it would silently vanish from the top of the thread.
   */
  useEffect(() => {
    const previous = prevLiveMessagesRef.current;
    prevLiveMessagesRef.current = messages;
    if (previous.length === 0) return;

    const liveIds = new Set(messages.map((m) => m.id));
    const evicted = previous.filter((m) => !liveIds.has(m.id));
    if (evicted.length === 0) return;

    setOlderMessages((prev) => {
      const known = new Set(prev.map((m) => m.id));
      // Evicted messages are the oldest of the live window, so they belong
      // immediately after the already-paged history — already in order.
      return [...prev, ...evicted.filter((m) => !known.has(m.id))];
    });
  }, [messages]);

  // Keep the reading position stable after a page is prepended
  useLayoutEffect(() => {
    const el = streamRef.current;
    const before = pendingScrollAdjustRef.current;
    if (!el || before === null) return;
    pendingScrollAdjustRef.current = null;
    el.scrollTop += el.scrollHeight - before;
  }, [olderMessages]);

  // Enter (or re-enter) whenever the signed-in name or the open room changes
  useEffect(() => {
    if (!passcode || !roomId) {
      setCurrentRoom(null);
      setMessages([]);
      setOlderMessages([]);
      setHistoryCursor(null);
      setHasMoreHistory(true);
      historyInitialisedRef.current = false;
      setMyPlayerId('');
      return;
    }
    enterRoom(passcode);
  }, [passcode, roomId]);

  /**
   * Announce new arrivals. The live window is capped, so compare the newest id
   * rather than the message count — the count stops growing once it is full.
   */
  useEffect(() => {
    const lastMsg = messages[messages.length - 1];
    if (!lastMsg) return;

    if (isInitialLoadRef.current) {
      isInitialLoadRef.current = false;
      lastSeenMessageIdRef.current = lastMsg.id;
      scrollToBottom();
      return;
    }

    if (lastSeenMessageIdRef.current === lastMsg.id) return;
    lastSeenMessageIdRef.current = lastMsg.id;

    if (lastMsg.author === passcode || lastMsg.author === displayName) {
      // Our own message — follow it down
      scrollToBottom();
    } else {
      setHasNewMessages(true);
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
    if (activeQ && readPicks(activeQ, 'target').length === 0 && passcode !== activeQ.initiator) {
      if (prevQuestionIdRef.current !== activeQ.id) {
        prevQuestionIdRef.current = activeQ.id;
        setIsAnswerModalDismissed(false);
        setSelectedOptIndexes([]);
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
      setSelectedOptIndexes([]);
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

    const unsubscribeMessages = subscribeToMessages(roomCode, (page) => {
      setMessages(page.messages);

      // The first snapshot seeds paging; later ones must not reset it, or
      // reaching the start of the thread would be forgotten on every new message.
      if (!historyInitialisedRef.current) {
        historyInitialisedRef.current = true;
        setHistoryCursor(page.cursor);
        setHasMoreHistory(page.hasMore);
      }
      setIsLoadingHistory(false);
    });

    /*
     * Heartbeat only while the tab is actually in front. A phone left on the
     * home screen with the app in the background used to keep writing — and
     * so keep generating reads on the other device — all day.
     */
    const beat = () => {
      if (myPlayerId && document.visibilityState === 'visible') {
        touchPlayer(roomCode, myPlayerId);
      }
    };

    beat();
    const heartbeat = setInterval(beat, HEARTBEAT_MS);
    document.addEventListener('visibilitychange', beat);

    return () => {
      clearInterval(heartbeat);
      document.removeEventListener('visibilitychange', beat);
      unsubscribeRoom();
      unsubscribeMessages();
    };
  }, [currentRoom?.code, myPlayerId, passcode]);

  /** Registers this tab as a player in the shared room. */
  const enterRoom = async (rawName: string) => {
    const cleanName = rawName.trim();
    if (!cleanName) return;

    try {
      // Drop tab sessions that stopped sending heartbeats long ago
      await prunePlayers(roomId);

      const room = await ensureRoom(
        roomId,
        cleanName,
        [cleanName, partnerName.trim()].filter(Boolean).sort((a, b) => a.localeCompare(b))
      );
      const thisPlayerId = `p-${tabSessionId}`;
      const existing = room.players.find((p) => p.id === thisPlayerId);

      await upsertPlayer(roomId, {
        id: thisPlayerId,
        name: cleanName,
        score: existing?.score ?? 0,
        isHost: existing?.isHost ?? room.players.length === 0,
        lastActive: new Date().toISOString(),
      });

      setCurrentRoom(room);
      setMyPlayerId(thisPlayerId);
    } catch (err: any) {
      console.error('Failed to enter room:', err);
      showToast('連線失敗', err?.message || '請檢查網路連線', 'error');
    }
  };

  // Names are the identity, so no lookup table is needed
  const getNameByPasscode = (code: string) => code || '';

  /*
   * The opponent is fixed by the pairing, so it comes from the prop rather than
   * from whoever happens to be in the players list. Two windows of my own
   * account are two player rows with my name on them, and picking "the other
   * row" used to make me my own opponent.
   */
  const partnerPasscode = partnerName.trim();
  const partnerDisplayName = partnerPasscode || '對方';

  const partnerPlayer = (currentRoom?.players || [])
    .filter((p) => sameName(p.name, partnerPasscode))
    .sort((a, b) => (b.lastActive || '').localeCompare(a.lastActive || ''))[0];

  const hasPartner = !!partnerPasscode;

  // Send Chat Message
  const handleSendChatMessage = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!currentRoom || !chatMessageText.trim()) return;

    const text = chatMessageText.trim();
    const quoted = replyTarget;
    setChatMessageText('');
    setReplyTarget(null);

    try {
      await appendMessage(
        currentRoom.code,
        buildMessage({
          id: `msg-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
          author: displayName || passcode,
          text,
          type: 'chat',
          ...(quoted ? { replyTo: quoted } : {}),
        })
      );
      scrollToBottom();
    } catch (err: any) {
      setChatMessageText(text);
      setReplyTarget(quoted);
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
      // A decline is transient — only the acceptance is worth recording.
      if (accept) {
        await appendMessage(
          currentRoom.code,
          buildMessage({
            id: `msg-res-${Date.now()}`,
            author: '系統',
            text: `${getNameByPasscode(passcode)} 接受了考驗，等待出題。`,
            type: 'system',
          })
        );
      }

      if (accept) {
        setIsAnswerModalDismissed(false);
        setIsQuestionModalDismissed(false);
        setSelectedOptIndexes([]);
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

  /**
   * Fills the four option slots from a question's option list. Questions can
   * carry any number of options (two or more), so unused slots are cleared and
   * later filtered out when the question is published.
   */
  const applyOptionsToForm = (options?: string[]) => {
    const list = options || [];
    setOptA(list[0] || '');
    setOptB(list[1] || '');
    setOptC(list[2] || '');
    setOptD(list[3] || '');
  };

  /**
   * Which library questions have already been played, per category. This rides
   * along on the room document that is already being watched, so filtering
   * costs no extra reads.
   */
  const playedFaqIdsByCategory = useMemo(() => {
    const byCategory = new Map<string, Set<string>>();
    const played: Record<string, string[]> = currentRoom?.playedFaqIds || {};
    for (const [category, ids] of Object.entries(played)) {
      byCategory.set(category, new Set(Array.isArray(ids) ? ids : []));
    }
    return byCategory;
  }, [currentRoom?.playedFaqIds]);

  /**
   * Categories actually present in the library. The picker used to hard-code a
   * list, so a question from a category missing from it (for example 「隨機」)
   * left the dropdown and the question list showing different things.
   */
  const availableCategories = useMemo(() => {
    const seen: string[] = [];
    for (const f of faqs) {
      if (f.category && !seen.includes(f.category)) seen.push(f.category);
    }
    return seen;
  }, [faqs]);

  // Keep the selection pointing at a category that exists
  useEffect(() => {
    if (availableCategories.length === 0) return;
    if (questionCategory === CUSTOM_CATEGORY_KEY) return;
    if (!availableCategories.includes(questionCategory)) {
      setQuestionCategory(availableCategories[0]);
    }
  }, [availableCategories, questionCategory]);

  /** Flat set of every played id, for dimming the library picker. */
  const playedFaqIdSet = useMemo(() => {
    const all = new Set<string>();
    for (const ids of playedFaqIdsByCategory.values()) {
      for (const id of ids) all.add(id);
    }
    return all;
  }, [playedFaqIdsByCategory]);

  /**
   * Questions published in the last three hours. The timestamps ride on the
   * room document, which is already being watched, so this costs no reads.
   */
  const recentRoundCount = useMemo(() => {
    const cutoff = Date.now() - RECENT_ACTIVITY_MS;
    return (currentRoom?.recentRounds || []).filter(
      (at) => new Date(at).getTime() >= cutoff
    ).length;
  }, [currentRoom?.recentRounds]);

  /**
   * Draws a question that has not been played yet. When a category runs out,
   * the cycle restarts rather than leaving the picker with nothing to offer.
   */
  const pickUnplayedFaq = (cat: string): FAQItem | null => {
    const inCategory = cat ? faqs.filter((f) => f.category === cat) : faqs;
    const pool = inCategory.length > 0 ? inCategory : faqs;
    if (pool.length === 0) return null;

    const played = playedFaqIdsByCategory.get(cat) || new Set<string>();
    const unplayed = pool.filter((f) => !played.has(f.id));

    if (unplayed.length > 0) {
      return unplayed[Math.floor(Math.random() * unplayed.length)];
    }

    // Everything in this category has been used — start a new cycle.
    if (cat && currentRoom) {
      resetPlayedCategory(currentRoom.code, cat);
      showToast('題目已全部玩過一輪', `「${cat}」重新開始`, 'info');
    }
    return pool[Math.floor(Math.random() * pool.length)];
  };

  /** Remembers which library question the form currently holds. */
  const [sourceFaqId, setSourceFaqId] = useState<string | undefined>(undefined);

  const applyFaqToForm = (faq: FAQItem) => {
    setQuestionText(faq.question);
    if (faq.category) setQuestionCategory(faq.category);
    applyOptionsToForm(faq.options);
    setSourceFaqId(faq.id);
  };

  // Helper to randomize a question given a category
  const randomizeQuestionForCategory = (cat: string) => {
    const faq = pickUnplayedFaq(cat === CUSTOM_CATEGORY_KEY ? '' : cat);
    if (faq) applyFaqToForm(faq);
  };

  const handleCategoryChange = (cat: string) => {
    setQuestionCategory(cat);
    setIsEditingPreset(false);
    if (cat === CUSTOM_CATEGORY_KEY) {
      setQuestionText('');
      applyOptionsToForm([]);
    } else {
      randomizeQuestionForCategory(cat);
    }
  };

  const handleSelectPresetFAQ = (f: FAQItem) => {
    applyFaqToForm(f);
    showToast('已套用題目', f.question, 'info');
  };

  // Draw another unplayed question from the current category
  const handleRandomizeQuestionByCategory = () => {
    if (faqs.length === 0) {
      showToast('題庫沒有題目', undefined, 'warning');
      return;
    }

    const faq = pickUnplayedFaq(questionCategory === CUSTOM_CATEGORY_KEY ? '' : questionCategory);
    if (!faq) {
      showToast('題庫沒有題目', undefined, 'warning');
      return;
    }

    applyFaqToForm(faq);
    showToast('已換題', faq.category || '自訂題庫', 'success');
  };

  // Submit Chosen Question & Options
  const handlePublishGameQuestion = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!currentRoom || !questionText.trim()) {
      showToast('請輸入題目', undefined, 'warning');
      return;
    }

    const finalCategory =
      questionCategory === CUSTOM_CATEGORY_KEY ? CUSTOM_CATEGORY_LABEL : questionCategory;
    const options = [optA, optB, optC, optD].map((o) => o.trim()).filter(Boolean);
    if (options.length < 2) {
      showToast('選項至少要兩個', undefined, 'warning');
      return;
    }

    // A hand-edited question is no longer the library one it started from
    const usedFaq = faqs.find((f) => f.id === sourceFaqId);
    const faqId = usedFaq && usedFaq.question === questionText.trim() ? usedFaq.id : undefined;

    const gameQuestion: RoomQuestion = {
      id: `gq-${Date.now()}`,
      v: DATA_SCHEMA_VERSION,
      initiator: passcode,
      target: partnerPasscode,
      question: questionText.trim(),
      category: finalCategory,
      options,
      ...(faqId ? { sourceFaqId: faqId } : {}),
      createdAt: new Date().toISOString(),
    };

    try {
      await setActiveGameQuestion(currentRoom.code, gameQuestion);
      await setGameInvitation(currentRoom.code, null);
      await recordRound(
        currentRoom.code,
        {
          id: gameQuestion.id,
          ...(faqId ? { faqId } : {}),
          question: gameQuestion.question,
          category: finalCategory,
          initiator: passcode,
          target: partnerPasscode,
          createdAt: gameQuestion.createdAt,
        },
        currentRoom.recentRounds || [],
        RECENT_ACTIVITY_MS
      );
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
      setSourceFaqId(undefined);
      setSelectedOptIndexes([]);
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
    if (selectedOptIndexes.length === 0) {
      showToast('請先選擇選項', undefined, 'warning');
      return;
    }
    if (!currentRoom) return;

    const labelFor = (idx: number) =>
      idx === 4 ? answerExplanation.trim() || '其他' : q.options[idx] || `選項 ${idx + 1}`;

    // "1. 在家追劇 ／ 2. 出門喝咖啡" — order carries the preference
    const picksText = selectedOptIndexes
      .map((idx, rank) => `${rank + 1}. ${labelFor(idx)}`)
      .join(' ／ ');
    const note = answerExplanation.trim();
    const includeNote = note && !selectedOptIndexes.includes(4);
    const selectedText = includeNote ? `${picksText} (說明: ${note})` : picksText;

    const isTargetSubmitting = passcode === q.target;

    setIsSubmittingOpt(true);
    try {
      const updatedQ = await submitGameAnswer(currentRoom.code, {
        isTarget: isTargetSubmitting,
        optionIndexes: selectedOptIndexes,
        optionText: selectedText,
      });

      setSelectedOptIndexes([]);
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
          ? `猜對了！\n真心話：${updatedQ.targetAnswerText}\n猜測：${updatedQ.initiatorGuessText}`
          : `沒猜中。\n真心話：${updatedQ.targetAnswerText}\n猜測：${updatedQ.initiatorGuessText}`;

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
  // readPicks also understands rounds stored before multi-select existed
  const hasTargetAnswered = activeQ ? readPicks(activeQ, 'target').length > 0 : false;
  const hasInitiatorGuessed = activeQ ? readPicks(activeQ, 'initiator').length > 0 : false;

  /*
   * People online, not tabs online. Each window registers its own player row,
   * so counting rows made a second window of the same account look like an
   * extra person; the names are de-duplicated instead.
   */
  const onlinePlayerCount = new Set(
    (currentRoom?.players || [])
      .filter(
        (p) =>
          p.name &&
          p.lastActive &&
          Date.now() - new Date(p.lastActive).getTime() < ONLINE_WINDOW_MS
      )
      .map((p) => p.name.trim().toLowerCase())
  ).size;

  const isRoundActive = !!activeQ || !!inviteState;

  const showQuestionModal =
    (isAcceptedWaitingInitiator || (isQuestionModalOpen && inviteState?.status === 'accepted')) &&
    !isQuestionModalDismissed;

  /*
   * Report presence + round state to the header.
   *
   * The invite handler is handed over through a ref so the callback identity
   * stays put — passing the handler itself would rebuild it every render and
   * turn this effect into an update loop.
   */
  const inviteHandlerRef = useRef<() => void>(() => {});
  inviteHandlerRef.current = handleSendGameInvite;
  const stableInvite = useCallback(() => inviteHandlerRef.current(), []);

  useEffect(() => {
    onStatusChange?.({
      onlineCount: onlinePlayerCount,
      isRoundActive,
      canInvite: hasPartner,
      onInvite: stableInvite,
    });
  }, [onlinePlayerCount, isRoundActive, hasPartner, onStatusChange, stableInvite]);

  /*
   * Fill the form each time it opens: a fresh unplayed question for a normal
   * category, or a blank slate for a custom one (last round's text would
   * otherwise still be sitting there).
   */
  const wasQuestionModalOpenRef = useRef(false);
  useEffect(() => {
    if (!showQuestionModal) {
      wasQuestionModalOpenRef.current = false;
      return;
    }

    const justOpened = !wasQuestionModalOpenRef.current;
    wasQuestionModalOpenRef.current = true;

    if (questionCategory === CUSTOM_CATEGORY_KEY) {
      if (justOpened) {
        setQuestionText('');
        applyOptionsToForm([]);
        setSourceFaqId(undefined);
      }
      return;
    }

    // Draw on open, and again if the library only finished loading afterwards
    if (justOpened || !questionText.trim()) {
      randomizeQuestionForCategory(questionCategory || availableCategories[0] || '');
    }
  }, [showQuestionModal, faqs.length]);


  // Sign-in and room selection happen before this view is mounted
  if (!passcode || !roomId) return null;

  return (
    <div className="flex-1 min-h-0 flex flex-col h-full animate-fade-in overflow-hidden">
      {/* Invite and Question Selection Modals */}
      <CoPlayInviteModals
        isPendingInviteForMe={isPendingInviteForMe}
        inviteStateSender={inviteState?.sender || ''}
        getNameByPasscode={getNameByPasscode}
        onRespondInvite={handleRespondInvite}
        isPendingInviteSender={isPendingInviteSender}
        partnerDisplayName={partnerDisplayName}
        onCancelInvite={handleCancelInvite}
        showQuestionModal={showQuestionModal}
        onCloseQuestionModal={() => {
          setIsQuestionModalDismissed(true);
          setIsQuestionModalOpen(false);
        }}
        onPublishGameQuestion={handlePublishGameQuestion}
        questionCategory={questionCategory}
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
        playedFaqIds={playedFaqIdSet}
        availableCategories={availableCategories}
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
        selectedOptIndexes={selectedOptIndexes}
        setSelectedOptIndexes={setSelectedOptIndexes}
        answerExplanation={answerExplanation}
        setAnswerExplanation={setAnswerExplanation}
        hasTargetAnswered={hasTargetAnswered}
        hasInitiatorGuessed={hasInitiatorGuessed}
        isSubmittingOpt={isSubmittingOpt}
        onSubmitOption={handleSubmitOption}
        onCancelActiveQuestion={handleCancelActiveQuestion}
      />

      {/* Main Dialogue Box */}
      <div className="milk-tea-card rounded-2xl sm:rounded-3xl p-2.5 sm:p-5 border border-[#D9C5B2] shadow-xs flex-1 min-h-0 flex flex-col justify-between overflow-hidden relative">
        {/*
         * Personal background. It sits behind everything in the card and never
         * takes pointer events, with a wash on top so message text stays
         * readable however busy the picture is.
         */}
        {background?.chatBackground && (
          <div className="absolute inset-0 pointer-events-none" aria-hidden="true">
            <img
              src={background.chatBackground}
              alt=""
              className="w-full h-full object-cover"
            />
            <div
              className="absolute inset-0 bg-[#FAF7F2]"
              style={{ opacity: (background.backgroundFade ?? 72) / 100 }}
            />
          </div>
        )}

        {/*
         * Dialogue header — desktop only. On phones the same controls live in
         * the app header, so repeating them here would cost a whole row of an
         * already short screen.
         */}
        <div className="relative hidden sm:flex items-center justify-between border-b border-[#D9C5B2] pb-2.5 mb-2.5 shrink-0">
          <div className="flex items-center gap-2">
            <div className="hidden sm:flex w-8 h-8 rounded-xl bg-[#E8D8C4] text-[#5C4B3A] items-center justify-center font-bold">
              <MessageSquare className="w-4 h-4 text-[#A68B6D]" />
            </div>
            <div>
              <h3 className="text-sm font-bold text-[#4A3F35]">對話</h3>
              <p className="text-[10px] text-[#7A6C5E]">
                {isLoadingHistory
                  ? '載入中…'
                  : `${visibleMessages.length} 則訊息 ‧ 3 小時內 ${recentRoundCount} 題`}
              </p>
            </div>
          </div>

          <button
            type="button"
            onClick={handleSendGameInvite}
            disabled={!hasPartner}
            title={hasPartner ? undefined : '等待對方進入房間'}
            className="px-3 py-2 rounded-xl bg-[#E8D8C4] hover:bg-[#D9C5B2] disabled:opacity-40 disabled:cursor-not-allowed text-[#4A3F35] text-xs font-bold flex items-center gap-1 transition-colors shrink-0"
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
        <div
          ref={streamRef}
          onScroll={(e) => {
            // Near the top and more history exists -> pull the next page
            if (e.currentTarget.scrollTop < 80) handleLoadOlder();
          }}
          className="flex-1 min-h-0 overflow-y-auto space-y-3.5 pr-1.5 scrollbar-thin relative"
        >
          {/* Phone-sized screens get the counts here instead of in a fixed row */}
          <div className="sm:hidden flex justify-center pb-1.5 text-[10px] text-[#7A6C5E]">
            {isLoadingHistory
              ? '載入中…'
              : `${visibleMessages.length} 則訊息 ‧ 3 小時內 ${recentRoundCount} 題`}
          </div>

          {currentRoom && !isLoadingHistory && visibleMessages.length > 0 && (
            <div className="flex justify-center pb-1">
              {isLoadingMore ? (
                <span className="inline-flex items-center gap-1.5 text-[11px] text-[#7A6C5E]">
                  <RefreshCw className="w-3.5 h-3.5 animate-spin" />
                  載入更早訊息…
                </span>
              ) : hasMoreHistory ? (
                <button
                  type="button"
                  onClick={handleLoadOlder}
                  className="inline-flex items-center gap-1 px-3 py-1 rounded-full bg-[#E8D8C4]/70 hover:bg-[#E8D8C4] text-[11px] font-semibold text-[#5C4B3A] transition-colors cursor-pointer"
                >
                  <ChevronUp className="w-3.5 h-3.5" />
                  載入更早訊息
                </button>
              ) : (
                <span className="text-[11px] text-[#A69684]">已是最早的訊息</span>
              )}
            </div>
          )}

          {!currentRoom || isLoadingHistory ? (
            <div className="flex items-center justify-center h-full text-xs text-[#7A6C5E] gap-2">
              <RefreshCw className="w-4 h-4 animate-spin text-[#A68B6D]" />
              <span>載入對話中…</span>
            </div>
          ) : visibleMessages.length === 0 ? (
            <div className="flex flex-col items-center justify-center h-full gap-1 text-xs text-[#7A6C5E]">
              <span>還沒有任何對話</span>
              {!hasPartner && <span className="text-[11px]">等待對方輸入姓名進入</span>}
            </div>
          ) : (
            visibleMessages.map((m, idx) => {
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
                  <div
                    key={messageKey}
                    ref={(node) => {
                      messageRefs.current[m.id] = node;
                    }}
                    className={`flex flex-col items-center my-3 animate-fade-in w-full rounded-3xl transition-colors ${
                      highlightedId === m.id ? 'ring-2 ring-[#A68B6D]' : ''
                    }`}
                  >
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
                        <button
                          type="button"
                          onClick={() => handleStartReply(m)}
                          aria-label="回覆這則結果"
                          className="p-1.5 rounded-lg hover:bg-black/5 transition-colors cursor-pointer"
                        >
                          <Reply className="w-3.5 h-3.5" />
                        </button>
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
                  ref={(node) => {
                    messageRefs.current[m.id] = node;
                  }}
                  className={`group flex flex-col rounded-2xl transition-all ${
                    isSystem ? 'items-center' : isMe ? 'items-end' : 'items-start'
                  } ${
                    highlightedId === m.id
                      ? 'ring-2 ring-[#8E7256] ring-offset-2 ring-offset-[#FAF7F2]'
                      : ''
                  }`}
                >
                  <div className="flex items-center gap-1.5 mb-1 text-[10px] text-[#7A6C5E]">
                    <span className="font-bold text-[#4A3F35]">
                      {m.author === passcode ? displayName : m.author === partnerPasscode ? partnerDisplayName : m.author} {isMe && '(你)'}
                    </span>
                    <span>• {m.timestamp}</span>
                  </div>

                  <div
                    className={`flex items-center gap-1 max-w-[88%] sm:max-w-[75%] ${
                      isSystem ? 'w-full' : isMe ? 'flex-row-reverse' : ''
                    }`}
                  >
                    <div
                      className={`min-w-0 px-3.5 py-2.5 rounded-2xl text-[13px] sm:text-xs leading-relaxed shadow-2xs ${
                        isSystem
                          ? 'bg-[#E8D8C4]/40 text-[#5C4B3A] border border-[#D9C5B2] text-center w-full'
                          : isMe
                          ? 'bg-[#A68B6D] text-white rounded-br-none font-medium'
                          : 'bg-white text-[#4A3F35] border border-[#D9C5B2] rounded-bl-none'
                      }`}
                    >
                      {m.replyTo && (
                        <button
                          type="button"
                          onClick={() => handleJumpToMessage(m.replyTo!.id)}
                          className={`w-full text-left mb-1.5 pl-2 pr-1 py-1 rounded-lg border-l-2 cursor-pointer transition-opacity hover:opacity-80 ${
                            isMe
                              ? 'border-white/70 bg-white/15 text-white/90'
                              : 'border-[#A68B6D] bg-[#F5EFE6] text-[#7A6C5E]'
                          }`}
                        >
                          <span className="block text-[10px] font-bold truncate">
                            {m.replyTo.author}
                          </span>
                          <span className="block text-[11px] truncate">{m.replyTo.text}</span>
                        </button>
                      )}
                      <span className="whitespace-pre-line">{m.text}</span>
                    </div>

                    {!isSystem && (
                      <button
                        type="button"
                        onClick={() => handleStartReply(m)}
                        aria-label="回覆這則訊息"
                        className="shrink-0 p-1.5 rounded-lg text-[#A68B6D] hover:bg-[#E8D8C4]/60 transition-all cursor-pointer opacity-60 sm:opacity-0 sm:group-hover:opacity-100 sm:focus:opacity-100"
                      >
                        <Reply className="w-3.5 h-3.5" />
                      </button>
                    )}
                  </div>
                </div>
              );
            })
          )}
          <div ref={messagesEndRef} />
        </div>

        {/* Bottom Input Area inside Dialogue Box */}
        <div className="relative pt-2.5 sm:pt-3 border-t border-[#D9C5B2] shrink-0">
          {replyTarget && (
            <div className="mb-2 flex items-center gap-2 px-3 py-2 rounded-xl bg-[#F5EFE6] border-l-2 border-[#A68B6D] animate-fade-in">
              <Reply className="w-3.5 h-3.5 text-[#A68B6D] shrink-0" />
              <div className="min-w-0 flex-1">
                <div className="text-[10px] font-bold text-[#4A3F35] truncate">
                  回覆 {replyTarget.author}
                </div>
                <div className="text-[11px] text-[#7A6C5E] truncate">{replyTarget.text}</div>
              </div>
              <button
                type="button"
                onClick={() => setReplyTarget(null)}
                aria-label="取消回覆"
                className="shrink-0 p-1 rounded-lg text-[#7A6C5E] hover:bg-[#E8D8C4] transition-colors cursor-pointer"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
          )}

          <form onSubmit={handleSendChatMessage} className="flex items-center gap-2">
            <input
              ref={chatInputRef}
              type="text"
              value={chatMessageText}
              onChange={(e) => setChatMessageText(e.target.value)}
              placeholder={replyTarget ? `回覆 ${replyTarget.author}…` : '輸入訊息…'}
              onKeyDown={(e) => {
                if (e.key === 'Escape' && replyTarget) setReplyTarget(null);
              }}
              enterKeyHint="send"
              autoComplete="off"
              className="flex-1 min-w-0 px-4 py-3 text-base sm:text-xs rounded-2xl milk-tea-input font-medium"
            />
            <button
              type="submit"
              disabled={!chatMessageText.trim()}
              aria-label="發送"
              className="milk-tea-btn-primary px-4 sm:px-5 py-3 rounded-2xl text-xs font-bold inline-flex items-center gap-1.5 shadow-xs shrink-0 disabled:opacity-40"
            >
              <Send className="w-4 h-4" />
              <span className="hidden sm:inline">發送</span>
            </button>
          </form>
        </div>
      </div>
    </div>
  );
};

