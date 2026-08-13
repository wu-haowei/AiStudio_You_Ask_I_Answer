import React from 'react';
import { UserCheck, Sparkles, RefreshCw } from 'lucide-react';

interface CoPlayPasscodeModalProps {
  loginCodeInput: string;
  setLoginCodeInput: (val: string) => void;
  isAuthLoading: boolean;
  onLogin: (code: string, isFromQuickBtn?: boolean) => void;
}

export const CoPlayPasscodeModal: React.FC<CoPlayPasscodeModalProps> = ({
  loginCodeInput,
  setLoginCodeInput,
  isAuthLoading,
  onLogin,
}) => {
  return (
    <div className="flex-1 min-h-0 flex items-center justify-center p-4">
      <div className="bg-[#FAF7F2] border-2 border-[#D9C5B2] rounded-3xl p-6 sm:p-8 max-w-md w-full shadow-xl text-center space-y-6">
        <div className="w-16 h-16 bg-[#A68B6D] text-white rounded-2xl mx-auto flex items-center justify-center font-bold text-xl shadow-md">
          <UserCheck className="w-8 h-8" />
        </div>
        <div className="space-y-2">
          <h2 className="text-lg font-bold text-[#4A3F35]">請選擇你的雙人連線代表帳號</h2>
          <p className="text-xs text-[#7A6C5E] leading-relaxed">
            選擇預設身分或自訂帳號，即可與另一半或朋友連線進行「你問我答」真心話對決！
          </p>
        </div>

        {/* Quick Identity Buttons */}
        <div className="grid grid-cols-2 gap-3">
          <button
            type="button"
            onClick={() => onLogin('1105', true)}
            className="p-4 rounded-2xl bg-white border-2 border-[#D9C5B2] hover:border-[#A68B6D] text-[#4A3F35] text-left transition-all group shadow-xs cursor-pointer"
          >
            <div className="text-xs text-[#7A6C5E] font-medium">預設帳號 1P</div>
            <div className="text-base font-bold text-[#4A3F35] flex items-center justify-between">
              <span>1105</span>
              <Sparkles className="w-4 h-4 text-[#A68B6D] group-hover:scale-110 transition-transform" />
            </div>
          </button>

          <button
            type="button"
            onClick={() => onLogin('1115', true)}
            className="p-4 rounded-2xl bg-white border-2 border-[#D9C5B2] hover:border-[#A68B6D] text-[#4A3F35] text-left transition-all group shadow-xs cursor-pointer"
          >
            <div className="text-xs text-[#7A6C5E] font-medium">預設帳號 2P</div>
            <div className="text-base font-bold text-[#4A3F35] flex items-center justify-between">
              <span>1115</span>
              <Sparkles className="w-4 h-4 text-[#A68B6D] group-hover:scale-110 transition-transform" />
            </div>
          </button>
        </div>

        {/* Custom Passcode Login Form */}
        <form
          onSubmit={(e) => {
            e.preventDefault();
            if (loginCodeInput.trim()) {
              onLogin(loginCodeInput, false);
            }
          }}
          className="space-y-3 border-t border-[#D9C5B2] pt-4 text-left"
        >
          <label className="block text-xs font-bold text-[#A68B6D]">自訂其他帳號或暗號：</label>
          <div className="flex gap-2">
            <input
              type="text"
              value={loginCodeInput}
              onChange={(e) => setLoginCodeInput(e.target.value)}
              placeholder="例如：帳號 2、Alex、小明..."
              className="flex-1 px-4 py-2.5 rounded-xl border border-[#D9C5B2] bg-white text-xs font-bold text-[#4A3F35] focus:outline-none focus:ring-2 focus:ring-[#A68B6D]"
            />
            <button
              type="submit"
              disabled={isAuthLoading || !loginCodeInput.trim()}
              className="milk-tea-btn-primary px-5 py-2.5 rounded-xl text-xs font-bold shadow-md disabled:opacity-50 cursor-pointer shrink-0"
            >
              {isAuthLoading ? '連線中...' : '登入連線'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};
