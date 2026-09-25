import { deleteDoc, deleteField, doc, getDoc, onSnapshot, setDoc, writeBatch } from 'firebase/firestore';
import {
  isSignInWithEmailLink,
  sendSignInLinkToEmail,
  signInWithEmailLink,
  updatePassword,
} from 'firebase/auth';
import { auth, db, ensureSignedIn } from './firebase';
import { t } from '../i18n';

/**
 * Name-and-password accounts.
 *
 * There is no backend, so verification has to happen where the browser cannot
 * skip it: security rules compare a submitted hash against one stored in a
 * document no client may read.
 *
 *   users/{key}       public    { key, name, mustChangePassword, hasRecoveryEmail, salt, hashVersion }
 *   accountPrivate/{key}  owner only  { email }
 *   secrets/{key}     no read   { passwordHash }
 *   sessions/{uid}    own only  { key, name, passwordHash }
 *   emails/{email}    see below { key }
 *
 * `users` is public by document — the login screen has to tell a new name from a
 * taken one, and fetch the salt, before anybody has signed in — so it holds nothing
 * private: not the recovery email (that is in `accountPrivate`, readable only by its
 * owner) and nothing that can be replayed. Rules allow looking one name up but refuse
 * listing the collection, so the accounts that exist cannot be harvested in bulk.
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
 * a verified Firebase sign-in. See firestore.rules for the mechanics.
 *
 * That verified sign-in is a passwordless "email link" one
 * (sendSignInLinkToEmail / signInWithEmailLink), not the more obvious
 * sendPasswordResetEmail / confirmPasswordReset pair. Firebase's own reset
 * flow only completes on Firebase's own hosted page unless the project's
 * email templates have "customize action URL" turned on — a project setting
 * this app cannot reach or rely on. An email-link sign-in has no such
 * hosted page to begin with; the link always opens this app directly, which
 * is what lets the new password be typed here rather than on a Firebase
 * screen this app never sees the result of.
 */

/**
 * The shared starting password older versions gave every new account. Nothing hands it
 * out any more; it is kept only so it can be refused as a password someone chooses.
 */
const LEGACY_DEFAULT_PASSWORD = '0101';

const USERS = 'users';
const SECRETS = 'secrets';
const SESSIONS = 'sessions';
const EMAILS = 'emails';
const PRIVATE = 'accountPrivate';

const isValidEmail = (email: string): boolean => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim());

/** Firestore document id for a recovery email — lowercased, same reasoning as accountKey. */
const emailKey = (email: string): string => email.trim().toLowerCase();

/**
 * Firebase's free daily allowance for its own email sending (password reset,
 * email link sign-in, etc.) is shared across every account on this project —
 * heavy testing in one day can exhaust it for everyone. `auth/quota-exceeded`
 * is the one failure worth calling out by name rather than folding into a
 * generic "try again later", since "later" here specifically means tomorrow,
 * not a few minutes.
 */
const friendlyEmailSendError = (err: unknown, fallbackMessage: string): AuthError => {
  if ((err as { code?: string })?.code === 'auth/quota-exceeded') {
    return new AuthError(t('auth.quotaExceeded'));
  }
  return new AuthError(fallbackMessage);
};

/**
 * Names double as document ids, so the few characters Firestore forbids there
 * are rejected up front rather than failing mysteriously on write.
 */
export const assertUsableName = (name: string): string => {
  const clean = name.trim();
  if (!clean) throw new AuthError(t('auth.nameRequired'));
  if (clean.includes('/')) throw new AuthError(t('auth.nameNoSlash'));
  if (clean === '.' || clean === '..') throw new AuthError(t('auth.nameUnusable'));
  if (/^__.*__$/.test(clean)) throw new AuthError(t('auth.nameUnusable'));
  if (new TextEncoder().encode(clean).length > 200) throw new AuthError(t('auth.nameTooLong'));
  return clean;
};

