import { Timestamp } from 'firebase/firestore';
const f = (value: unknown) => {
  if (value instanceof Timestamp) {
    const t: Timestamp = value;
    return t.seconds;
  }
  return 0;
};
export default f;
