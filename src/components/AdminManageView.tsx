import React, { useState, useEffect } from 'react';
import {
  Plus,
  Search,
  Edit2,
  Trash2,
  Pin,
  Eye,
  EyeOff,
  Sparkles,
  Download,
  Upload,
  RotateCcw,
  Bot,
  Wand2,
  X,
  Check,
  Key,
  Database,
  CheckCircle2,
  AlertCircle,
  RefreshCw,
  ShieldCheck,
} from 'lucide-react';
import { Category, FAQItem, NotionConfig } from '../types';
import {
  getStoredNotionConfig,
  saveStoredNotionConfig,
  HARDCODED_NOTION_QUESTION_DB_ID,
  HARDCODED_NOTION_ANSWER_DB_ID,
} from '../utils/storage';
import { testNotionConnection, syncQuestionToNotion } from '../utils/notionApi';

interface AdminManageViewProps {
  faqs: FAQItem[];
  categories: Category[];
  onAddFAQ: (faq: Omit<FAQItem, 'id' | 'updatedAt' | 'helpfulCount' | 'unhelpfulCount'>) => void;
  onUpdateFAQ: (faq: FAQItem) => void;
  onDeleteFAQ: (id: string) => void;
  onResetData: () => void;
  onImportData: (jsonStr: string) => void;
  onExportData: () => void;
  showToast: (title: string, description?: string, type?: 'success' | 'error' | 'info' | 'warning') => void;
}

