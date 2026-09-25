export const zh = {
  'app.name': '你問我答',
  'common.genericError': '發生錯誤，請稍後再試',
  'common.backToSignIn': '回到登入畫面',
} as const;

export const en: Record<keyof typeof zh, string> = {
  'app.name': 'You Ask, I Answer',
  'common.genericError': 'Something went wrong. Please try again later.',
  'common.backToSignIn': 'Back to sign in',
};

export const ja: Record<keyof typeof zh, string> = {
  'app.name': 'きみが聞く、わたしが答える',
  'common.genericError': 'エラーが発生しました。しばらくしてからもう一度お試しください。',
  'common.backToSignIn': 'ログイン画面に戻る',
};
