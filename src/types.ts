export interface FAQItem {
  id: string;
  question: string;
  /** Context or intent behind the question — shown in the admin list only. */
  answer: string;
  category: string;
  /*
   * `isPinned` and `isHidden` used to live here. Neither ever reached the game
   * — the question picker never looked at either one — so they were admin
   * toggles that changed nothing. Whether a question has been played is the
   * state that actually matters, and that is kept per pair on the room
   * document as playedFaqIds. Questions written by older versions may still
   * carry the old fields; nothing reads them.
   */
  /** Two or more choices. Absent means the question has no preset options. */
  options?: string[];
  updatedAt: string;
}

export interface Category {
  id: string;
  name: string;
  slug: string;
  colorClass: 'badge-milktea' | 'badge-matcha' | 'badge-rosetea' | 'badge-taro' | 'badge-earlgrey';
  description?: string;
}

export type ActiveTab = 'co_play' | 'admin_manage';

/*
 * Sentinels for the two entries in the category picker that are not categories.
 *
 * They share the field a real category name goes in, so they live here rather
 * than being spelled out at each use — the picker and the publisher have to
 * agree on them exactly, and they used to be written out by hand in both.
 */

/** Draw from the whole library, whatever category the question belongs to. */
export const RANDOM_CATEGORY_KEY = 'RANDOM';

/** Write a question by hand instead of drawing one. */
export const CUSTOM_CATEGORY_KEY = 'CUSTOM';

/**
 * Firestore document schema version. Bumped whenever stored shapes change;
 * every field added since v1 is optional, so documents written by older
 * versions keep working without migration.
 *
 *  v2 — chat history moved to a messages subcollection
 *  v3 — messages carry replyTo snapshots
 *  v4 — ordered multi-select answers, round history, per-category replay reset
 */
export const DATA_SCHEMA_VERSION = 4;

export interface ToastMessage {
  id: string;
  type: 'success' | 'info' | 'warning' | 'error';
  title: string;
  description?: string;
}

export interface GameInvitation {
  id: string;
  /** Player name of whoever sent the challenge. */
  sender: string;
  /** Player name of whoever was challenged. */
  target: string;
  status: 'pending' | 'accepted' | 'declined';
  createdAt: string;
}

export interface RoomQuestion {
  id: string;
  /** Schema marker; see DATA_SCHEMA_VERSION. */
  v?: number;
  /** The guesser. */
  initiator: string;
  /** The person whose true answer is being guessed. */
  target: string;
  question: string;
  category: string;
  options: string[];
  /** Library question this was drawn from, when it came from the preset list. */
  sourceFaqId?: string;

  /**
   * Picks are ordered by preference, at most two. Rounds created before
   * multi-select stored a single index in targetAnswer / initiatorGuess; those
   * are read as a one-element list, so old records still render correctly.
   */
  targetAnswers?: number[];
  initiatorGuesses?: number[];

  /** @deprecated Superseded by targetAnswers; kept so old rounds still read. */
  targetAnswer?: number;
  /** @deprecated Superseded by initiatorGuesses. */
  initiatorGuess?: number;

  targetAnswerText?: string;
  initiatorGuessText?: string;
  isRevealed?: boolean;
  isCorrect?: boolean;
  createdAt: string;
}

/**
 * One completed round, stored under rooms/{code}/rounds. Drives both the
 * "already played" filter and the recent-activity counter.
 */
export interface RoundRecord {
  id: string;
  /** Absent when the question was typed by hand rather than drawn from the library. */
  faqId?: string;
  question: string;
  category: string;
  initiator: string;
  target: string;
  createdAt: string;
}

export interface PlayerTurnSelection {
  myChoice?: number;
  myGuess?: number;
  submittedAt?: string;
}

export interface RoomPlayer {
  id: string;
  name: string;
  score: number;
  isHost: boolean;
  lastActive: string;
  answeredCurrent?: boolean;
  lastSelectedOption?: number;
  lastGuessOption?: number;
}

/**
 * Snapshot of the message being replied to. Denormalized on purpose: only the
 * most recent messages are loaded, so the quoted text must travel with the
 * reply to stay readable once the original scrolls out of the window.
 */
export interface MessageReplyRef {
  id: string;
  author: string;
  text: string;
}

export interface RoomMessage {
  id: string;
  author: string;
  text: string;
  replyTo?: MessageReplyRef;
  /** Display-only label, e.g. "14:32". */
  timestamp: string;
  /** ISO timestamp — the ordering key for the Firestore messages subcollection. */
  createdAt: string;
  type?: 'chat' | 'question' | 'system' | 'invite';
  questionData?: FAQItem;
  gameQuestion?: RoomQuestion;
}

export interface CoPlayRoom {
  code: string;
  /** Schema marker for the room document itself. */
  v?: number;
  hostName: string;
  /**
   * Library question ids already used, grouped by category. Kept on the room
   * document so the replay filter needs no extra reads; emptying a category's
   * list starts a fresh cycle.
   */
  playedFaqIds?: Record<string, string[]>;
  /**
   * ISO timestamps of recently published questions, pruned to the activity
   * window on every write. Riding on the room document means the "last 3 hours"
   * counter costs no reads of its own.
   */
  recentRounds?: string[];
  /** Stored in Firestore as a map keyed by player id; normalized to an array on read. */
  players: RoomPlayer[];
  activeGameQuestion?: RoomQuestion | null;
  gameInvitation?: GameInvitation | null;
  status: 'lobby' | 'playing' | 'finished';
  createdAt: string;
  updatedAt: string;
}

export interface FilterState {
  searchQuery: string;
  selectedCategory: string;
  selectedTag: string;
  sortBy: 'pinned' | 'popular' | 'latest';
}