export interface AccountRecord {
  /** Display name, spelled the way it was first registered. */
  name: string;
  exists: boolean;
  mustChangePassword: boolean;
  /** Whether a recovery email is on file — a yes/no; the address itself is in accountPrivate. */
  hasRecoveryEmail: boolean;
  /** Per-account password salt. Absent on accounts that have not moved to the salted scheme yet. */
  salt?: string;
}

export class AuthError extends Error {}

/** Lowercased name — the account key, and what every document id uses. */
export const accountKey = (name: string): string => assertUsableName(name).toLowerCase();

/**
 * How a password becomes the value stored in `secrets`.
 *
 * Version 2 — every account created, or whose password is changed, from now on:
 * PBKDF2-SHA-256 with 210,000 rounds and a random per-account salt. The salt lives
 * on the public users document. It is not a secret; its job is to make every
 * account's hash different so one precomputed table cannot cover them all. The
 * rounds are what make each guess expensive for someone who does get hold of a hash.
 *
 * Version 1 — accounts from before this: one SHA-256 over a fixed application salt
 * and the account key. Still understood so those accounts can sign in once; a
 * successful sign-in rewrites them as version 2 (see writePassword).
 *
 * Neither is a substitute for a server that can count guesses and lock an account
 * out. Firestore rules compare hashes but cannot rate-limit, so an online guess is
 * still cheap to make — which is why passwords are required to be reasonably long,
 * and why the shared default password is gone.
 */
const PBKDF2_ROUNDS = 210_000;
const HASH_VERSION = 2;

/** Shortest password accepted when one is chosen or changed. */
export const MIN_PASSWORD_LENGTH = 8;

const toHex = (bytes: ArrayBuffer | Uint8Array): string =>
  Array.from(new Uint8Array(bytes as ArrayBuffer))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');

const newSalt = (): string => toHex(crypto.getRandomValues(new Uint8Array(16)));

/** The version-1 hash, for accounts that have not been upgraded yet. */
const legacyHash = async (name: string, password: string): Promise<string> => {
  const data = new TextEncoder().encode(`youaskianswer:${name.trim().toLowerCase()}:${password}`);
  return toHex(await crypto.subtle.digest('SHA-256', data));
};

/** The version-2 hash. The key rather than the display name, so "Amy" and "amy" agree. */
const saltedHash = async (key: string, password: string, salt: string): Promise<string> => {
  const encoder = new TextEncoder();
  const material = await crypto.subtle.importKey('raw', encoder.encode(password), 'PBKDF2', false, [
    'deriveBits',
  ]);
  const bits = await crypto.subtle.deriveBits(
    {
      name: 'PBKDF2',
      hash: 'SHA-256',
      salt: encoder.encode(`youaskianswer:${key}:${salt}`),
      iterations: PBKDF2_ROUNDS,
    },
    material,
    256
  );
  return `v2:${toHex(bits)}`;
};

/** The hash for `password` the way this account stores it: salted when it has a salt, the old way when it does not. */
const hashFor = (key: string, password: string, salt?: string): Promise<string> =>
  salt ? saltedHash(key, password, salt) : legacyHash(key, password);

/** A password somebody is choosing (registering, changing, resetting) — not one they are merely typing to sign in. */
const assertAcceptablePassword = (password: string) => {
  if (password.length < MIN_PASSWORD_LENGTH) throw new AuthError(t('auth.newPasswordTooShort'));
  if (password === LEGACY_DEFAULT_PASSWORD) throw new AuthError(t('auth.noDefaultPassword'));
};

/**
 * Replaces an account's password and its salt in one atomic batch.
 *
 * The secret and the salt have to change together: someone signing in reads the salt
 * from the users document and derives a hash from it, so if only one of the two
 * landed the account would reject its own correct password. A batch commits both or
 * neither. Returns the new hash, for re-binding the session.
 */
const writePassword = async (
  key: string,
  password: string,
  extraUserFields: Record<string, unknown> = {}
): Promise<string> => {
  const salt = newSalt();
  const hash = await saltedHash(key, password, salt);
  const now = new Date().toISOString();

  const batch = writeBatch(db);
  batch.set(doc(db, SECRETS, key), { passwordHash: hash, updatedAt: now }, { merge: true });
  batch.set(doc(db, USERS, key), { salt, hashVersion: HASH_VERSION, ...extraUserFields }, { merge: true });
  await batch.commit();
  return hash;
};

