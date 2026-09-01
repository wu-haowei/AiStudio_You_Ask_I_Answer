import { deleteDoc, doc, getDoc, onSnapshot, setDoc } from 'firebase/firestore';
import {
  EmailAuthProvider,
  confirmPasswordReset,
  linkWithCredential,
  sendPasswordResetEmail,
  signInWithEmailAndPassword,
  updateEmail,
  verifyPasswordResetCode,
} from 'firebase/auth';
import { auth, db, ensureSignedIn } from './firebase';

/**
 * Name-and-password accounts.
 *
 * There is no backend, so verification has to happen where the browser cannot
 * skip it: security rules compare a submitted hash against one stored in a
 * document no client may read.
 *
 *   users/{key}       public    { key, name, mustChangePassword, hasRecoveryEmail, email }
 *   secrets/{key}     no read   { passwordHash }
 *   sessions/{uid}    own only  { key, name, passwordHash }
 *   emails/{email}    see below { key }
 *
 * `users.email` is deliberately public, same as the rest of that document —
 * that is what lets "forgot password" work by name alone (look the address up
 * and mail it, rather than asking the person to type back the address they
 * are, definitionally, the one person who might not have handy). There is no
 * backend to hide it behind a "prove you're allowed to know this" check the
 * way `secrets` and `emails` get to; anyone who knows a name can look up the
 * email on file for it. Never render the value anywhere outside a screen the
 * account's own owner is looking at.
 *
 * `key` is the lowercased name and is the document id, so "Amy" and "amy" are
 * the same account. The original spelling is kept in `name` and is what other
 * people see. Rules can call `.lower()`, so they can check the two agree —
 * url-encoding, by contrast, is something rules cannot recompute, which is why
 * the id stays this close to the raw name.
 *
 * The session document is both the proof and the binding: it can only be
 * written with a hash that matches the secret, and every other rule asks
 * "which name does this uid belong to?" by reading it.
 *
 * Keeping the hash out of `users` matters — a readable hash is a hash an
 * attacker can simply replay.
 *
 * Forgetting a password is the one thing this whole scheme cannot recover
 * from on its own — there is no session to prove who you are. `emails/{email}`
 * is the door around that: it maps a recovery email to an account key, and is
 * only readable by whoever has just proven ownership of that exact email via
 * Firebase's own (built-in, no package or server of ours) password-reset
 * email. See firestore.rules for the mechanics.
 */

export const DEFAULT_PASSWORD = '0101';

const USERS = 'users';
const SECRETS = 'secrets';
const SESSIONS = 'sessions';
const EMAILS = 'emails';

const isValidEmail = (email: string): boolean => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim());

/** Firestore document id for a recovery email — lowercased, same reasoning as accountKey. */
const emailKey = (email: string): string => email.trim().toLowerCase();

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
  /** Display name, spelled the way it was first registered. */
  name: string;
  exists: boolean;
  mustChangePassword: boolean;
  /** Whether a recovery email is on file — the login screen requires one before letting a person in. */
  hasRecoveryEmail: boolean;
  /** The recovery email itself, when there is one. Public data — see the module doc comment — but still only for the owner's own eyes in the UI. */
  email?: string;
}

export class AuthError extends Error {}

/** Lowercased name — the account key, and what every document id uses. */
export const accountKey = (name: string): string => assertUsableName(name).toLowerCase();

/**
 * Hashes with SHA-256 and a fixed application salt plus the account key.
 *
 * The key rather than the display name, so typing "Amy" and "amy" produces the
 * same hash — otherwise case-insensitive login would still fail at the password
 * check.
 *
 * Not bcrypt — without a server there is nowhere to run a slow KDF — but it
 * keeps plain passwords out of the database and out of network payloads.
 */
export const hashPassword = async (name: string, password: string): Promise<string> => {
  const data = new TextEncoder().encode(`youaskianswer:${name.trim().toLowerCase()}:${password}`);
  const digest = await crypto.subtle.digest('SHA-256', data);
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
};

