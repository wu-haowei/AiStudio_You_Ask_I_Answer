import { deleteDoc, doc, getDoc, onSnapshot, setDoc } from 'firebase/firestore';
import { db, ensureSignedIn } from './firebase';

/**
 * Name-and-password accounts.
 *
 * There is no backend, so verification has to happen where the browser cannot
 * skip it: security rules compare a submitted hash against one stored in a
 * document no client may read.
 *
 *   users/{name}      public    { name, mustChangePassword }
 *   secrets/{name}    no read   { passwordHash }
 *   sessions/{uid}    own only  { name, passwordHash }
 *
 * The name is used verbatim as the document id. Url-encoding it would be
 * tidier, but security rules cannot url-encode, and a rule that cannot
 * recompute the key cannot tell whether a session's name really belongs to the
 * secret it was checked against. Names are validated instead.
 *
 * The session document is both the proof and the binding: it can only be
 * written with a hash that matches the secret, and every other rule asks
 * "which name does this uid belong to?" by reading it.
 *
 * Keeping the hash out of `users` matters — a readable hash is a hash an
 * attacker can simply replay.
 */

export const DEFAULT_PASSWORD = '0101';

const USERS = 'users';
const SECRETS = 'secrets';
const SESSIONS = 'sessions';

/**
 * Names double as document ids, so the few characters Firestore forbids there
 * are rejected up front rather than failing mysteriously on write.
 */
export const assertUsableName = (name: string): string => {
  const clean = name.trim();
  if (!clean) throw new AuthError('請輸入姓名');
  if (clean.includes('/')) throw new AuthError('姓名不能包含斜線');
  if (clean === '.' || clean === '..') throw new AuthError('這個姓名不能使用');
  if (/^__.*__$/.test(clean)) throw new AuthError('這個姓名不能使用');
  if (new TextEncoder().encode(clean).length > 200) throw new AuthError('姓名太長');
  return clean;
};

export interface AccountRecord {
  name: string;
  exists: boolean;
  mustChangePassword: boolean;
}

export class AuthError extends Error {}

/**
 * Hashes with SHA-256 and a fixed application salt plus the name.
 *
 * Not bcrypt — without a server there is nowhere to run a slow KDF — but it
 * keeps plain passwords out of the database and out of network payloads.
 */
export const hashPassword = async (name: string, password: string): Promise<string> => {
  const data = new TextEncoder().encode(`youaskianswer:${name.trim()}:${password}`);
  const digest = await crypto.subtle.digest('SHA-256', data);
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
};

/** Only reveals whether the name is taken, never anything secret. */
export const lookupAccount = async (name: string): Promise<AccountRecord> => {
  const clean = assertUsableName(name);
  try {
    const snap = await getDoc(doc(db, USERS, clean));
    if (!snap.exists()) return { name: clean, exists: false, mustChangePassword: true };
    return {
      name: clean,
      exists: true,
      mustChangePassword: snap.data().mustChangePassword !== false,
    };
  } catch (err) {
    console.warn('[accounts] lookup failed:', err);
    throw new AuthError('無法連線，請檢查網路');
  }
};

/**
 * Signs in, creating the account with the default password when it is new.
 *
 * The session is rewritten on every login, which is what makes the app
 * survivable: anonymous uids change whenever browser data is cleared, so the
 * password — not the uid — has to be what proves identity. Without this
 * rebinding, clearing a cache would lock someone out of their own rooms.
 */