/** Writes the session document — which is also the password check, since rules refuse a wrong hash. */
const bindSession = (uid: string, key: string, name: string, passwordHash: string) =>
  setDoc(doc(db, SESSIONS, uid), {
    key,
    name,
    passwordHash,
    boundAt: new Date().toISOString(),
  });

/** Only reveals whether the name is taken (and the public salt), never anything secret. */
export const lookupAccount = async (name: string): Promise<AccountRecord> => {
  const clean = assertUsableName(name);
  try {
    const snap = await getDoc(doc(db, USERS, accountKey(clean)));
    if (!snap.exists()) {
      return { name: clean, exists: false, mustChangePassword: false, hasRecoveryEmail: false };
    }
    const data = snap.data();
    return {
      // The stored spelling wins, so signing in as "amy" still shows "Amy"
      name: (data.name as string) || clean,
      exists: true,
      mustChangePassword: data.mustChangePassword !== false,
      hasRecoveryEmail: data.hasRecoveryEmail === true,
      salt: typeof data.salt === 'string' && data.salt ? data.salt : undefined,
    };
  } catch (err) {
    console.warn('[accounts] lookup failed:', err);
    throw new AuthError(t('auth.offline'));
  }
};

/**
 * Creates a new account with a password the person chose themselves.
 *
 * There is no shared starting password any more: one that everybody knows lets anyone
 * claim a name before its owner arrives, and be signed in as them. The secret is
 * written first because rules only let a secret be created, never overwritten, so it is
 * what actually decides who got the name if two people try at once.
 */
export const registerAccount = async (name: string, password: string): Promise<AccountRecord> => {
  const clean = assertUsableName(name);
  assertAcceptablePassword(password);

  const key = accountKey(clean);
  const user = await ensureSignedIn();
  if ((await lookupAccount(clean)).exists) throw new AuthError(t('auth.nameTaken'));

  const salt = newSalt();
  const hash = await saltedHash(key, password, salt);
  const now = new Date().toISOString();

  try {
    await setDoc(doc(db, SECRETS, key), { passwordHash: hash, createdAt: now });
  } catch (err) {
    console.warn('[accounts] secret creation rejected:', err);
    throw new AuthError(t('auth.cannotCreate'));
  }

  try {
    await setDoc(doc(db, USERS, key), {
      key,
      name: clean,
      exists: true,
      mustChangePassword: false,
      salt,
      hashVersion: HASH_VERSION,
      createdAt: now,
    });
  } catch (err) {
    console.warn('[accounts] user creation rejected:', err);
    throw new AuthError(t('auth.cannotCreate'));
  }

  try {
    await bindSession(user.uid, key, clean, hash);
  } catch (err) {
    console.warn('[accounts] new account session rejected:', err);
    throw new AuthError(t('auth.cannotCreate'));
  }

  return { name: clean, exists: true, mustChangePassword: false, hasRecoveryEmail: false, salt };
};

