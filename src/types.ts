export interface FAQItem {
  id: string;
  question: string;
  /** Context or intent behind the question — shown in the admin list only. */
  answer: string;
  category: string;
  isPinned?: boolean;
  isHidden?: boolean;
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
   * Per-category timestamp marking when the "already played" list was last
   * cleared, so a category whose questions ran out can start a fresh cycle.
   */
  playedResetAt?: Record<string, string>;
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
