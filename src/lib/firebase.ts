import { initializeApp, getApps, getApp } from 'firebase/app';
import {
  getFirestore,
  doc,
  collection,
  query,
  orderBy,
  limit as fsLimit,
  onSnapshot,
  setDoc,
  getDoc,
  getDocs,
  deleteDoc,
  deleteField,
  writeBatch,
  runTransaction,
  serverTimestamp,
} from 'firebase/firestore';
import {
  Category,
  CoPlayRoom,
  FAQItem,
  GameInvitation,
  RoomMessage,
  RoomPlayer,
  RoomQuestion,
  UserQuestion,
} from '../types';

const env = (import.meta as any).env || {};

export const firebaseConfig = {
  apiKey: env.VITE_FIREBASE_API_KEY || 'AIzaSyDuWpe6wWkyzyuEqbTclpSgw7Akz9hqPVk',
  authDomain: env.VITE_FIREBASE_AUTH_DOMAIN || 'youaskianswer-aa276.firebaseapp.com',
  projectId: env.VITE_FIREBASE_PROJECT_ID || 'youaskianswer-aa276',
  storageBucket: env.VITE_FIREBASE_STORAGE_BUCKET || 'youaskianswer-aa276.firebasestorage.app',
  messagingSenderId: env.VITE_FIREBASE_MESSAGING_SENDER_ID || '659973025136',
  appId: env.VITE_FIREBASE_APP_ID || '1:659973025136:web:68b0ce844d553928e333b5',
};

const app = !getApps().length ? initializeApp(firebaseConfig) : getApp();
export const db = getFirestore(app);

/** Collection names — single source of truth. */
export const COLLECTIONS = {
  ROOMS: 'rooms',
  MESSAGES: 'messages',
  FAQS: 'faqs',
  CATEGORIES: 'categories',
  USER_QUESTIONS: 'userQuestions',
} as const;

/** How many historical messages to load when entering a room. */
export const MESSAGE_HISTORY_LIMIT = 300;

/* ------------------------------------------------------------------ *
 * Utilities
 * ------------------------------------------------------------------ */

/**
 * Firestore rejects `undefined`. Strip it everywhere; at the top level an
 * explicit `undefined`/`null` becomes deleteField() so stale invitations and
 * questions are actually removed from the document.
 */
const sanitizeForFirestore = (obj: any, isTopLevel = true): any => {
  if (obj === null || obj === undefined) {
    return isTopLevel ? deleteField() : null;
  }
  if (Array.isArray(obj)) {
    return obj.filter((item) => item !== undefined).map((item) => sanitizeForFirestore(item, false));
  }
  if (typeof obj === 'object') {
    const cleaned: Record<string, any> = {};
    for (const [key, value] of Object.entries(obj)) {
      if (value === undefined || value === null) {
        if (isTopLevel) cleaned[key] = deleteField();
        else if (value === null) cleaned[key] = null;
      } else if (typeof value === 'object') {
        cleaned[key] = sanitizeForFirestore(value, false);
      } else {
        cleaned[key] = value;
      }
    }
    return cleaned;
  }
  return obj;
};

const roomRef = (code: string) => doc(db, COLLECTIONS.ROOMS, code.toUpperCase());
const messagesRef = (code: string) =>
  collection(db, COLLECTIONS.ROOMS, code.toUpperCase(), COLLECTIONS.MESSAGES);

/** Firestore stores players as a map (safe concurrent merges); the UI wants an array. */
const playersMapToArray = (players: any): RoomPlayer[] => {
  if (!players) return [];
  if (Array.isArray(players)) return players;
  return Object.entries(players).map(([id, p]: [string, any]) => ({ ...p, id }));
};

const normalizeRoom = (code: string, data: any): CoPlayRoom => ({
  code: code.toUpperCase(),
  hostName: data?.hostName || '',
  players: playersMapToArray(data?.players),
  activeGameQuestion: data?.activeGameQuestion ?? null,
  gameInvitation: data?.gameInvitation ?? null,
  status: data?.status || 'playing',
  createdAt: data?.createdAt || new Date().toISOString(),
  updatedAt: data?.updatedAt || new Date().toISOString(),
});

/* ------------------------------------------------------------------ *
 * Room document
 * ------------------------------------------------------------------ */

/** Creates the room document if it does not exist yet. Safe to call on every entry. */
export const ensureRoom = async (code: string, hostName = ''): Promise<CoPlayRoom> => {
  const ref = roomRef(code);
  const snap = await getDoc(ref);
  if (snap.exists()) {
    return normalizeRoom(code, snap.data());
  }

  const now = new Date().toISOString();
  const fresh = {
    code: code.toUpperCase(),
    hostName,
    players: {},
    status: 'playing',
    createdAt: now,
    updatedAt: now,
  };
  await setDoc(ref, fresh, { merge: true });
  return normalizeRoom(code, fresh);
};