/**
 * Signs in to an existing account.
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
  if (!password) throw new AuthError(t('auth.passwordRequired'));

  const key = accountKey(clean);
  const user = await ensureSignedIn();
  let account = await lookupAccount(clean);
  if (!account.exists) throw new AuthError(t('auth.noSuchAccount'));
  // Whatever the person typed, the display name is the registered spelling
  const display = account.name;

  /*
   * The real check. Rules permit this write only when the hash matches the stored
   * secret, so a wrong password is refused by Firestore rather than by code that
   * devtools could step over.
   */
  const attempt = async (record: AccountRecord): Promise<string> => {
    const hash = await hashFor(key, password, record.salt);
    await bindSession(user.uid, key, display, hash);
    return hash;
  };

  let hash: string;
  try {
    hash = await attempt(account);
  } catch (err) {
    /*
     * One retry: if the password was upgraded to the salted scheme on another device
     * between the lookup and this attempt, the salt just read is stale.
     */
    const fresh = await lookupAccount(clean).catch(() => account);
    if (fresh.salt === account.salt) {
      console.warn('[accounts] password rejected:', err);
      throw new AuthError(t('auth.wrongPassword'));
    }
    try {
      hash = await attempt(fresh);
      account = fresh;
    } catch (retryErr) {
      console.warn('[accounts] password rejected:', retryErr);
      throw new AuthError(t('auth.wrongPassword'));
    }
  }

  /*
   * An account still on the old scheme is moved to the salted one now that the
   * password has just been proven. Accounts that must change their password anyway are
   * left alone — changePassword does the same upgrade a moment later.
   */
  if (!account.salt && !account.mustChangePassword) {
    try {
      const upgraded = await writePassword(key, password);
      await bindSession(user.uid, key, display, upgraded);
    } catch (err) {
      // Atomic, so a failure leaves the account exactly as it was; it upgrades next time
      console.warn('[accounts] upgrading to a salted hash failed:', err);
    }
  }

  await setDoc(
    doc(db, USERS, key),
    { lastLoginAt: new Date().toISOString() },
    { merge: true }
  ).catch(() => {
    // A failed timestamp update must not block a successful login
  });

  return account;
};

/** Replaces the password, then refreshes the session so it stays valid. */
export const changePassword = async (
  name: string,
  currentPassword: string,
  nextPassword: string
): Promise<void> => {
  const clean = assertUsableName(name);
  const key = accountKey(clean);
  assertAcceptablePassword(nextPassword);
  if (nextPassword === currentPassword) throw new AuthError(t('auth.newPasswordSame'));

  const user = await ensureSignedIn();

  let nextHash: string;
  try {
    // Rules require the caller's session to be bound to this name, which it
    // only can be if the current password was correct at sign-in.
    nextHash = await writePassword(key, nextPassword, { mustChangePassword: false });
  } catch (err) {
    console.warn('[accounts] change password rejected:', err);
    throw new AuthError(t('auth.changeFailed'));
  }

  // The session carries the old hash; leaving it stale would fail later checks
  await bindSession(user.uid, key, clean, nextHash);
};

/**
 * The recovery email on file for this account, for its owner's eyes only.
 *
 * It lives in `accountPrivate/{key}`, which rules let only the signed-in owner read.
 * Older accounts still carry it on the public `users` document, so that is the
 * fallback until syncVerifiedEmail has moved it across.
 */
export const getRecoveryEmail = async (name: string): Promise<string | undefined> => {
  const key = accountKey(name);
  try {
    const snap = await getDoc(doc(db, PRIVATE, key));
    const email = (snap.data()?.email as string | undefined)?.trim();
    if (email) return email;
  } catch (err) {
    console.warn('[accounts] private email read failed:', err);
  }
  try {
    const snap = await getDoc(doc(db, USERS, key));
    return (snap.data()?.email as string | undefined)?.trim() || undefined;
  } catch {
    return undefined;
  }
};

/**
 * Moves an address that older versions left on the public `users` document into
 * `accountPrivate`, and removes it from the public one. Runs on sign-in, as the owner
 * — the only person rules let write either document — so every account cleans itself
 * up the next time it is used, without anyone having to run a migration.
 */
const moveLegacyEmailToPrivate = async (key: string): Promise<void> => {
  const snap = await getDoc(doc(db, USERS, key));
  const legacy = (snap.data()?.email as string | undefined)?.trim();
  if (!legacy) return;

  await setDoc(doc(db, PRIVATE, key), { email: legacy, updatedAt: new Date().toISOString() }, { merge: true });
  await setDoc(doc(db, USERS, key), { email: deleteField() }, { merge: true });
};

/**
 * Best-effort duplicate check, run before touching Firebase Auth at all so a
 * taken address is rejected immediately instead of after one or two email
 * round-trips. The actual uniqueness guarantee is `emails/{emailKey}` (create-only,
 * keyed by the lowercased address), enforced later once ownership is proven; this
 * is purely for a faster, friendlier error.
 *
 * It reads that one document. Rules answer a lookup of an address nobody holds, or
 * one this account holds, normally — and refuse a lookup of one somebody else holds,
 * which is how "taken" is learned without ever seeing whose it is.
 */
