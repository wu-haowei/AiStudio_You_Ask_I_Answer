import {
  collection,
  deleteDoc,
  doc,
  getDoc,
  getDocs,
  onSnapshot,
  query,
  setDoc,
  where,
} from 'firebase/firestore';
import { db } from './firebase';

/**
 * Who is around, and how two people agree to start talking.
 *
 * Presence is a collection of one small document per person. Watching it costs
 * a read for every heartbeat of every online person, so the listener is only
 * attached while the conversation list is on screen — inside a room there is
 * nothing on the page that needs it.
 */

const PRESENCE = 'presence';
const INVITES = 'chatInvites';
const ROOMS = 'rooms';

export const PRESENCE_HEARTBEAT_MS = 60000;
export const PRESENCE_WINDOW_MS = 3 * PRESENCE_HEARTBEAT_MS;

export interface PresenceRecord {
  name: string;
  lastActive: string;
}

export interface ChatInvite {
  id: string;
  from: string;
  to: string;
  status: 'pending' | 'accepted' | 'declined';
  createdAt: string;
}

const encodeName = (name: string) => encodeURIComponent(name.trim());

/**
 * Room id for a pair, derived from both names so each side computes the same
 * one without having to look it up or agree on who created it first.
 */
export const pairRoomId = (a: string, b: string): string => {
  const [first, second] = [a.trim(), b.trim()].sort((x, y) => x.localeCompare(y));
  return `pair__${encodeName(first)}__${encodeName(second)}`;
};

export const isOnline = (record: { lastActive?: string }) =>
  !!record.lastActive && Date.now() - new Date(record.lastActive).getTime() < PRESENCE_WINDOW_MS;

export const announcePresence = async (name: string) => {
  if (!name) return;
  try {
    await setDoc(doc(db, PRESENCE, encodeName(name)), {
      name,
      lastActive: new Date().toISOString(),
    });
  } catch (err) {
    console.warn('[pairing] presence heartbeat failed:', err);
  }
};

export const clearPresence = async (name: string) => {
  if (!name) return;
  await deleteDoc(doc(db, PRESENCE, encodeName(name))).catch(() => {});
};

/** Only attach this while the conversation list is visible. */
export const subscribeToPresence = (onUpdate: (people: PresenceRecord[]) => void) =>
  onSnapshot(
    collection(db, PRESENCE),
    (snap) => onUpdate(snap.docs.map((d) => d.data() as PresenceRecord).filter(isOnline)),
    (err) => console.warn('[pairing] presence snapshot error:', err)
  );

/* ------------------------------------------------------------------ *
 * Invitations
 * ------------------------------------------------------------------ */

export const sendChatInvite = async (from: string, to: string): Promise<string> => {
  const id = `inv-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
  await setDoc(doc(db, INVITES, id), {
    id,
    from,
    to,
    status: 'pending',
    createdAt: new Date().toISOString(),
  });
  return id;
};

export const respondToInvite = async (invite: ChatInvite, accept: boolean) => {
  await setDoc(
    doc(db, INVITES, invite.id),
    { status: accept ? 'accepted' : 'declined', respondedAt: new Date().toISOString() },
    { merge: true }
  );
};

export const dismissInvite = (inviteId: string) =>
  deleteDoc(doc(db, INVITES, inviteId)).catch(() => {});

/** Invitations addressed to me, and the ones I sent that are still open. */
export const subscribeToInvites = (
  name: string,
  onUpdate: (incoming: ChatInvite[], outgoing: ChatInvite[]) => void
) => {
  if (!name) return () => {};

  let incoming: ChatInvite[] = [];
  let outgoing: ChatInvite[] = [];
  const emit = () => onUpdate(incoming, outgoing);

  const unsubIncoming = onSnapshot(
    query(collection(db, INVITES), where('to', '==', name)),
    (snap) => {
      incoming = snap.docs.map((d) => d.data() as ChatInvite);
      emit();
    },
    (err) => console.warn('[pairing] incoming invites error:', err)
  );

  const unsubOutgoing = onSnapshot(
    query(collection(db, INVITES), where('from', '==', name)),
    (snap) => {
      outgoing = snap.docs.map((d) => d.data() as ChatInvite);
      emit();
    },
    (err) => console.warn('[pairing] outgoing invites error:', err)
  );

  return () => {
    unsubIncoming();
    unsubOutgoing();
  };
};

/* ------------------------------------------------------------------ *
 * Pair rooms
 * ------------------------------------------------------------------ */

export interface PairRoomSummary {
  id: string;
  participants: string[];
  updatedAt: string;
}

/** Creates the room for two people if it is not there yet. */
export const ensurePairRoom = async (a: string, b: string): Promise<string> => {
  const id = pairRoomId(a, b);
  const ref = doc(db, ROOMS, id);
  const snap = await getDoc(ref);

  if (!snap.exists()) {
    const now = new Date().toISOString();
    await setDoc(ref, {
      code: id,
      participants: [a.trim(), b.trim()].sort((x, y) => x.localeCompare(y)),
      players: {},
      status: 'playing',
      createdAt: now,
      updatedAt: now,
    });
  }

  return id;
};

/**
 * Conversations this person is part of.
 *
 * Read once when the list opens rather than watched: the set of rooms changes
 * only when a new pairing is agreed, and that path already refreshes it.
 */
export const listMyRooms = async (name: string): Promise<PairRoomSummary[]> => {
  if (!name) return [];
  try {
    const snap = await getDocs(
      query(collection(db, ROOMS), where('participants', 'array-contains', name.trim()))
    );
    return snap.docs
      .map((d) => ({
        id: d.id,
        participants: (d.data().participants as string[]) || [],
        updatedAt: (d.data().updatedAt as string) || '',
      }))
      .sort((x, y) => y.updatedAt.localeCompare(x.updatedAt));
  } catch (err) {
    console.warn('[pairing] failed to list rooms:', err);
    return [];
  }
};

/** The other person in a pair room. */
export const partnerOf = (participants: string[], me: string) =>
  participants.find((p) => p !== me) || '對方';
