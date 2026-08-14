import React, { useEffect, useState } from 'react';
import { X, ImagePlus, Trash2 } from 'lucide-react';
import { type UserPreferences } from '../lib/preferences';
import { BackgroundCropEditor } from './BackgroundCropEditor';

interface BackgroundSettingsModalProps {
  isOpen: boolean;
  onClose: () => void;
  preferences: UserPreferences;
  onSave: (patch: Partial<UserPreferences>) => Promise<void> | void;
  showToast: (
    title: string,
    description?: string,
    type?: 'success' | 'error' | 'info' | 'warning'
  ) => void;
}

/** Picks and previews the chat background, and how far it is washed out. */
export const BackgroundSettingsModal: React.FC<BackgroundSettingsModalProps> = ({
  isOpen,
  onClose,
  preferences,
  onSave,
  showToast,
}) => {
  /** A chosen file waits here until it has been framed in the crop editor. */
  const [pendingFile, setPendingFile] = useState<File | null>(null);
  // Fade is previewed live, so it is held locally until the modal closes
  const [fade, setFade] = useState(preferences.backgroundFade);

  /*
   * Preferences arrive from Firestore a moment after mount, so the slider has
   * to pick up the stored value when the dialog opens rather than freezing on
   * whatever the default was at first render.
   */
  useEffect(() => {
    if (isOpen) setFade(preferences.backgroundFade);
  }, [isOpen, preferences.backgroundFade]);

  if (!isOpen) return null;

  const handleFileChosen = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = ''; // let the same file be re-picked after cancelling
    if (!file) return;

    if (!file.type.startsWith('image/')) {
      showToast('請選擇圖片檔', undefined, 'warning');
      return;
    }
    setPendingFile(file);
  };

  const handleCropApplied = async (dataUrl: string) => {
    try {
      await onSave({ chatBackground: dataUrl });
      setPendingFile(null);
      showToast('背景已更新', undefined, 'success');
    } catch (err: any) {
      showToast('無法使用這張圖', err?.message || '請換一張試試', 'error');
    }
  };

  const handleFadeCommit = (value: number) => {
    setFade(value);
    onSave({ backgroundFade: value });
  };

  if (pendingFile) {
    return (
      <BackgroundCropEditor
        file={pendingFile}
        fade={fade}
        onFadeChange={handleFadeCommit}
        onCancel={() => setPendingFile(null)}
        onApply={handleCropApplied}
      />
    );
  }

  const hasBackground = !!preferences.chatBackground;

  return (
    <div className="fixed inset-0 z-50 bg-black/40 backdrop-blur-xs flex items-center justify-center p-4 animate-fade-in">
      <div className="bg-[#FAF7F2] border border-[#D9C5B2] rounded-3xl p-5 sm:p-6 max-w-sm w-full shadow-2xl space-y-4">
        <div className="flex items-start justify-between border-b border-[#D9C5B2] pb-3">
          <div>
            <h3 className="text-base font-bold text-[#4A3F35]">聊天背景</h3>
            <p className="text-xs text-[#7A6C5E] mt-0.5">只有你看得到，換裝置登入一樣在</p>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="關閉"
            className="text-[#7A6C5E] hover:text-[#4A3F35] p-1.5 rounded-xl hover:bg-[#E8D8C4]/60 transition-colors cursor-pointer"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Live preview of image and fade together */}
        <div className="relative h-36 rounded-2xl overflow-hidden border border-[#D9C5B2] bg-[#F5E6D3]">
          {hasBackground ? (
            <>
              <img
                src={preferences.chatBackground}
                alt="背景預覽"
                className="absolute inset-0 w-full h-full object-cover"
              />
              <div
                className="absolute inset-0 bg-[#FAF7F2]"
                style={{ opacity: fade / 100 }}
              />
            </>
          ) : (
            <div className="absolute inset-0 flex items-center justify-center text-xs text-[#A69684]">
              尚未設定背景
            </div>
          )}

          <div className="relative h-full flex flex-col justify-end gap-1.5 p-3">
            <span className="self-start max-w-[75%] px-2.5 py-1.5 rounded-xl rounded-bl-none bg-white border border-[#D9C5B2] text-[11px] text-[#4A3F35]">
              這樣看得清楚嗎
            </span>
            <span className="self-end max-w-[75%] px-2.5 py-1.5 rounded-xl rounded-br-none bg-[#A68B6D] text-[11px] text-white">
              可以，很好看
            </span>
          </div>
        </div>

        <div className="space-y-1.5">
          <div className="flex items-center justify-between text-xs font-bold text-[#5C4B3A]">
            <label htmlFor="bg-fade">變淡程度</label>
            <span className="text-[#7A6C5E]">{fade}%</span>
          </div>
          <input
            id="bg-fade"
            type="range"
            min={0}
            max={95}
            step={1}
            value={fade}
            disabled={!hasBackground}
            onChange={(e) => setFade(Number(e.target.value))}
            onPointerUp={(e) => handleFadeCommit(Number((e.target as HTMLInputElement).value))}
            onKeyUp={(e) => handleFadeCommit(Number((e.target as HTMLInputElement).value))}
            className="w-full accent-[#A68B6D] disabled:opacity-40"
          />
          <p className="text-[11px] text-[#A69684]">調高會讓訊息更好讀</p>
        </div>

        <div className="flex items-center gap-2 pt-1">
          <label className="flex-1 py-3 rounded-2xl text-xs font-bold text-center cursor-pointer transition-colors inline-flex items-center justify-center gap-1.5 milk-tea-btn-primary shadow-sm">
            <ImagePlus className="w-4 h-4" />
            {hasBackground ? '換一張' : '選擇圖片'}
            <input type="file" accept="image/*" className="hidden" onChange={handleFileChosen} />
          </label>

          {hasBackground && (
            <button
              type="button"
              onClick={() => onSave({ chatBackground: '' })}
              aria-label="移除背景"
              className="px-3 py-3 rounded-2xl bg-[#F2EBE1] text-[#7A6C5E] hover:text-rose-600 hover:bg-rose-50 transition-colors cursor-pointer"
            >
              <Trash2 className="w-4 h-4" />
            </button>
          )}
        </div>

        <p className="text-[11px] text-[#A69684] leading-relaxed">
          選好圖後可以拖曳調整位置，只有框內範圍會上傳。
        </p>
      </div>
    </div>
  );
};