const isEmailTaken = async (email: string, ownKey: string): Promise<boolean> => {
  try {
    const snap = await getDoc(doc(db, EMAILS, emailKey(email)));
    return snap.exists() && snap.data()?.key !== ownKey;
  } catch (err) {
    if ((err as { code?: string })?.code === 'permission-denied') return true;
    console.warn('[accounts] duplicate-email check failed:', err);
    return false; // best-effort only — a failed check must not block a legitimate change
  }
};

/**
 * Starts setting or changing this account's recovery email. Nothing is
 * written to Firestore here in either case — ownership of the address has to
 * be proven by clicking an emailed link first (completeNewEmailConfirmation
 * or completeEmailChangeReauth do the actual writing), otherwise anyone who
 * can type into this form could redirect a stranger's password resets to an
 * address of their own with no proof of anything.
 *
 * Two different links, depending on whether this account already has an
 * email on file:
 *
 *   - First time (no priorEmail): a confirmation link goes straight to the
 *     *new* address. Clicking it (completeNewEmailConfirmation) is a plain
 *     email-link sign-in, same mechanism as the reauth link below — not
 *     EmailAuthProvider.credentialWithLink + linkWithCredential onto this
 *     browser's existing anonymous uid, which looks like the "proper" way to
 *     upgrade an anonymous user but does not actually behave that way in
 *     practice (confirmed against the Auth emulator: it silently signs into
 *     a separate, brand-new identity for that email instead of attaching to
 *     the current one, then fails with auth/invalid-action-code on the
 *     following step that assumes the link succeeded). Firestore is not
 *     touched here either, for the same reason as the reauth path: this may
 *     not even be the same device. syncVerifiedEmail is what actually moves
 *     the address into this account's record, on a later, ordinary sign-in.
 *
 *   - Changing an existing one: the link goes to the *old* address first
 *     instead — requiring the current owner to approve before a new address
 *     can even be proposed, which is what stops someone with temporary
 *     access to an already-signed-in browser from quietly redirecting
 *     password resets to themselves. Clicking it (completeEmailChangeReauth)
 *     signs back into whatever uid the old address's credential belongs to,
 *     then sends the *new* address its own confirmation link using the exact
 *     same mechanism as the first-time case above — not
 *     verifyBeforeUpdateEmail, Firebase's own built-in "change this email"
 *     call, which routes its follow-up link through Firebase's own hosted
 *     page rather than back into this app, leaving no way to tell whether
 *     the click actually did what it appeared to. There is no stored
 *     password to reauthenticate with any other way either (this app never
 *     keeps one for Firebase's own copy of the credential) — that first
 *     email-link sign-in step is also what Firebase now requires before
 *     touching an already-linked credential at all, since a long-lived
 *     anonymous session is essentially never "recently" authenticated
 *     (auth/requires-recent-login). Neither half of this path touches
 *     Firestore directly either: the new address only becomes this account's
 *     email once syncVerifiedEmail notices Firebase's own copy changed,
 *     which happens on a later, ordinary sign-in.
 */
