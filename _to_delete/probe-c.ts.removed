import {
  collection,
  doc,
  getDoc,
  getDocs,
  setDoc,
  writeBatch,
  Timestamp,
  type CollectionReference,
  type DocumentReference,
  type Firestore,
} from 'firebase/firestore';
import { DATA_SCHEMA_VERSION } from '../src/types';

/**
 * Backup and restore for one conversation.
 *
 * Firestore's managed export needs a paid plan, so this walks the tree with the
 * ordinary SDK instead. The scope is deliberately a single pair room: it is
 * what the admin screen is about, it is all the security rules would hand over
 * anyway, and — most importantly — it means a restore can never reach into
 * somebody else's conversation.
 *
 * Timestamps are written in a tagged shape so they survive the JSON round trip
 * and are decoded again on restore.
 */

export interface BackupDocument {
  data: Record<string, unknown>;
  subcollections: Record<string, BackupCollection>;
}

export type BackupCollection = Record<string, BackupDocument>;

export interface BackupFile {
  exportedAt: string;
  schemaVersion: number;
  documentCount: number;
  /** Present on room backups; older whole-database files do not have it. */
  scope?: 'room';
  roomId?: string;
  participants?: string[];
  collections: Record<string, BackupCollection>;
}

/**
 * Subcollections cannot be discovered from a web client — `listCollections()`
 * is admin-only — so the ones this app creates are named explicitly. Anything
 * added later needs a line here to be included in backups.
 */
const ROOM_SUBCOLLECTIONS = ['messages', 'rounds', 'faqs'] as const;

/** Timestamps must survive the JSON round trip; store them in a tagged shape. */
const encodeValue = (value: unknown): unknown => {
  if (value instanceof Timestamp) {
    return { __type__: 'timestamp', seconds: value.seconds, nanoseconds: value.nanoseconds };
  }
  if (Array.isArray(value)) return value.map(encodeValue);
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>).map(([k, v]) => [k, encodeValue(v)])
    );
  }
  return value;
};

/** Reverses encodeValue when reading a backup file. */
const decodeValue = (value: unknown): unknown => {
  if (Array.isArray(value)) return value.map(decodeValue);
  if (value && typeof value === 'object') {
    const obj = value as Record<string, unknown>;
    if (obj.__type__ === 'timestamp') {
      return new Timestamp(Number(obj.seconds), Number(obj.nanoseconds));
    }
    return Object.fromEntries(Object.entries(obj).map(([k, v]) => [k, decodeValue(v)]));
  }
  return value;
};

const dumpCollection = async (
  ref: CollectionReference,
  onProgress?: (count: number) => void
): Promise<{ collection: BackupCollection; count: number }> => {
  const snap = await getDocs(ref);
  const out: BackupCollection = {};
  let count = 0;

  for (const document of snap.docs) {
    out[document.id] = {
      data: encodeValue(document.data()) as Record<string, unknown>,
      subcollections: {},
    };
    count += 1;
    onProgress?.(count);
  }

  return { collection: out, count };
};

/** Reads one conversation — the room document and everything under it. */
export const createRoomBackup = async (
  db: Firestore,
  roomId: string,
  onProgress?: (count: number) => void
): Promise<BackupFile> => {
  const roomSnap = await getDoc(doc(db, 'rooms', roomId));
  if (!roomSnap.exists()) throw new Error('找不到這個對話');

  const roomData = roomSnap.data();
  const entry: BackupDocument = {
    data: encodeValue(roomData) as Record<string, unknown>,
    subcollections: {},
  };

  let documentCount = 1;
  for (const sub of ROOM_SUBCOLLECTIONS) {
    const nested = await dumpCollection(collection(db, 'rooms', roomId, sub), (n) =>
      onProgress?.(documentCount + n)
    );
    // Skip empty subcollections so the file stays readable
    if (Object.keys(nested.collection).length > 0) {
      entry.subcollections[sub] = nested.collection;
      documentCount += nested.count;
    }
  }

  return {
    exportedAt: new Date().toISOString(),
    schemaVersion: DATA_SCHEMA_VERSION,
    scope: 'room',
    roomId,
    participants: (roomData.participants as string[]) || [],
    documentCount,
    collections: { rooms: { [roomId]: entry } },
  };
};

