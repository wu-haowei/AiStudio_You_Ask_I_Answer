import { collection, doc, getDocs, writeBatch } from 'firebase/firestore';
import { db } from './firebase';

/**
 * Moves the old single-room data into a pair room.
 *
 * Before pairing existed everyone shared one room called MAIN-ROOM. Rather than
 * migrate automatically on start-up — which would silently push someone else's
 * conversation into a new pair — this runs from a button, copies rather than
 * moves, and skips anything already present. Running it twice is harmless.
 */

const LEGACY_ROOM = 'MAIN-ROOM';
const BATCH_LIMIT = 400; // Firestore caps a batch at 500 operations

export interface MigrationReport {
  messages: number;
  rounds: number;
  faqs: number;
}

/** Copies documents from one subcollection to another, keeping their ids. */
const copySubcollection = async (
  from: string[],
  to: string[],
  existing: Set<string>
): Promise<number> => {
  const snap = await getDocs(collection(db, from[0], from[1], from[2]));
  const pending = snap.docs.filter((d) => !existing.has(d.id));

  let written = 0;
  for (let i = 0; i < pending.length; i += BATCH_LIMIT) {
    const batch = writeBatch(db);
    for (const d of pending.slice(i, i + BATCH_LIMIT)) {
      batch.set(doc(db, to[0], to[1], to[2], d.id), d.data());
      written += 1;
    }
    await batch.commit();
  }
  return written;
};

const idsIn = async (path: string[]): Promise<Set<string>> => {
  const snap = await getDocs(collection(db, path[0], path[1], path[2]));
  return new Set(snap.docs.map((d) => d.id));
};

export const hasLegacyRoom = async (): Promise<boolean> => {
  const snap = await getDocs(collection(db, 'rooms', LEGACY_ROOM, 'messages'));
  return !snap.empty;
};

export const migrateLegacyRoom = async (targetRoomId: string): Promise<MigrationReport> => {
  if (!targetRoomId || targetRoomId === LEGACY_ROOM) {
    throw new Error('目標房間不正確');
  }

  const report: MigrationReport = { messages: 0, rounds: 0, faqs: 0 };

  for (const sub of ['messages', 'rounds', 'faqs'] as const) {
    const from = ['rooms', LEGACY_ROOM, sub];
    const to = ['rooms', targetRoomId, sub];
    report[sub] = await copySubcollection(from, to, await idsIn(to));
  }

  return report;
};

/**
 * The top-level `faqs` collection was the shared question library. Pairs now
 * keep their own, so this seeds a pair from the old shared one.
 */
export const importLegacyFaqs = async (targetRoomId: string): Promise<number> => {
  const snap = await getDocs(collection(db, 'faqs'));
  if (snap.empty) return 0;

  const existing = await idsIn(['rooms', targetRoomId, 'faqs']);
  const pending = snap.docs.filter((d) => !existing.has(d.id));

  let written = 0;
  for (let i = 0; i < pending.length; i += BATCH_LIMIT) {
    const batch = writeBatch(db);
    for (const d of pending.slice(i, i + BATCH_LIMIT)) {
      batch.set(doc(db, 'rooms', targetRoomId, 'faqs', d.id), d.data());
      written += 1;
    }
    await batch.commit();
  }
  return written;
};
