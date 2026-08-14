import { initializeApp, getApps, getApp } from 'firebase/app';
import {
  getFirestore,
  doc,
  collection,
  query,
  orderBy,
  limit as fsLimit,
  startAfter,
  onSnapshot,
  setDoc,
  getDoc,
  getDocs,
  deleteDoc,
  deleteField,
  writeBatch,
  arrayUnion,
  runTransaction,
  serverTimestamp,
  type QueryDocumentSnapshot,
} from 'firebase/firestore';
import { getAuth, signInAnonymously, onAuthStateChanged, type User } from 'firebase/auth';
import {
  Category,
  CoPlayRoom,
  FAQItem,
  GameInvitation,
  RoomMessage,
  RoomPlayer,
  RoomQuestion,
  RoundRecord,
  DATA_SCHEMA_VERSION,
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
export const auth = getAuth(app);

/** Collection names — single source of truth. */
export const COLLECTIONS = {
  ROOMS: 'rooms',
  MESSAGES: 'messages',
  /** Completed rounds; drives replay filtering and recent-activity counts. */
  ROUNDS: 'rounds',
  FAQS: 'faqs',
  CATEGORIES: 'categories',
  /** Allowlist of anonymous UIDs permitted to use the app. */
  MEMBERS: 'members',
  CONFIG: 'config',
} as const;

/** Messages fetched on entry, and per "load older" page. */
export const MESSAGE_PAGE_SIZE = 50;

/* ------------------------------------------------------------------ *
 * Access control
 * ------------------------------------------------------------------ */

/**
 * Reads the access switch at config/access.
 *
 * This single flag drives both halves of the gate: the app reads it here, and
 * the security rules read the same document. Flipping it in the Firebase
 * console turns the invite gate on or off without redeploying anything.
 *
 * Missing document or unreadable => treated as off, matching the rules.
 */
export const isInviteRequired = async (): Promise<boolean> => {
  try {
    const snap = await getDoc(doc(db, COLLECTIONS.CONFIG, 'access'));
    return snap.exists() && snap.data()?.requireInvite === true;
  } catch (err) {
    console.warn('[firestore] could not read access config, treating as open:', err);
    return false;
  }
};

/**
 * Signs the browser in anonymously. Anonymous auth alone proves nothing — it
 * just gives this device a stable uid that the allowlist can be checked against.
 */
export const ensureSignedIn = (): Promise<User> =>
  new Promise((resolve, reject) => {
    const unsubscribe = onAuthStateChanged(
      auth,
      (user) => {
        if (user) {
          unsubscribe();
          resolve(user);
          return;
        }
        signInAnonymously(auth).catch((err) => {
          unsubscribe();
          reject(err);
        });
      },
      (err) => {
        unsubscribe();
        reject(err);
      }
    );
  });

/** True when this uid is on the allowlist. */
export const isMember = async (uid: string): Promise<boolean> => {
  try {
    const snap = await getDoc(doc(db, COLLECTIONS.MEMBERS, uid));
    return snap.exists();
  } catch {
    return false;
  }
};

/**
 * Joins the allowlist by presenting the shared invite code. Security rules
 * compare the submitted code against a config document the client cannot read,
 * so a wrong code is rejected server-side.
 */
export const claimMembership = async (uid: string, code: string, name = ''): Promise<boolean> => {
  try {
    await setDoc(doc(db, COLLECTIONS.MEMBERS, uid), {
      code: code.trim(),
      name,
      joinedAt: new Date().toISOString(),
    });
    return true;
  } catch (err) {
    console.warn('[firestore] membership rejected:', err);
    return false;
  }
};

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
const roundsRef = (code: string) =>
  collection(db, COLLECTIONS.ROOMS, code.toUpperCase(), COLLECTIONS.ROUNDS);

/** Firestore stores players as a map (safe concurrent merges); the UI wants an array. */
const playersMapToArray = (players: any): RoomPlayer[] => {
  if (!players) return [];
  if (Array.isArray(players)) return players;
  return Object.entries(players).map(([id, p]: [string, any]) => ({ ...p, id }));
};

const normalizeRoom = (code: string, data: any): CoPlayRoom => ({
  code: code.toUpperCase(),
  v: data?.v,
  hostName: data?.hostName || '',
  playedFaqIds: data?.playedFaqIds || {},
  recentRounds: data?.recentRounds || [],
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
    v: DATA_SCHEMA_VERSION,
    hostName,
    players: {},
    status: 'playing',
    createdAt: now,
    updatedAt: now,
  };
  await setDoc(ref, fresh, { merge: true });
  return normalizeRoom(code, fresh);
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
 * Reads a side's picks, tolerating rounds stored before multi-select existed.
 */
export const readPicks = (q: RoomQuestion, side: 'target' | 'initiator'): number[] => {
  if (side === 'target') {
    if (q.targetAnswers?.length) return q.targetAnswers;
    return q.targetAnswer !== undefined ? [q.targetAnswer] : [];
  }
  if (q.initiatorGuesses?.length) return q.initiatorGuesses;
  return q.initiatorGuess !== undefined ? [q.initiatorGuess] : [];
};

/**
 * Records one player's option for the active question inside a transaction, so
 * two devices submitting at the same time cannot clobber each other. Returns the
 * merged question — `isRevealed` is true only for the call that completed the
 * pair, which lets exactly one client publish the reveal message.
 */
export const submitGameAnswer = async (
  code: string,
  opts: { isTarget: boolean; optionIndexes: number[]; optionText: string }
): Promise<RoomQuestion | null> => {
  const ref = roomRef(code);
  return runTransaction(db, async (tx) => {
    const snap = await tx.get(ref);
    if (!snap.exists()) return null;

    const current = snap.data()?.activeGameQuestion as RoomQuestion | undefined;
    if (!current) return null;

    const updated: RoomQuestion = { ...current, v: DATA_SCHEMA_VERSION };
    if (opts.isTarget) {
      updated.targetAnswers = opts.optionIndexes;
      updated.targetAnswerText = opts.optionText;
    } else {
      updated.initiatorGuesses = opts.optionIndexes;
      updated.initiatorGuessText = opts.optionText;
    }

    const targetPicks = readPicks(updated, 'target');
    const guessPicks = readPicks(updated, 'initiator');

    const wasRevealed = !!current.isRevealed;
    if (targetPicks.length > 0 && guessPicks.length > 0) {
      updated.isRevealed = true;
      // Any overlap counts as a hit, whatever the preference order.
      updated.isCorrect = guessPicks.some((pick) => targetPicks.includes(pick));
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
    // Only the message document is written. Touching the room document here
    // would push a snapshot of it to every connected client — a read each —
    // even though nothing about the room actually changed.
    await setDoc(doc(messagesRef(code), payload.id), {
      ...sanitizeForFirestore(payload, false),
      serverTime: serverTimestamp(),
    });
  } catch (err) {
    console.warn('[firestore] failed to append message:', err);
  }
  return payload;
};

/** Opaque paging cursor — the oldest document of the page just delivered. */
export type MessageCursor = QueryDocumentSnapshot | null;

export interface MessagePage {
  messages: RoomMessage[];
  cursor: MessageCursor;
  hasMore: boolean;
}

/**
 * Reads a document as a message. `serverTimestamps: 'estimate'` matters: a
 * message this device just sent has no server timestamp until the write lands,
 * and an unresolved timestamp sorts as null — which would make the message jump
 * to the top of the thread for a moment.
 */
const toMessage = (d: QueryDocumentSnapshot): RoomMessage =>
  d.data({ serverTimestamps: 'estimate' }) as RoomMessage;

/** Fetches the page of messages immediately older than `cursor`, oldest-first. */
export const loadOlderMessages = async (
  code: string,
  cursor: QueryDocumentSnapshot,
  max = MESSAGE_PAGE_SIZE
): Promise<MessagePage> => {
  try {
    const snap = await getDocs(
      query(messagesRef(code), orderBy('serverTime', 'desc'), startAfter(cursor), fsLimit(max))
    );
    return {
      messages: snap.docs.map(toMessage).reverse(),
      cursor: snap.docs[snap.docs.length - 1] ?? null,
      hasMore: snap.docs.length === max,
    };
  } catch (err) {
    console.warn('[firestore] failed to load older messages:', err);
    return { messages: [], cursor: null, hasMore: false };
  }
};

/**
 * Realtime listener over the most recent `max` messages, delivered oldest-first
 * and ordered by server time so the two devices' clocks cannot disagree.
 * The first callback doubles as the initial load; older pages come from
 * loadOlderMessages.
 */
export const subscribeToMessages = (
  code: string,
  onUpdate: (page: MessagePage) => void,
  max = MESSAGE_PAGE_SIZE
) => {
  if (!code) return () => {};
  return onSnapshot(
    query(messagesRef(code), orderBy('serverTime', 'desc'), fsLimit(max)),
    (snap) =>
      onUpdate({
        messages: snap.docs.map(toMessage).reverse(),
        // Ordered newest-first, so the last document is the oldest of the page
        cursor: snap.docs[snap.docs.length - 1] ?? null,
        hasMore: snap.docs.length === max,
      }),
    (err) => console.warn('[firestore] messages snapshot error:', err)
  );
};

/* ------------------------------------------------------------------ *
 * Round history
 * ------------------------------------------------------------------ */

/**
 * Records a published question. The round document is the audit log; the id is
 * also appended to the room's played list so the replay filter costs no extra
 * reads (the room document is already being listened to).
 */
export const recordRound = async (
  code: string,
  round: RoundRecord,
  /** Timestamps already on the room document, so they can be pruned in place. */
  knownRecentRounds: string[] = [],
  activityWindowMs = 3 * 60 * 60 * 1000
) => {
  try {
    // The round document is the audit log; nothing reads it at runtime.
    await setDoc(doc(roundsRef(code), round.id), {
      ...sanitizeForFirestore(round, false),
      serverTime: serverTimestamp(),
    });

    const cutoff = Date.now() - activityWindowMs;
    const recentRounds = [
      ...knownRecentRounds.filter((at) => new Date(at).getTime() >= cutoff),
      round.createdAt,
    ];

    // arrayUnion must not pass through sanitizeForFirestore — it would treat
    // the sentinel as a plain object and destroy it.
    await setDoc(
      roomRef(code),
      {
        ...(round.faqId
          ? { playedFaqIds: { [round.category]: arrayUnion(round.faqId) } }
          : {}),
        recentRounds,
        updatedAt: new Date().toISOString(),
      },
      { merge: true }
    );
  } catch (err) {
    console.warn('[firestore] failed to record round:', err);
  }
};

/**
 * Starts a fresh replay cycle for one category by emptying its played list.
 * Round documents are kept, so history and the activity counter are unaffected.
 */
export const resetPlayedCategory = async (code: string, category: string) => {
  try {
    await setDoc(
      roomRef(code),
      { playedFaqIds: { [category]: [] }, updatedAt: new Date().toISOString() },
      { merge: true }
    );
  } catch (err) {
    console.warn('[firestore] failed to reset played questions:', err);
  }
};

/* ------------------------------------------------------------------ *
 * Content collections: faqs / categories
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

/** Batched delete — used by the admin bulk-delete action. */
export const deleteItems = async (name: string, ids: string[]) => {
  try {
    for (let i = 0; i < ids.length; i += 400) {
      const batch = writeBatch(db);
      for (const id of ids.slice(i, i + 400)) batch.delete(doc(db, name, id));
      await batch.commit();
    }
  } catch (err) {
    console.warn(`[firestore] failed to bulk delete from ${name}:`, err);
    throw err;
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