export const setRecoveryEmail = async (
  name: string,
  email: string
): Promise<'linked' | 'verification-sent' | 'reauth-required'> => {
  const clean = assertUsableName(name);
  const key = accountKey(clean);
  const trimmedEmail = email.trim();
  if (!isValidEmail(trimmedEmail)) throw new AuthError(t('auth.emailInvalid'));

  const priorEmail = await getRecoveryEmail(clean);
  if (priorEmail && emailKey(priorEmail) === emailKey(trimmedEmail)) {
    return 'linked'; // already set to this exact email — nothing to do
  }

  if (await isEmailTaken(trimmedEmail, key)) throw new AuthError(t('auth.emailTaken'));

  if (priorEmail) {
    try {
      const continueUrl =
        `${window.location.origin}${window.location.pathname}` +
        `?purpose=reauthEmail&email=${encodeURIComponent(priorEmail)}&pendingEmail=${encodeURIComponent(trimmedEmail)}`;
      await sendSignInLinkToEmail(auth, priorEmail, { url: continueUrl, handleCodeInApp: true });
    } catch (err) {
      console.warn('[accounts] sending reauth link failed:', err);
      throw friendlyEmailSendError(err, t('auth.confirmSendFailed'));
    }
    return 'reauth-required';
  }

  try {
    const continueUrl =
      `${window.location.origin}${window.location.pathname}` +
      `?purpose=confirmNewEmail&pendingEmail=${encodeURIComponent(trimmedEmail)}`;
    await sendSignInLinkToEmail(auth, trimmedEmail, { url: continueUrl, handleCodeInApp: true });
  } catch (err) {
    console.warn('[accounts] sending new-email confirmation failed:', err);
    throw friendlyEmailSendError(err, t('auth.confirmSendFailed'));
  }
  return 'verification-sent';
};

/**
 * Whether the current URL is one of this app's own email-link sign-ins with
 * no special `purpose` attached — a plain "forgot password" link. The other
 * two purposes (email-change confirmation and reauth) are told apart by that
 * query param this app itself adds to the link's continue URL, so anything
 * carrying one is excluded here rather than named one by one — a link type
 * added later only needs its own isXLink check, not an update to this one.
 */
export const isPasswordResetLink = (url: string): boolean => {
  try {
    if (!isSignInWithEmailLink(auth, url)) return false;
    return !new URL(url).searchParams.get('purpose');
  } catch {
    return false;
  }
};

/** Whether the current URL is the link setRecoveryEmail sends to a brand-new address, before it has ever been set for this account. */
export const isNewEmailConfirmationLink = (url: string): boolean => {
  try {
    if (!isSignInWithEmailLink(auth, url)) return false;
    return new URL(url).searchParams.get('purpose') === 'confirmNewEmail';
  } catch {
    return false;
  }
};

/**
 * Finishes first-time recovery-email setup: proves ownership of the new
 * address via a plain email-link sign-in (see setRecoveryEmail's doc comment
 * for why not EmailAuthProvider.credentialWithLink, which looks like the
 * right tool but doesn't hold up in practice). Does not touch Firestore —
 * same reasoning as completeEmailChangeReauth: this sign-in's uid has no
 * relation to this browser's session, on this device or any other.
 * syncVerifiedEmail is what actually records the address, next time this
 * account signs in for real.
 */
export const completeNewEmailConfirmation = async (link: string): Promise<string> => {
  if (!isNewEmailConfirmationLink(link)) throw new AuthError(t('auth.linkInvalid'));

  const pendingEmail = new URL(link).searchParams.get('pendingEmail') || '';
  if (!pendingEmail) throw new AuthError(t('auth.linkInvalid'));

  try {
    await signInWithEmailLink(auth, pendingEmail, link);
  } catch (err) {
    console.warn('[accounts] confirming new email failed:', err);
    throw new AuthError(t('auth.linkInvalid'));
  }

  return pendingEmail;
};

/**
 * Picks up an email change once Firebase actually confirms it.
 *
 * Neither completeNewEmailConfirmation nor completeEmailChangeReauth updates
 * anything until the person clicks the link they send — Firebase's own copy
 * of `user.email` only changes at that point, and only becomes visible here
 * after a `reload()`. There is no backend to be notified the moment that
 * happens, so this runs opportunistically on sign-in instead: most of the
 * time it finds nothing new and is a single cheap read, but the one time it
 * matters (the next time this browser opens the app after the link was
 * clicked, on this device or another) it is what actually moves the address
 * into this account's Firestore record and the `emails/` index.
 */
