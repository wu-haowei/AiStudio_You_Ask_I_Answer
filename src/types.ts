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
  sender: string;       // e.g. '1105'
  target: string;       // e.g. '1115'
  status: 'pending' | 'accepted' | 'declined';
  createdAt: string;
}

export interface RoomQuestion {
  id: string;
  initiator: string;    // e.g. '1105' (the guesser)
  target: string;       // e.g. '1115' (the person whose true answer is asked)
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

export interface RoomMessage {
  id: string;
  author: string;
  text: string;
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
