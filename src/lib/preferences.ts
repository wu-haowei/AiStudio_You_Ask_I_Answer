import { doc, onSnapshot, setDoc, deleteField } from 'firebase/firestore';
import { db } from './firebase';

/**
 * Per-person display preferences, keyed by the name used to sign in.
 *
 * Kept in Firestore rather than localStorage so the same name gets the same
 * look on any device, and so clearing the browser does not lose it.
 */

export interface UserPreferences {
  /** Data URL of the chat background, or empty for none. */
  chatBackground: string;
  /** How much the background is washed out, 0–100. Higher means easier to read. */
  backgroundFade: number;
}

export const DEFAULT_PREFERENCES: UserPreferences = {
  chatBackground: '',
  backgroundFade: 72,
};

const PREFS_COLLECTION = 'userPrefs';

/**
 * Firestore rejects documents over 1 MiB, and a base64 data URL is about a
 * third larger than the bytes it encodes. This ceiling leaves comfortable room
 * for the rest of the document.
 */
export const MAX_BACKGROUND_BYTES = 600_000;

/**
  * Names are free text, but a Firestore document id cannot contain a slash and
  * must not be "." or "..", so the name is percent-encoded before use.
  */
/*
 * The name is the document id verbatim — security rules compare it against the
 * signed-in name and cannot url-encode, so encoding here would lock everyone
 * out of their own preferences.
 */
const prefsRef = (name: string) => doc(db, PREFS_COLLECTION, name.trim().toLowerCase());

export const subscribeToPreferences = (
  name: string,
  onUpdate: (prefs: UserPreferences) => void
) => {
  if (!name) return () => {};
  return onSnapshot(
    prefsRef(name),
    (snap) => {
      const data = snap.data() || {};
      onUpdate({
        chatBackground: data.chatBackground || DEFAULT_PREFERENCES.chatBackground,
        backgroundFade:
          typeof data.backgroundFade === 'number'
            ? data.backgroundFade
            : DEFAULT_PREFERENCES.backgroundFade,
      });
    },
    (err) => console.warn('[firestore] preferences snapshot error:', err)
  );
};

export const savePreferences = async (name: string, patch: Partial<UserPreferences>) => {
  if (!name) return;
  try {
    await setDoc(prefsRef(name), { ...patch, updatedAt: new Date().toISOString() }, { merge: true });
  } catch (err) {
    console.warn('[firestore] failed to save preferences:', err);
    throw err;
  }
};

export const clearChatBackground = (name: string) =>
  setDoc(prefsRef(name), { chatBackground: deleteField() }, { merge: true });

/**
 * Picks the smallest format this browser can actually *encode*.
 *
 * Decoding support is not the question — every current browser displays AVIF
 * and WebP. Encoding through canvas is patchier: Firefox has never shipped WebP
 * in toDataURL, and AVIF encoding is not available everywhere either. Probing a
 * 1×1 canvas is cheap and tells us the truth for this browser; toDataURL
 * silently returns PNG when the requested type is unsupported.
 */
let cachedMime: string | null = null;

const bestEncoderMime = (): string => {
  if (cachedMime) return cachedMime;

  const probe = document.createElement('canvas');
  probe.width = 1;
  probe.height = 1;

  // Smallest first — AVIF is typically 15–25% under WebP at the same quality
  for (const mime of ['image/avif', 'image/webp']) {
    try {
      if (probe.toDataURL(mime).startsWith(`data:${mime}`)) {
        cachedMime = mime;
        return mime;
      }
    } catch {
      // Unsupported types can throw rather than fall back; try the next one
    }
  }

  cachedMime = 'image/jpeg';
  return cachedMime;
};

/**
 * Output size of a cropped background.
 *
 * Portrait, because the app is used on phones; a wide screen fills the frame
 * with object-cover and trims the top and bottom instead. Fixing the output
 * dimensions is what makes any source image usable — the encoder always works
 * on the same pixel count no matter how large the original was.
 */
export const CROP_WIDTH = 900;
export const CROP_HEIGHT = 1200;

/** How the source image sits inside the crop frame. */
export interface CropTransform {
  /** 1 = fits the frame exactly; larger zooms in. */
  zoom: number;
  /** Pan, as a fraction of the frame's width and height. */
  offsetX: number;
  offsetY: number;
}

/** Anything the user could act on is spelled out; the rest is for the console. */
export class BackgroundError extends Error {
  constructor(
    message: string,
    /** Extra context shown in smaller print and logged in full. */
    readonly detail?: string
  ) {
    super(message);
    this.name = 'BackgroundError';
  }
}