/** Deletes documents in chunks; Firestore caps a batch at 500 operations. */
const deleteInBatches = async (db: Firestore, refs: DocumentReference[]): Promise<number> => {
  for (let i = 0; i < refs.length; i += 400) {
    const batch = writeBatch(db);
    for (const ref of refs.slice(i, i + 400)) batch.delete(ref);
    await batch.commit();
  }
  return refs.length;
};

/**
 * Empties one conversation: chat history, round log and question library.
 *
 * The room document itself is left in place. Deleting it would strip the
 * participant list the security rules read, and every following write —
 * including the restore about to happen — would be refused.
 */
export const wipeRoom = async (
  db: Firestore,
  roomId: string,
  onProgress?: (removed: number) => void
): Promise<number> => {
  let removed = 0;

  for (const sub of ROOM_SUBCOLLECTIONS) {
    const snap = await getDocs(collection(db, 'rooms', roomId, sub));
    removed += await deleteInBatches(db, snap.docs.map((d) => d.ref));
    onProgress?.(removed);
  }

  return removed;
};

export interface RestoreReport {
  written: number;
  failed: number;
}

/** The room ids a backup file carries, whatever version wrote it. */
export const roomIdsIn = (backup: BackupFile): string[] =>
  Object.keys(backup.collections?.rooms || {});

/** Human-readable "this file belongs to …", for the mismatch message. */
export const describeBackup = (backup: BackupFile): string => {
  if (backup.participants && backup.participants.length > 0) {
    return backup.participants.join(' 與 ');
  }
  const ids = roomIdsIn(backup);
  return ids.length > 0 ? ids.join('、') : '未知的對話';
};

/** True when the file carries data for this room — the restore guard. */
export const backupMatchesRoom = (backup: BackupFile, roomId: string): boolean =>
  roomIdsIn(backup).includes(roomId);

/**
 * Writes a conversation back into Firestore.
 *
 * The room's own document is merged rather than replaced wholesale: the live
 * participant list wins, so restoring a file taken before that field existed
 * cannot lock the pair out of their own room.
 */
export const restoreRoomBackup = async (
  db: Firestore,
  roomId: string,
  backup: BackupFile
): Promise<RestoreReport> => {
  const entry = (backup.collections?.rooms || {})[roomId];
  if (!entry) {
    throw new Error(`這份備份是【${describeBackup(backup)}】的資料，不是目前這一組對話`);
  }

  const report: RestoreReport = { written: 0, failed: 0 };
  const liveRoom = await getDoc(doc(db, 'rooms', roomId));
  const live = liveRoom.data() || {};

  const roomData = decodeValue(entry.data) as Record<string, unknown>;
  if (live.participants) roomData.participants = live.participants;
  if (live.participantKeys) roomData.participantKeys = live.participantKeys;

  await setDoc(doc(db, 'rooms', roomId), roomData, { merge: true });
  report.written += 1;

  for (const [sub, docs] of Object.entries(entry.subcollections || {})) {
    for (const [id, nested] of Object.entries(docs)) {
      try {
        await setDoc(
          doc(db, 'rooms', roomId, sub, id),
          decodeValue(nested.data) as Record<string, unknown>
        );
        report.written += 1;
      } catch (err) {
        console.warn(`restore failed for rooms/${roomId}/${sub}/${id}:`, err);
        report.failed += 1;
      }
    }
  }

  return report;
};

/** Rejects anything that is not one of our backup files. */
export const parseBackupFile = (raw: string): BackupFile => {
  const parsed = JSON.parse(raw);
  if (!parsed || typeof parsed !== 'object' || !parsed.collections) {
    throw new Error('這不是備份檔（缺少 collections 欄位）');
  }
  return parsed as BackupFile;
};

/** Filename for the downloaded snapshot. */
export const backupFileName = (partner = '', date = new Date()) => {
  const stamp = date.toISOString().slice(0, 19).replace(/[:T]/g, '-');
  const who = partner.trim() ? `-${partner.trim().replace(/[\\/:*?"<>|\s]/g, '_')}` : '';
  return `youaskianswer${who}-${stamp}.json`;
};
