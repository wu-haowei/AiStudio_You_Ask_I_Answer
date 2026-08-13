export interface FAQItem {
  id: string;
  question: string;
  answer: string;
  category: string;
  tags: string[];
  isPinned?: boolean;
  isHidden?: boolean;
  helpfulCount: number;
  unhelpfulCount: number;
  views?: number;
  updatedAt: string;
  // Interactive Quiz / Challenge support
  options?: string[];
  correctOptionIndex?: number;
  explanation?: string;
}

export interface Category {
  id: string;
  name: string;
  slug: string;
  colorClass: 'badge-milktea' | 'badge-matcha' | 'badge-rosetea' | 'badge-taro' | 'badge-earlgrey';
  description?: string;
}

export interface UserQuestion {
  id: string;
  authorName: string;
  authorEmail?: string;
  questionText: string;
  category: string;
  createdAt: string;
  status: 'pending' | 'answered' | 'archived';
  officialReply?: string;
}

export type ActiveTab = 'co_play' | 'admin_manage';

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
  /** The guesser. */
  initiator: string;
  /** The person whose true answer is being guessed. */
  target: string;
  question: string;
  category: string;
  options: string[];
  targetAnswer?: number;    // User B's true choice (0-3)
  initiatorGuess?: number;  // User A's guess (0-3)
  targetAnswerText?: string;
  initiatorGuessText?: string;
  isRevealed?: boolean;
  isCorrect?: boolean;
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
  hostName: string;
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