const describeBytes = (bytes: number) =>
  bytes >= 1_000_000 ? `${(bytes / 1_000_000).toFixed(1)} MB` : `${Math.round(bytes / 1000)} KB`;

/**
 * Decodes a file into something drawable.
 *
 * `createImageBitmap` is the fast path but it is also the step that fails on
 * phones: a large photo can exhaust memory, and some pickers hand over formats
 * a given browser cannot decode this way. An <img> element succeeds in several
 * of those cases, so it is worth a second attempt before giving up.
 */
const loadDrawable = async (
  file: File
): Promise<{ source: CanvasImageSource; width: number; height: number; via: string }> => {
  try {
    const bitmap = await createImageBitmap(file);
    return { source: bitmap, width: bitmap.width, height: bitmap.height, via: 'createImageBitmap' };
  } catch (bitmapError) {
    console.warn('[background] createImageBitmap failed, falling back to <img>:', bitmapError);

    const url = URL.createObjectURL(file);
    try {
      const img = await new Promise<HTMLImageElement>((resolve, reject) => {
        const element = new Image();
        element.onload = () => resolve(element);
        element.onerror = () => reject(new Error('img decode failed'));
        element.src = url;
      });
      return { source: img, width: img.naturalWidth, height: img.naturalHeight, via: '<img>' };
    } catch (imgError) {
      throw new BackgroundError(
        '這張圖無法解碼',
        `檔案 ${file.name || '(未命名)'}・${file.type || '未知格式'}・${describeBytes(file.size)}。` +
          `瀏覽器兩種解碼方式都失敗了（${String(bitmapError)} / ${String(imgError)}）。` +
          '手機拍的超大照片可能因記憶體不足而失敗，可先用相簿的編輯功能裁切後再試。'
      );
    } finally {
      URL.revokeObjectURL(url);
    }
  }
};

/**
 * Draws the framed region at the fixed output size and encodes it.
 *
 * The geometry mirrors CSS `object-fit: cover` followed by the same translate
 * and scale the editor previews with, so what the frame showed is what gets
 * saved.
 */
export const renderCrop = async (
  file: File,
  transform: CropTransform,
  maxBytes = MAX_BACKGROUND_BYTES
): Promise<string> => {
  const { source, width, height, via } = await loadDrawable(file);

  const canvas = document.createElement('canvas');
  canvas.width = CROP_WIDTH;
  canvas.height = CROP_HEIGHT;
  const ctx = canvas.getContext('2d');
  if (!ctx) {
    throw new BackgroundError('瀏覽器不支援圖片處理', '無法取得 canvas 2d context。');
  }

  // "cover": scale so the shorter side fills the frame, then apply the zoom
  const coverScale = Math.max(CROP_WIDTH / width, CROP_HEIGHT / height);
  const drawScale = coverScale * transform.zoom;
  const drawWidth = width * drawScale;
  const drawHeight = height * drawScale;

  const left = (CROP_WIDTH - drawWidth) / 2 + transform.offsetX * CROP_WIDTH;
  const top = (CROP_HEIGHT - drawHeight) / 2 + transform.offsetY * CROP_HEIGHT;

  try {
    ctx.drawImage(source, left, top, drawWidth, drawHeight);
  } catch (err) {
    throw new BackgroundError(
      '繪製圖片時失敗',
      `原圖 ${width}×${height}・${describeBytes(file.size)}・解碼方式 ${via}。${String(err)}`
    );
  } finally {
    (source as ImageBitmap).close?.();
  }

  const mime = bestEncoderMime();
  let smallest = Number.POSITIVE_INFINITY;

  for (const quality of [0.82, 0.7, 0.58, 0.45, 0.34, 0.24]) {
    const dataUrl = canvas.toDataURL(mime, quality);

    // toDataURL silently returns PNG when it cannot honour the type, and PNG of
    // a photo is far larger than the budget — worth naming if it happens.
    if (!dataUrl.startsWith(`data:${mime}`)) {
      throw new BackgroundError(
        '瀏覽器無法壓縮這張圖',
        `要求 ${mime} 但得到 ${dataUrl.slice(5, dataUrl.indexOf(';'))}。請改用其他瀏覽器再試。`
      );
    }

    smallest = Math.min(smallest, dataUrl.length);
    if (dataUrl.length <= maxBytes) return dataUrl;
  }

  throw new BackgroundError(
    '這張圖壓縮後仍然太大',
    `最小壓到 ${describeBytes(smallest)}，超過 ${describeBytes(maxBytes)} 的上限。` +
      `原圖 ${width}×${height}・${describeBytes(file.size)}・格式 ${mime}。` +
      '試著把縮放調小一點，或換一張細節較少的圖。'
  );
};
