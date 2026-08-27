import { initializeApp, getApps, getApp } from 'firebase/app';
import {
  connectFirestoreEmulator,
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
  arrayRemove,
  runTransaction,
  serverTimestamp,
  type QueryDocumentSnapshot,
} from 'firebase/firestore';
import {
  connectAuthEmulator,
  getAuth,
  signInAnonymously,
  onAuthStateChanged,
  type User,
} from 'firebase/auth';
import {
  CoPlayRoom,
  FAQItem,
  GameInvitation,
  RoomMessage,
  RoomPlayer,
  RoomQuestion,
  RoundRecord,
  DATA_SCHEMA_VERSION,
  OTHER_PICK_INDEX,
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

/*
 * Local emulator, opt-in only.
 *
 * Started with `npm run dev:local`, which runs Vite in the `emulator` mode and
 * therefore loads `.env.emulator`. Anything else — including the production
 * build — talks to the real project, so there is no way to ship this by
 * accident.
 */
if (env.VITE_USE_EMULATOR === 'true') {
  connectFirestoreEmulator(db, '127.0.0.1', 8080);
  connectAuthEmulator(auth, 'http://127.0.0.1:9099', { disableWarnings: true });
  console.info('[firebase] using the local emulator — no production data is touched');
}

/** Collection names — single source of truth. */
export const COLLECTIONS = {
  ROOMS: 'rooms',
  MESSAGES: 'messages',
  /** Completed rounds; drives replay filtering and recent-activity counts. */
  ROUNDS: 'rounds',
  /**
   * Question library. Under a room it is that pair's own; at the root it is the
   * default library a pair starts with before they have one.
   */
  FAQS: 'faqs',
  /** Allowlist of anonymous UIDs permitted to use the app. */
  MEMBERS: 'members',
  CONFIG: 'config',
} as const;

/**
 * Messages fetched on entry, and per "load older" page.
 *
 * Paid in full every time a room is opened, so it is the price of walking in
 * the door. A phone screen holds nowhere near this many; the rest is read on
 * demand when someone actually scrolls back.
 */
export const MESSAGE_PAGE_SIZE = 25;

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

/*
 * Room ids are generated from participant names and are case-sensitive, so
 * they must be used verbatim. An earlier version upper-cased them, which was
 * harmless for the single hard-coded room but would silently point a pair at a
 * room that does not exist.
 */
const roomRef = (code: string) => doc(db, COLLECTIONS.ROOMS, code);
const messagesRef = (code: string) =>
  collection(db, COLLECTIONS.ROOMS, code, COLLECTIONS.MESSAGES);
const roundsRef = (code: string) => collection(db, COLLECTIONS.ROOMS, code, COLLECTIONS.ROUNDS);

/** Firestore stores players as a map (safe concurrent merges); the UI wants an array. */
/*
 * Player rows, with the fields the UI relies on always present.
 *
 * A restored backup — or a room written by an older version — can contain
 * entries missing `name` or `lastActive`, and every consumer downstream
 * assumes they are there. Filling them in once here is cheaper than guarding
 * at each use, and a nameless row is dropped outright since it cannot be
 * matched to anybody.
 */
const playersMapToArray = (players: any): RoomPlayer[] => {
  if (!players) return [];

  const rows: any[] = Array.isArray(players)
    ? players
    : Object.entries(players).map(([id, p]: [string, any]) => ({ ...(p || {}), id }));

  return rows
    .filter((p) => p && typeof p === 'object')
    .map((p) => ({
      ...p,
      id: String(p.id || ''),
      name: typeof p.name === 'string' ? p.name : '',
      score: Number(p.score) || 0,
      isHost: !!p.isHost,
      lastActive: typeof p.lastActive === 'string' ? p.lastActive : '',
    }))
    .filter((p) => p.id);
};

const normalizeRoom = (code: string, data: any): CoPlayRoom => ({
  code,
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
export const ensureRoom = async (
  code: string,
  hostName = '',
  /**
   * Both names in the pair. Security rules read this list to decide who may see
   * the conversation, so a room created without it would be unreachable.
   */
  participants: string[] = []
): Promise<CoPlayRoom> => {
  const ref = roomRef(code);
  const snap = await getDoc(ref);
  if (snap.exists()) {
    return normalizeRoom(code, snap.data());
  }

  const now = new Date().toISOString();
  const fresh = {
    code,
    v: DATA_SCHEMA_VERSION,
    hostName,
    participants,
    participantKeys: participants.map((p) => p.trim().toLowerCase()),
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
 * Drops one tab's player entry on the way out.
 *
 * Saying goodbye explicitly is what lets the heartbeat run slowly: a normal
 * departure is reflected at once, so the beat only has to cover the cases
 * nobody can announce — a crash, a killed tab, a lost connection.
 */
export const removePlayer = async (code: string, playerId: string) => {
  if (!code || !playerId) return;
  try {
    await setDoc(
      roomRef(code),
      { players: { [playerId]: deleteField() }, updatedAt: new Date().toISOString() },
      { merge: true }
    );
  } catch (err) {
    console.warn('[firestore] failed to remove player:', err);
  }
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

/**
 * Lightweight presence heartbeat.
 *
 * `name` is optional but worth passing: the merge only touches the keys listed
 * here, so score and host status survive, while a row that was removed on the
 * way out comes back complete instead of as a nameless fragment.
 */
export const touchPlayer = async (code: string, playerId: string, name?: string) => {
  if (!code || !playerId) return;
  try {
    await setDoc(
      roomRef(code),
      {
        players: {
          [playerId]: {
            id: playerId,
            ...(name ? { name } : {}),
            lastActive: new Date().toISOString(),
          },
        },
      },
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

/** Why a round could not be started; drives the message shown to the player. */
export type ClaimInviteFailure = 'invited' | 'playing' | 'missing' | 'error';

/**
 * Deliberately one flat shape rather than a discriminated union: this project
 * compiles without `strict`, and without it a `ok: true | false` discriminant
 * does not narrow, so callers could not reach `reason`.
 */
export interface ClaimInviteResult {
  ok: boolean;
  reason?: ClaimInviteFailure;
}

/**
 * Starts a round, but only when none is already under way.
 *
 * The check has to happen inside the transaction. Reading the room first and
 * then writing would leave a window where both devices see an idle room and
 * both write an invitation — the second one wins, and the player who lost
 * watches their own dialog turn into the other person's invite without ever
 * being told why.
 *
 * A declined invitation is spent, and a revealed question is finished; neither
 * blocks a new round.
 */
export const claimGameInvitation = async (
  code: string,
  invitation: GameInvitation
): Promise<ClaimInviteResult> => {
  try {
    return await runTransaction<ClaimInviteResult>(db, async (tx) => {
      const snap = await tx.get(roomRef(code));
      if (!snap.exists()) return { ok: false, reason: 'missing' };

      const data = snap.data() || {};
      const current = data.gameInvitation as GameInvitation | null | undefined;
      const active = data.activeGameQuestion as RoomQuestion | null | undefined;

      if (current && current.status !== 'declined') return { ok: false, reason: 'invited' };
      if (active && !active.isRevealed) return { ok: false, reason: 'playing' };

      tx.set(
        roomRef(code),
        {
          gameInvitation: sanitizeForFirestore(invitation, false),
          // Clears whatever the previous round left behind.
          activeGameQuestion: deleteField(),
          updatedAt: new Date().toISOString(),
        },
        { merge: true }
      );
      return { ok: true };
    });
  } catch (err) {
    console.warn('[firestore] failed to claim invitation:', err);
    return { ok: false, reason: 'error' };
  }
};

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
 * Is this pick the "其他" slot rather than one of the listed options?
 *
 * New rounds store OTHER_PICK_INDEX. Older ones stored `4`, which was safe back
 * when four options were the maximum — index 4 could only ever mean "其他". That
 * stopped being true once questions could carry five or more, so the old value
 * is honoured only for questions short enough that it cannot mean anything else.
 */
export const isOtherPick = (q: RoomQuestion, index: number): boolean =>
  index === OTHER_PICK_INDEX || (index === 4 && (q.options?.length ?? 0) <= 4);

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

/**
 * When a message happened, in milliseconds.
 *
 * A message you have just sent carries no server timestamp yet — Firestore
 * fills it in when the write lands — so the local snapshot sorts it as if it
 * had no time at all and it surfaces at the wrong end of the thread. Falling
 * back to the sender's own `createdAt` keeps it where it belongs until the
 * server's value arrives.
 */
const messageTime = (m: RoomMessage): number => {
  const server = (m as any).serverTime;
  if (server?.toMillis) return server.toMillis();
  if (server?.seconds) return server.seconds * 1000;
  const created = Date.parse(m.createdAt || '');
  return Number.isNaN(created) ? 0 : created;
};

/** Oldest first — the order the thread is read in. */
const inReadingOrder = (messages: RoomMessage[]): RoomMessage[] =>
  [...messages].sort((a, b) => messageTime(a) - messageTime(b));

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
      messages: inReadingOrder(snap.docs.map(toMessage)),
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
        messages: inReadingOrder(snap.docs.map(toMessage)),
        // Ordered newest-first, so the last document is the oldest of the page
        cursor: snap.docs[snap.docs.length - 1] ?? null,
        hasMore: snap.docs.length === max,
      }),
    (err) => console.warn('[firestore] messages snapshot error:', err)
  );
};

/* ------------------------------------------------------------------ *
 * Per-room question library
 * ------------------------------------------------------------------ */

const roomFaqsRef = (code: string) => collection(db, COLLECTIONS.ROOMS, code, COLLECTIONS.FAQS);

/**
 * Watches a pair's own questions.
 *
 * An empty library is not an error: the caller falls back to the built-in
 * defaults so a new pair has something to play with immediately, while still
 * being able to tell "never imported" apart from "imported then emptied".
 */
export const subscribeToRoomFaqs = (code: string, onUpdate: (items: FAQItem[]) => void) => {
  if (!code) return () => {};
  return onSnapshot(
    roomFaqsRef(code),
    (snap) => onUpdate(snap.docs.map((d) => ({ ...(d.data() as FAQItem), id: d.id }))),
    (err) => console.warn('[firestore] room faqs snapshot error:', err)
  );
};

export const saveRoomFaq = async (code: string, item: FAQItem) => {
  try {
    await setDoc(doc(roomFaqsRef(code), item.id), sanitizeForFirestore(item, false), {
      merge: true,
    });
  } catch (err) {
    console.warn('[firestore] failed to save room faq:', err);
  }
};

export const deleteRoomFaq = async (code: string, id: string) => {
  try {
    await deleteDoc(doc(roomFaqsRef(code), id));
  } catch (err) {
    console.warn('[firestore] failed to delete room faq:', err);
  }
};

/** Batched upsert — Firestore caps a batch at 500 writes. */
export const saveRoomFaqs = async (code: string, items: FAQItem[]) => {
  try {
    for (let i = 0; i < items.length; i += 400) {
      const batch = writeBatch(db);
      for (const item of items.slice(i, i + 400)) {
        batch.set(doc(roomFaqsRef(code), item.id), sanitizeForFirestore(item, false), {
          merge: true,
        });
      }
      await batch.commit();
    }
  } catch (err) {
    console.warn('[firestore] failed to bulk save room faqs:', err);
    throw err;
  }
};

export const deleteRoomFaqs = async (code: string, ids: string[]) => {
  try {
    for (let i = 0; i < ids.length; i += 400) {
      const batch = writeBatch(db);
      for (const id of ids.slice(i, i + 400)) batch.delete(doc(roomFaqsRef(code), id));
      await batch.commit();
    }
  } catch (err) {
    console.warn('[firestore] failed to bulk delete room faqs:', err);
    throw err;
  }
};

/**
 * Swaps a pair's library out for a different set of questions.
 *
 * Deliberately a replacement rather than a merge: "restore the defaults" has to
 * mean the library afterwards *is* the defaults, not the defaults plus whatever
 * was already lying around.
 *
 * The delete reads the collection rather than trusting a list from the caller —
 * a client-side snapshot can be a question behind, and anything it had not seen
 * yet would survive the wipe and reappear as a stray.
 */
export const replaceRoomFaqs = async (code: string, items: FAQItem[]) => {
  const existing = await getDocs(roomFaqsRef(code));

  for (let i = 0; i < existing.docs.length; i += 400) {
    const batch = writeBatch(db);
    for (const d of existing.docs.slice(i, i + 400)) batch.delete(d.ref);
    await batch.commit();
  }

  await saveRoomFaqs(code, items);
  return existing.docs.length;
};

/**
 * Forgets every question this pair has played.
 *
 * Used when the library itself is replaced: the ids in the played list point at
 * questions that no longer exist, and the list has no other way of shrinking.
 */
export const clearPlayedFaqIds = async (code: string) => {
  try {
    await setDoc(
      roomRef(code),
      { playedFaqIds: {}, updatedAt: new Date().toISOString() },
      { merge: true }
    );
  } catch (err) {
    console.warn('[firestore] failed to clear played questions:', err);
  }
};

/* ------------------------------------------------------------------ *
 * Round history
 * ------------------------------------------------------------------ */

/**
 * Publishes a question and records the round, in one write to the room.
 *
 * Everything here used to be three separate room writes — publish the question,
 * clear the invitation, append to the played list — and each of them pushed the
 * whole room document to every connected tab, one billed read apiece. They all
 * belong to the same user action, so they travel together.
 *
 * The round document is the audit log and lives in its own subcollection.
 * Nothing subscribes to it, so writing it separately costs no fan-out; a
 * failure there must not stop the round from starting, which is why it is
 * caught on its own.
 */
export const publishRound = async (
  code: string,
  question: RoomQuestion,
  round: RoundRecord,
  /** Timestamps already on the room document, so they can be pruned in place. */
  knownRecentRounds: string[] = [],
  activityWindowMs = 3 * 60 * 60 * 1000
) => {
  try {
    await setDoc(doc(roundsRef(code), round.id), {
      ...sanitizeForFirestore(round, false),
      serverTime: serverTimestamp(),
    });
  } catch (err) {
    console.warn('[firestore] failed to write round audit record:', err);
  }

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
      activeGameQuestion: sanitizeForFirestore(question, false),
      // The invitation has done its job the moment the question exists.
      gameInvitation: deleteField(),
      ...(round.faqId
        ? { playedFaqIds: { [round.category]: arrayUnion(round.faqId) } }
        : {}),
      // Unconditional, unlike playedFaqIds above — a hand-typed question has
      // no faqId to key on, but it still happened and is still worth
      // remembering by its words.
      playedQuestionTexts: arrayUnion(round.question.trim()),
      recentRounds,
      updatedAt: new Date().toISOString(),
    },
    { merge: true }
  );
};

/**
 * Everything this pair has already answered: library ids (for the replay
 * filter) and raw question text (for spotting the same question again after
 * its original library entry is gone). One read serves both.
 */
export const loadPlayedData = async (
  code: string
): Promise<{ faqIds: string[]; questionTexts: string[] }> => {
  try {
    const snap = await getDoc(roomRef(code));
    const data = snap.data();
    const played = (data?.playedFaqIds || {}) as Record<string, string[]>;
    return {
      faqIds: Array.from(new Set(Object.values(played).flat().filter(Boolean))),
      questionTexts: Array.from(new Set((data?.playedQuestionTexts || []) as string[])),
    };
  } catch (err) {
    console.warn('[firestore] failed to read played questions:', err);
    return { faqIds: [], questionTexts: [] };
  }
};

/**
 * Marks a question played without there having been a round.
 *
 * The admin list offers this as a manual toggle: a pair may have talked a
 * question through out loud, or simply not want it coming up again. It writes
 * the same fields the game does, so the replay filter and the text-based
 * "already answered" lookup both need no special case — and
 * `forgetPlayedFaqIds` is already the way back for the id side. The text side
 * has its own way back too — see `setPlayedQuestionText` — for the one place
 * that needs it: the cloud import picker, marking a question before it has an
 * id to hang a played-faq record on.
 */
export const markFaqPlayed = async (code: string, category: string, faqId: string, questionText?: string) => {
  if (!code || !faqId) return;
  await setDoc(
    roomRef(code),
    {
      // arrayUnion must be built inline; sanitizeForFirestore would flatten the
      // sentinel into a plain object and destroy it.
      playedFaqIds: { [category || '未分類']: arrayUnion(faqId) },
      ...(questionText?.trim() ? { playedQuestionTexts: arrayUnion(questionText.trim()) } : {}),
      updatedAt: new Date().toISOString(),
    },
    { merge: true }
  );
};

/**
 * Adds or removes a single question's text from the durable "answered"
 * record directly — for the cloud import picker, where a question may not be
 * in the library yet (so there is no faqId for `markFaqPlayed` to use) and
 * still needs to be markable, and un-markable, as answered.
 */
export const setPlayedQuestionText = async (code: string, questionText: string, answered: boolean) => {
  const text = questionText.trim();
  if (!code || !text) return;
  try {
    await setDoc(
      roomRef(code),
      {
        // Sentinels must be built inline; sanitizeForFirestore would flatten them into plain objects.
        playedQuestionTexts: answered ? arrayUnion(text) : arrayRemove(text),
        updatedAt: new Date().toISOString(),
      },
      { merge: true }
    );
  } catch (err) {
    console.warn('[firestore] failed to update played question text:', err);
  }
};

/**
 * Drops ids from every category's played list.
 *
 * Called after those questions are deleted — leaving them behind would keep
 * counting them against a library they are no longer part of — and by the
 * admin list's played toggle, to put a question back into circulation.
 */
export const forgetPlayedFaqIds = async (code: string, ids: string[]) => {
  if (ids.length === 0) return;

  const snap = await getDoc(roomRef(code));
  const played = (snap.data()?.playedFaqIds || {}) as Record<string, string[]>;
  const removed = new Set(ids);
  const next: Record<string, string[]> = {};

  for (const [category, list] of Object.entries(played)) {
    next[category] = (list || []).filter((id) => !removed.has(id));
  }

  await setDoc(
    roomRef(code),
    { playedFaqIds: next, updatedAt: new Date().toISOString() },
    { merge: true }
  );
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

/* ------------------------------------------------------------------ *
 * The default question library
 * ------------------------------------------------------------------ *
 *
 * A pair with no library of its own plays with this one, and the admin screen
 * can edit it like any other library. It lives in the root `faqs` collection —
 * the one the app used back when every pair shared a single library — which is
 * why the security rules already allow any signed-in user to read and write it.
 *
 * It used to be a constant compiled into the bundle, which meant changing a
 * question meant editing code and redeploying the site.
 */

/** One-shot read. The default library changes rarely; a live listener would
 *  bill every device for a collection almost nobody is looking at. */
export const loadDefaultFaqs = async (): Promise<FAQItem[]> => {
  try {
    const snap = await getDocs(contentRef(COLLECTIONS.FAQS));
    return snap.docs.map((d) => ({ ...(d.data() as FAQItem), id: d.id }));
  } catch (err) {
    console.warn('[firestore] failed to load the default library:', err);
    return [];
  }
};

/** Live view, for the admin screen while it is actually editing this library. */
export const subscribeToDefaultFaqs = (cb: (items: FAQItem[]) => void) =>
  subscribeToCollection<FAQItem>(COLLECTIONS.FAQS, cb);

export const saveDefaultFaq = (item: FAQItem) => saveItem(COLLECTIONS.FAQS, item);
export const saveDefaultFaqs = (items: FAQItem[]) => saveItems(COLLECTIONS.FAQS, items);
export const deleteDefaultFaq = (id: string) => deleteItem(COLLECTIONS.FAQS, id);
export const deleteDefaultFaqs = (ids: string[]) => deleteItems(COLLECTIONS.FAQS, ids);
