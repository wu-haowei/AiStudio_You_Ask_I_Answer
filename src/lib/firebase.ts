import { initializeApp, getApps, getApp } from 'firebase/app';
import { getFirestore, doc, onSnapshot, setDoc, getDoc, deleteField } from 'firebase/firestore';
import { getAuth } from 'firebase/auth';
import { CoPlayRoom } from '../types';

const env = (import.meta as any).env || {};

export const firebaseConfig = {
  apiKey: env.VITE_FIREBASE_API_KEY || "AIzaSyDuWpe6wWkyzyuEqbTclpSgw7Akz9hqPVk",
  authDomain: env.VITE_FIREBASE_AUTH_DOMAIN || "youaskianswer-aa276.firebaseapp.com",
  projectId: env.VITE_FIREBASE_PROJECT_ID || "youaskianswer-aa276",
  storageBucket: env.VITE_FIREBASE_STORAGE_BUCKET || "youaskianswer-aa276.firebasestorage.app",
  messagingSenderId: env.VITE_FIREBASE_MESSAGING_SENDER_ID || "659973025136",
  appId: env.VITE_FIREBASE_APP_ID || "1:659973025136:web:68b0ce844d553928e333b5"
};

const app = !getApps().length ? initializeApp(firebaseConfig) : getApp();
export const db = getFirestore(app);
export const auth = getAuth(app);

// Helper to sanitize objects for Firestore (removes undefined values or uses deleteField)
const sanitizeForFirestore = (obj: any, isTopLevel = true): any => {
  if (obj === null || obj === undefined) {
    return isTopLevel ? deleteField() : null;
  }
  if (Array.isArray(obj)) {
    return obj
      .filter((item) => item !== undefined)
      .map((item) => sanitizeForFirestore(item, false));
  }
  if (typeof obj === 'object') {
    const cleaned: Record<string, any> = {};
    for (const [key, value] of Object.entries(obj)) {
      if (value === undefined) {
        if (isTopLevel) {
          cleaned[key] = deleteField();
        }
        // If nested, omit the key completely
      } else if (value === null) {
        if (isTopLevel) {
          cleaned[key] = deleteField();
        } else {
          cleaned[key] = null;
        }
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

// Realtime Firestore synchronization for CoPlay rooms
export const subscribeToFirebaseRoom = (
  roomCode: string,
  onUpdate: (room: CoPlayRoom) => void
) => {
  if (!db || !roomCode) return () => {};
  const roomRef = doc(db, 'rooms', roomCode.toUpperCase());
  return onSnapshot(
    roomRef,
    (snapshot) => {
      if (snapshot.exists()) {
        onUpdate(snapshot.data() as CoPlayRoom);
      }
    },
    (err) => {
      console.warn('Firestore room snapshot warning:', err);
    }
  );
};

export const syncRoomToFirebase = async (room: CoPlayRoom) => {
  if (!db || !room?.code) return;
  try {
    const roomRef = doc(db, 'rooms', room.code.toUpperCase());
    const sanitized = sanitizeForFirestore(room, true);
    await setDoc(roomRef, sanitized, { merge: true });
  } catch (err) {
    console.warn('Failed to sync room to Firebase:', err);
  }
};

export const getFirebaseRoom = async (roomCode: string): Promise<CoPlayRoom | null> => {
  if (!db || !roomCode) return null;
  try {
    const roomRef = doc(db, 'rooms', roomCode.toUpperCase());
    const snap = await getDoc(roomRef);
    if (snap.exists()) {
      return snap.data() as CoPlayRoom;
    }
  } catch (err) {
    console.warn('Failed to fetch room from Firebase:', err);
  }
  return null;
};
