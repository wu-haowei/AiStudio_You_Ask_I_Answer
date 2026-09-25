/*
 * Every message, one file per screen or area, each holding its Chinese
 * source and the English and Japanese versions side by side. The other two
 * are typed against the Chinese keys of the *same file*, so a message added
 * without its translations fails to compile right where it was written.
 *
 * Traditional Chinese is the source language. `{name}`-style placeholders are
 * filled by t(key, { name }); keep the same placeholders in every language.
 */
import * as common from './common';
import * as login from './login';
import * as auth from './auth';
import * as header from './header';
import * as lang from './lang';
import * as prefs from './prefs';
import * as app from './app';
import * as views from './views';
import * as convo from './convo';
import * as onboarding from './onboarding';
import * as background from './background';
import * as libmsg from './libmsg';
import * as coplay from './coplay';
import * as coplaymodals from './coplaymodals';
import * as drive from './drive';
import * as importmodal from './importmodal';
import * as admin from './admin';
// __IMPORTS__

export const zhTW = {
  ...common.zh,
  ...login.zh,
  ...auth.zh,
  ...header.zh,
  ...lang.zh,
  ...prefs.zh,
  ...app.zh,
  ...views.zh,
  ...convo.zh,
  ...onboarding.zh,
  ...background.zh,
  ...libmsg.zh,
  ...coplay.zh,
  ...coplaymodals.zh,
  ...drive.zh,
  ...importmodal.zh,
  ...admin.zh,
  // __ZH__
} as const;

export type MessageKey = keyof typeof zhTW;

export const en: Record<MessageKey, string> = {
  ...common.en,
  ...login.en,
  ...auth.en,
  ...header.en,
  ...lang.en,
  ...prefs.en,
  ...app.en,
  ...views.en,
  ...convo.en,
  ...onboarding.en,
  ...background.en,
  ...libmsg.en,
  ...coplay.en,
  ...coplaymodals.en,
  ...drive.en,
  ...importmodal.en,
  ...admin.en,
  // __EN__
};

export const ja: Record<MessageKey, string> = {
  ...common.ja,
  ...login.ja,
  ...auth.ja,
  ...header.ja,
  ...lang.ja,
  ...prefs.ja,
  ...app.ja,
  ...views.ja,
  ...convo.ja,
  ...onboarding.ja,
  ...background.ja,
  ...libmsg.ja,
  ...coplay.ja,
  ...coplaymodals.ja,
  ...drive.ja,
  ...importmodal.ja,
  ...admin.ja,
  // __JA__
};
