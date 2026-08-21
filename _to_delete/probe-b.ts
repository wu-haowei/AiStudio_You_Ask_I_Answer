import { Timestamp } from 'firebase/firestore';

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
export default encodeValue;
