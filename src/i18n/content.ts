import { UNFILED_CATEGORY, type QuestionTranslations } from '../types';
import { t, type Lang } from './index';

/**
 * Written on questions created with the "custom" option. Stored as this
 * Chinese word (existing rooms already hold it), shown via displayCategory.
 */
export const CUSTOM_CATEGORY_LABEL = '自訂';

/*
 * Question content is translated per question, by hand, and never
 * machine-translated on import — the original is always kept and always
 * wins when a language has no version of its own. Nothing here throws or
 * returns empty: showing the original is always better than showing nothing.
 */

/** The question text in `lang`, or the original when there is no usable translation. */
export const localizedQuestion = (
  original: string,
  translations: QuestionTranslations | undefined,
  lang: Lang
): string => translations?.[lang]?.question?.trim() || original;

/** The admin-side context text in `lang`, or the original. */
export const localizedAnswer = (
  original: string,
  translations: QuestionTranslations | undefined,
  lang: Lang
): string => translations?.[lang]?.answer?.trim() || original;

/**
 * The options in `lang` — but only if the translation lines up with the
 * original exactly. Answers are stored as option positions, so a list with a
 * different length (or a blank in the middle of it) could put two players on
 * different questions under the same numbers; that is worse than showing the
 * original, so it is treated as no translation at all.
 */
export const localizedOptions = <T extends string[] | undefined>(
  original: T,
  translations: QuestionTranslations | undefined,
  lang: Lang
): T => {
  const translated = translations?.[lang]?.options;
  if (
    original &&
    translated &&
    translated.length === original.length &&
    translated.every((option) => option.trim())
  ) {
    return translated.map((option) => option.trim()) as T;
  }
  return original;
};

/**
 * A round's question and options as one viewer should read them — the same
 * fallbacks as above, applied to the snapshot a round carries.
 */
export const localizedRoundQuestion = (
  round: { question: string; options?: string[]; translations?: QuestionTranslations },
  lang: Lang
): { question: string; options: string[] | undefined } => ({
  question: localizedQuestion(round.question, round.translations, lang),
  options: localizedOptions(round.options, round.translations, lang),
});

/**
 * Category names are free text a person typed or imported, and stay exactly
 * as written — except the two the app itself writes, whose stored value is a
 * fixed Chinese word. Those are shown in the viewer's language instead.
 */
export const displayCategory = (category: string): string => {
  if (category === UNFILED_CATEGORY) return t('category.unfiled');
  if (category === CUSTOM_CATEGORY_LABEL) return t('category.custom');
  return category;
};

/**
 * What of a library question's translations goes into a published round: the
 * question text and options only. The admin-side `answer` context never
 * reaches a round, in any language. Returns undefined when nothing is left, so
 * a round without translations carries no empty field.
 */
export const translationsForRound = (
  translations: QuestionTranslations | undefined
): QuestionTranslations | undefined => {
  if (!translations) return undefined;
  const out: QuestionTranslations = {};
  for (const [lang, entry] of Object.entries(translations) as [Lang, QuestionTranslations[Lang]][]) {
    const question = entry?.question?.trim();
    const options = entry?.options?.map((o) => o.trim());
    if (question || (options && options.some(Boolean))) {
      out[lang] = { ...(question ? { question } : {}), ...(options ? { options } : {}) };
    }
  }
  return Object.keys(out).length > 0 ? out : undefined;
};

/** Whether any language beyond the original has something written for it. */
export const hasTranslations = (translations: QuestionTranslations | undefined): boolean =>
  !!translations &&
  Object.values(translations).some(
    (entry) => !!entry && (entry.question?.trim() || entry.answer?.trim() || entry.options?.some((o) => o.trim()))
  );
