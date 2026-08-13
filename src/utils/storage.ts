import { Category, FAQItem, NotionConfig, UserQuestion } from '../types';
import { INITIAL_CATEGORIES, INITIAL_FAQS, INITIAL_USER_QUESTIONS } from '../data/initialData';

export const CURRENT_APP_VERSION = '2.2.0';
export const APP_VERSION_KEY = 'milktea_qa_app_version';

const STORAGE_KEYS = {
  FAQS: 'milktea_qa_faqs_v1',
  CATEGORIES: 'milktea_qa_categories_v1',
  USER_QUESTIONS: 'milktea_qa_user_questions_v1',
  VOTED_FAQS: 'milktea_qa_voted_faqs_v1',
  NOTION_CONFIG: 'milktea_qa_notion_config_v1',
};

/**
 * Checks current stored app version against CURRENT_APP_VERSION.
 * If version is missing or outdated:
 * 1. Clears sessionStorage completely to flush stale tab state / session passcodes.
 * 2. Clears obsolete localStorage keys & sanitizes configuration.
 * 3. Updates stored version key.
 * Returns true if a version update/migration was performed.
 */
export function checkAndMigrateStorageVersion(): boolean {
  try {
    const storedVersion = localStorage.getItem(APP_VERSION_KEY);

    if (storedVersion !== CURRENT_APP_VERSION) {
      console.log(`[App Version Upgrade] Upgrading from "${storedVersion || 'legacy'}" to "${CURRENT_APP_VERSION}"`);

      // 1. Flush sessionStorage completely
      try {
        sessionStorage.clear();
      } catch (e) {
        console.warn('Failed to clear sessionStorage during version update:', e);
      }

      // 2. Clear obsolete or temporary storage keys
      localStorage.removeItem('coplay_rooms_static_v1');
      localStorage.removeItem('coplay_session_passcode');

      // Preserve and sanitize Notion config if present
      const notionRaw = localStorage.getItem(STORAGE_KEYS.NOTION_CONFIG);
      if (notionRaw) {
        try {
          const parsed = JSON.parse(notionRaw);
          if (!parsed || typeof parsed !== 'object') {
            localStorage.removeItem(STORAGE_KEYS.NOTION_CONFIG);
          }
        } catch {
          localStorage.removeItem(STORAGE_KEYS.NOTION_CONFIG);
        }
      }

      // Preserve and sanitize FAQs if valid
      const faqsRaw = localStorage.getItem(STORAGE_KEYS.FAQS);
      if (faqsRaw) {
        try {
          const parsed = JSON.parse(faqsRaw);
          if (!Array.isArray(parsed)) {
            localStorage.setItem(STORAGE_KEYS.FAQS, JSON.stringify(INITIAL_FAQS));
          }
        } catch {
          localStorage.setItem(STORAGE_KEYS.FAQS, JSON.stringify(INITIAL_FAQS));
        }
      }

      // Write updated version tag
      localStorage.setItem(APP_VERSION_KEY, CURRENT_APP_VERSION);
      return true;
    }
  } catch (err) {
    console.error('Failed to check and migrate storage version:', err);
  }
  return false;
}

/**
 * Manual full purge of sessionStorage & localStorage for troubleshooting
 */
export function clearAllStorageAndSession(): void {
  try {
    sessionStorage.clear();
    localStorage.clear();
    localStorage.setItem(APP_VERSION_KEY, CURRENT_APP_VERSION);
    resetToDefaults();
  } catch (err) {
    console.error('Failed to purge storage:', err);
  }
}

// Notion Configuration Operations
export const HARDCODED_NOTION_QUESTION_DB_ID = (import.meta as unknown as { env: Record<string, string> }).env?.VITE_NOTION_QUESTION_DB_ID || '3ba6e88209608047b0e3df6fe9b38c41';
export const HARDCODED_NOTION_ANSWER_DB_ID = (import.meta as unknown as { env: Record<string, string> }).env?.VITE_NOTION_ANSWER_DB_ID || '3ba6e882096080c18233fb5e88b8354d';
export const HARDCODED_NOTION_DB_ID = HARDCODED_NOTION_ANSWER_DB_ID;
export const HARDCODED_NOTION_TOKEN = (import.meta as unknown as { env: Record<string, string> }).env?.VITE_NOTION_TOKEN || '';

