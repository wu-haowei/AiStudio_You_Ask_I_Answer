import { initializeApp, getApps, getApp } from 'firebase/app';
import { getFirestore, doc, onSnapshot, setDoc, getDoc } from 'firebase/firestore';
import { getAuth } from 'firebase/auth';
import { CoPlayRoom } from '../types';

export const firebaseConfig = {
  apiKey: import.meta.env.VITE_FIREBASE_API_KEY || "AIzaSyDuWpe6wWkyzyuEqbTclpSgw7Akz9hqPVk",
  authDomain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN || "youaskianswer-aa276.firebaseapp.com",
  projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID || "youaskianswer-aa276",
  storageBucket: import.meta.env.VITE_FIREBASE_STORAGE_BUCKET || "youaskianswer-aa276.firebasestorage.app",
  messagingSenderId: import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID || "659973025136",
  appId: import.meta.env.VITE_FIREBASE_APP_ID || "1:659973025136:web:68b0ce844d553928e333b5"
};

const app = !getApps().length ? initializeApp(firebaseConfig) : getApp();
export const db = getFirestore(app);
export const auth = getAuth(app);

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
    await setDoc(roomRef, room, { merge: true });
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
