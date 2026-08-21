import { Timestamp } from 'firebase/firestore';
export const f = (value: unknown): unknown => {
  if (value instanceof Timestamp) {
    return { seconds: value.seconds };
  }
  return value;
};
