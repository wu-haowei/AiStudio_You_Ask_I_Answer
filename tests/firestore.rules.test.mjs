/*
 * Security-rules tests.
 *
 * These rules are the only thing standing between one pair's conversation and
 * everybody else, so they are worth testing rather than eyeballing. Run:
 *
 *   npm run test:rules
 *
 * It needs Java 21+ (the Firestore emulator is a jar) and downloads that jar on
 * first run, so it has to be run somewhere with internet access.
 */
import assert from 'node:assert';
import {
  initializeTestEnvironment,
  assertFails,
  assertSucceeds,
} from '@firebase/rules-unit-testing';
import { readFileSync } from 'node:fs';
import {
  doc, getDoc, setDoc, deleteDoc, collection, getDocs, query, where, setLogLevel,
} from 'firebase/firestore';

// Denied writes are the point of most of these tests; the SDK logging each one
// as an error buries the actual results.
setLogLevel('silent');

const env = await initializeTestEnvironment({
  projectId: 'rules-test',
  firestore: { rules: readFileSync(new URL('../firestore.rules', import.meta.url), 'utf8'), host: '127.0.0.1', port: 8080 },
});

const HASH_A = 'hash-a', HASH_B = 'hash-b';
let passed = 0;
const failures = [];
const test = async (name, fn) => {
  try { await fn(); passed++; console.log('  ok  ', name); }
  catch (e) {
    failures.push({ name, reason: e.message.split('\n')[0].slice(0, 160) });
    console.log('  FAIL', name, '\n       ', e.message.slice(0, 200));
  }
};

// Seed accounts and sessions the way the app does
await env.withSecurityRulesDisabled(async (ctx) => {
  const db = ctx.firestore();
  // Amy registered with a capital A — the id is still lowercase
  await setDoc(doc(db, 'users/amy'), { name: 'Amy', mustChangePassword: false });
  await setDoc(doc(db, 'secrets/amy'), { passwordHash: HASH_A });
  await setDoc(doc(db, 'users/bob'), { name: 'bob', mustChangePassword: false });
  await setDoc(doc(db, 'secrets/bob'), { passwordHash: HASH_B });
  await setDoc(doc(db, 'users/eve'), { name: 'eve', mustChangePassword: false });
  await setDoc(doc(db, 'secrets/eve'), { passwordHash: 'hash-e' });
  await setDoc(doc(db, 'sessions/uid-amy'), { key: 'amy', name: 'Amy', passwordHash: HASH_A });
  await setDoc(doc(db, 'sessions/uid-bob'), { key: 'bob', name: 'bob', passwordHash: HASH_B });
  await setDoc(doc(db, 'sessions/uid-eve'), { key: 'eve', name: 'eve', passwordHash: 'hash-e' });
  await setDoc(doc(db, 'rooms/pair__amy__bob'), {
    code: 'pair__amy__bob',
    participants: ['Amy', 'bob'],
    participantKeys: ['amy', 'bob'],
  });
  // A room written before participantKeys existed, to prove the fallback works
  await setDoc(doc(db, 'rooms/pair__amy__old'), {
    code: 'pair__amy__old',
    participants: ['Amy', 'old'],
  });
  /*
   * Somebody else's conversation. Without one of these in the database an
   * unfiltered list of rooms would succeed simply because every room happened
   * to be readable — the rule would look stricter than it is.
   */
  await setDoc(doc(db, 'rooms/pair__bob__eve'), {
    code: 'pair__bob__eve',
    participants: ['bob', 'eve'],
    participantKeys: ['bob', 'eve'],
  });
  await setDoc(doc(db, 'rooms/pair__amy__bob/messages/m1'), { text: 'hi', author: 'amy' });
  await setDoc(doc(db, 'rooms/pair__amy__bob/faqs/f1'), { question: 'q' });
  await setDoc(doc(db, 'rooms/MAIN-ROOM'), { code: 'MAIN-ROOM' });
  await setDoc(doc(db, 'rooms/MAIN-ROOM/messages/old1'), { text: 'legacy' });
  // Amy has linked a recovery email; bob has not.
  await setDoc(doc(db, 'emails/amy@example.com'), { key: 'amy' });
});

const amy = env.authenticatedContext('uid-amy').firestore();
const eve = env.authenticatedContext('uid-eve').firestore();
const nobody = env.authenticatedContext('uid-new').firestore();

// A browser that has just completed Firebase's own password-reset email
// flow for amy@example.com — no session yet, just a verified email claim.
const verifiedAsAmy = env
  .authenticatedContext('uid-reset', { email: 'amy@example.com', email_verified: true })
  .firestore();