export const syncVerifiedEmail = async (name: string): Promise<void> => {
  const clean = assertUsableName(name);
  const key = accountKey(clean);
  const user = await ensureSignedIn();

  // Older accounts keep the address on the public record; take it off there (best-effort)
  await moveLegacyEmailToPrivate(key).catch((err) =>
    console.warn('[accounts] moving the email off the public record failed:', err)
  );

  try {
    await user.reload();
  } catch {
    return; // offline or similar — nothing lost, this just runs again next sign-in
  }

  const liveEmail = user.email?.trim();
  if (!liveEmail || !user.emailVerified) return;

  const storedEmail = await getRecoveryEmail(clean);
  if (storedEmail && emailKey(storedEmail) === emailKey(liveEmail)) return; // already in sync

  try {
    await setDoc(doc(db, EMAILS, emailKey(liveEmail)), { key, createdAt: new Date().toISOString() });
  } catch (err) {
    console.warn('[accounts] failed to record confirmed email index:', err);
    return; // likely claimed by another account already — leave it for a human to sort out
  }

  if (storedEmail) {
    await deleteDoc(doc(db, EMAILS, emailKey(storedEmail))).catch((err) =>
      console.warn('[accounts] failed to retire old email index:', err)
    );
  }

  // The address goes to the private record; the public one only learns that there is one
  await setDoc(doc(db, PRIVATE, key), { email: liveEmail, updatedAt: new Date().toISOString() }, { merge: true });
  await setDoc(doc(db, USERS, key), { hasRecoveryEmail: true, email: deleteField() }, { merge: true });
};

/** Where completePasswordReset looks first for the email a reset link belongs to. */
const RESET_EMAIL_STORAGE_KEY = 'youaskianswer_reset_email';

/**
 * Kicks off Firebase's own email delivery — no mail-sending package or server
 * of ours involved, Firebase sends it. See the module doc comment for why
 * this is a passwordless "email link" rather than an actual password-reset
 * email under the hood.
 *
 * The email is carried three ways in case any one of them is unavailable by
 * the time the link is opened: in localStorage (works when it's opened in
 * the same browser, which is the common case), and in the link's own query
 * string (works from a different device or a cleared localStorage too).
 */
export const requestPasswordReset = async (email: string): Promise<void> => {
  const trimmed = email.trim();
  if (!isValidEmail(trimmed)) throw new AuthError(t('auth.emailInvalid'));

  try {
    const continueUrl = `${window.location.origin}${window.location.pathname}?email=${encodeURIComponent(trimmed)}`;
    await sendSignInLinkToEmail(auth, trimmed, { url: continueUrl, handleCodeInApp: true });
    try {
      window.localStorage.setItem(RESET_EMAIL_STORAGE_KEY, trimmed);
    } catch {
      // Not fatal — the email is also in the link's own query string.
    }
  } catch (err) {
    console.warn('[accounts] password reset request failed:', err);
    throw friendlyEmailSendError(err, t('auth.resetSendFailed'));
  }
};

/** Whether the current URL is the "old address, please approve" link setRecoveryEmail sends when changing an already-set email. */
export const isEmailChangeReauthLink = (url: string): boolean => {
  try {
    if (!isSignInWithEmailLink(auth, url)) return false;
    return new URL(url).searchParams.get('purpose') === 'reauthEmail';
  } catch {
    return false;
  }
};

/**
 * Finishes the reauth detour from setRecoveryEmail: signs back in via the
 * link (satisfying Firebase's "recent login" requirement — see the doc
 * comment above for why that is needed at all), then sends the *new*
 * address its own confirmation link using exactly the same mechanism as a
 * first-time setup (see completeNewEmailConfirmation) — not
 * verifyBeforeUpdateEmail, which routes through Firebase's own hosted page
 * for its follow-up link, completely outside this app's view. That link
 * being opaque was never just a cosmetic annoyance: it meant this app had no
 * way to tell whether the click actually landed the way it appeared to.
 * Reusing the email-link mechanism keeps every step of this flow inside
 * pages this app controls. Neither half touches this app's own Firestore
 * data — syncVerifiedEmail is what moves the address over, the next time
 * this account signs in for real.
 */
