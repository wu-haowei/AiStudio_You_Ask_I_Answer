import React, { useState, useEffect } from 'react';
import {
  Users,
  Database,
  CheckCircle2,
  RefreshCw,
  Send,
  Sparkles,
  Trophy,
  MessageSquare,
  ArrowRight,
  ShieldCheck,
  AlertCircle,
  Key,
  Lock,
  LogOut,
  HelpCircle,
} from 'lucide-react';
import { CoPlayRoom, FAQItem, NotionConfig } from '../types';
import { getStoredNotionConfig, saveStoredNotionConfig } from '../utils/storage';

interface CoPlayAndNotionViewProps {
  faqs: FAQItem[];
  showToast: (title: string, description?: string, type?: 'success' | 'info' | 'warning' | 'error') => void;
}

const PASSCODE_STORAGE_KEY = 'milktea_coplay_passcode';

export const CoPlayAndNotionView: React.FC<CoPlayAndNotionViewProps> = ({ faqs, showToast }) => {
  // Notion Configuration State
  const [notionConfig, setNotionConfig] = useState<NotionConfig>(getStoredNotionConfig());
  const [notionToken, setNotionToken] = useState(notionConfig.token);
  const [notionDbId, setNotionDbId] = useState(notionConfig.databaseId);
  const [isTestingNotion, setIsTestingNotion] = useState(false);
  const [notionStatus, setNotionStatus] = useState<'connected' | 'disconnected' | 'testing'>('disconnected');
  const [notionDbTitle, setNotionDbTitle] = useState('');
  const [isSyncingAll, setIsSyncingAll] = useState(false);

  // Passcode Auth State (1105 / 1115)
  const [passcode, setPasscode] = useState<string>(() => localStorage.getItem(PASSCODE_STORAGE_KEY) || '');
  const [passcodeInput, setPasscodeInput] = useState('');
  const [isAuthLoading, setIsAuthLoading] = useState(false);

  // Room State
  const [currentRoom, setCurrentRoom] = useState<CoPlayRoom | null>(null);
  const [myPlayerId, setMyPlayerId] = useState<string>('');
  const [chatMessageText, setChatMessageText] = useState('');

  // View SubTab: 'co_play' or 'notion_settings'
  const [subTab, setSubTab] = useState<'co_play' | 'notion_settings'>('co_play');

  // Auto Login if saved passcode exists
  useEffect(() => {
    if (passcode === '1105' || passcode === '1115') {
      handleLoginWithPasscode(passcode, true);
    }
  }, []);

  // Poll room status if currently in a room
  useEffect(() => {
    if (!currentRoom || !passcode) return;

    const interval = setInterval(async () => {
      try {
        const res = await fetch(`/api/rooms/${currentRoom.code}?playerId=${myPlayerId}`);
        if (res.ok) {
          const data = await res.json();
          if (data.success && data.room) {
            setCurrentRoom(data.room);
          }
        }
      } catch (err) {
        console.error('Room poll error:', err);
      }
    }, 2000);

    return () => clearInterval(interval);
  }, [currentRoom?.code, myPlayerId, passcode]);

  // Test Notion connection on load
  useEffect(() => {
    if (notionConfig.token && notionConfig.databaseId) {
      handleTestNotionConnection(notionConfig.token, notionConfig.databaseId, true);
    }
  }, []);

  // Login with Passcode (1105 / 1115)
  const handleLoginWithPasscode = async (codeToUse: string, silent = false) => {
    const cleanCode = codeToUse.trim();
    if (cleanCode !== '1105' && cleanCode !== '1115') {
      if (!silent) showToast('密碼無效', '請輸入密碼：1105 或 1115', 'error');
      return;
    }

    setIsAuthLoading(true);
    try {
      const res = await fetch('/api/rooms/login-with-passcode', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ passcode: cleanCode, questions: faqs }),
      });

      const data = await res.json();
      if (res.ok && data.success) {
        setPasscode(cleanCode);
        localStorage.setItem(PASSCODE_STORAGE_KEY, cleanCode);
        setCurrentRoom(data.room);
        setMyPlayerId(data.playerId);

        if (!silent) {
          showToast(`人員 ${cleanCode} 登入成功！`, '歷史對話與答題紀錄已自動保留載入', 'success');
        }
      } else {
        if (!silent) showToast('登入失敗', data.error || '密碼錯誤', 'error');
      }
    } catch (err: any) {
      if (!silent) showToast('連線失敗', err.message, 'error');
    } finally {
      setIsAuthLoading(false);
    }
  };

  // Switch identity / logout passcode
  const handleLogoutPasscode = () => {
    localStorage.removeItem(PASSCODE_STORAGE_KEY);
    setPasscode('');
    setCurrentRoom(null);
    setMyPlayerId('');
    showToast('已登出人員身分', '請重新輸入密碼 (1105 或 1115) 登入', 'info');
  };

  // Test Notion connection
  const handleTestNotionConnection = async (token = notionToken, dbId = notionDbId, silent = false) => {
    if (!token.trim() || !dbId.trim()) {
      if (!silent) showToast('請填寫 Notion Token 與 Database ID', '', 'warning');
      return;
    }

    setIsTestingNotion(true);
    setNotionStatus('testing');

    try {
      const res = await fetch('/api/notion/test-connection', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token: token.trim(), databaseId: dbId.trim() }),
      });

      const data = await res.json();

      if (res.ok && data.success) {
        setNotionStatus('connected');
        setNotionDbTitle(data.title || 'Notion 資料庫');

        const updated = { token: token.trim(), databaseId: dbId.trim(), autoSync: true };
        setNotionConfig(updated);
        saveStoredNotionConfig(updated);

        if (!silent) {
          showToast('Notion 連線成功！', `已成功存取「${data.title || 'Notion 資料庫'}」`, 'success');
        }
      } else {
        setNotionStatus('disconnected');
        if (!silent) {
          showToast('Notion 連線失敗', data.error || '請檢查 Token 與權限設定', 'error');
        }
      }
    } catch (err: any) {
      setNotionStatus('disconnected');
      if (!silent) {
        showToast('無法連線至伺服器', err.message, 'error');
      }
    } finally {
      setIsTestingNotion(false);
    }
  };

  // Batch sync all FAQs to Notion
  const handleBatchSyncAllFAQs = async () => {
    if (!notionConfig.token || !notionConfig.databaseId) {
      showToast('請先連線 Notion 資料庫', '', 'warning');
      setSubTab('notion_settings');
      return;
    }

    setIsSyncingAll(true);
    let successCount = 0;

    for (const faq of faqs) {
      try {
        const res = await fetch('/api/notion/sync-question', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            token: notionConfig.token,
            databaseId: notionConfig.databaseId,
            question: faq.question,
            answer: faq.answer,
            category: faq.category,
            tags: faq.tags,
          }),
        });

        if (res.ok) successCount++;
      } catch (err) {
        console.error('Batch sync item error:', err);
      }
    }

    setIsSyncingAll(false);
    showToast(`成功同步 ${successCount} 則題目至 Notion！`, '包含所有自訂 Q&A 內容與解析。', 'success');
  };

  // Submit Quiz Answer
  const handleSubmitAnswer = async (selectedOptionIndex: number) => {
    if (!currentRoom) return;
    try {
      const res = await fetch(`/api/rooms/${currentRoom.code}/answer`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          playerId: myPlayerId,
          selectedOptionIndex,
        }),
      });

      const data = await res.json();
      if (res.ok && data.success) {
        setCurrentRoom(data.room);
        showToast(
          data.isCorrect ? '答對了！+10 分' : '答錯囉，再接再厲！',
          '',
          data.isCorrect ? 'success' : 'info'
        );
      }
    } catch (err: any) {
      showToast('答題出錯', err.message, 'error');
    }
  };

  // Next Question
  const handleNextQuestion = async () => {
    if (!currentRoom) return;
    try {
      const res = await fetch(`/api/rooms/${currentRoom.code}/next`, {
        method: 'POST',
      });
      const data = await res.json();
      if (res.ok && data.success) {
        setCurrentRoom(data.room);
      }
    } catch (err: any) {
      showToast('無法切換題目', err.message, 'error');
    }
  };

  // Send Chat Message
  const handleSendChatMessage = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!currentRoom || !chatMessageText.trim()) return;

    const authorName = passcode || '1105';

    try {
      const res = await fetch(`/api/rooms/${currentRoom.code}/chat`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          author: authorName,
          text: chatMessageText.trim(),
        }),
      });

      const data = await res.json();
      if (res.ok && data.success) {
        setCurrentRoom(data.room);
        setChatMessageText('');

        // If autoSync enabled, sync chat message to Notion too
        if (notionConfig.token && notionConfig.databaseId) {
          fetch('/api/notion/sync-chat', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              token: notionConfig.token,
              databaseId: notionConfig.databaseId,
              author: authorName,
              messageText: chatMessageText.trim(),
              roomCode: currentRoom.code,
            }),
          }).catch((err) => console.error('Auto sync chat error:', err));
        }
      }
    } catch (err: any) {
      showToast('發送訊息失敗', err.message, 'error');
    }
  };

  // Sync single chat to Notion manually
  const handleSyncChatToNotion = async (author: string, text: string) => {
    if (!notionConfig.token || !notionConfig.databaseId) {
      showToast('請先連線 Notion 資料庫', '點擊上方「Notion 設定」進行連線', 'warning');
      return;
    }

    try {
      const res = await fetch('/api/notion/sync-chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          token: notionConfig.token,
          databaseId: notionConfig.databaseId,
          author,
          messageText: text,
          roomCode: currentRoom?.code || '1105-1115',
        }),
      });

      if (res.ok) {
        showToast('對話紀錄已成功存入 Notion！', '', 'success');
      } else {
        showToast('無法存入 Notion', '', 'error');
      }
    } catch (err: any) {
      showToast('同步異常', err.message, 'error');
    }
  };

  const myPlayerObj = currentRoom?.players.find((p) => p.name === passcode);

  return (
    <div className="space-y-6 pb-16">
      {/* Top Banner Header */}
      <div className="flex flex-col md:flex-row items-start md:items-center justify-between gap-4 p-6 sm:p-8 rounded-3xl bg-[#FAF7F2] border border-[#D9C5B2] shadow-xs">
        <div>
          <div className="flex flex-wrap items-center gap-2 mb-1">
            <span className="px-3 py-1 rounded-full bg-[#E8D8C4] text-[#5C4B3A] text-xs font-bold border border-[#D9C5B2]">
              雙人對話 & 答題模式 (密碼：1105 / 1115)
            </span>
            {notionStatus === 'connected' && (
              <span className="px-2.5 py-0.5 rounded-full bg-emerald-100 text-emerald-800 text-xs font-semibold flex items-center gap-1">
                <CheckCircle2 className="w-3.5 h-3.5 text-emerald-600" />
                Notion 已連線 ({notionDbTitle})
              </span>
            )}
          </div>
          <h1 className="text-xl sm:text-2xl font-bold text-[#4A3F35] flex items-center gap-2">
            <Users className="w-7 h-7 text-[#A68B6D]" />
            <span>雙人線上對話遊戲與 Notion 同步</span>
          </h1>
          <p className="text-xs sm:text-sm text-[#7A6C5E] mt-1 leading-relaxed max-w-2xl">
            不用手動創建房間，輸入密碼 <strong>1105</strong> 或 <strong>1115</strong> 即可直接登入對話與答題模式，系統會自動儲存對話與答題紀錄！
          </p>
        </div>

        {/* Subtab Switcher */}
        <div className="flex items-center gap-1.5 bg-[#E8D8C4]/60 p-1.5 rounded-2xl border border-[#D9C5B2] self-stretch md:self-auto justify-center">
          <button
            onClick={() => setSubTab('co_play')}
            className={`px-4 py-2 rounded-xl text-xs sm:text-sm font-semibold transition-all flex items-center gap-2 ${
              subTab === 'co_play'
                ? 'bg-[#A68B6D] text-white shadow-xs'
                : 'text-[#7A6C5E] hover:text-[#4A3F35]'
            }`}
          >
            <Users className="w-4 h-4" />
            <span>雙人連線與對話</span>
          </button>
          <button
            onClick={() => setSubTab('notion_settings')}
            className={`px-4 py-2 rounded-xl text-xs sm:text-sm font-semibold transition-all flex items-center gap-2 ${
              subTab === 'notion_settings'
                ? 'bg-[#A68B6D] text-white shadow-xs'
                : 'text-[#7A6C5E] hover:text-[#4A3F35]'
            }`}
          >
            <Database className="w-4 h-4" />
            <span>Notion 設定</span>
          </button>
        </div>
      </div>

      {/* Main Content Areas */}
      {subTab === 'notion_settings' ? (
        /* Notion Settings & Sync Dashboard */
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 animate-fade-in">
          {/* Notion Config Form Card */}
          <div className="lg:col-span-2 milk-tea-card rounded-3xl p-6 sm:p-8 space-y-6">
            <div className="flex items-center justify-between border-b border-[#D9C5B2] pb-4">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-2xl bg-[#E8D8C4] text-[#A68B6D] flex items-center justify-center font-bold">
                  <Key className="w-5 h-5" />
                </div>
                <div>
                  <h2 className="text-base sm:text-lg font-bold text-[#4A3F35]">
                    Notion API 連線與權限設定
                  </h2>
                  <p className="text-xs text-[#7A6C5E]">
                    輸入您的 Notion Internal Integration Token 與資料庫 ID。
                  </p>
                </div>
              </div>

              <span
                className={`text-xs px-3 py-1 rounded-full font-bold flex items-center gap-1 ${
                  notionStatus === 'connected'
                    ? 'bg-emerald-100 text-emerald-800'
                    : 'bg-amber-100 text-amber-800'
                }`}
              >
                {notionStatus === 'connected' ? (
                  <>
                    <CheckCircle2 className="w-3.5 h-3.5 text-emerald-600" /> 連線正常
                  </>
                ) : (
                  <>
                    <AlertCircle className="w-3.5 h-3.5 text-amber-600" /> 未建立連線
                  </>
                )}
              </span>
            </div>

            <div className="space-y-4">
              <div>
                <label className="block text-xs font-semibold text-[#4A3F35] mb-1.5">
                  Notion Integration Token <span className="text-rose-500">*</span>
                </label>
                <input
                  type="password"
                  value={notionToken}
                  onChange={(e) => setNotionToken(e.target.value)}
                  placeholder="secret_xxxxxxxxxxxxxxxxxxxxxxxxxxxx"
                  className="w-full px-4 py-3 text-sm rounded-xl milk-tea-input font-mono"
                />
              </div>

              <div>
                <label className="block text-xs font-semibold text-[#4A3F35] mb-1.5">
                  Notion Database ID <span className="text-rose-500">*</span>
                </label>
                <input
                  type="text"
                  value={notionDbId}
                  onChange={(e) => setNotionDbId(e.target.value)}
                  placeholder="例如：2906e88209608305a41a883089e88811"
                  className="w-full px-4 py-3 text-sm rounded-xl milk-tea-input font-mono"
                />
              </div>

              <div className="flex flex-wrap items-center justify-between gap-3 pt-4 border-t border-[#D9C5B2]">
                <button
                  onClick={() => handleTestNotionConnection(notionToken, notionDbId)}
                  disabled={isTestingNotion}
                  className="milk-tea-btn-secondary px-5 py-2.5 rounded-xl text-xs sm:text-sm font-semibold inline-flex items-center gap-2"
                >
                  <RefreshCw className={`w-4 h-4 ${isTestingNotion ? 'animate-spin' : ''}`} />
                  <span>{isTestingNotion ? '正在測試連線...' : '測試 Notion 連線'}</span>
                </button>

                <button
                  onClick={handleBatchSyncAllFAQs}
                  disabled={isSyncingAll || notionStatus !== 'connected'}
                  className="milk-tea-btn-primary px-5 py-2.5 rounded-xl text-xs sm:text-sm font-semibold inline-flex items-center gap-2 shadow-sm disabled:opacity-50"
                >
                  <Database className={`w-4 h-4 ${isSyncingAll ? 'animate-bounce' : ''}`} />
                  <span>{isSyncingAll ? '正在寫入 Notion...' : `一鍵匯出全站 ${faqs.length} 題至 Notion`}</span>
                </button>
              </div>
            </div>
          </div>

          {/* Guide */}
          <div className="milk-tea-card rounded-3xl p-6 sm:p-8 space-y-4 bg-[#FAF7F2]">
            <h3 className="text-sm sm:text-base font-bold text-[#4A3F35] flex items-center gap-2">
              <ShieldCheck className="w-5 h-5 text-[#A68B6D]" />
              <span>3 步驟快速設定 Notion 資料庫</span>
            </h3>

            <ol className="space-y-3 text-xs text-[#7A6C5E] list-decimal list-inside leading-relaxed">
              <li className="p-2.5 rounded-xl bg-white border border-[#D9C5B2]">
                <strong className="text-[#4A3F35]">建立 Notion Integration：</strong>
                <br />
                前往 <a href="https://www.notion.so/my-integrations" target="_blank" rel="noreferrer" className="text-[#A68B6D] underline">notion.so/my-integrations</a> 建立 Integration 取得 Token。
              </li>
              <li className="p-2.5 rounded-xl bg-white border border-[#D9C5B2]">
                <strong className="text-[#4A3F35]">授權資料庫 (Add Connection)：</strong>
                <br />
                在您的 Notion 資料庫頁面右上角「...」→「Add connections」開啟該 Integration 權限。
              </li>
              <li className="p-2.5 rounded-xl bg-white border border-[#D9C5B2]">
                <strong className="text-[#4A3F35]">貼上 Token 與 Database ID：</strong>
                <br />
                複製 Database ID 貼上測試連線即可！
              </li>
            </ol>
          </div>
        </div>
      ) : (
        /* Real-Time Dual Co-Play Dashboard */
        <div className="space-y-6 animate-fade-in">
          {!passcode || !currentRoom ? (
            /* Passcode Verification Card */
            <div className="max-w-md mx-auto milk-tea-card rounded-3xl p-6 sm:p-8 space-y-6">
              <div className="text-center space-y-2">
                <div className="w-14 h-14 rounded-2xl bg-[#E8D8C4] text-[#A68B6D] flex items-center justify-center font-bold mx-auto">
                  <Lock className="w-7 h-7" />
                </div>
                <h2 className="text-lg sm:text-xl font-bold text-[#4A3F35]">
                  請輸入人員密碼驗證登入
                </h2>
                <p className="text-xs text-[#7A6C5E]">
                  本系統提供兩位人員雙人跨裝置對決，請輸入密碼 <strong>1105</strong> 或 <strong>1115</strong>。
                </p>
              </div>

              <form
                onSubmit={(e) => {
                  e.preventDefault();
                  handleLoginWithPasscode(passcodeInput);
                }}
                className="space-y-4"
              >
                <div>
                  <label className="block text-xs font-semibold text-[#4A3F35] mb-1.5">
                    請輸入驗證密碼
                  </label>
                  <input
                    type="password"
                    required
                    value={passcodeInput}
                    onChange={(e) => setPasscodeInput(e.target.value)}
                    placeholder="輸入 1105 或 1115"
                    className="w-full px-4 py-3 text-center text-lg tracking-widest font-mono rounded-xl milk-tea-input font-bold"
                  />
                </div>

                <div className="flex gap-2">
                  <button
                    type="button"
                    onClick={() => {
                      setPasscodeInput('1105');
                      handleLoginWithPasscode('1105');
                    }}
                    className="flex-1 py-2 rounded-xl text-xs font-bold bg-[#E8D8C4] text-[#4A3F35] hover:bg-[#D9C5B2]"
                  >
                    快捷登入 1105
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setPasscodeInput('1115');
                      handleLoginWithPasscode('1115');
                    }}
                    className="flex-1 py-2 rounded-xl text-xs font-bold bg-[#E8D8C4] text-[#4A3F35] hover:bg-[#D9C5B2]"
                  >
                    快捷登入 1115
                  </button>
                </div>

                <button
                  type="submit"
                  disabled={isAuthLoading}
                  className="w-full milk-tea-btn-primary py-3.5 rounded-2xl text-sm font-semibold inline-flex items-center justify-center gap-2 shadow-sm"
                >
                  <Key className="w-4 h-4" />
                  <span>{isAuthLoading ? '正在驗證登入...' : '確認密碼並連線'}</span>
                </button>
              </form>
            </div>
          ) : (
            /* Active Direct Co-Play Room Screen */
            <div className="space-y-6">
              {/* User Identity Info Bar */}
              <div className="p-4 sm:p-5 rounded-3xl bg-[#FAF7F2] border border-[#D9C5B2] flex flex-wrap items-center justify-between gap-4 shadow-xs">
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 rounded-2xl bg-[#A68B6D] text-white flex items-center justify-center font-bold">
                    {passcode}
                  </div>
                  <div>
                    <div className="flex items-center gap-2">
                      <span className="text-sm font-bold text-[#4A3F35]">
                        目前登入人員：{passcode}
                      </span>
                      <span className="text-[10px] px-2 py-0.5 rounded-full bg-emerald-100 text-emerald-800 font-bold">
                        自動儲存狀態 ✅
                      </span>
                    </div>
                    <p className="text-xs text-[#7A6C5E] mt-0.5">
                      連線房間：{currentRoom.code} ｜ 雙人對決進行中
                    </p>
                  </div>
                </div>

                <div className="flex items-center gap-2">
                  <button
                    onClick={handleLogoutPasscode}
                    className="px-3.5 py-2 rounded-xl text-xs font-semibold text-[#7A6C5E] bg-[#E8D8C4]/60 hover:bg-[#E8D8C4] flex items-center gap-1.5"
                  >
                    <LogOut className="w-3.5 h-3.5" />
                    <span>切換人員身份 (登出)</span>
                  </button>
                </div>
              </div>

              {/* Main Content Grid: Quiz Game vs Dialogue Chat */}
              <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
                {/* Left Column: Interactive Quiz & Game Mode */}
                <div className="lg:col-span-2 space-y-6">
                  {/* Scoreboard Cards */}
                  <div className="grid grid-cols-2 gap-4">
                    {currentRoom.players.map((p) => {
                      const isMe = p.name === passcode;
                      return (
                        <div
                          key={p.id}
                          className={`p-4 rounded-2xl border transition-all ${
                            isMe
                              ? 'bg-white border-[#A68B6D] ring-2 ring-[#A68B6D]/20 shadow-sm'
                              : 'bg-[#FAF7F2] border-[#D9C5B2]'
                          }`}
                        >
                          <div className="flex items-center justify-between">
                            <span className="text-xs font-bold text-[#4A3F35] flex items-center gap-1">
                              人員 {p.name} {isMe && '(你)'}
                            </span>
                            <span className="w-2.5 h-2.5 rounded-full bg-emerald-500 animate-pulse"></span>
                          </div>
                          <div className="mt-2 flex items-baseline justify-between">
                            <span className="text-2xl font-extrabold text-[#A68B6D]">{p.score} 分</span>
                            <span className="text-[11px] text-[#7A6C5E]">
                              {p.answeredCurrent ? '已回答 ✅' : '思考中...'}
                            </span>
                          </div>
                        </div>
                      );
                    })}
                  </div>

                  {/* Active Question Panel */}
                  {(() => {
                    const currentQ = currentRoom.questions[currentRoom.currentQuestionIndex];
                    if (!currentQ) return null;

                    const hasAnswered = myPlayerObj?.answeredCurrent ?? false;
                    const options = currentQ.options || [
                      currentQ.answer,
                      '選項 A',
                      '選項 B',
                      '選項 C',
                    ];

                    return (
                      <div className="milk-tea-card rounded-3xl p-6 sm:p-8 space-y-6">
                        <div className="flex items-center justify-between border-b border-[#D9C5B2] pb-3">
                          <span className="text-xs font-bold px-3 py-1 rounded-full bg-[#E8D8C4] text-[#5C4B3A]">
                            第 {currentRoom.currentQuestionIndex + 1} / {currentRoom.questions.length} 題
                          </span>
                          <span className="text-xs text-[#7A6C5E]">【{currentQ.category}】</span>
                        </div>

                        <div>
                          <h3 className="text-base sm:text-lg font-bold text-[#4A3F35] leading-relaxed">
                            {currentQ.question}
                          </h3>
                        </div>

                        {/* Options */}
                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                          {options.map((opt: string, idx: number) => {
                            const isSelected = myPlayerObj?.lastSelectedOption === idx;
                            const isCorrect = idx === (currentQ.correctOptionIndex ?? 0);

                            let btnClass =
                              'bg-white text-[#4A3F35] border-[#D9C5B2] hover:border-[#A68B6D] hover:bg-[#E8D8C4]/20';

                            if (hasAnswered) {
                              if (isCorrect) {
                                btnClass = 'bg-emerald-100 text-emerald-800 border-emerald-400 font-bold';
                              } else if (isSelected) {
                                btnClass = 'bg-rose-100 text-rose-800 border-rose-400 font-bold';
                              } else {
                                btnClass = 'bg-gray-100 text-gray-400 border-gray-200 opacity-60';
                              }
                            }

                            return (
                              <button
                                key={idx}
                                disabled={hasAnswered}
                                onClick={() => handleSubmitAnswer(idx)}
                                className={`p-4 rounded-2xl border text-left text-xs sm:text-sm transition-all flex items-center justify-between ${btnClass}`}
                              >
                                <span>{opt}</span>
                                {hasAnswered && isCorrect && (
                                  <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0" />
                                )}
                              </button>
                            );
                          })}
                        </div>

                        {/* Explanation block */}
                        {hasAnswered && (
                          <div className="p-4 rounded-2xl bg-[#E8D8C4]/40 border border-[#D9C5B2] text-xs text-[#4A3F35] leading-relaxed space-y-1 animate-fade-in">
                            <p className="font-bold text-[#A68B6D]">💡 答案與詳細解析說明：</p>
                            <p>{currentQ.answer}</p>
                          </div>
                        )}

                        {/* Control for Next Question */}
                        {hasAnswered && (
                          <div className="pt-2 flex justify-end">
                            <button
                              onClick={handleNextQuestion}
                              className="milk-tea-btn-primary px-5 py-2.5 rounded-xl text-xs sm:text-sm font-semibold inline-flex items-center gap-1.5 shadow-sm"
                            >
                              <span>進入下一題</span>
                              <ArrowRight className="w-4 h-4" />
                            </button>
                          </div>
                        )}
                      </div>
                    );
                  })()}
                </div>

                {/* Right Column: Live Room Chat & Notion Log */}
                <div className="milk-tea-card rounded-3xl p-5 sm:p-6 flex flex-col justify-between h-[540px]">
                  <div className="space-y-3 flex-1 flex flex-col overflow-hidden">
                    <div className="flex items-center justify-between border-b border-[#D9C5B2] pb-3">
                      <h3 className="text-sm font-bold text-[#4A3F35] flex items-center gap-1.5">
                        <MessageSquare className="w-4 h-4 text-[#A68B6D]" />
                        <span>雙人即時對話區</span>
                      </h3>
                      <span className="text-[10px] text-[#7A6C5E]">自動儲存紀錄</span>
                    </div>

                    {/* Messages Feed */}
                    <div className="flex-1 overflow-y-auto space-y-2.5 pr-1 text-xs">
                      {currentRoom.messages.map((m) => (
                        <div
                          key={m.id}
                          className={`p-3 rounded-2xl ${
                            m.author === '系統提示' || m.author === '系統廣播'
                              ? 'bg-[#E8D8C4]/40 text-[#5C4B3A] border border-[#D9C5B2]/60'
                              : m.author === passcode
                              ? 'bg-amber-50/80 border border-[#D9C5B2]'
                              : 'bg-white border border-[#D9C5B2]'
                          }`}
                        >
                          <div className="flex items-center justify-between text-[11px] mb-1">
                            <span className="font-bold text-[#4A3F35]">
                              {m.author} {m.author === passcode && '(你)'}
                            </span>
                            <div className="flex items-center gap-1">
                              <span className="text-[#7A6C5E] text-[10px]">{m.timestamp}</span>
                              {m.author !== '系統提示' && m.author !== '系統廣播' && (
                                <button
                                  onClick={() => handleSyncChatToNotion(m.author, m.text)}
                                  className="p-0.5 rounded text-[#A68B6D] hover:bg-[#E8D8C4]"
                                  title="存至 Notion"
                                >
                                  <Database className="w-3 h-3" />
                                </button>
                              )}
                            </div>
                          </div>
                          <p className="text-[#4A3F35] leading-relaxed font-sans">{m.text}</p>
                        </div>
                      ))}
                    </div>
                  </div>

                  {/* Chat Input Form */}
                  <form onSubmit={handleSendChatMessage} className="pt-3 border-t border-[#D9C5B2] flex items-center gap-2">
                    <input
                      type="text"
                      value={chatMessageText}
                      onChange={(e) => setChatMessageText(e.target.value)}
                      placeholder={`以 ${passcode} 身份輸入對話與交流...`}
                      className="flex-1 px-3.5 py-2 text-xs rounded-xl milk-tea-input"
                    />
                    <button
                      type="submit"
                      className="milk-tea-btn-primary p-2.5 rounded-xl shadow-xs"
                    >
                      <Send className="w-4 h-4" />
                    </button>
                  </form>
                </div>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
};
