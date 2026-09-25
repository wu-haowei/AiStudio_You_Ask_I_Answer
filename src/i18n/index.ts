import { useSyncExternalStore } from 'react';
import { zhTW, en, ja, type MessageKey } from './messages';

/*
 * A deliberately small translation layer rather than a library: the app has
 * three languages, no plurals worth speaking of, and nothing that needs
 * runtime-loaded catalogues — so a typed dictionary per language and one
 * `t()` cover it without another dependency to keep updated.
 *
 * Traditional Chinese is the source. The other dictionaries are typed against
 * its keys, so a message added there and not translated fails to compile
 * instead of quietly showing up as Chinese in an English screen.
 */

export type Lang = 'zh-TW' | 'en' | 'ja';
export type { MessageKey };

export const DEFAULT_LANG: Lang = 'zh-TW';

/** Each language named in itself — a person looking for theirs may not read the current one. */
export const LANGS: { code: Lang; label: string; short: string }[] = [
  { code: 'zh-TW', label: '繁體中文', short: '繁' },
  { code: 'en', label: 'English', short: 'EN' },
  { code: 'ja', label: '日本語', short: '日' },
];

const HTML_LANG: Record<Lang, string> = { 'zh-TW': 'zh-Hant', en: 'en', ja: 'ja' };

/** BCP 47 tag for Intl and toLocale* calls. */
export const INTL_LOCALE: Record<Lang, string> = { 'zh-TW': 'zh-TW', en: 'en', ja: 'ja' };

const dictionaries: Record<Lang, Record<MessageKey, string>> = { 'zh-TW': zhTW, en, ja };

export const isLang = (value: unknown): value is Lang =>
  value === 'zh-TW' || value === 'en' || value === 'ja';

/** Local-device copy, so the login screen — before anyone is known — already speaks the right language. */
const STORAGE_KEY = 'milktea_qa_lang_v1';

const readStored = (): Lang => {
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (isLang(stored)) return stored;
  } catch {
    // Storage unavailable (private browsing, quota) — fall through to the default.
  }
  return DEFAULT_LANG;
};

let current: Lang = readStored();
const listeners = new Set<() => void>();

if (typeof document !== 'undefined') document.documentElement.lang = HTML_LANG[current];

export const getLang = (): Lang => current;

/**
 * Switches language everywhere at once. Every component that calls useT() or
 * useLang() re-renders; anything reading `t` from a non-React module simply
 * picks up the new language on its next call.
 */
export const setLang = (next: Lang): void => {
  if (next === current) return;
  current = next;
  try {
    localStorage.setItem(STORAGE_KEY, next);
  } catch {
    // Not fatal — the choice just will not survive a reload on this device.
  }
  if (typeof document !== 'undefined') document.documentElement.lang = HTML_LANG[next];
  listeners.forEach((listener) => listener());
};

const subscribe = (listener: () => void) => {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
};

export type MessageParams = Record<string, string | number>;

/** `{name}` placeholders, filled from params. An unknown placeholder is left as written, which is easier to spot than a blank. */
const interpolate = (template: string, params?: MessageParams): string =>
  params ? template.replace(/\{(\w+)\}/g, (whole, key) => (key in params ? String(params[key]) : whole)) : template;

/**
 * Looks a message up in the current language, falling back to Chinese so a
 * gap can never render an empty label.
 */
export const t = (key: MessageKey, params?: MessageParams): string =>
  interpolate(dictionaries[current][key] || zhTW[key], params);

/**
 * Like t(), but in a chosen language rather than the current one. Used to
 * write the Chinese rendering stored beside a message code, so a client that
 * predates the code still has readable text to show.
 */
export const tIn = (lang: Lang, key: MessageKey, params?: MessageParams): string =>
  interpolate(dictionaries[lang][key] || zhTW[key], params);

/** Whether a string read back from storage is one of this build's message keys. */
export const isMessageKey = (key: string): key is MessageKey => key in zhTW;

/** The current language, re-rendering the caller when it changes. */
export const useLang = (): Lang => useSyncExternalStore(subscribe, getLang, () => DEFAULT_LANG);

/**
 * `t`, bound to a component: calling this is what subscribes it to language
 * changes, so any component that shows text should call it even if it only
 * uses `t` inside a handler.
 */
export const useT = (): typeof t => {
  useLang();
  return t;
};