// Same idea, but the link was never clicked — email present, not verified.
const unverifiedAsAmy = env
  .authenticatedContext('uid-unverified', { email: 'amy@example.com', email_verified: false })
  .firestore();
// A verified email that was never linked to any account.
const verifiedStranger = env
  .authenticatedContext('uid-stranger', { email: 'nobody@example.com', email_verified: true })
  .firestore();

console.log('\nPasswords');
await test('correct password binds a session', () =>
  assertSucceeds(setDoc(doc(nobody, 'sessions/uid-new'), { key: 'amy', name: 'Amy', passwordHash: HASH_A })));
await test('wrong password is refused', () =>
  assertFails(setDoc(doc(nobody, 'sessions/uid-new'), { key: 'amy', name: 'Amy', passwordHash: 'guess' })));
await test('any capitalisation reaches the same account', () =>
  assertSucceeds(setDoc(doc(nobody, 'sessions/uid-new'), { key: 'amy', name: 'AMY', passwordHash: HASH_A })));
await test('a key that does not match its name is refused', () =>
  assertFails(setDoc(doc(nobody, 'sessions/uid-new'), { key: 'amy', name: 'eve', passwordHash: HASH_A })));
await test('password hashes are never readable', () =>
  assertFails(getDoc(doc(amy, 'secrets/amy'))));
await test('cannot bind a name to somebody else\'s secret', () =>
  assertFails(setDoc(doc(nobody, 'sessions/uid-new'), { key: 'amy', name: 'Amy', passwordHash: 'hash-e' })));
await test('owner may change their own password', () =>
  assertSucceeds(setDoc(doc(amy, 'secrets/amy'), { passwordHash: 'new' }, { merge: true })));
await test('nobody may change another password', () =>
  assertFails(setDoc(doc(eve, 'secrets/amy'), { passwordHash: 'stolen' }, { merge: true })));
await test('an existing secret cannot be re-created', () =>
  assertFails(setDoc(doc(eve, 'secrets/bob'), { passwordHash: 'stolen' })));
await test('a users doc must match its own id', () =>
  assertFails(setDoc(doc(eve, 'users/zoe'), { name: 'amy' })));
await test('a users doc id must be the lowercased name', () =>
  assertFails(setDoc(doc(eve, 'users/Zoe'), { name: 'Zoe' })));

console.log('\nForgot password (verified-email reset)');
await test('a verified, linked email may reset that account\'s password', () =>
  assertSucceeds(setDoc(doc(verifiedAsAmy, 'secrets/amy'), { passwordHash: 'reset-hash' }, { merge: true })));
await test('that same verified email may not touch a different account', () =>
  assertFails(setDoc(doc(verifiedAsAmy, 'secrets/bob'), { passwordHash: 'stolen' }, { merge: true })));
await test('an unverified email cannot reset anything, even if it matches', () =>
  assertFails(setDoc(doc(unverifiedAsAmy, 'secrets/amy'), { passwordHash: 'reset-hash' }, { merge: true })));
await test('a verified email nobody linked cannot reset anything', () =>
  assertFails(setDoc(doc(verifiedStranger, 'secrets/amy'), { passwordHash: 'reset-hash' }, { merge: true })));
await test('the email/account mapping is unreadable without a matching verified email', () =>
  assertFails(getDoc(doc(amy, 'emails/amy@example.com'))));
await test('the email/account mapping is unreadable by an unverified match', () =>
  assertFails(getDoc(doc(unverifiedAsAmy, 'emails/amy@example.com'))));
await test('a verified matching email may read its own mapping', () =>
  assertSucceeds(getDoc(doc(verifiedAsAmy, 'emails/amy@example.com'))));
await test('linking a new email requires a session', () =>
  assertFails(setDoc(doc(verifiedAsAmy, 'emails/new@example.com'), { key: 'amy' })));
await test('the account owner may link a new email for themselves', () =>
  assertSucceeds(setDoc(doc(amy, 'emails/amy-alt@example.com'), { key: 'amy' })));
await test('nobody may link an email to somebody else\'s account', () =>
  assertFails(setDoc(doc(eve, 'emails/eve-hijack@example.com'), { key: 'amy' })));
await test('an email already claimed by one account cannot be re-claimed by another', () =>
  assertFails(setDoc(doc(eve, 'emails/amy@example.com'), { key: 'eve' })));
await test('the account owner may unlink their own email', () =>
  assertSucceeds(deleteDoc(doc(amy, 'emails/amy-alt@example.com'))));
await test('nobody may unlink someone else\'s email', () =>
  assertFails(deleteDoc(doc(eve, 'emails/amy@example.com'))));