/** Only reveals whether the name is taken, never anything secret. */
export const lookupAccount = async (name: string): Promise<AccountRecord> => {
  const clean = assertUsableName(name);
  try {
    const snap = await getDoc(doc(db, USERS, accountKey(clean)));
    if (!snap.exists()) {
      return { name: clean, exists: false, mustChangePassword: true, hasRecoveryEmail: false };
    }
    return {
      // The stored spelling wins, so signing in as "amy" still shows "Amy"
      name: (snap.data().name as string) || clean,
      exists: true,
      mustChangePassword: snap.data().mustChangePassword !== false,
      hasRecoveryEmail: snap.data().hasRecoveryEmail === true,
      email: (snap.data().email as string) || undefined,
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

  const key = accountKey(clean);
  const user = await ensureSignedIn();
  const account = await lookupAccount(clean);
  // Whatever the person typed, the display name is the registered spelling
  const display = account.name;
  const hash = await hashPassword(key, password);

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
    await setDoc(doc(db, SECRETS, key), {
      passwordHash: hash,
      createdAt: new Date().toISOString(),
    }).catch((err) => console.warn('[accounts] secret creation rejected:', err));

    await setDoc(doc(db, USERS, key), {
      key,
      name: display,
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
      key,
      name: display,
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
    doc(db, USERS, key),
    { lastLoginAt: new Date().toISOString() },
    { merge: true }
  ).catch(() => {
    // A failed timestamp update must not block a successful login
  });

  return account.exists
    ? account
    : { name: display, exists: true, mustChangePassword: true, hasRecoveryEmail: false };
};

/** Replaces the password, then refreshes the session so it stays valid. */
export const changePassword = async (
  name: string,
  currentPassword: string,
  nextPassword: string
): Promise<void> => {
  const clean = assertUsableName(name);
  const key = accountKey(clean);
  if (nextPassword.length < 4) throw new AuthError('新密碼至少 4 個字元');
  if (nextPassword === DEFAULT_PASSWORD) throw new AuthError('請不要沿用預設密碼');
  if (nextPassword === currentPassword) throw new AuthError('新密碼不能和目前的一樣');

  const user = await ensureSignedIn();
  const nextHash = await hashPassword(key, nextPassword);

  try {
    // Rules require the caller's session to be bound to this name, which it
    // only can be if the current password was correct at sign-in.
    await setDoc(
      doc(db, SECRETS, key),
      { passwordHash: nextHash, updatedAt: new Date().toISOString() },
      { merge: true }
    );
  } catch (err) {
    console.warn('[accounts] change password rejected:', err);
    throw new AuthError('無法變更密碼，請重新登入後再試');
  }

  // The session carries the old hash; leaving it stale would fail later checks
  await setDoc(doc(db, SESSIONS, user.uid), {
    key,
    name: clean,
    passwordHash: nextHash,
    boundAt: new Date().toISOString(),
  });

  await setDoc(
    doc(db, USERS, key),
    { mustChangePassword: false },
    { merge: true }
  );
};

/**
 * A password for Firebase's own copy of the credential — never this
 * account's actual password. Firebase requires one to create an
 * email/password credential at all, but nothing ever signs in with it
 * directly; the only path that matters is completePasswordReset, which
 * overwrites it with whatever the person types during an actual reset. Using
 * a real password here would tie Firebase's stricter rules (6+ characters) to
 * this app's own (4+), which is exactly the mismatch that made a short
 * custom password fail here with auth/weak-password.
 */
const randomInternalPassword = (): string =>
  Array.from(crypto.getRandomValues(new Uint8Array(24)))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');

/**
 * Links a recovery email to the signed-in account, so a future "forgot
 * password" has something to reset. This is the only place `emails/{email}`
 * gets written — see the module doc comment for what that document is for.
 *
 * A browser's anonymous Firebase user can only ever be linked to email/password
 * once — one uid, one Firebase-side credential. Testing two different named
 * accounts from the same browser hits that the moment the second one tries to
 * set up its own email: Firebase already upgraded this uid the first time.
 * There is no real conflict (the two are still different app accounts, this
 * is purely a Firebase Auth limit on the one uid), so that case falls back to
 * overwriting the existing credential instead of failing outright.
 */
export const setRecoveryEmail = async (name: string, email: string): Promise<void> => {
  const clean = assertUsableName(name);
  const key = accountKey(clean);
  const trimmedEmail = email.trim();
  if (!isValidEmail(trimmedEmail)) throw new AuthError('請輸入有效的 Email');

  // Read before writing anything, so a switch away from an old email can
  // retire that old email's index entry once the new one is safely in place.
  const priorSnap = await getDoc(doc(db, USERS, key));
  const priorEmail = (priorSnap.data()?.email as string | undefined)?.trim();
  if (priorEmail && emailKey(priorEmail) === emailKey(trimmedEmail)) {
    return; // already set to this exact email — nothing to do
  }

  const user = await ensureSignedIn();

  try {
    await linkWithCredential(user, EmailAuthProvider.credential(trimmedEmail, randomInternalPassword()));
  } catch (err: any) {
    if (err?.code === 'auth/email-already-in-use' || err?.code === 'auth/credential-already-in-use') {
      console.warn('[accounts] linking email failed:', err);
      throw new AuthError('這個 Email 已經被使用，換一個試試');
    }
    if (err?.code === 'auth/provider-already-linked') {
      // This browser already has an email/password credential from another
      // named account tested here before — replace it with this one's.
      try {
        await updateEmail(user, trimmedEmail);
      } catch (updateErr: any) {
        console.warn('[accounts] updating existing linked email failed:', updateErr);
        if (updateErr?.code === 'auth/email-already-in-use') {
          throw new AuthError('這個 Email 已經被使用，換一個試試');
        }
        throw new AuthError('設定 Email 失敗，請稍後再試');
      }
    } else {
      console.warn('[accounts] linking email failed:', err);
      throw new AuthError('設定 Email 失敗，請稍後再試');
    }
  }

  try {
    // Create-only by rule — this is also what stops two accounts sharing one inbox.
    await setDoc(doc(db, EMAILS, emailKey(trimmedEmail)), {
      key,
      createdAt: new Date().toISOString(),
    });
  } catch (err) {
    console.warn('[accounts] failed to record email index:', err);
    throw new AuthError('這個 Email 可能已經被其他帳號使用');
  }

  // Only retired now that the new one is confirmed written — a failed create
  // above must not leave this account with no working email index at all.
  if (priorEmail) {
    await deleteDoc(doc(db, EMAILS, emailKey(priorEmail))).catch((err) =>
      console.warn('[accounts] failed to retire old email index:', err)
    );
  }

  await setDoc(doc(db, USERS, key), { hasRecoveryEmail: true, email: trimmedEmail }, { merge: true });
};

/**
 * Kicks off Firebase's own password-reset email — no mail-sending package or
 * server of ours involved, Firebase sends it. Deliberately quiet about
 * whether the email actually matched an account: telling a stranger "no
 * account uses that email" is exactly the kind of thing this screen must not
 * reveal.
 */
export const requestPasswordReset = async (email: string): Promise<void> => {
  const trimmed = email.trim();
  if (!isValidEmail(trimmed)) throw new AuthError('請輸入有效的 Email');

  try {
    await sendPasswordResetEmail(auth, trimmed, {
      url: window.location.origin + window.location.pathname,
      handleCodeInApp: true,
    });
  } catch (err: any) {
    if (err?.code === 'auth/user-not-found') return; // see doc comment above
    console.warn('[accounts] password reset request failed:', err);
    throw new AuthError('寄送失敗，請檢查網路後再試');
  }
};

/**
 * "Forgot password", by name rather than by typing back an email — looks up
 * whatever address this account has on file and mails the reset link there.
 * Unlike requestPasswordReset, this one *does* say plainly when there is
 * nothing to send to, since the name itself is already public knowledge in
 * this app (the ordinary login screen already reveals whether a name is
 * registered) — there is no equivalent secrecy left to protect here.
 */
export const requestPasswordResetForName = async (name: string): Promise<void> => {
  const clean = assertUsableName(name);
  const account = await lookupAccount(clean);
  if (!account.exists) throw new AuthError('查無這個姓名的帳號');
  if (!account.hasRecoveryEmail || !account.email) {
    throw new AuthError('這個帳號還沒設定救援 Email，請用密碼登入後到設定裡新增');
  }
  await requestPasswordReset(account.email);
};

/** Confirms a password-reset link is genuine and unexpired, and returns the email it was sent to. */
export const verifyResetCode = async (oobCode: string): Promise<string> => {
  try {
    return await verifyPasswordResetCode(auth, oobCode);
  } catch (err) {
    console.warn('[accounts] invalid or expired reset code:', err);
    throw new AuthError('這個連結已經失效或不存在，請重新申請一次');
  }
};

/**
 * Finishes a "forgot password" reset: sets the new password on both sides —
 * Firebase's own copy (via the emailed code, which is what proves this is
 * legitimate) and this app's own hash (via the emails/{email} index, which is
 * how a browser with nothing but a verified email gets to touch secrets/{key}
 * at all — see firestore.rules' canResetByEmail) — then signs this browser in
 * as that account, the same as an ordinary login would.
 */
export const completePasswordReset = async (
  oobCode: string,
  newPassword: string
): Promise<AccountRecord> => {
  if (newPassword.length < 4) throw new AuthError('新密碼至少 4 個字元');
  if (newPassword === DEFAULT_PASSWORD) throw new AuthError('請不要使用預設密碼');

  const email = await verifyResetCode(oobCode);

  try {
    await confirmPasswordReset(auth, oobCode, newPassword);
  } catch (err) {
    console.warn('[accounts] confirming reset failed:', err);
    throw new AuthError('重設密碼失敗，連結可能已經失效，請重新申請一次');
  }

  let uid: string;
  try {
    const credential = await signInWithEmailAndPassword(auth, email, newPassword);
    uid = credential.user.uid;
  } catch (err) {
    console.warn('[accounts] sign-in after reset failed:', err);
    throw new AuthError('密碼已經重設成功，但自動登入失敗，請回到登入畫面用新密碼登入');
  }

  const indexSnap = await getDoc(doc(db, EMAILS, emailKey(email)));
  if (!indexSnap.exists()) {
    throw new AuthError('找不到這個 Email 對應的帳號，請聯絡對方協助處理');
  }
  const key = indexSnap.data().key as string;

  const userSnap = await getDoc(doc(db, USERS, key));
  const display = (userSnap.data()?.name as string) || key;
  const hash = await hashPassword(key, newPassword);

  await setDoc(
    doc(db, SECRETS, key),
    { passwordHash: hash, updatedAt: new Date().toISOString() },
    { merge: true }
  );

  await setDoc(doc(db, SESSIONS, uid), {
    key,
    name: display,
    passwordHash: hash,
    boundAt: new Date().toISOString(),
  });

  await setDoc(
    doc(db, USERS, key),
    { lastLoginAt: new Date().toISOString() },
    { merge: true }
  ).catch(() => {
    // A failed timestamp update must not block a successful reset
  });

  return { name: display, exists: true, mustChangePassword: false, hasRecoveryEmail: true, email };
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
    return (
      snap.exists() &&
      String(snap.data().name || '').toLowerCase() === clean.toLowerCase()
    );
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
    doc(db, USERS, accountKey(name)),
    (snap) =>
      onUpdate({
        name,
        exists: snap.exists(),
        mustChangePassword: snap.data()?.mustChangePassword !== false,
        hasRecoveryEmail: snap.data()?.hasRecoveryEmail === true,
        email: (snap.data()?.email as string) || undefined,
      }),
    (err) => console.warn('[accounts] account snapshot error:', err)
  );
};
