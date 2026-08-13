import React, { useState, useEffect, useRef } from 'react';
import {
  Send,
  Sparkles,
  HelpCircle,
  MessageSquare,
  Database,
  PlusCircle,
  Check,
  UserCheck,
  RefreshCw,
  CheckCircle2,
  Gamepad2,
  X,
  ThumbsUp,
  Clock,
  Target,
  ArrowDown,
  Award,
  AlertCircle,
  Edit3,
  LogOut,
  User,
  Shuffle,
  Dices,
  XCircle,
} from 'lucide-react';
import { CoPlayRoom, FAQItem, RoomQuestion } from '../types';
import { getStoredNotionConfig } from '../utils/storage';
import { subscribeToFirebaseRoom, syncRoomToFirebase } from '../lib/firebase';
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

// Helper for safe JSON API response parsing (detects GitHub Pages / static hosting)
let isStaticHostingDetected = typeof window !== 'undefined' && (
  window.location.hostname.includes('github.io') ||
  window.location.pathname.includes('/AiStudio_You_Ask_I_Answer')
);

const fetchRoomApi = async (url: string, options?: RequestInit) => {
  if (isStaticHostingDetected) {
    return { success: false, isStaticFallback: true };
  }

  try {
    const res = await fetch(url, options);
    const contentType = res.headers.get('content-type') || '';
    if (contentType.includes('text/html') || (!res.ok && contentType.includes('html'))) {
      isStaticHostingDetected = true;
      return { success: false, isStaticFallback: true };
    }
    const data = await res.json().catch(() => null);
    if (!data) {
      isStaticHostingDetected = true;
      return { success: false, isStaticFallback: true };
    }
    return { ...data, isStaticFallback: false };
  } catch (err) {
    isStaticHostingDetected = true;
    return { success: false, isStaticFallback: true };
  }
};

const LOCAL_STATIC_ROOM_KEY = (code: string) => `milktea_static_room_${code.toUpperCase()}`;

const getLocalStaticRoom = (code: string, defaultQuestions: FAQItem[] = []): CoPlayRoom => {
  const key = LOCAL_STATIC_ROOM_KEY(code);
  const stored = localStorage.getItem(key);
  if (stored) {
    try {
      return JSON.parse(stored);
    } catch (e) {
      // ignore
    }
  }

  const initialRoom: CoPlayRoom = {
    code: code.toUpperCase(),
    hostName: '1105',
    players: [
      { id: 'p-1105', name: '1105', score: 20, isHost: true, lastActive: new Date().toISOString() },
      { id: 'p-1115', name: '1115', score: 10, isHost: false, lastActive: new Date().toISOString() },
    ],
    questions: defaultQuestions,
    messages: [
      {
        id: 'msg-init-1',
        author: '系統提示',
        text: '歡迎進入【雙人猜心對話框】！本機雙人連線已就緒。',
        timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
        isSyncedToNotion: true,
      },
    ],
    currentQuestionIndex: 0,
    status: 'playing',
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };

  localStorage.setItem(key, JSON.stringify(initialRoom));
  return initialRoom;
};

