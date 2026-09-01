import React, { useEffect, useRef, useState } from 'react';
import {
  Settings,
  Users,
  Coffee,
  ChevronDown,
  LogOut,
  Image,
  Mail,
  ArrowLeft,
  PlusCircle,
  HelpCircle,
} from 'lucide-react';
import { ActiveTab } from '../types';
import { useIdentity } from '../lib/identity';

/**
 * How long after a tap the burst is considered over. Restarted by every tap, so
 * this is the gap between taps, not the total time allowed for three.
 */
const LOGO_TAP_WINDOW_MS = 320;

/** Taps that reveal the default-library switch. */
const LOGO_TAPS_FOR_DEFAULTS = 3;

interface HeaderProps {
  activeTab: ActiveTab;
  setActiveTab: (tab: ActiveTab) => void;
  /** Players seen in the room within the presence window. */
  onlineCount: number;
  onOpenBackgroundSettings: () => void;
  onOpenEmailSettings: () => void;
  /** Re-opens the first-run app explainer on demand. */
  onOpenOnboarding: () => void;
  /** Shows or hides the admin screen's default-library switch. */
  onToggleDefaultLibrary: () => void;
  onSignOut: () => void;
  /** Present only while a conversation is open. */
  partnerName?: string;
  onLeaveRoom?: () => void;
  /**
   * Starting a round. On phones this button lives up here — the conversation
   * card's own header row is hidden to save vertical space.
   */
  onStartChallenge?: () => void;
  canStartChallenge?: boolean;
  /** Shown on the disabled button so the reason is not left to guesswork. */
  challengeHint?: string;
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
  onOpenBackgroundSettings,
  onOpenEmailSettings,
  onOpenOnboarding,
  onToggleDefaultLibrary,
  onSignOut,
  partnerName,
  onLeaveRoom,
  onStartChallenge,
  canStartChallenge = false,
  challengeHint,
  showToast,
}) => {
  const { name, isSignedIn } = useIdentity();
  const [isMenuOpen, setIsMenuOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);
  /** Taps counted so far in the current burst, and the timer that ends it. */
  const logoTapRef = useRef(0);
  const logoTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Close the menu when clicking anywhere else
  useEffect(() => {
    if (!isMenuOpen) return;
    const handleClickOutside = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setIsMenuOpen(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [isMenuOpen]);

  /*
   * The logo is a gesture target as well as a button:
   *
   *   one tap     back to the conversation
   *   three taps  show or hide the default-library switch in the admin screen
   *
   * Both act the moment they can. The first tap navigates straight away and the
   * counter keeps running underneath in case two more follow; the third fires
   * as it lands rather than waiting out a timer, because nothing is listening
   * for a fourth. The counter simply forgets itself after a quiet moment.
   */
  const handleLogoTap = () => {
    logoTapRef.current += 1;
    if (logoTimerRef.current) clearTimeout(logoTimerRef.current);

    if (logoTapRef.current >= LOGO_TAPS_FOR_DEFAULTS) {
      logoTapRef.current = 0;
      logoTimerRef.current = null;
      if (!partnerName) {
        showToast('請先選擇一個對話', '題庫是每組對話各自獨立的', 'warning');
        return;
      }
      onToggleDefaultLibrary();
      return;
    }

    if (logoTapRef.current === 1) setActiveTab('co_play');

    logoTimerRef.current = setTimeout(() => {
      logoTapRef.current = 0;
      logoTimerRef.current = null;
    }, LOGO_TAP_WINDOW_MS);
  };

  // A burst left half-finished must not outlive the header
  useEffect(
    () => () => {
      if (logoTimerRef.current) clearTimeout(logoTimerRef.current);
    },
    []
  );

  const tabClass = (isActive: boolean) =>
    `flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs sm:text-sm font-medium transition-all ${
      isActive
        ? 'bg-white text-[#4A3F35] shadow-sm font-semibold'
        : 'text-[#7A6C5E] hover:text-[#4A3F35] hover:bg-white/50'
    }`;

  return (
    <header
      /*
       * Installed on an iPhone there is no browser chrome, and the viewport is
       * declared `viewport-fit=cover` — so the page starts at the very top of
       * the screen, behind the status bar. Padding the header by the safe-area
       * inset pushes its contents clear while its own background fills the
       * strip, which is what makes it read as part of the app rather than a
       * gap above it.
       */
      style={{ paddingTop: 'env(safe-area-inset-top)' }}
      className="shrink-0 sticky top-0 z-40 bg-[#FAF7F2]/95 backdrop-blur-md border-b border-[#D9C5B2]"
    >
      <div className="max-w-7xl mx-auto px-3 sm:px-6 lg:px-8">
        <div className="flex items-center justify-between gap-2 h-14">
          {/* Brand */}
          <div className="flex items-center gap-2 min-w-0">
            {onLeaveRoom && (
              <button
                type="button"
                onClick={onLeaveRoom}
                aria-label="回到對話列表"
                className="p-2 -ml-1 rounded-xl text-[#7A6C5E] hover:text-[#4A3F35] hover:bg-[#E8D8C4]/60 transition-colors cursor-pointer shrink-0"
              >
                <ArrowLeft className="w-5 h-5" />
              </button>
            )}

            <button
              type="button"
              onClick={handleLogoTap}
              title="連點三下可顯示／收起預設題庫切換"
              className="flex items-center gap-2 shrink-0 cursor-pointer select-none"
            >
              <div className="w-9 h-9 rounded-2xl bg-[#A68B6D] flex items-center justify-center text-white">
                <Coffee className="w-5 h-5" />
              </div>
              <span className="text-base sm:text-lg font-bold text-[#4A3F35] tracking-tight truncate">
                {partnerName || '你問我答'}
              </span>
            </button>
          </div>

          {isSignedIn && (
            <div className="flex items-center gap-1.5 sm:gap-2 min-w-0">
              {/* Phone-only: the challenge button, since the card header is hidden */}
              {onStartChallenge && (
                <button
                  type="button"
                  onClick={onStartChallenge}
                  disabled={!canStartChallenge}
                  title={canStartChallenge ? undefined : challengeHint || '等待對方進入房間'}
                  className="sm:hidden px-2.5 py-1.5 rounded-xl bg-[#E8D8C4] hover:bg-[#D9C5B2] disabled:opacity-40 text-[#4A3F35] text-xs font-bold inline-flex items-center gap-1 transition-colors cursor-pointer shrink-0"
                >
                  <PlusCircle className="w-3.5 h-3.5" />
                  考驗
                </button>
              )}

              {/* Tabs — only meaningful once a conversation is open */}
              {partnerName && (
              <nav className="hidden sm:flex items-center gap-1 bg-[#E8D8C4]/60 p-1 rounded-2xl border border-[#D9C5B2]">
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
              )}

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

                    {/* Phone-only: the tabs moved in here when they left the bar */}
                    {partnerName && (
                      <div className="py-1 sm:hidden border-b border-[#EFE5D8]">
                        <button
                          type="button"
                          onClick={() => {
                            setIsMenuOpen(false);
                            setActiveTab('co_play');
                          }}
                          className={`w-full px-4 py-2.5 text-left text-xs font-semibold transition-colors flex items-center gap-2.5 cursor-pointer ${
                            activeTab === 'co_play'
                              ? 'text-[#4A3F35] bg-[#F5EFE6]'
                              : 'text-[#7A6C5E] hover:bg-[#F5EFE6]'
                          }`}
                        >
                          <Users className="w-4 h-4 text-[#A68B6D]" />
                          對話
                        </button>
                        <button
                          type="button"
                          onClick={() => {
                            setIsMenuOpen(false);
                            setActiveTab('admin_manage');
                          }}
                          className={`w-full px-4 py-2.5 text-left text-xs font-semibold transition-colors flex items-center gap-2.5 cursor-pointer ${
                            activeTab === 'admin_manage'
                              ? 'text-[#4A3F35] bg-[#F5EFE6]'
                              : 'text-[#7A6C5E] hover:bg-[#F5EFE6]'
                          }`}
                        >
                          <Settings className="w-4 h-4 text-[#A68B6D]" />
                          後台
                        </button>
                      </div>
                    )}

                    <div className="py-1">
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
                          onOpenEmailSettings();
                        }}
                        className="w-full px-4 py-2.5 text-left text-xs font-semibold text-[#4A3F35] hover:bg-[#F5EFE6] transition-colors flex items-center gap-2.5 cursor-pointer"
                      >
                        <Mail className="w-4 h-4 text-[#A68B6D]" />
                        救援 Email
                      </button>
                      <button
                        type="button"
                        onClick={() => {
                          setIsMenuOpen(false);
                          onOpenOnboarding();
                        }}
                        className="w-full px-4 py-2.5 text-left text-xs font-semibold text-[#4A3F35] hover:bg-[#F5EFE6] transition-colors flex items-center gap-2.5 cursor-pointer"
                      >
                        <HelpCircle className="w-4 h-4 text-[#A68B6D]" />
                        使用說明
                      </button>
                      <button
                        type="button"
                        onClick={() => {
                          setIsMenuOpen(false);
                          onSignOut();
                        }}
                        className="w-full px-4 py-2.5 text-left text-xs font-semibold text-[#4A3F35] hover:bg-[#F5EFE6] transition-colors flex items-center gap-2.5 cursor-pointer"
                      >
                        <LogOut className="w-4 h-4 text-[#A68B6D]" />
                        登出
                      </button>
                    </div>
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