export function getStoredNotionConfig(): NotionConfig {
  try {
    const raw = localStorage.getItem(STORAGE_KEYS.NOTION_CONFIG);
    if (!raw) {
      const defaultConfig: NotionConfig = {
        token: HARDCODED_NOTION_TOKEN,
        databaseId: HARDCODED_NOTION_ANSWER_DB_ID,
        questionDatabaseId: HARDCODED_NOTION_QUESTION_DB_ID,
        answerDatabaseId: HARDCODED_NOTION_ANSWER_DB_ID,
        autoSync: true,
      };
      localStorage.setItem(STORAGE_KEYS.NOTION_CONFIG, JSON.stringify(defaultConfig));
      return defaultConfig;
    }
    const parsed = JSON.parse(raw);
    let token = parsed.token || HARDCODED_NOTION_TOKEN;
    if (!token || token.includes('bbd6e882096082ca')) {
      token = HARDCODED_NOTION_TOKEN;
    }

    let questionDatabaseId = parsed.questionDatabaseId || HARDCODED_NOTION_QUESTION_DB_ID;
    let answerDatabaseId = parsed.answerDatabaseId || parsed.databaseId || HARDCODED_NOTION_ANSWER_DB_ID;

    if (!questionDatabaseId || questionDatabaseId.includes('2906e88209608305')) {
      questionDatabaseId = HARDCODED_NOTION_QUESTION_DB_ID;
    }
    if (!answerDatabaseId || answerDatabaseId.includes('2906e88209608305')) {
      answerDatabaseId = HARDCODED_NOTION_ANSWER_DB_ID;
    }

    return {
      token,
      databaseId: answerDatabaseId,
      questionDatabaseId,
      answerDatabaseId,
      autoSync: parsed.autoSync ?? true,
    };
  } catch {
    return {
      token: HARDCODED_NOTION_TOKEN,
      databaseId: HARDCODED_NOTION_ANSWER_DB_ID,
      questionDatabaseId: HARDCODED_NOTION_QUESTION_DB_ID,
      answerDatabaseId: HARDCODED_NOTION_ANSWER_DB_ID,
      autoSync: true,
    };
  }
}

export function saveStoredNotionConfig(config: NotionConfig): void {
  try {
    localStorage.setItem(STORAGE_KEYS.NOTION_CONFIG, JSON.stringify(config));
  } catch (err) {
    console.error('Failed to save Notion config:', err);
  }
}

// FAQ Operations
export function getStoredFAQs(): FAQItem[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEYS.FAQS);
    if (!raw) {
      localStorage.setItem(STORAGE_KEYS.FAQS, JSON.stringify(INITIAL_FAQS));
      return INITIAL_FAQS;
    }
    return JSON.parse(raw);
  } catch (err) {
    console.error('Failed to parse stored FAQs:', err);
    return INITIAL_FAQS;
  }
}

export function saveStoredFAQs(faqs: FAQItem[]): void {
  try {
    localStorage.setItem(STORAGE_KEYS.FAQS, JSON.stringify(faqs));
  } catch (err) {
    console.error('Failed to save FAQs to localStorage:', err);
  }
}

// Category Operations
export function getStoredCategories(): Category[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEYS.CATEGORIES);
    if (!raw) {
      localStorage.setItem(STORAGE_KEYS.CATEGORIES, JSON.stringify(INITIAL_CATEGORIES));
      return INITIAL_CATEGORIES;
    }
    return JSON.parse(raw);
  } catch (err) {
    console.error('Failed to parse categories:', err);
    return INITIAL_CATEGORIES;
  }
}

export function saveStoredCategories(categories: Category[]): void {
  try {
    localStorage.setItem(STORAGE_KEYS.CATEGORIES, JSON.stringify(categories));
  } catch (err) {
    console.error('Failed to save categories:', err);
  }
}

// User Questions Operations
export function getStoredUserQuestions(): UserQuestion[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEYS.USER_QUESTIONS);
    if (!raw) {
      localStorage.setItem(STORAGE_KEYS.USER_QUESTIONS, JSON.stringify(INITIAL_USER_QUESTIONS));
      return INITIAL_USER_QUESTIONS;
    }
    return JSON.parse(raw);
  } catch (err) {
    console.error('Failed to parse user questions:', err);
    return INITIAL_USER_QUESTIONS;
  }
}

export function saveStoredUserQuestions(questions: UserQuestion[]): void {
  try {
    localStorage.setItem(STORAGE_KEYS.USER_QUESTIONS, JSON.stringify(questions));
  } catch (err) {
    console.error('Failed to save user questions:', err);
  }
}

// User Vote Trackers
export function getVotedFAQIds(): Record<string, 'helpful' | 'unhelpful'> {
  try {
    const raw = localStorage.getItem(STORAGE_KEYS.VOTED_FAQS);
    return raw ? JSON.parse(raw) : {};
  } catch {
    return {};
  }
}

export function saveVotedFAQId(faqId: string, type: 'helpful' | 'unhelpful'): void {
  const current = getVotedFAQIds();
  current[faqId] = type;
  try {
    localStorage.setItem(STORAGE_KEYS.VOTED_FAQS, JSON.stringify(current));
  } catch (err) {
    console.error('Failed to save voted status:', err);
  }
}

// Reset ALL to factory default
export function resetToDefaults(): { faqs: FAQItem[]; categories: Category[]; userQuestions: UserQuestion[] } {
  localStorage.setItem(STORAGE_KEYS.FAQS, JSON.stringify(INITIAL_FAQS));
  localStorage.setItem(STORAGE_KEYS.CATEGORIES, JSON.stringify(INITIAL_CATEGORIES));
  localStorage.setItem(STORAGE_KEYS.USER_QUESTIONS, JSON.stringify(INITIAL_USER_QUESTIONS));
  localStorage.removeItem(STORAGE_KEYS.VOTED_FAQS);
  return {
    faqs: INITIAL_FAQS,
    categories: INITIAL_CATEGORIES,
    userQuestions: INITIAL_USER_QUESTIONS,
  };
}

// Export and Import JSON data
export function exportDataAsJSON(): string {
  const data = {
    version: '1.0',
    exportDate: new Date().toISOString(),
    faqs: getStoredFAQs(),
    categories: getStoredCategories(),
    userQuestions: getStoredUserQuestions(),
  };
  return JSON.stringify(data, null, 2);
}