export const getRoom = async (code: string): Promise<CoPlayRoom | null> => {
  const snap = await getDoc(roomRef(code));
  return snap.exists() ? normalizeRoom(code, snap.data()) : null;
};

export const subscribeToRoom = (code: string, onUpdate: (room: CoPlayRoom) => void) => {
  if (!code) return () => {};
  return onSnapshot(
    roomRef(code),
    (snap) => {
      if (snap.exists()) onUpdate(normalizeRoom(code, snap.data()));
    },
    (err) => console.warn('[firestore] room snapshot error:', err)
  );
};

/** Partial merge write. Pass `null`/`undefined` for a field to delete it. */
export const updateRoom = async (code: string, patch: Record<string, any>) => {
  try {
    await setDoc(
      roomRef(code),
      sanitizeForFirestore({ ...patch, updatedAt: new Date().toISOString() }, true),
      { merge: true }
    );
  } catch (err) {
    console.warn('[firestore] failed to update room:', err);
  }
};

/** Writes a single player entry without touching the other players. */
export const upsertPlayer = async (code: string, player: RoomPlayer) => {
  const { id, ...rest } = player;
  await updateRoom(code, { players: { [id]: { ...rest, id } } });
};

/**
 * Removes player entries that have not sent a heartbeat recently. Each browser
 * tab registers its own player id, so without this the room document would grow
 * a new entry on every visit.
 */
export const prunePlayers = async (code: string, maxAgeMs = 6 * 60 * 60 * 1000) => {
  try {
    const snap = await getDoc(roomRef(code));
    if (!snap.exists()) return;

    const players = snap.data()?.players || {};
    const cutoff = Date.now() - maxAgeMs;
    const removals: Record<string, any> = {};

    for (const [id, p] of Object.entries<any>(players)) {
      const seen = p?.lastActive ? new Date(p.lastActive).getTime() : 0;
      if (seen < cutoff) removals[id] = deleteField();
    }

    if (Object.keys(removals).length > 0) {
      await setDoc(roomRef(code), { players: removals }, { merge: true });
    }
  } catch (err) {
    console.warn('[firestore] failed to prune players:', err);
  }
};

/** Lightweight presence heartbeat. */
export const touchPlayer = async (code: string, playerId: string) => {
  if (!code || !playerId) return;
  try {
    await setDoc(
      roomRef(code),
      { players: { [playerId]: { lastActive: new Date().toISOString() } } },
      { merge: true }
    );
  } catch (err) {
    console.warn('[firestore] heartbeat failed:', err);
  }
};

export const setGameInvitation = (code: string, invitation: GameInvitation | null) =>
  updateRoom(code, { gameInvitation: invitation });

export const setActiveGameQuestion = (code: string, question: RoomQuestion | null) =>
  updateRoom(code, { activeGameQuestion: question });

/**
 * Records one player's option for the active question inside a transaction, so
 * two devices submitting at the same time cannot clobber each other. Returns the
 * merged question — `isRevealed` is true only for the call that completed the
 * pair, which lets exactly one client publish the reveal message.
 */
export const submitGameAnswer = async (
  code: string,
  opts: { isTarget: boolean; optionIndex: number; optionText: string }
): Promise<RoomQuestion | null> => {
  const ref = roomRef(code);
  return runTransaction(db, async (tx) => {
    const snap = await tx.get(ref);
    if (!snap.exists()) return null;

    const current = snap.data()?.activeGameQuestion as RoomQuestion | undefined;
    if (!current) return null;

    const updated: RoomQuestion = { ...current };
    if (opts.isTarget) {
      updated.targetAnswer = opts.optionIndex;
      updated.targetAnswerText = opts.optionText;
    } else {
      updated.initiatorGuess = opts.optionIndex;
      updated.initiatorGuessText = opts.optionText;
    }

    const wasRevealed = !!current.isRevealed;
    if (updated.targetAnswer !== undefined && updated.initiatorGuess !== undefined) {
      updated.isRevealed = true;
      updated.isCorrect = updated.targetAnswer === updated.initiatorGuess;
    }

    tx.set(
      ref,
      {
        activeGameQuestion: sanitizeForFirestore(updated, false),
        updatedAt: new Date().toISOString(),
      },
      { merge: true }
    );

    // Suppress a duplicate reveal if this question was already revealed.
    return wasRevealed ? { ...updated, isRevealed: false } : updated;
  });
};

/* ------------------------------------------------------------------ *
 * Messages subcollection
 * ------------------------------------------------------------------ */

