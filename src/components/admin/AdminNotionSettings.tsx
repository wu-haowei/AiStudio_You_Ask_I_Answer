import React, { useState, useEffect } from 'react';
import { Key, CheckCircle2, AlertCircle, RefreshCw, Database } from 'lucide-react';
import { FAQItem, NotionConfig } from '../../types';
import {
  getStoredNotionConfig,
  saveStoredNotionConfig,
  HARDCODED_NOTION_QUESTION_DB_ID,
  HARDCODED_NOTION_ANSWER_DB_ID,
} from '../../utils/storage';
import { testNotionConnection, syncQuestionToNotion } from '../../utils/notionApi';

interface AdminNotionSettingsProps {
  faqs: FAQItem[];
  showToast: (title: string, description?: string, type?: 'success' | 'error' | 'info' | 'warning') => void;
}

export const AdminNotionSettings: React.FC<AdminNotionSettingsProps> = ({ faqs, showToast }) => {
  const [notionConfig, setNotionConfig] = useState<NotionConfig>(getStoredNotionConfig());
  const [notionToken, setNotionToken] = useState(notionConfig.token);
  const [questionDbId, setQuestionDbId] = useState(
    notionConfig.questionDatabaseId || HARDCODED_NOTION_QUESTION_DB_ID
  );
  const [answerDbId, setAnswerDbId] = useState(
    notionConfig.answerDatabaseId || HARDCODED_NOTION_ANSWER_DB_ID
  );
  const [isTestingNotion, setIsTestingNotion] = useState(false);
  const [notionStatus, setNotionStatus] = useState<'connected' | 'disconnected' | 'testing'>('disconnected');
  const [notionDbTitle, setNotionDbTitle] = useState('');
  const [isSyncingAll, setIsSyncingAll] = useState(false);

  useEffect(() => {
    if (notionConfig.token && (questionDbId || answerDbId)) {
      handleTestNotionConnection(notionConfig.token, answerDbId || questionDbId, true);
    }
  }, []);

  const handleTestNotionConnection = async (token = notionToken, dbId = answerDbId, silent = false) => {
    if (!token.trim() || !dbId.trim()) {
      if (!silent) showToast('請填寫 Notion Token 與 Database ID', '', 'warning');
      return;
    }

    setIsTestingNotion(true);
    setNotionStatus('testing');

    try {
      const result = await testNotionConnection(token, dbId);

      if (result.success) {
        setNotionStatus('connected');
        setNotionDbTitle(result.title || 'Notion 資料庫');

        const updated: NotionConfig = {
          token: token.trim(),
          databaseId: answerDbId.trim(),
          questionDatabaseId: questionDbId.trim(),
          answerDatabaseId: answerDbId.trim(),
          autoSync: true,
        };
        setNotionConfig(updated);
        saveStoredNotionConfig(updated);

        if (!silent) {
          if (result.isStaticFallback && result.error) {
            showToast('Notion 備份設定已備份至本機', result.error, 'info');
          } else {
            showToast('Notion 連線成功！', `已成功存取「${result.title || 'Notion 資料庫'}」`, 'success');
          }
        }
      } else {
        setNotionStatus('disconnected');
        if (!silent) {
          showToast('Notion 連線提示', result.error || '請檢查 Token 與權限設定', 'warning');
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

  const handleBatchSyncAllFAQs = async () => {
    if (!notionConfig.token || (!questionDbId && !notionConfig.databaseId)) {
      showToast('請先連線 Notion 資料庫', '', 'warning');
      return;
    }

    setIsSyncingAll(true);
    let successCount = 0;

    for (const faq of faqs) {
      const res = await syncQuestionToNotion(
        notionConfig.token,
        questionDbId || HARDCODED_NOTION_QUESTION_DB_ID,
        faq.question,
        faq.answer,
        faq.category,
        faq.tags,
        faq.options
      );

      if (res.success) successCount++;
    }

    setIsSyncingAll(false);
    showToast(`成功處理 ${successCount} 則題目備份同步！`, '已保存至 Notion 題目庫紀錄', 'success');
  };

  return (
    <div className="milk-tea-card rounded-3xl p-6 sm:p-8 space-y-5 border border-[#D9C5B2] bg-[#FAF7F2]">
      <div className="flex items-center justify-between border-b border-[#D9C5B2] pb-4">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-2xl bg-[#E8D8C4] text-[#A68B6D] flex items-center justify-center font-bold">
            <Key className="w-5 h-5" />
          </div>
          <div>
            <h2 className="text-base font-bold text-[#4A3F35]">
              Notion API 連線與備份設定 (後台專用)
            </h2>
            <p className="text-xs text-[#7A6C5E]">
              輸入 Notion Integration Token 與 Database ID，即時將題目與聊天紀錄同步至 Notion。
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
              <CheckCircle2 className="w-3.5 h-3.5 text-emerald-600" /> 已連線 ({notionDbTitle})
            </>
          ) : (
            <>
              <AlertCircle className="w-3.5 h-3.5 text-amber-600" /> 未建立連線
            </>
          )}
        </span>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <div>
          <label className="block text-xs font-semibold text-[#4A3F35] mb-1.5">
            Notion Integration Token
          </label>
          <input
            type="password"
            value={notionToken}
            onChange={(e) => setNotionToken(e.target.value)}
            placeholder="secret_xxxxxxxxxxxxxxxxxxxxxxxxxxxx"
            className="w-full px-4 py-2.5 text-xs rounded-xl milk-tea-input font-mono"
          />
        </div>

        <div>
          <label className="block text-xs font-semibold text-[#4A3F35] mb-1.5">
            題目 Database ID
          </label>
          <input
            type="text"
            value={questionDbId}
            onChange={(e) => setQuestionDbId(e.target.value)}
            placeholder="3ba6e88209608047b0e3df6fe9b38c41"
            className="w-full px-4 py-2.5 text-xs rounded-xl milk-tea-input font-mono"
          />
        </div>

        <div>
          <label className="block text-xs font-semibold text-[#4A3F35] mb-1.5">
            回答/對話 Database ID
          </label>
          <input
            type="text"
            value={answerDbId}
            onChange={(e) => setAnswerDbId(e.target.value)}
            placeholder="3ba6e882096080c18233fb5e88b8354d"
            className="w-full px-4 py-2.5 text-xs rounded-xl milk-tea-input font-mono"
          />
        </div>
      </div>

      <div className="flex flex-wrap items-center justify-between gap-3 pt-2">
        <button
          onClick={() => handleTestNotionConnection(notionToken, answerDbId)}
          disabled={isTestingNotion}
          className="milk-tea-btn-secondary px-4 py-2 rounded-xl text-xs font-semibold inline-flex items-center gap-2 cursor-pointer"
        >
          <RefreshCw className={`w-3.5 h-3.5 ${isTestingNotion ? 'animate-spin' : ''}`} />
          <span>{isTestingNotion ? '連線中...' : '測試 Notion 連線'}</span>
        </button>

        <button
          onClick={handleBatchSyncAllFAQs}
          disabled={isSyncingAll || notionStatus !== 'connected'}
          className="milk-tea-btn-primary px-4 py-2 rounded-xl text-xs font-semibold inline-flex items-center gap-2 disabled:opacity-50 cursor-pointer"
        >
          <Database className="w-3.5 h-3.5" />
          <span>{isSyncingAll ? '同步中...' : `一鍵同步 ${faqs.length} 題至 Notion`}</span>
        </button>
      </div>
    </div>
  );
};