console.log('\nPrivate conversations');
await test('participant reads the room', () =>
  assertSucceeds(getDoc(doc(amy, 'rooms/pair__amy__bob'))));
await test('outsider cannot read the room', () =>
  assertFails(getDoc(doc(eve, 'rooms/pair__amy__bob'))));
await test('participant reads chat history', () =>
  assertSucceeds(getDocs(collection(amy, 'rooms/pair__amy__bob/messages'))));
await test('outsider cannot read chat history', () =>
  assertFails(getDocs(collection(eve, 'rooms/pair__amy__bob/messages'))));
await test('outsider cannot write a message', () =>
  assertFails(setDoc(doc(eve, 'rooms/pair__amy__bob/messages/x'), { text: 'hi' })));
await test('participant reads the pair question library', () =>
  assertSucceeds(getDocs(collection(amy, 'rooms/pair__amy__bob/faqs'))));
await test('outsider cannot read the pair question library', () =>
  assertFails(getDocs(collection(eve, 'rooms/pair__amy__bob/faqs'))));
await test('listing my own rooms works', () =>
  assertSucceeds(getDocs(query(collection(amy, 'rooms'), where('participants', 'array-contains', 'Amy')))));
await test('listing every room is refused', () =>
  assertFails(getDocs(collection(amy, 'rooms'))));
await test('participants cannot be rewritten', () =>
  assertFails(setDoc(doc(amy, 'rooms/pair__amy__bob'), { participants: ['Amy', 'eve'] }, { merge: true })));
await test('a new room must include me', () =>
  assertFails(setDoc(doc(amy, 'rooms/pair__bob__zoe'), {
    participants: ['bob', 'zoe'],
    participantKeys: ['bob', 'zoe'],
  })));
await test('someone else\'s room stays shut', () =>
  assertFails(getDoc(doc(amy, 'rooms/pair__bob__eve'))));
await test('a new room with me is allowed', () =>
  assertSucceeds(setDoc(doc(amy, 'rooms/pair__amy__eve'), {
    participants: ['Amy', 'eve'],
    participantKeys: ['amy', 'eve'],
  })));
await test('rooms written before participantKeys still open', () =>
  assertSucceeds(getDoc(doc(amy, 'rooms/pair__amy__old'))));
await test('outsiders are still kept out of those older rooms', () =>
  assertFails(getDoc(doc(eve, 'rooms/pair__amy__old'))));
await test('looking up a room that does not exist is not an error', () =>
  assertSucceeds(getDoc(doc(amy, 'rooms/pair__nobody__yet'))));

console.log('\nLegacy room (migration)');
await test('legacy history stays readable', () =>
  assertSucceeds(getDocs(collection(amy, 'rooms/MAIN-ROOM/messages'))));

console.log('\nPresence and invitations');
await test('presence must carry my own name', () =>
  assertFails(setDoc(doc(amy, 'presence/bob'), { name: 'bob', lastActive: 'now' })));
await test('publishing my own presence works', () =>
  assertSucceeds(setDoc(doc(amy, 'presence/amy'), { name: 'Amy', lastActive: 'now' })));
await test('cannot send an invite as someone else', () =>
  assertFails(setDoc(doc(eve, 'chatInvites/i1'), { from: 'Amy', to: 'bob', status: 'pending' })));
await test('sending my own invite works', () =>
  assertSucceeds(setDoc(doc(amy, 'chatInvites/i2'), { from: 'Amy', to: 'bob', status: 'pending' })));
await test('an unrelated person cannot read the invite', () =>
  assertFails(getDoc(doc(eve, 'chatInvites/i2'))));

console.log('\nPreferences');
await test('my own preferences are writable', () =>
  assertSucceeds(setDoc(doc(amy, 'userPrefs/amy'), { chatBackground: '' })));
await test('preferences are keyed by the lowercased name', () =>
  assertFails(setDoc(doc(amy, 'userPrefs/Amy'), { chatBackground: '' })));
await test('someone else\'s preferences are not', () =>
  assertFails(setDoc(doc(eve, 'userPrefs/amy'), { chatBackground: 'x' })));

console.log('\nSigned out');
const anon = env.unauthenticatedContext().firestore();
await test('a signed-out visitor sees nothing', () =>
  assertFails(getDoc(doc(anon, 'rooms/pair__amy__bob'))));

await env.cleanup();

// Repeat the failures at the end — the emulator's own output scrolls the
// individual lines away, and the summary alone does not say which one broke.
if (failures.length > 0) {
  console.log('\nFailures:');
  for (const f of failures) console.log(`  · ${f.name}\n      ${f.reason}`);
}
console.log(`\n${passed} passed, ${failures.length} failed`);
process.exit(failures.length ? 1 : 0);
