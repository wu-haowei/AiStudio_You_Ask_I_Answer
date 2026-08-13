import React from 'react';
import { UserRound } from 'lucide-react';

interface CoPlayPasscodeModalProps {
  loginCodeInput: string;
  setLoginCodeInput: (v: string) => void;
  isAuthLoading: boolean;
  onLogin: (code: string) => void;
}

/** Entry screen — any non-empty name gets you into the room. */
export const CoPlayPasscodeModal: React.FC<CoPlayPasscodeModalProps> = ({
  loginCodeInput,
  setLoginCodeInput,
  isAuthLoading,
  onLogin,
}) => {
  const canSubmit = !!loginCodeInput.trim() && !isAuthLoading;

  return (
    <div className="flex-1 min-h-0 flex items-center justify-center p-4">
      <div className="bg-[#FAF7F2] border border-[#D9C5B2] rounded-3xl p-6 sm:p-8 max-w-sm w-full shadow-lg space-y-6">
        <div className="text-center space-y-3">
          <div className="w-14 h-14 bg-[#A68B6D] text-white rounded-2xl mx-auto flex items-center justify-center">
            <UserRound className="w-7 h-7" />
          </div>
          <div className="space-y-1">
            <h2 className="text-lg font-bold text-[#4A3F35]">你問我答</h2>
            <p className="text-xs text-[#7A6C5E]">輸入姓名即可進入</p>
          </div>
        </div>

        <form
          onSubmit={(e) => {
            e.preventDefault();
            if (canSubmit) onLogin(loginCodeInput);
          }}
          className="space-y-3"
        >
          <div className="space-y-1.5">
            <label htmlFor="player-name" className="block text-xs font-bold text-[#7A6C5E]">
              姓名
            </label>
            <input
              id="player-name"
              type="text"
              value={loginCodeInput}
              onChange={(e) => setLoginCodeInput(e.target.value)}
              placeholder="輸入你的姓名"
              autoComplete="name"
              maxLength={20}
              className="w-full px-4 py-3 rounded-2xl border border-[#D9C5B2] bg-white text-sm font-semibold text-[#4A3F35] focus:outline-none focus:ring-2 focus:ring-[#A68B6D]"
            />
          </div>

          <button
            type="submit"
            disabled={!canSubmit}
            className="milk-tea-btn-primary w-full py-3 rounded-2xl text-sm font-bold shadow-sm disabled:opacity-50 cursor-pointer"
          >
            {isAuthLoading ? '連線中…' : '進入'}
          </button>
        </form>
      </div>
    </div>
  );
};