export const appendMessage = async (
  code: string,
  message: Omit<RoomMessage, 'createdAt'> & { createdAt?: string }
): Promise<RoomMessage> => {
  const payload: RoomMessage = {
    ...message,
    createdAt: message.createdAt || new Date().toISOString(),
  };
  try {
    await setDoc(doc(messagesRef(code), payload.id), {
      ...sanitizeForFirestore(payload, false),
      serverTime: serverTimestamp(),
    });
    await updateRoom(code, {});
  } catch (err) {
    console.warn('[firestore] failed to append message:', err);
  }
  return payload;
};

/** One-shot history read — used when entering a room before the listener attaches. */
export const loadRecentMessages = async (
  code: string,
  max = MESSAGE_HISTORY_LIMIT
): Promise<RoomMessage[]> => {
  try {
    const snap = await getDocs(query(messagesRef(code), orderBy('createdAt', 'desc'), fsLimit(max)));
    return snap.docs.map((d) => d.data() as RoomMessage).reverse();
  } catch (err) {
    console.warn('[firestore] failed to load message history:', err);
    return [];
  }
};

/**
 * Realtime listener over the most recent `max` messages, delivered oldest-first.
 * The first callback fires with the full history, so this doubles as the initial load.
 */
export const subscribeToMessages = (
  code: string,
  onUpdate: (messages: RoomMessage[]) => void,
  max = MESSAGE_HISTORY_LIMIT
) => {
  if (!code) return () => {};
  return onSnapshot(
    query(messagesRef(code), orderBy('createdAt', 'desc'), fsLimit(max)),
    (snap) => onUpdate(snap.docs.map((d) => d.data() as RoomMessage).reverse()),
    (err) => console.warn('[firestore] messages snapshot error:', err)
  );
};

/* ------------------------------------------------------------------ *
 * Content collections: faqs / categories / userQuestions
 * ------------------------------------------------------------------ */

const contentRef = (name: string) => collection(db, name);

export const subscribeToCollection = <T extends { id: string }>(
  name: string,
  onUpdate: (items: T[]) => void
) =>
  onSnapshot(
    contentRef(name),
    (snap) => onUpdate(snap.docs.map((d) => ({ ...(d.data() as T), id: d.id }))),
    (err) => console.warn(`[firestore] ${name} snapshot error:`, err)
  );

export const saveItem = async <T extends { id: string }>(name: string, item: T) => {
  try {
    await setDoc(doc(db, name, item.id), sanitizeForFirestore(item, false), { merge: true });
  } catch (err) {
    console.warn(`[firestore] failed to save ${name}/${item.id}:`, err);
  }
};

export const deleteItem = async (name: string, id: string) => {
  try {
    await deleteDoc(doc(db, name, id));
  } catch (err) {
    console.warn(`[firestore] failed to delete ${name}/${id}:`, err);
  }
};

/** Batched upsert — Firestore caps a batch at 500 writes. */
export const saveItems = async <T extends { id: string }>(name: string, items: T[]) => {
  try {
    for (let i = 0; i < items.length; i += 400) {
      const batch = writeBatch(db);
      for (const item of items.slice(i, i + 400)) {
        batch.set(doc(db, name, item.id), sanitizeForFirestore(item, false), { merge: true });
      }
      await batch.commit();
    }
  } catch (err) {
    console.warn(`[firestore] failed to bulk save ${name}:`, err);
  }
};

export const replaceCollection = async <T extends { id: string }>(name: string, items: T[]) => {
  try {
    const existing = await getDocs(contentRef(name));
    for (let i = 0; i < existing.docs.length; i += 400) {
      const batch = writeBatch(db);
      for (const d of existing.docs.slice(i, i + 400)) batch.delete(d.ref);
      await batch.commit();
    }
  } catch (err) {
    console.warn(`[firestore] failed to clear ${name}:`, err);
  }
  await saveItems(name, items);
};

/** Seeds default content the first time the app runs against an empty database. */
export const seedCollectionIfEmpty = async <T extends { id: string }>(
  name: string,
  defaults: T[]
): Promise<boolean> => {
  try {
    const snap = await getDocs(query(contentRef(name), fsLimit(1)));
    if (!snap.empty) return false;
    await saveItems(name, defaults);
    return true;
  } catch (err) {
    console.warn(`[firestore] failed to seed ${name}:`, err);
    return false;
  }
};

/* Convenience wrappers with concrete types */
export const subscribeToFAQs = (cb: (items: FAQItem[]) => void) =>
  subscribeToCollection<FAQItem>(COLLECTIONS.FAQS, cb);
export const subscribeToCategories = (cb: (items: Category[]) => void) =>
  subscribeToCollection<Category>(COLLECTIONS.CATEGORIES, cb);
export const subscribeToUserQuestions = (cb: (items: UserQuestion[]) => void) =>
  subscribeToCollection<UserQuestion>(COLLECTIONS.USER_QUESTIONS, cb);
