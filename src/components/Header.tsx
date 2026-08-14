import React, { useEffect, useRef, useState } from 'react';
import { Settings, Users, Coffee, ChevronDown, Edit3, LogOut, Check, Image } from 'lucide-react';
import { ActiveTab } from '../types';
import { useIdentity } from '../lib/identity';

interface HeaderProps {
  activeTab: ActiveTab;
  setActiveTab: (tab: ActiveTab) => void;
  /** Players seen in the room within the presence window. */
  onlineCount: number;
  onOpenBackgroundSettings: () => void;
  /** Renaming mid-round would orphan the active question, so it is blocked. */
  isRoundActive: boolean;
  showToast: (
    title: string,
    description?: string,
    type?: 'success' | 'error' | 'info' | 'warning'
  ) => void;
}

export const Header: React.FC<HeaderProps> = ({
  activeTab,
  setActiveTab,
  onlineCount,
  isRoundActive,
  onOpenBackgroundSettings,
  showToast,
}) => {
  const { name, isSignedIn, signIn, signOut } = useIdentity();
  const [isMenuOpen, setIsMenuOpen] = useState(false);
  const [isEditingName, setIsEditingName] = useState(false);
  const [nameInput, setNameInput] = useState('');
  const menuRef = useRef<HTMLDivElement>(null);

  // Close the menu when clicking anywhere else
  useEffect(() => {
    if (!isMenuOpen) return;
    const handleClickOutside = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setIsMenuOpen(false);
        setIsEditingName(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [isMenuOpen]);

  const handleSaveName = (e: React.FormEvent) => {
    e.preventDefault();
    const clean = nameInput.trim();
    if (!clean) {
      showToast('請輸入名稱', undefined, 'warning');
      return;
    }
    if (isRoundActive) {
      showToast('考驗進行中', '結束這一題後才能改名', 'warning');
      return;
    }
    signIn(clean);
    setIsEditingName(false);
    setIsMenuOpen(false);
    showToast('名稱已更新', clean, 'success');
  };

  const tabClass = (isActive: boolean) =>
    `flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs sm:text-sm font-medium transition-all ${
      isActive
        ? 'bg-white text-[#4A3F35] shadow-sm font-semibold'
        : 'text-[#7A6C5E] hover:text-[#4A3F35] hover:bg-white/50'
    }`;

  return (
    <header className="shrink-0 sticky top-0 z-40 bg-[#FAF7F2]/95 backdrop-blur-md border-b border-[#D9C5B2]">
      <div className="max-w-7xl mx-auto px-3 sm:px-6 lg:px-8">
        <div className="flex items-center justify-between gap-2 h-14">
          {/* Brand */}
          <button
            type="button"
            onClick={() => setActiveTab('co_play')}
            className="flex items-center gap-2 shrink-0 cursor-pointer"
          >
            <div className="w-9 h-9 rounded-2xl bg-[#A68B6D] flex items-center justify-center text-white">
              <Coffee className="w-5 h-5" />
            </div>
            <span className="text-base sm:text-lg font-bold text-[#4A3F35] tracking-tight">
              你問我答
            </span>
          </button>

          {isSignedIn && (
            <div className="flex items-center gap-2 min-w-0">
              {/* Tabs */}
              <nav className="flex items-center gap-1 bg-[#E8D8C4]/60 p-1 rounded-2xl border border-[#D9C5B2]">
                <button
                  onClick={() => setActiveTab('co_play')}
                  className={tabClass(activeTab === 'co_play')}
                >
                  <Users className="w-4 h-4" />
                  <span className="hidden sm:inline">對話</span>
                </button>
                <button
                  onClick={() => setActiveTab('admin_manage')}
                  className={tabClass(activeTab === 'admin_manage')}
                >
                  <Settings className="w-4 h-4" />
                  <span className="hidden sm:inline">後台</span>
                </button>
              </nav>

              {/* Player menu */}
              <div className="relative shrink-0" ref={menuRef}>
                <button
                  type="button"
                  onClick={() => setIsMenuOpen((v) => !v)}
                  className="flex items-center gap-1.5 pl-2.5 pr-2 py-2 rounded-2xl bg-white border border-[#D9C5B2] hover:bg-[#F5EFE6] transition-colors cursor-pointer max-w-[8rem] sm:max-w-none"
                >
                  <span
                    className={`w-2 h-2 rounded-full shrink-0 ${
                      onlineCount > 1 ? 'bg-emerald-500' : 'bg-[#C9B7A2]'
                    }`}
                  />
                  <span className="text-xs font-bold text-[#4A3F35] truncate">{name}</span>
                  <ChevronDown className="w-3.5 h-3.5 text-[#7A6C5E] shrink-0" />
                </button>

                {isMenuOpen && (
                  <div className="absolute right-0 mt-2 w-56 rounded-2xl bg-white border border-[#D9C5B2] shadow-lg overflow-hidden animate-fade-in">
                    <div className="px-4 py-3 border-b border-[#EFE5D8]">
                      <div className="text-sm font-bold text-[#4A3F35] truncate">{name}</div>
                      <div className="text-[11px] text-[#7A6C5E] mt-0.5">
                        線上 {onlineCount || 1} 人
                      </div>
                    </div>

                    {isEditingName ? (
                      <form onSubmit={handleSaveName} className="p-3 space-y-2">
                        <input
                          type="text"
                          value={nameInput}
                          onChange={(e) => setNameInput(e.target.value)}
                          placeholder="輸入新名稱"
                          maxLength={20}
                          autoFocus
                          className="w-full px-3 py-2 text-xs rounded-xl border border-[#D9C5B2] bg-white text-[#4A3F35] font-semibold focus:outline-none focus:ring-2 focus:ring-[#A68B6D]"
                        />
                        <div className="flex items-center gap-2">
                          <button
                            type="submit"
                            className="flex-1 py-2 rounded-xl bg-[#A68B6D] hover:bg-[#8E7256] text-white text-xs font-bold transition-colors cursor-pointer flex items-center justify-center gap-1"
                          >
                            <Check className="w-3.5 h-3.5" />
                            儲存
                          </button>
                          <button
                            type="button"
                            onClick={() => setIsEditingName(false)}
                            className="px-3 py-2 rounded-xl bg-[#F2EBE1] text-[#7A6C5E] text-xs font-bold cursor-pointer"
                          >
                            取消
                          </button>
                        </div>
                      </form>
                    ) : (
                      <div className="py-1">
                        <button
                          type="button"
                          onClick={() => {
                            setNameInput(name);
                            setIsEditingName(true);
                          }}
                          className="w-full px-4 py-2.5 text-left text-xs font-semibold text-[#4A3F35] hover:bg-[#F5EFE6] transition-colors flex items-center gap-2.5 cursor-pointer"
                        >
                          <Edit3 className="w-4 h-4 text-[#A68B6D]" />
                          改名
                        </button>
                        <button
                          type="button"
                          onClick={() => {
                            setIsMenuOpen(false);
                            onOpenBackgroundSettings();
                          }}
                          className="w-full px-4 py-2.5 text-left text-xs font-semibold text-[#4A3F35] hover:bg-[#F5EFE6] transition-colors flex items-center gap-2.5 cursor-pointer"
                        >
                          <Image className="w-4 h-4 text-[#A68B6D]" />
                          聊天背景
                        </button>
                        <button
                          type="button"
                          onClick={() => {
                            setIsMenuOpen(false);
                            signOut();
                            setActiveTab('co_play');
                          }}
                          className="w-full px-4 py-2.5 text-left text-xs font-semibold text-[#4A3F35] hover:bg-[#F5EFE6] transition-colors flex items-center gap-2.5 cursor-pointer"
                        >
                          <LogOut className="w-4 h-4 text-[#A68B6D]" />
                          切換帳號
                        </button>
                      </div>
                    )}
                  </div>
                )}
              </div>
            </div>
          )}
        </div>
      </div>
    </header>
  );
};
