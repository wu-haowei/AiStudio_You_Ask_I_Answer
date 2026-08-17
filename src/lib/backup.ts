import {
  collection,
  doc,
  getDocs,
  query,
  setDoc,
  where,
  writeBatch,
  Timestamp,
  type CollectionReference,
  type DocumentReference,
  type Firestore,
  type Query,
} from 'firebase/firestore';
import { DATA_SCHEMA_VERSION } from '../types';

/**
 * Whole-database backup for the admin download button.
 *
 * Firestore's managed export needs a paid plan, so this walks the tree with the
 * ordinary SDK instead: every root collection, every document, and recursively
 * every subcollection.
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
  collections: Record<string, BackupCollection>;
}

/**
 * Subcollections cannot be discovered from a web client — `listCollections()`
 * is admin-only — so the ones this app creates are named explicitly. Anything
 * added later needs a line here to be included in backups.
 */
const KNOWN_SUBCOLLECTIONS: Record<string, string[]> = {
  // `faqs` here is the pair's own question library, stored under its room
  rooms: ['messages', 'rounds', 'faqs'],
};

const ROOT_COLLECTIONS = ['faqs', 'categories', 'rooms', 'userPrefs'];

/**
 * Rooms belong to a pair, and the rules only let you read the ones you are in.
 * Listing the whole collection would therefore be rejected, so when a name is
 * given the rooms are fetched with a participant filter instead — the backup
 * covers your own conversations, which is all anyone is allowed to see.
 */
const roomsFor = (db: Firestore, scopeName?: string) =>
  scopeName
    ? query(collection(db, 'rooms'), where('participants', 'array-contains', scopeName.trim()))
    : collection(db, 'rooms');

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

const dumpCollection = async (
  ref: CollectionReference | Query,
  subcollectionNames: string[],
  onProgress?: (count: number) => void
): Promise<{ collection: BackupCollection; count: number }> => {
  const snap = await getDocs(ref);
  const out: BackupCollection = {};
  let count = 0;

  for (const document of snap.docs) {
    const entry: BackupDocument = {
      data: encodeValue(document.data()) as Record<string, unknown>,
      subcollections: {},
    };
    count += 1;

    for (const name of subcollectionNames) {
      const nested = await dumpCollection(
        collection(document.ref, name),
        KNOWN_SUBCOLLECTIONS[name] || [],
        onProgress
      );
      // Skip empty subcollections so the file stays readable
      if (Object.keys(nested.collection).length > 0) {
        entry.subcollections[name] = nested.collection;
        count += nested.count;
      }
    }

    out[document.id] = entry;
    onProgress?.(count);
  }

  return { collection: out, count };
};

/** Reads everything and returns a self-contained snapshot object. */
export const createBackup = async (
  db: Firestore,
  onProgress?: (count: number) => void,
  scopeName?: string
): Promise<BackupFile> => {
  const collections: Record<string, BackupCollection> = {};
  let documentCount = 0;

  for (const name of ROOT_COLLECTIONS) {
    const result = await dumpCollection(
      name === 'rooms' ? roomsFor(db, scopeName) : collection(db, name),
      KNOWN_SUBCOLLECTIONS[name] || [],
      onProgress
    );
    collections[name] = result.collection;
    documentCount += result.count;
  }

  return {
    exportedAt: new Date().toISOString(),
    schemaVersion: DATA_SCHEMA_VERSION,
    documentCount,
    collections,
  };
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

/** Deletes documents in chunks; Firestore caps a batch at 500 operations. */
const deleteInBatches = async (
  db: Firestore,
  refs: DocumentReference[]
): Promise<number> => {
  for (let i = 0; i < refs.length; i += 400) {
    const batch = writeBatch(db);
    for (const ref of refs.slice(i, i + 400)) batch.delete(ref);
    await batch.commit();
  }
  return refs.length;
};

/**
 * Empties the whole database, subcollections included.
 *
 * Deleting a document does not remove documents beneath it, so chat history and
 * round logs have to be cleared explicitly before their room document goes.
 */
export const wipeDatabase = async (
  db: Firestore,
  onProgress?: (removed: number) => void,
  scopeName?: string
): Promise<number> => {
  let removed = 0;

  for (const name of ROOT_COLLECTIONS) {
    const snap = await getDocs(name === 'rooms' ? roomsFor(db, scopeName) : collection(db, name));

    for (const document of snap.docs) {
      for (const sub of KNOWN_SUBCOLLECTIONS[name] || []) {
        const nested = await getDocs(collection(document.ref, sub));
        removed += await deleteInBatches(db, nested.docs.map((d) => d.ref));
        onProgress?.(removed);
      }
    }

    removed += await deleteInBatches(db, snap.docs.map((d) => d.ref));
    onProgress?.(removed);
  }

  return removed;
};

export interface RestoreReport {
  written: number;
  failed: number;
}

const restoreCollection = async (
  ref: CollectionReference,
  docs: BackupCollection,
  report: RestoreReport
): Promise<void> => {
  for (const [id, entry] of Object.entries(docs)) {
    try {
      await setDoc(doc(ref, id), decodeValue(entry.data) as Record<string, unknown>);
      report.written += 1;
    } catch (err) {
      console.warn(`restore failed for ${ref.path}/${id}:`, err);
      report.failed += 1;
    }

    for (const [name, nested] of Object.entries(entry.subcollections || {})) {
      await restoreCollection(collection(doc(ref, id), name), nested, report);
    }
  }
};

/** Writes a backup back into Firestore. Call wipeDatabase first for a clean slate. */
export const restoreBackup = async (db: Firestore, backup: BackupFile): Promise<RestoreReport> => {
  const report: RestoreReport = { written: 0, failed: 0 };
  for (const [name, docs] of Object.entries(backup.collections || {})) {
    await restoreCollection(collection(db, name), docs, report);
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
export const backupFileName = (date = new Date()) =>
  `youaskianswer-backup-${date.toISOString().slice(0, 19).replace(/[:T]/g, '-')}.json`;
