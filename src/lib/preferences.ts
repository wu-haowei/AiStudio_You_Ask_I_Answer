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
const prefsRef = (name: string) => doc(db, PREFS_COLLECTION, encodeURIComponent(name));

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
  const bitmap = await createImageBitmap(file);

  const canvas = document.createElement('canvas');
  canvas.width = CROP_WIDTH;
  canvas.height = CROP_HEIGHT;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('瀏覽器不支援圖片處理');

  // "cover": scale so the shorter side fills the frame, then apply the zoom
  const coverScale = Math.max(CROP_WIDTH / bitmap.width, CROP_HEIGHT / bitmap.height);
  const drawScale = coverScale * transform.zoom;
  const drawWidth = bitmap.width * drawScale;
  const drawHeight = bitmap.height * drawScale;

  const left = (CROP_WIDTH - drawWidth) / 2 + transform.offsetX * CROP_WIDTH;
  const top = (CROP_HEIGHT - drawHeight) / 2 + transform.offsetY * CROP_HEIGHT;

  ctx.drawImage(bitmap, left, top, drawWidth, drawHeight);
  bitmap.close?.();

  const mime = bestEncoderMime();
  for (const quality of [0.82, 0.7, 0.58, 0.45, 0.34]) {
    const dataUrl = canvas.toDataURL(mime, quality);
    if (dataUrl.length <= maxBytes) return dataUrl;
  }

  // A fixed-size canvas at the lowest quality is already tiny; this is a
  // last resort for pathological images rather than an expected path.
  return canvas.toDataURL(mime, 0.28);
};