export const signInWithPassword = async (
  name: string,
  password: string
): Promise<AccountRecord> => {
  const clean = assertUsableName(name);
  if (!password) throw new AuthError('請輸入密碼');

  const user = await ensureSignedIn();
  const account = await lookupAccount(clean);
  const hash = await hashPassword(clean, password);

  if (!account.exists) {
    if (password !== DEFAULT_PASSWORD) {
      throw new AuthError(`這是新帳號，請用預設密碼 ${DEFAULT_PASSWORD} 登入`);
    }

    /*
     * Rules only allow creating a secret that does not exist yet, so this can
     * never overwrite someone else's password. Failures are logged rather than
     * thrown: if a previous attempt half-created the account, the session write
     * below is still the honest test of whether the password is right.
     */
    await setDoc(doc(db, SECRETS, clean), {
      passwordHash: hash,
      createdAt: new Date().toISOString(),
    }).catch((err) => console.warn('[accounts] secret creation rejected:', err));

    await setDoc(doc(db, USERS, clean), {
      name: clean,
      exists: true,
      mustChangePassword: true,
      createdAt: new Date().toISOString(),
    }).catch((err) => console.warn('[accounts] user creation rejected:', err));
  }

  /*
   * The real check. Rules permit this write only when the hash matches the
   * stored secret, so a wrong password is refused by Firestore rather than by
   * code that devtools could step over.
   */
  try {
    await setDoc(doc(db, SESSIONS, user.uid), {
      name: clean,
      passwordHash: hash,
      boundAt: new Date().toISOString(),
    });
  } catch (err) {
    console.warn('[accounts] password rejected:', err);
    throw new AuthError(
      account.exists ? '密碼不正確' : '無法建立帳號，這個名字可能已被使用'
    );
  }

  await setDoc(
    doc(db, USERS, clean),
    { lastLoginAt: new Date().toISOString() },
    { merge: true }
  ).catch(() => {
    // A failed timestamp update must not block a successful login
  });

  return account.exists ? account : { name: clean, exists: true, mustChangePassword: true };
};

/** Replaces the password, then refreshes the session so it stays valid. */
export const changePassword = async (
  name: string,
  currentPassword: string,
  nextPassword: string
): Promise<void> => {
  const clean = assertUsableName(name);
  if (nextPassword.length < 4) throw new AuthError('新密碼至少 4 個字元');
  if (nextPassword === DEFAULT_PASSWORD) throw new AuthError('請不要沿用預設密碼');
  if (nextPassword === currentPassword) throw new AuthError('新密碼不能和目前的一樣');

  const user = await ensureSignedIn();
  const nextHash = await hashPassword(clean, nextPassword);

  try {
    // Rules require the caller's session to be bound to this name, which it
    // only can be if the current password was correct at sign-in.
    await setDoc(
      doc(db, SECRETS, clean),
      { passwordHash: nextHash, updatedAt: new Date().toISOString() },
      { merge: true }
    );
  } catch (err) {
    console.warn('[accounts] change password rejected:', err);
    throw new AuthError('無法變更密碼，請重新登入後再試');
  }

  // The session carries the old hash; leaving it stale would fail later checks
  await setDoc(doc(db, SESSIONS, user.uid), {
    name: clean,
    passwordHash: nextHash,
    boundAt: new Date().toISOString(),
  });

  await setDoc(
    doc(db, USERS, clean),
    { mustChangePassword: false },
    { merge: true }
  );
};

/**
 * Confirms this browser still holds a valid session for `name`.
 *
 * Anonymous uids are not permanent — clearing site data hands out a new one —
 * and every rule keys off sessions/{uid}. Without this check the app would look
 * signed in while every read and write was silently denied.
 */
export const hasValidSession = async (name: string): Promise<boolean> => {
  const clean = name.trim();
  if (!clean) return false;

  try {
    const user = await ensureSignedIn();
    const snap = await getDoc(doc(db, SESSIONS, user.uid));
    return snap.exists() && snap.data().name === clean;
  } catch (err) {
    console.warn('[accounts] session check failed:', err);
    // A network blip should not throw someone out of their own account
    return true;
  }
};

/** Drops the session document so the next visit has to sign in again. */
export const endSession = async (): Promise<void> => {
  try {
    const user = await ensureSignedIn();
    await deleteDoc(doc(db, SESSIONS, user.uid));
  } catch (err) {
    console.warn('[accounts] session cleanup failed:', err);
  }
};

/** Watches the account record so a forced password change reacts immediately. */
export const subscribeToAccount = (name: string, onUpdate: (account: AccountRecord) => void) => {
  if (!name) return () => {};
  return onSnapshot(
    doc(db, USERS, name.trim()),
    (snap) =>
      onUpdate({
        name,
        exists: snap.exists(),
        mustChangePassword: snap.data()?.mustChangePassword !== false,
      }),
    (err) => console.warn('[accounts] account snapshot error:', err)
  );
};
