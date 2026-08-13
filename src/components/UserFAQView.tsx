import React, { useState, useMemo } from 'react';
import {
  Search,
  ChevronDown,
  ThumbsUp,
  ThumbsDown,
  Copy,
  Pin,
  Eye,
  MessageCircle,
  HelpCircle,
  Sparkles,
  Tag,
  Share2,
} from 'lucide-react';
import { Category, FAQItem } from '../types';

interface UserFAQViewProps {
  faqs: FAQItem[];
  categories: Category[];
  searchQuery: string;
  setSearchQuery: (q: string) => void;
  onVote: (faqId: string, type: 'helpful' | 'unhelpful') => void;
  votedStatus: Record<string, 'helpful' | 'unhelpful'>;
  onIncrementViews: (faqId: string) => void;
  onOpenAskModal: () => void;
  showToast: (title: string, description?: string, type?: 'success' | 'info') => void;
}

export const UserFAQView: React.FC<UserFAQViewProps> = ({
  faqs,
  categories,
  searchQuery,
  setSearchQuery,
  onVote,
  votedStatus,
  onIncrementViews,
  onOpenAskModal,
  showToast,
}) => {
  const [selectedCategory, setSelectedCategory] = useState<string>('all');
  const [selectedTag, setSelectedTag] = useState<string>('all');
  const [expandedFaqId, setExpandedFaqId] = useState<string | null>(faqs[0]?.id || null);
  const [sortBy, setSortBy] = useState<'pinned' | 'popular' | 'latest'>('pinned');

  // Extract all unique tags
  const allTags = useMemo(() => {
    const tagsSet = new Set<string>();
    faqs.forEach((faq) => faq.tags?.forEach((tag) => tagsSet.add(tag)));
    return Array.from(tagsSet);
  }, [faqs]);

  // Filter and Sort FAQs
  const filteredFaqs = useMemo(() => {
    return faqs
      .filter((faq) => !faq.isHidden)
      .filter((faq) => {
        if (selectedCategory !== 'all' && faq.category !== selectedCategory) {
          return false;
        }
        if (selectedTag !== 'all' && (!faq.tags || !faq.tags.includes(selectedTag))) {
          return false;
        }
        if (searchQuery.trim()) {
          const q = searchQuery.toLowerCase();
          const matchQ = faq.question.toLowerCase().includes(q);
          const matchA = faq.answer.toLowerCase().includes(q);
          const matchT = faq.tags?.some((t) => t.toLowerCase().includes(q));
          return matchQ || matchA || matchT;
        }
        return true;
      })
      .sort((a, b) => {
        if (sortBy === 'pinned') {
          if (a.isPinned && !b.isPinned) return -1;
          if (!a.isPinned && b.isPinned) return 1;
        }
        if (sortBy === 'popular') {
          return (b.views || 0) + b.helpfulCount - ((a.views || 0) + a.helpfulCount);
        }
        // latest
        return new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime();
      });
  }, [faqs, selectedCategory, selectedTag, searchQuery, sortBy]);

  const handleToggleExpand = (faqId: string) => {
    if (expandedFaqId === faqId) {
      setExpandedFaqId(null);
    } else {
      setExpandedFaqId(faqId);
      onIncrementViews(faqId);
    }
  };

  const handleCopyAnswer = (question: string, answer: string, e: React.MouseEvent) => {
    e.stopPropagation();
    const textToCopy = `【常見問題】${question}\n【解答】${answer}`;
    navigator.clipboard.writeText(textToCopy);
    showToast('已複製回答內容', '您可以直接貼上傳送給親友或客戶', 'success');
  };

  const getCategoryColor = (catName: string) => {
    const found = categories.find((c) => c.name === catName);
    return found ? found.colorClass : 'badge-milktea';
  };

  return (
    <div className="space-y-8 pb-12">
      {/* Hero Banner with Warm Milk Tea Aesthetic */}
      <div className="relative overflow-hidden rounded-3xl bg-gradient-to-br from-[#FAF7F2] via-[#E8D8C4] to-[#D9C5B2] border border-[#D9C5B2] p-6 sm:p-10 shadow-sm">
        <div className="absolute top-0 right-0 w-64 h-64 bg-[#A68B6D]/10 rounded-full blur-3xl pointer-events-none" />
        <div className="relative z-10 max-w-3xl space-y-4">
          <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-white/80 border border-[#D9C5B2] text-xs font-semibold text-[#A68B6D] shadow-2xs backdrop-blur-xs">
            <Sparkles className="w-3.5 h-3.5" />
            <span>親切即時 ‧ 智慧解答與雲端同步</span>
          </div>
          <h1 className="text-2xl sm:text-4xl font-extrabold text-[#4A3F35] tracking-tight leading-snug">
            你需要知道的事，<br className="hidden sm:block" />
            這裡都有溫暖解答。
          </h1>
          <p className="text-sm sm:text-base text-[#6D5D4D] leading-relaxed">
            選擇下方分類或輸入關鍵字，即可快速檢視詳盡解答；若未找到所需資訊，歡迎點選「我要提問」或使用雙人連線與 Notion 同步功能。
          </p>

          {/* Search Box */}
          <div className="pt-2">
            <div className="relative">
              <Search className="absolute left-4 top-1/2 -translate-y-1/2 w-5 h-5 text-[#A68B6D]" />
              <input
                type="text"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="搜尋關鍵字，例如：退換貨、運費、付款、密碼..."
                className="w-full pl-12 pr-10 py-3.5 text-sm sm:text-base rounded-2xl milk-tea-input shadow-sm"
              />
              {searchQuery && (
                <button
                  onClick={() => setSearchQuery('')}
                  className="absolute right-4 top-1/2 -translate-y-1/2 text-xs bg-[#E8D8C4] hover:bg-[#D9C5B2] text-[#4A3F35] px-2 py-1 rounded-lg transition-colors"
                >
                  清除
                </button>
              )}
            </div>
          </div>

          {/* Quick Tag Pills */}
          <div className="flex flex-wrap items-center gap-2 pt-1 text-xs text-[#7A6C5E]">
            <span className="font-medium flex items-center gap-1">
              <Tag className="w-3.5 h-3.5" /> 熱門標籤：
            </span>
            {allTags.slice(0, 6).map((tag) => (
              <button
                key={tag}
                onClick={() => setSelectedTag(selectedTag === tag ? 'all' : tag)}
                className={`px-2.5 py-1 rounded-lg text-xs transition-all ${
                  selectedTag === tag
                    ? 'bg-[#A68B6D] text-white font-semibold'
                    : 'bg-white/70 hover:bg-white text-[#5C4B3A] border border-[#D9C5B2]'
                }`}
              >
                #{tag}
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* Filter and Category Section */}
      <div className="space-y-4">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 border-b border-[#E8DFD3] pb-4">
          {/* Categories Horizontal Scroll Chips */}
          <div className="flex items-center gap-2 overflow-x-auto pb-2 sm:pb-0 scrollbar-none">
            <button
              onClick={() => setSelectedCategory('all')}
              className={`px-4 py-2 rounded-xl text-xs sm:text-sm font-semibold shrink-0 transition-all ${
                selectedCategory === 'all'
                  ? 'bg-[#8C6D53] text-white shadow-sm'
                  : 'bg-white text-[#7A6C65] hover:text-[#3A2E2B] hover:bg-[#F4ECE1] border border-[#E8DFD3]'
              }`}
            >
              全部常見問題 ({faqs.filter((f) => !f.isHidden).length})
            </button>
            {categories.map((cat) => {
              const catFaqCount = faqs.filter((f) => !f.isHidden && f.category === cat.name).length;
              return (
                <button
                  key={cat.id}
                  onClick={() => setSelectedCategory(cat.name)}
                  className={`px-3.5 py-2 rounded-xl text-xs sm:text-sm font-medium shrink-0 transition-all ${
                    selectedCategory === cat.name
                      ? 'bg-[#8C6D53] text-white shadow-sm font-semibold'
                      : 'bg-white text-[#7A6C65] hover:text-[#3A2E2B] hover:bg-[#F4ECE1] border border-[#E8DFD3]'
                  }`}
                >
                  {cat.name} ({catFaqCount})
                </button>
              );
            })}
          </div>

          {/* Sort Dropdown */}
          <div className="flex items-center gap-2 shrink-0 self-end sm:self-auto">
            <span className="text-xs text-[#7A6C65]">排序：</span>
            <select
              value={sortBy}
              onChange={(e: any) => setSortBy(e.target.value)}
              className="px-3 py-1.5 rounded-xl text-xs bg-white border border-[#E8DFD3] text-[#3A2E2B] focus:outline-none focus:ring-2 focus:ring-[#8C6D53]"
            >
              <option value="pinned">置頂優先</option>
              <option value="popular">熱門觀看/按讚</option>
              <option value="latest">最新更新</option>
            </select>
          </div>
        </div>

        {/* Selected Tag Indicator */}
        {selectedTag !== 'all' && (
          <div className="flex items-center justify-between px-4 py-2 rounded-xl bg-[#F3E8DC] border border-[#E6D4C2] text-xs text-[#7A5230]">
            <span>正在篩選標籤為 <strong>#{selectedTag}</strong> 的問題</span>
            <button
              onClick={() => setSelectedTag('all')}
              className="underline hover:text-[#3A2E2B]"
            >
              清除標籤篩選
            </button>
          </div>
        )}
      </div>

      {/* FAQ Accordion List */}
      <div className="space-y-4">
        {filteredFaqs.length === 0 ? (
          <div className="text-center py-16 px-4 bg-white rounded-3xl border border-[#E8DFD3] space-y-4">
            <div className="w-16 h-16 mx-auto rounded-2xl bg-[#F4ECE1] flex items-center justify-center text-[#8C6D53]">
              <HelpCircle className="w-8 h-8" />
            </div>
            <h3 className="text-lg font-bold text-[#3A2E2B]">找不到相關常見問題？</h3>
            <p className="text-sm text-[#7A6C65] max-w-md mx-auto">
              嘗試換個關鍵字搜尋，或是點擊下方按鈕直接向我們送出您的問題，我們將由專人為您解答！
            </p>
            <button
              onClick={onOpenAskModal}
              className="milk-tea-btn-primary px-5 py-2.5 rounded-xl text-sm font-semibold inline-flex items-center gap-2"
            >
              <MessageCircle className="w-4 h-4" />
              立即送出提問
            </button>
          </div>
        ) : (
          filteredFaqs.map((faq) => {
            const isExpanded = expandedFaqId === faq.id;
            const myVote = votedStatus[faq.id];

            return (
              <div
                key={faq.id}
                className={`milk-tea-card rounded-2xl overflow-hidden transition-all ${
                  isExpanded ? 'ring-2 ring-[#8C6D53]/30 bg-[#FFFDF9]' : ''
                }`}
              >
                {/* Header Row (Question Clickable) */}
                <button
                  onClick={() => handleToggleExpand(faq.id)}
                  className="w-full p-5 sm:p-6 text-left flex items-start justify-between gap-4 focus:outline-none"
                >
                  <div className="flex items-start gap-3 sm:gap-4 flex-1">
                    {/* Category Badge & Pin */}
                    <div className="flex flex-col gap-1 shrink-0 mt-0.5">
                      <span
                        className={`text-[11px] font-semibold px-2.5 py-0.5 rounded-full ${getCategoryColor(
                          faq.category
                        )}`}
                      >
                        {faq.category}
                      </span>
                      {faq.isPinned && (
                        <span className="inline-flex items-center gap-0.5 text-[10px] font-bold text-amber-700 bg-amber-100/80 px-2 py-0.5 rounded-md border border-amber-200">
                          <Pin className="w-3 h-3 fill-amber-700" />
                          置頂
                        </span>
                      )}
                    </div>

                    {/* Question Text */}
                    <div className="space-y-1">
                      <h3 className="text-base sm:text-lg font-bold text-[#3A2E2B] leading-snug">
                        {faq.question}
                      </h3>
                      {faq.tags && faq.tags.length > 0 && (
                        <div className="flex flex-wrap gap-1.5 pt-1">
                          {faq.tags.map((tag) => (
                            <span
                              key={tag}
                              className="text-[11px] text-[#8A7970] bg-[#F4ECE1] px-2 py-0.5 rounded-md"
                            >
                              #{tag}
                            </span>
                          ))}
                        </div>
                      )}
                    </div>
                  </div>

                  {/* Expand Chevron Icon */}
                  <div className="shrink-0 pt-1 text-[#8C6D53]">
                    <ChevronDown
                      className={`w-5 h-5 transition-transform duration-200 ${
                        isExpanded ? 'rotate-180' : ''
                      }`}
                    />
                  </div>
                </button>

                {/* Collapsible Answer Body */}
                {isExpanded && (
                  <div className="px-5 pb-5 sm:px-6 sm:pb-6 pt-0 border-t border-[#E8DFD3]/60 space-y-4 animate-fade-in">
                    {/* Answer Text */}
                    <div className="pt-4 text-sm sm:text-base text-[#4A3D39] leading-relaxed whitespace-pre-line bg-[#FCFAF6] p-4 sm:p-5 rounded-xl border border-[#E8DFD3]/60">
                      {faq.answer}
                    </div>

                    {/* Helpful Rating & Action Row */}
                    <div className="flex flex-wrap items-center justify-between gap-3 pt-2 text-xs text-[#7A6C65]">
                      {/* Views */}
                      <div className="flex items-center gap-1.5 text-[#8A7970]">
                        <Eye className="w-3.5 h-3.5" />
                        <span>累積閱讀：{faq.views || 1} 次</span>
                      </div>

                      {/* Vote & Share Controls */}
                      <div className="flex items-center gap-3">
                        <span className="hidden sm:inline font-medium">這解答對您有幫助嗎？</span>
                        <button
                          onClick={() => onVote(faq.id, 'helpful')}
                          className={`flex items-center gap-1 px-3 py-1.5 rounded-lg border transition-all ${
                            myVote === 'helpful'
                              ? 'bg-emerald-600 text-white border-emerald-600 font-semibold'
                              : 'bg-white hover:bg-emerald-50 text-emerald-800 border-emerald-200'
                          }`}
                        >
                          <ThumbsUp className="w-3.5 h-3.5" />
                          <span>有用 ({faq.helpfulCount})</span>
                        </button>

                        <button
                          onClick={() => onVote(faq.id, 'unhelpful')}
                          className={`flex items-center gap-1 px-3 py-1.5 rounded-lg border transition-all ${
                            myVote === 'unhelpful'
                              ? 'bg-rose-600 text-white border-rose-600 font-semibold'
                              : 'bg-white hover:bg-rose-50 text-rose-800 border-rose-200'
                          }`}
                        >
                          <ThumbsDown className="w-3.5 h-3.5" />
                          <span>待改善 ({faq.unhelpfulCount})</span>
                        </button>

                        <button
                          onClick={(e) => handleCopyAnswer(faq.question, faq.answer, e)}
                          className="flex items-center gap-1 px-3 py-1.5 rounded-lg border border-[#E8DFD3] bg-white hover:bg-[#F4ECE1] text-[#3A2E2B] transition-colors"
                          title="複製問題與解答"
                        >
                          <Copy className="w-3.5 h-3.5 text-[#8C6D53]" />
                          <span className="hidden xs:inline">複製內文</span>
                        </button>
                      </div>
                    </div>
                  </div>
                )}
              </div>
            );
          })
        )}
      </div>

      {/* Bottom Help Prompt */}
      <div className="rounded-2xl bg-[#F4ECE1] border border-[#E4D8C8] p-6 text-center space-y-3">
        <h3 className="text-base font-bold text-[#3A2E2B]">還沒有找到您要的答案嗎？</h3>
        <p className="text-xs sm:text-sm text-[#7A6C65] max-w-xl mx-auto">
          隨時將您的疑慮告訴我們，專人客服團隊將在第一時間審核與回覆，並可納入公開常見問題！
        </p>
        <button
          onClick={onOpenAskModal}
          className="milk-tea-btn-primary px-6 py-2.5 rounded-xl text-sm font-semibold shadow-sm inline-flex items-center gap-2"
        >
          <Share2 className="w-4 h-4" />
          線上送出您的提問
        </button>
      </div>
    </div>
  );
};
