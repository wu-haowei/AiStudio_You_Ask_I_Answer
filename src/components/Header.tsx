import React, { useState, useEffect } from 'react';
import {
  Settings,
  Menu,
  X,
  Plus,
  Coffee,
  Users,
  Maximize2,
  Minimize2,
} from 'lucide-react';
import { ActiveTab } from '../types';

interface HeaderProps {
  activeTab: ActiveTab;
  setActiveTab: (tab: ActiveTab) => void;
  pendingQuestionsCount: number;
  onOpenAskModal: () => void;
  searchQuery: string;
  setSearchQuery: (q: string) => void;
}

export const Header: React.FC<HeaderProps> = ({
  activeTab,
  setActiveTab,
  onOpenAskModal,
}) => {
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const [isFullscreen, setIsFullscreen] = useState(false);

  useEffect(() => {
    const handleFullscreenChange = () => {
      setIsFullscreen(!!document.fullscreenElement);
    };
    document.addEventListener('fullscreenchange', handleFullscreenChange);
    return () => document.removeEventListener('fullscreenchange', handleFullscreenChange);
  }, []);

  const toggleFullscreen = () => {
    if (!document.fullscreenElement) {
      document.documentElement.requestFullscreen().catch((err) => {
        console.warn('Fullscreen request failed:', err);
      });
    } else {
      if (document.exitFullscreen) {
        document.exitFullscreen().catch((err) => {
          console.warn('Exit fullscreen failed:', err);
        });
      }
    }
  };

  const isAdmin = activeTab === 'admin_manage';

  return (
    <header className="shrink-0 sticky top-0 z-40 bg-[#FAF7F2]/95 backdrop-blur-md border-b border-[#D9C5B2]">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="flex items-center justify-between h-14 sm:h-16">
          {/* Logo & Brand */}
          <div className="flex items-center gap-3 cursor-pointer" onClick={() => setActiveTab('co_play')}>
            <div className="w-10 h-10 sm:w-11 sm:h-11 rounded-2xl bg-gradient-to-br from-[#A68B6D] to-[#8E7256] flex items-center justify-center text-white shadow-md shadow-[#A68B6D]/20">
              <Coffee className="w-5 h-5 sm:w-6 sm:h-6" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <span className="text-lg sm:text-xl font-bold text-[#4A3F35] tracking-tight">
                  你問我答
                </span>
              </div>
              <p className="text-xs text-[#7A6C5E] hidden xs:block">
                習性喜好、人生規劃、感情、狀況劇與敏感題真心話猜測
              </p>
            </div>
          </div>

          {/* Desktop Navigation Tabs */}
          <nav className="hidden md:flex items-center gap-1.5 bg-[#E8D8C4]/60 p-1.5 rounded-2xl border border-[#D9C5B2]">
            <button
              onClick={() => setActiveTab('co_play')}
              className={`flex items-center gap-2 px-4 py-2 rounded-xl text-sm font-medium transition-all ${
                activeTab === 'co_play'
                  ? 'bg-white text-[#4A3F35] shadow-sm font-semibold ring-1 ring-[#A68B6D]'
                  : 'text-[#7A6C5E] hover:text-[#4A3F35] hover:bg-white/50'
              }`}
            >
              <Users className="w-4 h-4 text-[#A68B6D]" />
              <span>你問我答對決</span>
              <span className="w-2 h-2 rounded-full bg-[#A68B6D] animate-ping"></span>
            </button>

            <div className="h-4 w-px bg-[#D9C5B2] mx-1" />

            <button
              onClick={() => setActiveTab('admin_manage')}
              className={`flex items-center gap-2 px-4 py-2 rounded-xl text-sm font-medium transition-all ${
                isAdmin
                  ? 'bg-[#A68B6D] text-white shadow-sm font-semibold'
                  : 'text-[#7A6C5E] hover:text-[#4A3F35] hover:bg-white/50'
              }`}
            >
              <Settings className="w-4 h-4" />
              <span>後台管理</span>
            </button>
          </nav>

          {/* Right Action Buttons */}
          <div className="flex items-center gap-2 sm:gap-3">
            {/* Fullscreen Toggle Button */}
            <button
              onClick={toggleFullscreen}
              className="p-2 sm:px-3 sm:py-2 rounded-xl text-[#4A3F35] bg-white hover:bg-[#E8D8C4] border border-[#D9C5B2] transition-colors flex items-center gap-1.5 text-xs font-bold shadow-2xs cursor-pointer"
              title={isFullscreen ? '退出全螢幕' : '全螢幕顯示'}
            >
              {isFullscreen ? (
                <>
                  <Minimize2 className="w-4 h-4 text-[#A68B6D]" />
                  <span className="hidden sm:inline">退出全螢幕</span>
                </>
              ) : (
                <>
                  <Maximize2 className="w-4 h-4 text-[#A68B6D]" />
                  <span className="hidden sm:inline">全螢幕</span>
                </>
              )}
            </button>

            {!isAdmin ? (
              <button
                onClick={onOpenAskModal}
                className="milk-tea-btn-primary flex items-center gap-1.5 px-3.5 py-2 rounded-xl text-xs sm:text-sm font-medium shadow-sm hover:shadow-md"
              >
                <Plus className="w-4 h-4" />
                <span>新增自訂題目</span>
              </button>
            ) : (
              <button
                onClick={() => setActiveTab('co_play')}
                className="milk-tea-btn-secondary flex items-center gap-1.5 px-3.5 py-2 rounded-xl text-xs sm:text-sm font-medium"
              >
                <Users className="w-4 h-4 text-[#A68B6D]" />
                <span>切換至你問我答</span>
              </button>
            )}

            {/* Mobile Hamburger Toggle */}
            <button
              onClick={() => setMobileMenuOpen(!mobileMenuOpen)}
              className="md:hidden p-2 rounded-xl text-[#4A3F35] hover:bg-[#E8D8C4] border border-[#D9C5B2] transition-colors"
              aria-label="切換選單"
            >
              {mobileMenuOpen ? <X className="w-5 h-5" /> : <Menu className="w-5 h-5" />}
            </button>
          </div>
        </div>
      </div>

      {/* Mobile Drawer Navigation */}
      {mobileMenuOpen && (
        <div className="md:hidden bg-[#FAF7F2] border-b border-[#D9C5B2] px-4 pt-2 pb-4 space-y-2 animate-fade-in">
          <button
            onClick={() => {
              setActiveTab('co_play');
              setMobileMenuOpen(false);
            }}
            className={`w-full flex items-center justify-between px-3.5 py-2.5 rounded-xl text-sm font-medium transition-colors ${
              activeTab === 'co_play'
                ? 'bg-[#A68B6D] text-white font-semibold shadow-sm'
                : 'text-[#4A3F35] hover:bg-[#E8D8C4]'
            }`}
          >
            <div className="flex items-center gap-2.5">
              <Users className="w-4 h-4" />
              <span>你問我答</span>
            </div>
          </button>

          <button
            onClick={() => {
              setActiveTab('admin_manage');
              setMobileMenuOpen(false);
            }}
            className={`w-full flex items-center justify-between px-3.5 py-2.5 rounded-xl text-sm font-medium transition-colors ${
              activeTab === 'admin_manage'
                ? 'bg-[#A68B6D] text-white font-semibold shadow-sm'
                : 'text-[#4A3F35] hover:bg-[#E8D8C4]'
            }`}
          >
            <div className="flex items-center gap-2.5">
              <Settings className="w-4 h-4" />
              <span>後台管理</span>
            </div>
          </button>
        </div>
      )}
    </header>
  );
};