const saveLocalStaticRoom = (room: CoPlayRoom) => {
  if (!room || !room.code) return;
  const key = LOCAL_STATIC_ROOM_KEY(room.code);
  localStorage.setItem(key, JSON.stringify(room));
  // Sync in real-time to Firebase Firestore for cross-device support
  syncRoomToFirebase(room);
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

  // Room State
  const [currentRoom, setCurrentRoom] = useState<CoPlayRoom | null>(null);
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
    if (!currentRoom?.messages) return;
    const messages = currentRoom.messages;
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
  }, [currentRoom?.messages]);

  // Toast alert when new invitation or question arrives via polling
  useEffect(() => {
    if (!currentRoom) return;

    // Invitation alert for target
    const invite = currentRoom.gameInvitation;
    if (invite && invite.status === 'pending' && invite.sender !== passcode) {
      if (prevInviteIdRef.current !== invite.id) {
        prevInviteIdRef.current = invite.id;
        showToast('🎮 收到對決考驗邀請！', `發起人：${getNameByPasscode(invite.sender)}`, 'info');
      }
    }

    // Invitation accepted alert for initiator (sender)
    if (invite && invite.status === 'accepted' && invite.sender === passcode) {
      if (prevInviteAcceptedRef.current !== invite.id) {
        prevInviteAcceptedRef.current = invite.id;
        setIsQuestionModalDismissed(false);
        showToast('🎉 對方已接受挑戰！', `【${getNameByPasscode(invite.target)}】已接受挑戰，請設定考驗題目`, 'success');
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
        showToast('❓ 收到猜心考驗題目！', `發問人：${getNameByPasscode(activeQ.initiator)}`, 'info');
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

  // Real-time Firebase Firestore & multi-tab listener (stably initialized per room)
  useEffect(() => {
    const roomCode = currentRoom?.code;
    if (!roomCode || !passcode) return;

    // Real-time Firebase Firestore listener for cross-device sync
    const unsubscribeFirebase = subscribeToFirebaseRoom(roomCode, (updatedRoom) => {
      if (updatedRoom && updatedRoom.updatedAt !== currentRoomRef.current?.updatedAt) {
        currentRoomRef.current = updatedRoom;
        setCurrentRoom(updatedRoom);
        const key = LOCAL_STATIC_ROOM_KEY(roomCode);
        localStorage.setItem(key, JSON.stringify(updatedRoom));
      }
    });

    // Listen for storage events across tabs on same domain
    const handleStorageChange = (e: StorageEvent) => {
      if (e.key === LOCAL_STATIC_ROOM_KEY(roomCode) && e.newValue) {
        try {
          const parsed = JSON.parse(e.newValue);
          if (parsed && parsed.updatedAt !== currentRoomRef.current?.updatedAt) {
            currentRoomRef.current = parsed;
            setCurrentRoom(parsed);
          }
        } catch (err) {
          // ignore
        }
      }
    };
    window.addEventListener('storage', handleStorageChange);

    // Fallback polling for static / local environment
    const interval = setInterval(async () => {
      if (!isStaticHostingDetected) {
        try {
          const data = await fetchRoomApi(`/api/rooms/${roomCode}?playerId=${myPlayerId}`);
          if (data.success && data.room && data.room.updatedAt !== currentRoomRef.current?.updatedAt) {
            currentRoomRef.current = data.room;
            setCurrentRoom(data.room);
          }
        } catch (err) {
          // silent
        }
      } else {
        const localRoom = getLocalStaticRoom(roomCode, faqs);
        if (localRoom && localRoom.updatedAt !== currentRoomRef.current?.updatedAt) {
          currentRoomRef.current = localRoom;
          setCurrentRoom(localRoom);
        }
      }
    }, 2000);

    return () => {
      clearInterval(interval);
      unsubscribeFirebase();
      window.removeEventListener('storage', handleStorageChange);
    };
  }, [currentRoom?.code, myPlayerId, passcode]);

  // Handle Saving Renamed Name
  const handleSaveName = (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    const clean = nameInput.trim();
    if (!clean) {
      showToast('名稱不可為空', '請輸入有效的使用者名稱', 'warning');
      return;
    }
    setDisplayName(clean);
    localStorage.setItem(`milktea_username_${passcode}`, clean);
    setIsEditingName(false);
    showToast('名稱更新成功！', `已為帳號 ${passcode} 儲存名稱為「${clean}」`, 'success');
  };

  // Handle Logout
  const handleLogout = () => {
    setPasscode('');
    sessionStorage.removeItem(SESSION_PASSCODE_KEY);
    localStorage.removeItem(PASSCODE_STORAGE_KEY);
    setCurrentRoom(null);
    showToast('已成功登出', '請選擇或輸入暗號重新登入', 'info');
  };

  // Login / Switch Identity
  const handleLoginWithPasscode = async (codeToUse: string, silent = false) => {
    const cleanCode = codeToUse.trim();
    if (!cleanCode) {
      if (!silent) showToast('請輸入暗號或帳號名稱', '不可為空', 'error');
      return;
    }

    setIsAuthLoading(true);
    try {
      const data = await fetchRoomApi('/api/rooms/login-with-passcode', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ passcode: cleanCode, questions: faqs, tabSessionId }),
      });

      if (data.success && data.room) {
        const thisPlayerId = data.playerId || `p-${cleanCode}-${tabSessionId}`;

        // Multi-tab co-play auto detection:
        const isSessionExplicit = !!sessionStorage.getItem(SESSION_PASSCODE_KEY);
        if (!isSessionExplicit && cleanCode === '1105' && data.room?.players) {
          const otherActive1105 = data.room.players.find(
            (p: any) =>
              p.name === '1105' &&
              p.id !== thisPlayerId &&
              p.lastActive &&
              Date.now() - new Date(p.lastActive).getTime() < 30000
          );
          if (otherActive1105) {
            showToast('⚡ 自動切換 2P 帳號', '檢測到 1105 (1P) 已有其他視窗連線中，本視窗已自動為您切換為 1115 (2P)！', 'info');
            return handleLoginWithPasscode('1115', silent);
          }
        }

        setPasscode(cleanCode);
        sessionStorage.setItem(SESSION_PASSCODE_KEY, cleanCode);
        localStorage.setItem(PASSCODE_STORAGE_KEY, cleanCode);
        setCurrentRoom(data.room);
        setMyPlayerId(thisPlayerId);

        const loadedName = getSavedNameForPasscode(cleanCode);
        setDisplayName(loadedName);

        if (!silent) {
          showToast(`連線成功！`, `已以帳號「${loadedName} (${cleanCode})」登入房間`, 'success');
        }
      } else {
        // Static Host / GitHub Pages Fallback Mode
        const thisPlayerId = `p-${cleanCode}-${tabSessionId}`;
        const room = getLocalStaticRoom('DUAL-1105-1115', faqs);

        let player = room.players.find((p) => p.id === thisPlayerId);
        if (!player) {
          const defaultPlayer = room.players.find((p) => p.name === cleanCode);
          if (defaultPlayer) {
            defaultPlayer.id = thisPlayerId;
            defaultPlayer.lastActive = new Date().toISOString();
          } else {
            room.players.push({
              id: thisPlayerId,
              name: cleanCode,
              score: 0,
              isHost: false,
              lastActive: new Date().toISOString(),
            });
          }
        } else {
          player.lastActive = new Date().toISOString();
        }

        room.updatedAt = new Date().toISOString();
        saveLocalStaticRoom(room);

        setPasscode(cleanCode);
        sessionStorage.setItem(SESSION_PASSCODE_KEY, cleanCode);
        localStorage.setItem(PASSCODE_STORAGE_KEY, cleanCode);
        setCurrentRoom(room);
        setMyPlayerId(thisPlayerId);

        const loadedName = getSavedNameForPasscode(cleanCode);
        setDisplayName(loadedName);

        if (!silent) {
          showToast(`連線成功！`, `已以帳號「${loadedName} (${cleanCode})」登入房間`, 'success');
        }
      }
    } catch (err: any) {
      if (!silent) showToast('連線失敗', err.message, 'error');
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

    const config = getStoredNotionConfig();

    try {
      const data = await fetchRoomApi(`/api/rooms/${currentRoom.code}/chat`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          author: displayName || passcode,
          text: chatMessageText.trim(),
          notionToken: config.token,
          notionDbId: config.answerDatabaseId || config.databaseId,
        }),
      });

      if (data.success && data.room) {
        setCurrentRoom(data.room);
        setChatMessageText('');
        scrollToBottom();
        if (data.message?.isSyncedToNotion) {
          showToast('對話已發送', '資料已成功寫入 Notion 資料庫！', 'success');
        } else {
          showToast(
            '對話已發送',
            data.message?.notionError || '提示：Notion 未寫入，請檢查 Token 與 Notion 資料庫連結授權',
            'warning'
          );
        }
      } else {
        const newMsg = {
          id: `msg-${Date.now()}`,
          author: displayName || passcode,
          text: chatMessageText.trim(),
          timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
          isSyncedToNotion: false,
        };
        const room = {
          ...currentRoom,
          messages: [...currentRoom.messages, newMsg],
          updatedAt: new Date().toISOString(),
        };
        saveLocalStaticRoom(room);
        setCurrentRoom(room);
        setChatMessageText('');
        scrollToBottom();
        showToast('對話已發送', '訊息已成功儲存於對話視窗', 'success');
      }
    } catch (err: any) {
      showToast('發送訊息失敗', err.message, 'error');
    }
  };

  // Initiate Game Challenge
  const handleSendGameInvite = async () => {
    if (!currentRoom) return;
    setIsQuestionModalDismissed(false);
    setIsQuestionModalOpen(false);
    const config = getStoredNotionConfig();
    try {
      const data = await fetchRoomApi(`/api/rooms/${currentRoom.code}/invite`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          sender: passcode,
          notionToken: config.token,
          notionDbId: config.databaseId,
        }),
      });

      if (data.success && data.room) {
        setCurrentRoom(data.room);
        showToast('發起猜心考驗', `已向 ${partnerDisplayName} 發出挑戰邀請！`, 'info');
      } else {
        const sysMsg = {
          id: `msg-inv-${Date.now()}`,
          author: '系統廣播',
          text: `🎮 【人員 ${passcode}】向【人員 ${partnerPasscode}】發起了猜心考驗！等待對方確認...`,
          timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
          type: 'invite' as const,
          isSyncedToNotion: false,
        };
        const room: CoPlayRoom = {
          ...currentRoom,
          activeGameQuestion: undefined,
          gameInvitation: {
            id: `inv-${Date.now()}`,
            sender: passcode,
            target: partnerPasscode,
            status: 'pending',
            createdAt: new Date().toISOString(),
          },
          messages: [...currentRoom.messages, sysMsg],
          updatedAt: new Date().toISOString(),
        };
        saveLocalStaticRoom(room);
        setCurrentRoom(room);
        showToast('發起猜心考驗', `已向 ${partnerDisplayName} 發出挑戰邀請！`, 'info');
      }
    } catch (err: any) {
      showToast('邀請失敗', err.message, 'error');
    }
  };

  // Respond to Game Invite (Accept / Decline)
  const handleRespondInvite = async (accept: boolean) => {
    if (!currentRoom) return;
    const config = getStoredNotionConfig();
    try {
      const data = await fetchRoomApi(`/api/rooms/${currentRoom.code}/respond-invite`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          passcode,
          accept,
          notionToken: config.token,
          notionDbId: config.databaseId,
        }),
      });

      if (data.success && data.room) {
        setCurrentRoom(data.room);
        if (accept) {
          setIsAnswerModalDismissed(false);
          setIsQuestionModalDismissed(false);
          setSelectedOptIndex(null);
          setAnswerExplanation('');
          showToast('已接受挑戰！', `等待 ${partnerDisplayName} 設定考驗題目`, 'success');
        } else {
          showToast('已婉拒本次挑戰', '', 'info');
        }
      } else {
        const newStatus = accept ? 'accepted' : 'declined';
        const sysMsg = {
          id: `msg-res-${Date.now()}`,
          author: '系統廣播',
          text: accept
            ? `✅ 【人員 ${passcode}】接受了對決考驗！請對決發起人選擇題目。`
            : `❌ 【人員 ${passcode}】婉拒了本次猜心考驗。`,
          timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
          type: 'system' as const,
        };
        const room: CoPlayRoom = {
          ...currentRoom,
          gameInvitation: currentRoom.gameInvitation
            ? { ...currentRoom.gameInvitation, status: newStatus }
            : undefined,
          messages: [...currentRoom.messages, sysMsg],
          updatedAt: new Date().toISOString(),
        };
        saveLocalStaticRoom(room);
        setCurrentRoom(room);
        if (accept) {
          setIsAnswerModalDismissed(false);
          setIsQuestionModalDismissed(false);
          setSelectedOptIndex(null);
          setAnswerExplanation('');
          showToast('已接受挑戰！', `等待 ${partnerDisplayName} 設定考驗題目`, 'success');
        } else {
          showToast('已婉拒本次挑戰', '', 'info');
        }
      }
    } catch (err: any) {
      showToast('回應失敗', err.message, 'error');
    }
  };

  // Cancel Game Invitation
  const handleCancelInvite = async () => {
    if (!currentRoom) return;
    try {
      const data = await fetchRoomApi(`/api/rooms/${currentRoom.code}/cancel-invite`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ passcode }),
      });

      if (data.success && data.room) {
        setCurrentRoom(data.room);
        showToast('已取消發起', '已取消本次考驗邀請', 'info');
      } else {
        const sysMsg = {
          id: `msg-cancel-${Date.now()}`,
          author: '系統廣播',
          text: `🚫 【人員 ${passcode}】已取消了猜心考驗發起。`,
          timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
          type: 'system' as const,
        };
        const room: CoPlayRoom = {
          ...currentRoom,
          gameInvitation: undefined,
          messages: [...currentRoom.messages, sysMsg],
          updatedAt: new Date().toISOString(),
        };
        saveLocalStaticRoom(room);
        setCurrentRoom(room);
        showToast('已取消發起', '已取消本次考驗邀請', 'info');
      }
    } catch (err: any) {
      showToast('取消失敗', err.message, 'error');
    }
  };

  // Cancel Active Game Question
  const handleCancelActiveQuestion = async () => {
    if (!currentRoom) return;
    try {
      const data = await fetchRoomApi(`/api/rooms/${currentRoom.code}/cancel-question`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ passcode }),
      });

      if (data.success && data.room) {
        setCurrentRoom(data.room);
        setIsAnswerModalDismissed(false);
        showToast('已取消考驗', '已取消目前的考驗題目', 'info');
      } else {
        const sysMsg = {
          id: `msg-cancel-q-${Date.now()}`,
          author: '系統廣播',
          text: `🚫 【人員 ${passcode}】取消了本次猜心考驗題目。`,
          timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
          type: 'system' as const,
        };
        const room: CoPlayRoom = {
          ...currentRoom,
          activeGameQuestion: undefined,
          messages: [...currentRoom.messages, sysMsg],
          updatedAt: new Date().toISOString(),
        };
        saveLocalStaticRoom(room);
        setCurrentRoom(room);
        setIsAnswerModalDismissed(false);
        showToast('已取消考驗', '已取消目前的考驗題目', 'info');
      }
    } catch (err: any) {
      showToast('取消失敗', err.message, 'error');
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
    showToast('套用成功', `已選擇題目：${f.question}`, 'info');
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
      showToast('暫無資料', '題庫中目前沒有可抽取的題目', 'warning');
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
    showToast('隨機換題成功！', `已為您載入「${randomFaq.category || '自訂題庫'}」題目`, 'success');
  };

  // Submit Chosen Question & Options
  const handlePublishGameQuestion = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!currentRoom || !questionText.trim()) {
      showToast('請填寫題目', '請輸入要問對方的題目', 'warning');
      return;
    }

    const finalCategory = questionCategory === 'CUSTOM' ? (customCategoryInput.trim() || '自訂種類') : questionCategory;
    const config = getStoredNotionConfig();

    try {
      const options = [optA, optB, optC, optD].filter((o) => o.trim() !== '');
      const data = await fetchRoomApi(`/api/rooms/${currentRoom.code}/submit-game-question`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          sender: passcode,
          question: questionText.trim(),
          category: finalCategory,
          options,
          notionToken: config.token,
          notionDbId: config.questionDatabaseId || config.databaseId,
        }),
      });

      if (data.success && data.room) {
        setCurrentRoom(data.room);
        setIsQuestionModalOpen(false);
        setQuestionText('');
        setSelectedOptIndex(null);
        setAnswerExplanation('');
        scrollToBottom();
        showToast('題目已發布！', `題目類型：[${finalCategory}]，已發送至考驗視窗`, 'success');
      } else {
        const gameQuestionObj: RoomQuestion = {
          id: `gq-${Date.now()}`,
          initiator: passcode,
          target: partnerPasscode,
          question: questionText.trim(),
          category: finalCategory,
          options,
          createdAt: new Date().toISOString(),
        };
        const sysMsg = {
          id: `msg-gq-${Date.now()}`,
          author: '🎮 考驗發布',
          text: `❓ 【猜心考驗題目】：${questionText.trim()}\n等待【人員 ${partnerPasscode}】猜測您的真實選擇...`,
          timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
          type: 'system' as const,
        };
        const room: CoPlayRoom = {
          ...currentRoom,
          activeGameQuestion: gameQuestionObj,
          gameInvitation: undefined,
          messages: [...currentRoom.messages, sysMsg],
          updatedAt: new Date().toISOString(),
        };
        saveLocalStaticRoom(room);
        setCurrentRoom(room);
        setIsQuestionModalOpen(false);
        setQuestionText('');
        setSelectedOptIndex(null);
        setAnswerExplanation('');
        scrollToBottom();
        showToast('題目已發布！', `題目類型：[${finalCategory}]，已發送至考驗視窗`, 'success');
      }
    } catch (err: any) {
      showToast('連線失敗', err.message, 'error');
    }
  };

  // Submit Option in Modal (Target's true choice OR Initiator's guess)
  const handleSubmitOption = async (q: RoomQuestion) => {
    if (selectedOptIndex === null) {
      showToast('請選擇選項', '請選擇一個選項後再點擊送出', 'warning');
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

    const config = getStoredNotionConfig();

    setIsSubmittingOpt(true);
    try {
      const data = await fetchRoomApi(`/api/rooms/${currentRoom.code}/submit-game-answer`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          passcode,
          selectedOption: selectedOptIndex,
          selectedText,
          authorName: displayName,
          notionToken: config.token,
          notionDbId: config.answerDatabaseId || config.databaseId,
        }),
      });

      if (data.success && data.room) {
        setCurrentRoom(data.room);
        setSelectedOptIndex(null);
        setAnswerExplanation('');
        const isTarget = passcode === q.target;
        showToast(
          isTarget ? '真心話已送出！' : '猜測已送出！',
          isTarget ? `等待對方完成猜測` : `等待對方送出真心話`,
          'success'
        );
        if (data.gameQuestion?.isRevealed) {
          scrollToBottom();
        }
      } else {
        const isTarget = passcode === q.target;
        const updatedQ: RoomQuestion = { ...q };
        if (isTarget) {
          updatedQ.targetAnswer = selectedOptIndex;
          updatedQ.targetAnswerText = selectedText;
        } else {
          updatedQ.initiatorGuess = selectedOptIndex;
          updatedQ.initiatorGuessText = selectedText;
        }

        if (updatedQ.targetAnswer !== undefined && updatedQ.initiatorGuess !== undefined) {
          updatedQ.isRevealed = true;
          updatedQ.isCorrect = updatedQ.targetAnswer === updatedQ.initiatorGuess;
        }

        const sysMsg = {
          id: `msg-opt-${Date.now()}`,
          author: '系統連動',
          text: isTarget
            ? `🔒 【人員 ${passcode}】已設定真心話答案！`
            : `🎯 【人員 ${passcode}】已選擇猜測選項！`,
          timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
          type: 'system' as const,
        };

        const roomMessages = [...currentRoom.messages, sysMsg];

        if (updatedQ.isRevealed) {
          const resultText = updatedQ.isCorrect
            ? `🎉 【猜心結果揭曉：猜對了！】\n猜測者成功猜中！\n真心話答案是「${updatedQ.targetAnswerText}」。`
            : `❌ 【猜心結果揭曉：沒猜中！】\n真心話選擇是「${updatedQ.targetAnswerText}」\n猜測選項是「${updatedQ.initiatorGuessText}」。`;

          roomMessages.push({
            id: `msg-rev-${Date.now()}`,
            author: '🎯 揭曉報告',
            text: resultText,
            timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
            type: 'system' as const,
          });
        }

        const room: CoPlayRoom = {
          ...currentRoom,
          activeGameQuestion: updatedQ,
          messages: roomMessages,
          updatedAt: new Date().toISOString(),
        };

        saveLocalStaticRoom(room);
        setCurrentRoom(room);
        setSelectedOptIndex(null);
        setAnswerExplanation('');
        showToast(
          isTarget ? '真心話已送出！' : '猜測已送出！',
          isTarget ? `等待對方完成猜測` : `等待對方送出真心話`,
          'success'
        );
        if (updatedQ.isRevealed) {
          scrollToBottom();
        }
      }
    } catch (err: any) {
      showToast('作答失敗', err.message, 'error');
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

  // Multi-device/tab online status helpers
  const is1105Online = currentRoom?.players.some(
    (p) => p.name === '1105' && p.lastActive && Date.now() - new Date(p.lastActive).getTime() < 30000
  );
  const is1115Online = currentRoom?.players.some(
    (p) => p.name === '1115' && p.lastActive && Date.now() - new Date(p.lastActive).getTime() < 30000
  );

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
      {/* Identity Conflict Warning Banner */}
      {isDuplicateActiveAccount && (
        <div className="shrink-0 p-3 sm:p-4 rounded-2xl bg-amber-50 border-2 border-amber-300 text-amber-900 shadow-md flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3 animate-fade-in">
          <div className="flex items-start gap-2.5">
            <AlertCircle className="w-5 h-5 text-amber-600 shrink-0 mt-0.5" />
            <div className="text-xs space-y-0.5">
              <div className="font-bold text-amber-900">
                ⚠️ 身分重複提示：線上另一台裝置也正在使用【{passcode}】帳號！
              </div>
              <div className="text-amber-800 leading-relaxed">
                這會導致雙方都被判定為相同使用者而無法接收考驗與選項。請點擊右側按鈕切換為【{passcode === '1105' ? '1115 (2P)' : '1105 (1P)'}】即可正常連線對決！
              </div>
            </div>
          </div>
          <button
            type="button"
            onClick={() => {
              const targetCode = passcode === '1105' ? '1115' : '1105';
              handleLoginWithPasscode(targetCode, false);
            }}
            className="px-3.5 py-2 rounded-xl bg-amber-600 hover:bg-amber-700 text-white text-xs font-bold transition-colors cursor-pointer shrink-0 shadow-xs flex items-center gap-1.5"
          >
            <RefreshCw className="w-3.5 h-3.5" />
            <span>⚡ 一鍵切換為 {passcode === '1105' ? '1115 (2P)' : '1105 (1P)'}</span>
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
                  <span className="text-xs text-[#7A6C5E] font-medium">代表帳號：</span>
                  <span className="text-xs sm:text-sm font-bold text-[#4A3F35]">
                    {displayName} <span className="text-[10px] text-[#A68B6D]">({passcode})</span>
                  </span>
                </div>

                {/* Online Indicator */}
                <div className="flex items-center gap-1.5 px-2.5 py-1 rounded-xl bg-emerald-50 border border-emerald-300 text-emerald-800 text-xs font-bold shadow-2xs">
                  <span className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse" />
                  <span>線上 ({currentRoom?.players.length || 1} 人)</span>
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
                  <Edit3 className="w-3.5 h-3.5 text-[#A68B6D]" />
                  <span>改名</span>
                </button>

                {/* Quick Toggle 1105 / 1115 button for multi-window testing */}
                <button
                  type="button"
                  onClick={() => {
                    const targetCode = passcode === '1105' ? '1115' : '1105';
                    handleLoginWithPasscode(targetCode, false);
                  }}
                  className="px-2.5 py-1 rounded-xl bg-purple-100 border border-purple-300 text-purple-900 text-xs font-bold hover:bg-purple-200 transition-colors flex items-center gap-1 cursor-pointer"
                  title={`快速切換為 ${passcode === '1105' ? '1115' : '1105'} 測試雙人對決`}
                >
                  <RefreshCw className="w-3.5 h-3.5 text-purple-700" />
                  <span>切為 {passcode === '1105' ? '1115 (2P)' : '1105 (1P)'}</span>
                </button>

                {/* Switch Account Button */}
                <button
                  type="button"
                  onClick={handleLogout}
                  className="px-2.5 py-1 rounded-xl bg-amber-100 border border-amber-300 text-amber-900 text-xs font-bold hover:bg-amber-200 transition-colors flex items-center gap-1 cursor-pointer"
                  title="切換其他帳號"
                >
                  <UserCheck className="w-3.5 h-3.5 text-amber-700" />
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
            已同意挑戰！等待【{partnerDisplayName}】選擇/設定考驗題目...
          </span>
        </div>
      )}

      {/* Banner 1: Waiting Initiator to set question when Modal 2 is dismissed */}
      {isAcceptedWaitingInitiator && isQuestionModalDismissed && (
        <div className="p-3 bg-amber-50 border border-amber-300 rounded-2xl flex items-center justify-between text-xs text-amber-900 font-bold shrink-0 shadow-2xs animate-fade-in mb-2">
          <span className="flex items-center gap-2 truncate pr-2">
            <Sparkles className="w-4 h-4 text-amber-600 shrink-0 animate-pulse" />
            <span className="truncate">【{partnerDisplayName}】已同意挑戰！請設定猜心題目</span>
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
              設定題目 🎯
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
              🎯 猜心考驗作答進行中 [{activeQ.category}]：{activeQ.question}
            </span>
          </div>
          <div className="flex items-center gap-2 shrink-0">
            <button
              type="button"
              onClick={() => setIsAnswerModalDismissed(false)}
              className="px-3 py-1.5 rounded-xl bg-[#A68B6D] hover:bg-[#8E7256] text-white text-xs font-bold transition-colors cursor-pointer shadow-2xs"
            >
              開啟作答 🎯
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
              <h3 className="text-sm font-bold text-[#4A3F35]">猜心對話交流框</h3>
              <p className="text-[10px] text-[#7A6C5E]">訊息與考驗結果皆即時寫入 Notion Database</p>
            </div>
          </div>

          <button
            type="button"
            onClick={handleSendGameInvite}
            className="px-3 py-1.5 rounded-xl bg-[#E8D8C4] hover:bg-[#D9C5B2] text-[#4A3F35] text-xs font-bold flex items-center gap-1 transition-colors"
          >
            <PlusCircle className="w-3.5 h-3.5 text-[#A68B6D]" />
            <span>發起猜心題目</span>
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
              <ArrowDown className="w-4 h-4 text-amber-200" />
              <span>有新對話／結果訊息 (點擊滾動至最新) ↓</span>
            </button>
          </div>
        )}

        {/* Notion & Notify Rule Status Banner */}
        <div className="mb-3 p-3 rounded-2xl bg-[#FAF7F2] border border-[#D9C5B2] text-[#5C4B3A] text-xs flex items-start gap-2.5 shadow-2xs">
          <Database className="w-4 h-4 text-[#A68B6D] shrink-0 mt-0.5" />
          <div className="flex-1 space-y-1">
            <div className="font-bold text-[#4A3F35] flex items-center justify-between">
              <span>📌 系統通知覆蓋機制與 Notion 連線狀態</span>
              <span className="text-[10px] text-[#8C6D53] bg-[#E8D8C4]/60 px-2 py-0.5 rounded-full font-bold">
                Notify 最多 2 條 (右上角彈窗廣播)
              </span>
            </div>
            <p className="text-[11px] leading-relaxed text-[#7A6C5E]">
              1. 系統通知與 Notify 彈窗提示已調整至 **畫面右上角**，訊息最多保留 2 條自動覆蓋舊通知。<br />
              2. 已修正 Notion 寫入驗證與 Database ID 相容邏輯，連線寫入與揭曉報告即時同步。
            </p>
          </div>
        </div>

        {/* Embedded Dialogue Stream */}
        <div className="flex-1 min-h-0 overflow-y-auto space-y-3.5 pr-1.5 scrollbar-thin relative">
          {!currentRoom ? (
            <div className="flex items-center justify-center h-full text-xs text-[#7A6C5E] gap-2">
              <RefreshCw className="w-4 h-4 animate-spin text-[#A68B6D]" />
              <span>載入對話框中...</span>
            </div>
          ) : (
            currentRoom.messages.map((m, idx) => {
              const isSystem = m.author.includes('系統');
              const isMe = m.author === passcode;
              const isResultReport = m.author === '🎯 揭曉報告' || m.text.includes('【猜心結果揭曉');
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
                          <Award className="w-4 h-4 text-amber-600" />
                          <span>🎯 雙人猜心考驗揭曉報告</span>
                        </div>
                        {m.isSyncedToNotion ? (
                          <span className="text-[10px] px-2 py-0.5 rounded-md bg-emerald-100 text-emerald-800 font-bold flex items-center gap-1">
                            <CheckCircle2 className="w-3 h-3 text-emerald-600" />
                            Notion 已寫入
                          </span>
                        ) : (
                          <span
                            className="text-[10px] px-2 py-0.5 rounded-md bg-amber-100 text-amber-800 font-bold flex items-center gap-1 cursor-help"
                            title={m.notionError || '請至「後台管理」填寫 Notion Token & Database ID，並於 Notion 頁面開啟 Add Connections 授權'}
                          >
                            <AlertCircle className="w-3 h-3 text-amber-600" />
                            Notion 未寫入 (缺資訊)
                          </span>
                        )}
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
                    {m.isSyncedToNotion ? (
                      <span className="px-1.5 py-0.2 rounded bg-emerald-100 text-emerald-800 text-[9px] font-bold">
                        Notion 已寫入
                      </span>
                    ) : (
                      <span
                        className="px-1.5 py-0.2 rounded bg-amber-100 text-amber-800 text-[9px] font-bold cursor-help"
                        title={m.notionError || '缺少有效 Notion Token / 資料庫權限'}
                      >
                        Notion 未同步
                      </span>
                    )}
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
              placeholder={`以 ${displayName} 在此發送對話 (寫至 Notion 資料庫)...`}
              className="flex-1 px-4 py-3 text-xs rounded-2xl milk-tea-input font-medium"
            />
            <button
              type="submit"
              className="milk-tea-btn-primary px-5 py-3 rounded-2xl text-xs font-bold inline-flex items-center gap-1.5 shadow-xs shrink-0"
            >
              <Send className="w-3.5 h-3.5" />
              <span>發送對話</span>
            </button>
          </form>
        </div>
      </div>
    </div>
  );
};