export const completeEmailChangeReauth = async (link: string): Promise<string> => {
  if (!isEmailChangeReauthLink(link)) throw new AuthError(t('auth.linkInvalid'));

  const params = new URL(link).searchParams;
  const email = params.get('email') || '';
  const pendingEmail = params.get('pendingEmail') || '';
  if (!email || !pendingEmail) throw new AuthError(t('auth.linkInvalid'));

  try {
    await signInWithEmailLink(auth, email, link);
  } catch (err) {
    console.warn('[accounts] reauth email-link sign-in failed:', err);
    throw new AuthError(t('auth.linkInvalid'));
  }

  try {
    const continueUrl =
      `${window.location.origin}${window.location.pathname}` +
      `?purpose=confirmNewEmail&pendingEmail=${encodeURIComponent(pendingEmail)}`;
    await sendSignInLinkToEmail(auth, pendingEmail, { url: continueUrl, handleCodeInApp: true });
  } catch (err) {
    console.warn('[accounts] sending change-email confirmation after reauth failed:', err);
    throw friendlyEmailSendError(err, t('auth.reauthSentButFailed'));
  }

  return pendingEmail;
};

/**
 * Finishes a "forgot password" reset: proves ownership of the email by
 * completing Firebase's email-link sign-in (which lands directly in this
 * app — see the module doc comment for why that beats an actual password
 * reset email here), then sets the new password on both sides — Firebase's
 * own copy, best-effort, and this app's own hash via the emails/{email}
 * index, which is how a browser with nothing but a verified email gets to
 * touch secrets/{key} at all (see firestore.rules' canResetByEmail) — and
 * finally binds this browser's session to that account, the same as an
 * ordinary login would.
 */
export const completePasswordReset = async (
  link: string,
  newPassword: string
): Promise<AccountRecord> => {
  assertAcceptablePassword(newPassword);
  if (!isPasswordResetLink(link)) throw new AuthError(t('auth.linkInvalid'));

  let email = '';
  try {
    email = window.localStorage.getItem(RESET_EMAIL_STORAGE_KEY) || '';
  } catch {
    // Fall through to the link's own query string below.
  }
  if (!email) {
    try {
      email = new URL(link).searchParams.get('email') || '';
    } catch {
      // Malformed link — email stays empty, handled below.
    }
  }
  if (!email) {
    throw new AuthError(t('auth.linkWrongDevice'));
  }

  let uid: string;
  let signedInUser: Awaited<ReturnType<typeof signInWithEmailLink>>['user'];
  try {
    const credential = await signInWithEmailLink(auth, email, link);
    uid = credential.user.uid;
    signedInUser = credential.user;
  } catch (err) {
    console.warn('[accounts] email-link sign-in failed:', err);
    throw new AuthError(t('auth.linkInvalid'));
  }
  try {
    window.localStorage.removeItem(RESET_EMAIL_STORAGE_KEY);
  } catch {
    // Cosmetic only.
  }

  const indexSnap = await getDoc(doc(db, EMAILS, emailKey(email)));
  if (!indexSnap.exists()) {
    throw new AuthError(t('auth.emailAccountMissing'));
  }
  const key = indexSnap.data().key as string;

  const userSnap = await getDoc(doc(db, USERS, key));
  const display = (userSnap.data()?.name as string) || key;

  // Firebase's own copy is kept in step for tidiness — nothing here depends
  // on it succeeding, since app login never checks it.
  await updatePassword(signedInUser, newPassword).catch((err) =>
    console.warn('[accounts] updating Firebase-side password failed:', err)
  );

  // Secret and salt together, or neither — see writePassword. A reset gives the account a fresh salt.
  const hash = await writePassword(key, newPassword, { mustChangePassword: false });

  await bindSession(uid, key, display, hash);

  await setDoc(
    doc(db, USERS, key),
    { lastLoginAt: new Date().toISOString() },
    { merge: true }
  ).catch(() => {
    // A failed timestamp update must not block a successful reset
  });

  return { name: display, exists: true, mustChangePassword: false, hasRecoveryEmail: true };
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
      }),
    (err) => console.warn('[accounts] account snapshot error:', err)
  );
};
