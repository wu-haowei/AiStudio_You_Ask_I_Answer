import { Category, FAQItem, NotionConfig, UserQuestion } from '../types';
import { INITIAL_CATEGORIES, INITIAL_FAQS, INITIAL_USER_QUESTIONS } from '../data/initialData';

const STORAGE_KEYS = {
  FAQS: 'milktea_qa_faqs_v1',
  CATEGORIES: 'milktea_qa_categories_v1',
  USER_QUESTIONS: 'milktea_qa_user_questions_v1',
  VOTED_FAQS: 'milktea_qa_voted_faqs_v1',
  NOTION_CONFIG: 'milktea_qa_notion_config_v1',
};

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