export const AdminManageView: React.FC<AdminManageViewProps> = ({
  faqs,
  categories,
  onAddFAQ,
  onUpdateFAQ,
  onDeleteFAQ,
  onResetData,
  onImportData,
  onExportData,
  showToast,
}) => {
  const [search, setSearch] = useState('');
  const [selectedCategory, setSelectedCategory] = useState('all');

  // Notion Configuration State
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

  // Modal States
  const [isEditModalOpen, setIsEditModalOpen] = useState(false);
  const [editingFaq, setEditingFaq] = useState<FAQItem | null>(null);

  // Form Field States
  const [formQuestion, setFormQuestion] = useState('');
  const [formAnswer, setFormAnswer] = useState('');
  const [formCategory, setFormCategory] = useState('');
  const [formTagsStr, setFormTagsStr] = useState('');
  const [formIsPinned, setFormIsPinned] = useState(false);
  const [formIsHidden, setFormIsHidden] = useState(false);
  const [formOptionsStr, setFormOptionsStr] = useState('');
  const [formCorrectIndex, setFormCorrectIndex] = useState(0);
  const [formExplanation, setFormExplanation] = useState('');

  // AI Generator Modal
  const [isAiModalOpen, setIsAiModalOpen] = useState(false);
  const [aiTopic, setAiTopic] = useState('');
  const [aiCategory, setAiCategory] = useState(categories[0]?.name || '習性與喜好');
  const [aiCount, setAiCount] = useState(3);
  const [isGenerating, setIsGenerating] = useState(false);

  // AI Answer Polish
  const [isPolishing, setIsPolishing] = useState(false);

  // JSON Template Modal
  const [isJsonModalOpen, setIsJsonModalOpen] = useState(false);
  const [pastedJsonText, setPastedJsonText] = useState('');

  // Delete Confirmation
  const [deletingId, setDeletingId] = useState<string | null>(null);

  // Auto test Notion connection on load if configured
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

  const sampleJsonTemplate = JSON.stringify(
    [
      {
        question: '假日最喜歡的放鬆度過方式是什麼？',
        answer: '考驗對方的日常習性與放鬆偏好。',
        category: '習性與喜好',
        tags: ['日常習慣', '假日休閒'],
        options: ['在家躺平追劇看動漫', '約朋友出門踩點喝咖啡', '戶外運動踏青接觸大自然', '好好睡覺打電競打整天'],
      },
    ],
    null,
    2
  );

  const filteredFaqs = faqs.filter((f) => {
    if (selectedCategory !== 'all' && f.category !== selectedCategory) return false;
    if (search.trim()) {
      const q = search.toLowerCase();
      return (
        f.question.toLowerCase().includes(q) ||
        f.answer.toLowerCase().includes(q) ||
        f.tags?.some((t) => t.toLowerCase().includes(q))
      );
    }
    return true;
  });

  const handleOpenAddModal = () => {
    setEditingFaq(null);
    setFormQuestion('');
    setFormAnswer('');
    setFormCategory(categories[0]?.name || '習性與喜好');
    setFormTagsStr('');
    setFormIsPinned(false);
    setFormIsHidden(false);
    setFormOptionsStr('');
    setFormCorrectIndex(0);
    setFormExplanation('');
    setIsEditModalOpen(true);
  };

  const handleOpenEditModal = (faq: FAQItem) => {
    setEditingFaq(faq);
    setFormQuestion(faq.question);
    setFormAnswer(faq.answer);
    setFormCategory(faq.category);
    setFormTagsStr(faq.tags ? faq.tags.join(', ') : '');
    setFormIsPinned(!!faq.isPinned);
    setFormIsHidden(!!faq.isHidden);
    setFormOptionsStr(faq.options ? faq.options.join('\n') : '');
    setFormCorrectIndex(faq.correctOptionIndex || 0);
    setFormExplanation(faq.explanation || '');
    setIsEditModalOpen(true);
  };

  const handleSaveForm = (e: React.FormEvent) => {
    e.preventDefault();
    if (!formQuestion.trim() || !formAnswer.trim()) {
      showToast('請填寫完整內容', '問題與回答為必填欄位', 'error');
      return;
    }

    const tagsArray = formTagsStr
      .split(/[,，\s]+/)
      .map((t) => t.trim())
      .filter(Boolean);

    const optionsArray = formOptionsStr
      .split('\n')
      .map((o) => o.trim())
      .filter(Boolean);

    if (editingFaq) {
      onUpdateFAQ({
        ...editingFaq,
        question: formQuestion.trim(),
        answer: formAnswer.trim(),
        category: formCategory,
        tags: tagsArray,
        isPinned: formIsPinned,
        isHidden: formIsHidden,
        options: optionsArray.length > 0 ? optionsArray : undefined,
        correctOptionIndex: optionsArray.length > 0 ? formCorrectIndex : undefined,
        explanation: formExplanation.trim() || undefined,
        updatedAt: new Date().toISOString(),
      });
      showToast('更新成功', 'Q&A 內容已即時儲存！', 'success');
    } else {
      onAddFAQ({
        question: formQuestion.trim(),
        answer: formAnswer.trim(),
        category: formCategory,
        tags: tagsArray,
        isPinned: formIsPinned,
        isHidden: formIsHidden,
        options: optionsArray.length > 0 ? optionsArray : undefined,
        correctOptionIndex: optionsArray.length > 0 ? formCorrectIndex : undefined,
        explanation: formExplanation.trim() || undefined,
      });
      showToast('新增成功', '新題目已成功新增！', 'success');
    }

    setIsEditModalOpen(false);
  };

  const handlePolishAnswer = async () => {
    if (!formQuestion.trim() || !formAnswer.trim()) {
      showToast('請先填寫問題與解答草稿', 'AI 需要參考原始草稿進行優化', 'error');
      return;
    }

    setIsPolishing(true);
    try {
      const res = await fetch('/api/polish-answer', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ question: formQuestion, answer: formAnswer }),
      });
      const data = await res.json();
      if (data.success && data.polishedAnswer) {
        setFormAnswer(data.polishedAnswer);
        showToast('AI 答案優化完成', '已修飾語氣與條理排版', 'success');
      } else {
        throw new Error(data.error || '潤飾失敗');
      }
    } catch (err: any) {
      showToast('AI 潤飾暫無法使用', err.message || '請確認 API 金鑰', 'error');
    } finally {
      setIsPolishing(false);
    }
  };

  const handleGenerateQA = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!aiTopic.trim()) return;

    setIsGenerating(true);
    try {
      const res = await fetch('/api/generate-qa', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ topic: aiTopic, category: aiCategory, count: aiCount }),
      });
      const data = await res.json();
      if (data.success && Array.isArray(data.items)) {
        data.items.forEach((item: any) => {
          onAddFAQ({
            question: item.question,
            answer: item.answer,
            category: item.category || aiCategory,
            tags: item.tags || ['AI生成'],
            options: item.options,
            correctOptionIndex: item.correctOptionIndex,
            explanation: item.explanation,
          });
        });
        showToast('AI 批次生成完成！', `已成功新增 ${data.items.length} 則常見問題！`, 'success');
        setIsAiModalOpen(false);
        setAiTopic('');
      } else {
        throw new Error(data.error || '生成失敗');
      }
    } catch (err: any) {
      showToast('AI 生成失敗', err.message || '請稍後再試', 'error');
    } finally {
      setIsGenerating(false);
    }
  };

  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (event) => {
      try {
        const jsonStr = event.target?.result as string;
        onImportData(jsonStr);
        showToast('匯入備份成功', '已順利覆蓋載入 Q&A 備份檔！', 'success');
      } catch (err) {
        showToast('檔案格式錯誤', '請確認選擇有效的 JSON 檔案', 'error');
      }
    };
    reader.readAsText(file);
  };

  return (
    <div className="space-y-6 pb-12">
      {/* Admin Control Bar */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 p-6 rounded-3xl bg-white border border-[#E8DFD3] shadow-xs">
        <div>
          <h1 className="text-xl sm:text-2xl font-bold text-[#3A2E2B] flex items-center gap-2">
            <span>後台管理與題目匯入</span>
            <span className="text-xs px-2.5 py-0.5 rounded-full bg-[#F3E8DC] text-[#7A5230] font-semibold">
              共 {faqs.length} 題
            </span>
          </h1>
          <p className="text-xs sm:text-sm text-[#7A6C65] mt-1">
            設定 Notion API 連線、編輯題庫與批次匯入 JSON 題目檔。
          </p>
        </div>

        {/* Action Group */}
        <div className="flex flex-wrap items-center gap-2 sm:gap-3">
          <button
            onClick={() => setIsJsonModalOpen(true)}
            className="px-3.5 py-2 rounded-xl text-xs sm:text-sm font-semibold bg-[#E6D8C8] text-[#4A3F35] hover:bg-[#DBC9B5] transition-all inline-flex items-center gap-1.5 border border-[#D0BFAC]"
          >
            <Upload className="w-4 h-4 text-[#8C6D53]" />
            <span>匯入題目 (JSON 格式)</span>
          </button>

          <button
            onClick={handleOpenAddModal}
            className="milk-tea-btn-primary px-4 py-2 rounded-xl text-xs sm:text-sm font-semibold inline-flex items-center gap-1.5 shadow-sm"
          >
            <Plus className="w-4 h-4" />
            <span>新增題目</span>
          </button>

          {/* Backup Tools */}
          <div className="flex items-center gap-1 border-l border-[#E8DFD3] pl-2">
            <button
              onClick={onExportData}
              title="匯出資料 JSON 檔"
              className="p-2 rounded-xl text-[#7A6C65] hover:text-[#3A2E2B] hover:bg-[#F4ECE1] transition-colors"
            >
              <Download className="w-4 h-4" />
            </button>
            <label
              title="匯入 JSON 備份檔"
              className="p-2 rounded-xl text-[#7A6C65] hover:text-[#3A2E2B] hover:bg-[#F4ECE1] cursor-pointer transition-colors"
            >
              <Upload className="w-4 h-4" />
              <input type="file" accept=".json" onChange={handleFileUpload} className="hidden" />
            </label>
            <button
              onClick={() => {
                if (confirm('確定要將所有數據重置為預設題目庫嗎？')) {
                  onResetData();
                  showToast('已重置為預設資料', '', 'info');
                }
              }}
              title="重置為預設預載資料"
              className="p-2 rounded-xl text-rose-600 hover:bg-rose-50 transition-colors"
            >
              <RotateCcw className="w-4 h-4" />
            </button>
          </div>
        </div>
      </div>

      {/* Notion Integration Card inside Admin (Offloaded from main view) */}
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
            className="milk-tea-btn-secondary px-4 py-2 rounded-xl text-xs font-semibold inline-flex items-center gap-2"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${isTestingNotion ? 'animate-spin' : ''}`} />
            <span>{isTestingNotion ? '連線中...' : '測試 Notion 連線'}</span>
          </button>

          <button
            onClick={handleBatchSyncAllFAQs}
            disabled={isSyncingAll || notionStatus !== 'connected'}
            className="milk-tea-btn-primary px-4 py-2 rounded-xl text-xs font-semibold inline-flex items-center gap-2 disabled:opacity-50"
          >
            <Database className="w-3.5 h-3.5" />
            <span>{isSyncingAll ? '同步中...' : `一鍵同步 ${faqs.length} 題至 Notion`}</span>
          </button>
        </div>
      </div>

      {/* Filter and Search Inputs */}
      <div className="flex flex-col sm:flex-row items-center gap-3">
        <div className="relative flex-1 w-full">
          <Search className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-[#8C6D53]" />
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="搜尋題目、內容或標籤..."
            className="w-full pl-10 pr-4 py-2.5 text-sm rounded-xl milk-tea-input"
          />
        </div>

        <select
          value={selectedCategory}
          onChange={(e) => setSelectedCategory(e.target.value)}
          className="w-full sm:w-48 px-3.5 py-2.5 text-sm rounded-xl milk-tea-input shrink-0"
        >
          <option value="all">全部分類 ({faqs.length})</option>
          {categories.map((c) => (
            <option key={c.id} value={c.name}>
              {c.name}
            </option>
          ))}
        </select>
      </div>

      {/* Q&A Data Cards List */}
      <div className="space-y-3">
        {filteredFaqs.length === 0 ? (
          <div className="text-center py-12 bg-white rounded-3xl border border-[#E8DFD3] text-[#7A6C65]">
            無符合條件的題目數據，點擊右上角新增或匯入 JSON。
          </div>
        ) : (
          filteredFaqs.map((faq) => (
            <div
              key={faq.id}
              className={`milk-tea-card rounded-2xl p-5 flex flex-col sm:flex-row sm:items-center justify-between gap-4 ${
                faq.isHidden ? 'opacity-60 bg-[#F5F2EB]' : ''
              }`}
            >
              <div className="space-y-1.5 flex-1">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="text-xs px-2.5 py-0.5 rounded-full bg-[#F3E8DC] text-[#7A5230] font-semibold border border-[#E6D4C2]">
                    {faq.category}
                  </span>
                  {faq.isPinned && (
                    <span className="text-[10px] font-bold text-amber-800 bg-amber-100 px-2 py-0.5 rounded-md flex items-center gap-0.5">
                      <Pin className="w-3 h-3" /> 置頂
                    </span>
                  )}
                  {faq.isHidden && (
                    <span className="text-[10px] font-bold text-gray-600 bg-gray-200 px-2 py-0.5 rounded-md">
                      隱藏不公開
                    </span>
                  )}
                  {faq.options && faq.options.length > 0 && (
                    <span className="text-[10px] font-bold text-purple-700 bg-purple-100 px-2 py-0.5 rounded-md">
                      {faq.options.length} 個選項
                    </span>
                  )}
                </div>

                <h3 className="text-base font-bold text-[#3A2E2B]">{faq.question}</h3>
                <p className="text-xs text-[#7A6C65] line-clamp-2">{faq.answer}</p>
              </div>

              {/* Action Column */}
              <div className="flex items-center gap-2 shrink-0 self-end sm:self-auto border-t sm:border-t-0 pt-2 sm:pt-0 border-[#E8DFD3]">
                <button
                  onClick={() =>
                    onUpdateFAQ({ ...faq, isPinned: !faq.isPinned, updatedAt: new Date().toISOString() })
                  }
                  className={`p-2 rounded-xl transition-colors ${
                    faq.isPinned
                      ? 'bg-amber-100 text-amber-800'
                      : 'text-[#7A6C65] hover:bg-[#F4ECE1]'
                  }`}
                  title={faq.isPinned ? '取消置頂' : '設定置頂'}
                >
                  <Pin className="w-4 h-4" />
                </button>

                <button
                  onClick={() =>
                    onUpdateFAQ({ ...faq, isHidden: !faq.isHidden, updatedAt: new Date().toISOString() })
                  }
                  className={`p-2 rounded-xl transition-colors ${
                    faq.isHidden
                      ? 'bg-gray-200 text-gray-700'
                      : 'text-[#7A6C65] hover:bg-[#F4ECE1]'
                  }`}
                  title={faq.isHidden ? '設為公開顯示' : '暫存隱藏'}
                >
                  {faq.isHidden ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                </button>

                <button
                  onClick={() => handleOpenEditModal(faq)}
                  className="p-2 rounded-xl text-[#8C6D53] hover:bg-[#F4ECE1] transition-colors"
                  title="編輯"
                >
                  <Edit2 className="w-4 h-4" />
                </button>

                <button
                  onClick={() => setDeletingId(faq.id)}
                  className="p-2 rounded-xl text-rose-600 hover:bg-rose-50 transition-colors"
                  title="刪除"
                >
                  <Trash2 className="w-4 h-4" />
                </button>
              </div>
            </div>
          ))
        )}
      </div>

      {/* Edit / Add Modal */}
      {isEditModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/40 backdrop-blur-xs animate-fade-in overflow-y-auto">
          <div className="bg-[#FCFAF6] rounded-3xl border border-[#E8DFD3] shadow-2xl max-w-2xl w-full max-h-[90vh] flex flex-col overflow-hidden my-auto">
            <div className="px-6 py-5 bg-[#F5EFE6] border-b border-[#E8DFD3] flex items-center justify-between">
              <h3 className="text-base font-bold text-[#3A2E2B]">
                {editingFaq ? '編輯題目' : '新增題目'}
              </h3>
              <button
                onClick={() => setIsEditModalOpen(false)}
                className="p-1.5 rounded-xl text-[#7A6C65] hover:bg-[#EADDCB]"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <form onSubmit={handleSaveForm} className="p-6 space-y-4 overflow-y-auto flex-1">
              <div>
                <label className="block text-xs font-semibold text-[#3A2E2B] mb-1.5">
                  題目名稱 <span className="text-rose-500">*</span>
                </label>
                <input
                  type="text"
                  required
                  value={formQuestion}
                  onChange={(e) => setFormQuestion(e.target.value)}
                  placeholder="例如：假日最喜歡的放鬆度過方式是什麼？"
                  className="w-full px-4 py-2.5 text-sm rounded-xl milk-tea-input"
                />
              </div>

              <div>
                <div className="flex items-center justify-between mb-1.5">
                  <label className="text-xs font-semibold text-[#3A2E2B]">
                    題目解析與說明 <span className="text-rose-500">*</span>
                  </label>
                  <button
                    type="button"
                    onClick={handlePolishAnswer}
                    disabled={isPolishing}
                    className="text-xs text-[#8C6D53] hover:underline flex items-center gap-1 font-semibold"
                  >
                    <Wand2 className="w-3.5 h-3.5" />
                    <span>{isPolishing ? 'AI 潤飾中...' : '使用 AI 潤飾語氣'}</span>
                  </button>
                </div>
                <textarea
                  required
                  rows={3}
                  value={formAnswer}
                  onChange={(e) => setFormAnswer(e.target.value)}
                  placeholder="請輸入此題目的背景或考驗重點說明..."
                  className="w-full px-4 py-2.5 text-sm rounded-xl milk-tea-input resize-none"
                />
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs font-semibold text-[#3A2E2B] mb-1.5">
                    題目方向分類
                  </label>
                  <select
                    value={formCategory}
                    onChange={(e) => setFormCategory(e.target.value)}
                    className="w-full px-3.5 py-2.5 text-sm rounded-xl milk-tea-input"
                  >
                    {categories.map((c) => (
                      <option key={c.id} value={c.name}>
                        {c.name}
                      </option>
                    ))}
                  </select>
                </div>

                <div>
                  <label className="block text-xs font-semibold text-[#3A2E2B] mb-1.5">
                    相關標籤 (用逗號隔開)
                  </label>
                  <input
                    type="text"
                    value={formTagsStr}
                    onChange={(e) => setFormTagsStr(e.target.value)}
                    placeholder="日常生活, 偏好, 習慣"
                    className="w-full px-4 py-2.5 text-sm rounded-xl milk-tea-input"
                  />
                </div>
              </div>

              {/* Options */}
              <div className="border-t border-[#E8DFD3] pt-4 space-y-3">
                <div className="flex items-center gap-1.5 text-xs font-bold text-[#8C6D53]">
                  <Sparkles className="w-4 h-4" />
                  <span>題目選項 (每行一個，共 4 個)</span>
                </div>

                <div>
                  <textarea
                    rows={4}
                    value={formOptionsStr}
                    onChange={(e) => setFormOptionsStr(e.target.value)}
                    placeholder="選項 1&#10;選項 2&#10;選項 3&#10;選項 4"
                    className="w-full px-3.5 py-2 text-xs rounded-xl milk-tea-input resize-none"
                  />
                </div>
              </div>

              <div className="pt-4 flex items-center justify-end gap-3 border-t border-[#E8DFD3]">
                <button
                  type="button"
                  onClick={() => setIsEditModalOpen(false)}
                  className="px-4 py-2 rounded-xl text-sm font-medium text-[#7A6C65] hover:bg-[#F2EBE1]"
                >
                  取消
                </button>
                <button
                  type="submit"
                  className="milk-tea-btn-primary px-5 py-2.5 rounded-xl text-sm font-semibold inline-flex items-center gap-1.5"
                >
                  <Check className="w-4 h-4" />
                  <span>儲存變更</span>
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* JSON Modal */}
      {isJsonModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/40 backdrop-blur-xs animate-fade-in">
          <div className="bg-[#FCFAF6] rounded-3xl border border-[#E8DFD3] shadow-2xl max-w-2xl w-full max-h-[90vh] flex flex-col overflow-hidden">
            <div className="px-6 py-5 bg-[#F5EFE6] border-b border-[#E8DFD3] flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Upload className="w-5 h-5 text-[#8C6D53]" />
                <h3 className="text-base font-bold text-[#3A2E2B]">匯入題目 JSON 格式</h3>
              </div>
              <button
                onClick={() => setIsJsonModalOpen(false)}
                className="p-1.5 rounded-xl text-[#7A6C65] hover:bg-[#EADDCB]"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="p-6 space-y-5 overflow-y-auto flex-1">
              <div className="bg-[#F5EFE6] p-4 rounded-2xl border border-[#E8DFD3] space-y-2">
                <div className="flex items-center justify-between">
                  <span className="text-xs font-bold text-[#3A2E2B] flex items-center gap-1.5">
                    <Sparkles className="w-4 h-4 text-[#8C6D53]" />
                    範本 JSON 格式 (包含 6 大主題分類)
                  </span>
                  <div className="flex items-center gap-2">
                    <button
                      onClick={() => {
                        navigator.clipboard.writeText(sampleJsonTemplate);
                        showToast('已複製範本 JSON', '', 'success');
                      }}
                      className="px-2.5 py-1 text-xs rounded-lg bg-white border border-[#D0BFAC] text-[#4A3F35] font-semibold hover:bg-[#FAF7F2]"
                    >
                      複製範本
                    </button>
                    <button
                      onClick={() => {
                        const blob = new Blob([sampleJsonTemplate], { type: 'application/json' });
                        const url = URL.createObjectURL(blob);
                        const a = document.createElement('a');
                        a.href = url;
                        a.download = 'qa_template.json';
                        a.click();
                        URL.revokeObjectURL(url);
                        showToast('已下載 qa_template.json', '', 'info');
                      }}
                      className="px-2.5 py-1 text-xs rounded-lg bg-[#8C6D53] text-white font-semibold hover:bg-[#785C44]"
                    >
                      下載範本檔
                    </button>
                  </div>
                </div>

                <pre className="text-[11px] font-mono bg-[#2C2421] text-[#EADDCB] p-3 rounded-xl overflow-x-auto max-h-40 leading-relaxed">
                  {sampleJsonTemplate}
                </pre>
              </div>

              <div className="space-y-2">
                <label className="block text-xs font-bold text-[#3A2E2B]">
                  貼上 JSON 題目文字：
                </label>
                <textarea
                  rows={6}
                  value={pastedJsonText}
                  onChange={(e) => setPastedJsonText(e.target.value)}
                  placeholder="貼上 JSON 陣列內容..."
                  className="w-full px-4 py-3 text-xs font-mono rounded-xl milk-tea-input resize-none"
                />
              </div>

              <div className="pt-3 flex items-center justify-end gap-3 border-t border-[#E8DFD3]">
                <button
                  type="button"
                  onClick={() => setIsJsonModalOpen(false)}
                  className="px-4 py-2 rounded-xl text-xs font-semibold text-[#7A6C65] hover:bg-[#F2EBE1]"
                >
                  取消
                </button>
                <button
                  type="button"
                  onClick={() => {
                    if (!pastedJsonText.trim()) {
                      showToast('請先貼上 JSON 數據', '', 'error');
                      return;
                    }
                    try {
                      onImportData(pastedJsonText.trim());
                      setIsJsonModalOpen(false);
                      setPastedJsonText('');
                      showToast('成功匯入題目', '內容已即時更新', 'success');
                    } catch (err: any) {
                      showToast('JSON 格式錯誤', '請檢查 JSON 格式是否完整', 'error');
                    }
                  }}
                  className="milk-tea-btn-primary px-5 py-2.5 rounded-xl text-xs font-semibold flex items-center gap-1.5"
                >
                  <Check className="w-4 h-4" />
                  <span>確認解析並匯入</span>
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Delete Confirmation Modal */}
      {deletingId && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/40 backdrop-blur-xs animate-fade-in">
          <div className="bg-[#FCFAF6] rounded-3xl border border-[#E8DFD3] p-6 max-w-sm w-full space-y-4">
            <h3 className="text-base font-bold text-[#3A2E2B]">確認要刪除此題目嗎？</h3>
            <div className="flex items-center justify-end gap-3 pt-2">
              <button
                onClick={() => setDeletingId(null)}
                className="px-4 py-2 rounded-xl text-xs font-semibold text-[#7A6C65] hover:bg-[#F2EBE1]"
              >
                取消
              </button>
              <button
                onClick={() => {
                  onDeleteFAQ(deletingId);
                  setDeletingId(null);
                  showToast('已刪除題目', '', 'info');
                }}
                className="px-4 py-2 rounded-xl text-xs font-semibold bg-rose-600 text-white hover:bg-rose-700 shadow-xs"
              >
                確認刪除
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
