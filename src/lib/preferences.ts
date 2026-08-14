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
 * Shrinks an image until its data URL fits the size ceiling.
 *
 * Phone photos are several megabytes and would be rejected outright, so the
 * image is scaled down and re-encoded, dropping quality a step at a time until
 * it fits.
 */
export const compressImage = async (
  file: File,
  maxBytes = MAX_BACKGROUND_BYTES
): Promise<string> => {
  const bitmap = await createImageBitmap(file);

  // A phone screen never needs more than this for a background
  const maxEdge = 1280;
  const scale = Math.min(1, maxEdge / Math.max(bitmap.width, bitmap.height));
  const width = Math.round(bitmap.width * scale);
  const height = Math.round(bitmap.height * scale);

  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('瀏覽器不支援圖片處理');
  ctx.drawImage(bitmap, 0, 0, width, height);
  bitmap.close?.();

  const mime = bestEncoderMime();

  for (const quality of [0.82, 0.7, 0.58, 0.45, 0.34]) {
    const dataUrl = canvas.toDataURL(mime, quality);
    if (dataUrl.length <= maxBytes) return dataUrl;
  }

  // Still too big — halve the dimensions once and take the lowest quality
  const small = document.createElement('canvas');
  small.width = Math.round(width / 2);
  small.height = Math.round(height / 2);
  small.getContext('2d')?.drawImage(canvas, 0, 0, small.width, small.height);
  const fallback = small.toDataURL(mime, 0.4);

  if (fallback.length > maxBytes) {
    throw new Error('圖片太大，請換一張或先裁切');
  }
  return fallback;
};
