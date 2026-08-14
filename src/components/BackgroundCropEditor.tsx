import React, { useEffect, useRef, useState } from 'react';
import { Move, X, Check } from 'lucide-react';
import { CROP_HEIGHT, CROP_WIDTH, renderCrop, type CropTransform } from '../lib/preferences';

interface BackgroundCropEditorProps {
  file: File;
  onCancel: () => void;
  onApply: (dataUrl: string) => Promise<void> | void;
  /** Live preview of the wash so the crop can be judged as it will look. */
  fade: number;
  onFadeChange: (value: number) => void;
}

/** Drag position, in fractions of the frame — kept resolution-independent. */
interface DragState {
  pointerId: number;
  startX: number;
  startY: number;
  originX: number;
  originY: number;
}

const MIN_ZOOM = 1;
const MAX_ZOOM = 3;

/**
 * Frames an image before it becomes the chat background.
 *
 * Cropping is what makes any source image usable: the output is always
 * CROP_WIDTH × CROP_HEIGHT regardless of how large the original is, so the
 * encoder never has to give up and reject the file.
 */
export const BackgroundCropEditor: React.FC<BackgroundCropEditorProps> = ({
  file,
  onCancel,
  onApply,
  fade,
  onFadeChange,
}) => {
  const [objectUrl, setObjectUrl] = useState('');
  /** Natural size of the source, needed to know how far it can be panned. */
  const [natural, setNatural] = useState({ width: 0, height: 0 });
  const [transform, setTransform] = useState<CropTransform>({ zoom: 1, offsetX: 0, offsetY: 0 });
  const [isApplying, setIsApplying] = useState(false);
  const dragRef = useRef<DragState | null>(null);
  const frameRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const url = URL.createObjectURL(file);
    setObjectUrl(url);
    return () => URL.revokeObjectURL(url);
  }, [file]);

  /**
   * How far the image may travel on each axis before an edge would show.
   *
   * The two axes differ: an image whose shape does not match the frame already
   * overflows on one side at zoom 1, and that overflow is exactly the room
   * available to pan. Treating both axes as `(zoom - 1) / 2` would wrongly
   * freeze a wide photo in place until it was zoomed in.
   */
  const slackFor = (zoom: number) => {
    if (!natural.width || !natural.height) return { x: 0, y: 0 };

    const coverScale = Math.max(CROP_WIDTH / natural.width, CROP_HEIGHT / natural.height);
    const drawWidth = natural.width * coverScale * zoom;
    const drawHeight = natural.height * coverScale * zoom;

    return {
      x: Math.max(0, (drawWidth / CROP_WIDTH - 1) / 2),
      y: Math.max(0, (drawHeight / CROP_HEIGHT - 1) / 2),
    };
  };

  const clampTransform = (zoom: number, offsetX: number, offsetY: number): CropTransform => {
    const slack = slackFor(zoom);
    return {
      zoom,
      offsetX: Math.max(-slack.x, Math.min(slack.x, offsetX)),
      offsetY: Math.max(-slack.y, Math.min(slack.y, offsetY)),
    };
  };

  const handlePointerDown = (e: React.PointerEvent) => {
    (e.target as HTMLElement).setPointerCapture(e.pointerId);
    dragRef.current = {
      pointerId: e.pointerId,
      startX: e.clientX,
      startY: e.clientY,
      originX: transform.offsetX,
      originY: transform.offsetY,
    };
  };

  const handlePointerMove = (e: React.PointerEvent) => {
    const drag = dragRef.current;
    const frame = frameRef.current;
    if (!drag || drag.pointerId !== e.pointerId || !frame) return;

    const rect = frame.getBoundingClientRect();
    const dx = (e.clientX - drag.startX) / rect.width;
    const dy = (e.clientY - drag.startY) / rect.height;

    setTransform((prev) => clampTransform(prev.zoom, drag.originX + dx, drag.originY + dy));
  };

  const handlePointerUp = () => {
    dragRef.current = null;
  };

  const handleZoom = (zoom: number) => {
    setTransform((prev) => clampTransform(zoom, prev.offsetX, prev.offsetY));
  };

  const handleApply = async () => {
    if (isApplying) return;
    setIsApplying(true);
    try {
      const dataUrl = await renderCrop(file, transform);
      await onApply(dataUrl);
    } finally {
      setIsApplying(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 bg-black/50 backdrop-blur-xs flex items-center justify-center p-4 animate-fade-in">
      <div className="bg-[#FAF7F2] border border-[#D9C5B2] rounded-3xl p-5 sm:p-6 max-w-sm w-full shadow-2xl space-y-3">
        <div className="flex items-start justify-between">
          <div>
            <h3 className="text-base font-bold text-[#4A3F35]">調整背景位置</h3>
            <p className="text-xs text-[#7A6C5E] mt-0.5">拖曳移動，縮放調整大小</p>
          </div>
          <button
            type="button"
            onClick={onCancel}
            aria-label="取消"
            className="text-[#7A6C5E] hover:text-[#4A3F35] p-1.5 rounded-xl hover:bg-[#E8D8C4]/60 transition-colors cursor-pointer"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* The frame shows exactly what the chat area will display */}
        <div
          ref={frameRef}
          onPointerDown={handlePointerDown}
          onPointerMove={handlePointerMove}
          onPointerUp={handlePointerUp}
          onPointerCancel={handlePointerUp}
          style={{ aspectRatio: `${CROP_WIDTH} / ${CROP_HEIGHT}` }}
          className="relative w-full max-h-[46vh] mx-auto overflow-hidden rounded-2xl border-2 border-[#A68B6D] bg-[#2C2421] cursor-grab active:cursor-grabbing touch-none select-none"
        >
          {objectUrl && (
            <img
              src={objectUrl}
              alt="背景預覽"
              draggable={false}
              onLoad={(e) => {
                const img = e.currentTarget;
                setNatural({ width: img.naturalWidth, height: img.naturalHeight });
              }}
              className="absolute inset-0 w-full h-full object-cover pointer-events-none"
              style={{
                transform: `translate(${transform.offsetX * 100}%, ${
                  transform.offsetY * 100
                }%) scale(${transform.zoom})`,
              }}
            />
          )}

          <div
            className="absolute inset-0 bg-[#FAF7F2] pointer-events-none"
            style={{ opacity: fade / 100 }}
          />

          <span className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 pointer-events-none inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-[#FAF7F2]/90 text-[11px] font-semibold text-[#4A3F35]">
            <Move className="w-3.5 h-3.5" />
            拖曳調整
          </span>
        </div>

        <p className="text-[11px] text-[#A69684] text-center">框內就是對話區會顯示的範圍</p>

        <div className="space-y-2">
          <div className="flex items-center gap-3">
            <label htmlFor="crop-zoom" className="text-xs text-[#7A6C5E] min-w-[2.5rem]">
              縮放
            </label>
            <input
              id="crop-zoom"
              type="range"
              min={MIN_ZOOM}
              max={MAX_ZOOM}
              step={0.05}
              value={transform.zoom}
              onChange={(e) => handleZoom(Number(e.target.value))}
              className="flex-1 accent-[#A68B6D]"
            />
            <span className="text-xs font-semibold text-[#4A3F35] min-w-[2.2rem] text-right">
              {transform.zoom.toFixed(1)}×
            </span>
          </div>

          <div className="flex items-center gap-3">
            <label htmlFor="crop-fade" className="text-xs text-[#7A6C5E] min-w-[2.5rem]">
              變淡
            </label>
            <input
              id="crop-fade"
              type="range"
              min={0}
              max={95}
              step={1}
              value={fade}
              onChange={(e) => onFadeChange(Number(e.target.value))}
              className="flex-1 accent-[#A68B6D]"
            />
            <span className="text-xs font-semibold text-[#4A3F35] min-w-[2.2rem] text-right">
              {fade}%
            </span>
          </div>
        </div>

        <div className="flex items-center gap-2 pt-1">
          <button
            type="button"
            onClick={onCancel}
            disabled={isApplying}
            className="px-4 py-3 rounded-2xl text-xs font-bold text-[#7A6C5E] bg-[#F2EBE1] hover:bg-[#E8D8C4] transition-colors cursor-pointer disabled:opacity-50"
          >
            取消
          </button>
          <button
            type="button"
            onClick={handleApply}
            disabled={isApplying}
            className="flex-1 milk-tea-btn-primary py-3 rounded-2xl text-xs font-bold inline-flex items-center justify-center gap-1.5 shadow-sm disabled:opacity-50 cursor-pointer"
          >
            <Check className="w-4 h-4" />
            {isApplying ? '處理中…' : '套用背景'}
          </button>
        </div>

        <p className="text-[11px] text-[#A69684] leading-relaxed">
          只有框內範圍會被壓縮上傳，所以再大的原圖都能用。
        </p>
      </div>
    </div>
  );
};
