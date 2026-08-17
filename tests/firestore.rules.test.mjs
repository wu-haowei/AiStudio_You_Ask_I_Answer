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
  doc, getDoc, setDoc, deleteDoc, collection, getDocs, query, where,
} from 'firebase/firestore';

const env = await initializeTestEnvironment({
  projectId: 'rules-test',
  firestore: { rules: readFileSync(new URL('../firestore.rules', import.meta.url), 'utf8'), host: '127.0.0.1', port: 8080 },
});

const HASH_A = 'hash-a', HASH_B = 'hash-b';
let passed = 0, failed = 0;
const test = async (name, fn) => {
  try { await fn(); passed++; console.log('  ok  ', name); }
  catch (e) { failed++; console.log('  FAIL', name, '\n       ', e.message.slice(0, 200)); }
};

// Seed accounts and sessions the way the app does
await env.withSecurityRulesDisabled(async (ctx) => {
  const db = ctx.firestore();
  await setDoc(doc(db, 'users/amy'), { name: 'amy', mustChangePassword: false });
  await setDoc(doc(db, 'secrets/amy'), { passwordHash: HASH_A });
  await setDoc(doc(db, 'users/bob'), { name: 'bob', mustChangePassword: false });
  await setDoc(doc(db, 'secrets/bob'), { passwordHash: HASH_B });
  await setDoc(doc(db, 'users/eve'), { name: 'eve', mustChangePassword: false });
  await setDoc(doc(db, 'secrets/eve'), { passwordHash: 'hash-e' });
  await setDoc(doc(db, 'sessions/uid-amy'), { name: 'amy', passwordHash: HASH_A });
  await setDoc(doc(db, 'sessions/uid-bob'), { name: 'bob', passwordHash: HASH_B });
  await setDoc(doc(db, 'sessions/uid-eve'), { name: 'eve', passwordHash: 'hash-e' });
  await setDoc(doc(db, 'rooms/pair__amy__bob'), { code: 'pair__amy__bob', participants: ['amy', 'bob'] });
  await setDoc(doc(db, 'rooms/pair__amy__bob/messages/m1'), { text: 'hi', author: 'amy' });
  await setDoc(doc(db, 'rooms/pair__amy__bob/faqs/f1'), { question: 'q' });
  await setDoc(doc(db, 'rooms/MAIN-ROOM'), { code: 'MAIN-ROOM' });
  await setDoc(doc(db, 'rooms/MAIN-ROOM/messages/old1'), { text: 'legacy' });
});

const amy = env.authenticatedContext('uid-amy').firestore();
const eve = env.authenticatedContext('uid-eve').firestore();
const nobody = env.authenticatedContext('uid-new').firestore();

console.log('\nPasswords');
await test('correct password binds a session', () =>
  assertSucceeds(setDoc(doc(nobody, 'sessions/uid-new'), { name: 'amy', passwordHash: HASH_A })));
await test('wrong password is refused', () =>
  assertFails(setDoc(doc(nobody, 'sessions/uid-new'), { name: 'amy', passwordHash: 'guess' })));
await test('password hashes are never readable', () =>
  assertFails(getDoc(doc(amy, 'secrets/amy'))));
await test('cannot bind a name to somebody else\'s secret', () =>
  assertFails(setDoc(doc(nobody, 'sessions/uid-new'), { name: 'amy', passwordHash: 'hash-e' })));
await test('owner may change their own password', () =>
  assertSucceeds(setDoc(doc(amy, 'secrets/amy'), { passwordHash: 'new' }, { merge: true })));
await test('nobody may change another password', () =>
  assertFails(setDoc(doc(eve, 'secrets/amy'), { passwordHash: 'stolen' }, { merge: true })));
await test('an existing secret cannot be re-created', () =>
  assertFails(setDoc(doc(eve, 'secrets/bob'), { passwordHash: 'stolen' })));
await test('a users doc must match its own id', () =>
  assertFails(setDoc(doc(eve, 'users/zoe'), { name: 'amy' })));

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
  assertSucceeds(getDocs(query(collection(amy, 'rooms'), where('participants', 'array-contains', 'amy')))));
await test('listing every room is refused', () =>
  assertFails(getDocs(collection(amy, 'rooms'))));
await test('participants cannot be rewritten', () =>
  assertFails(setDoc(doc(amy, 'rooms/pair__amy__bob'), { participants: ['amy', 'eve'] }, { merge: true })));
await test('a new room must include me', () =>
  assertFails(setDoc(doc(amy, 'rooms/pair__bob__eve'), { participants: ['bob', 'eve'] })));
await test('a new room with me is allowed', () =>
  assertSucceeds(setDoc(doc(amy, 'rooms/pair__amy__eve'), { participants: ['amy', 'eve'] })));
await test('looking up a room that does not exist is not an error', () =>
  assertSucceeds(getDoc(doc(amy, 'rooms/pair__nobody__yet'))));

console.log('\nLegacy room (migration)');
await test('legacy history stays readable', () =>
  assertSucceeds(getDocs(collection(amy, 'rooms/MAIN-ROOM/messages'))));

console.log('\nPresence and invitations');
await test('presence must carry my own name', () =>
  assertFails(setDoc(doc(amy, 'presence/bob'), { name: 'bob', lastActive: 'now' })));
await test('publishing my own presence works', () =>
  assertSucceeds(setDoc(doc(amy, 'presence/amy'), { name: 'amy', lastActive: 'now' })));
await test('cannot send an invite as someone else', () =>
  assertFails(setDoc(doc(eve, 'chatInvites/i1'), { from: 'amy', to: 'bob', status: 'pending' })));
await test('sending my own invite works', () =>
  assertSucceeds(setDoc(doc(amy, 'chatInvites/i2'), { from: 'amy', to: 'bob', status: 'pending' })));
await test('an unrelated person cannot read the invite', () =>
  assertFails(getDoc(doc(eve, 'chatInvites/i2'))));

console.log('\nPreferences');
await test('my own preferences are writable', () =>
  assertSucceeds(setDoc(doc(amy, 'userPrefs/amy'), { chatBackground: '' })));
await test('someone else\'s preferences are not', () =>
  assertFails(setDoc(doc(eve, 'userPrefs/amy'), { chatBackground: 'x' })));

console.log('\nSigned out');
const anon = env.unauthenticatedContext().firestore();
await test('a signed-out visitor sees nothing', () =>
  assertFails(getDoc(doc(anon, 'rooms/pair__amy__bob'))));

await env.cleanup();
console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
