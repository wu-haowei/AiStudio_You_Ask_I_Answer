export const zh = {
  'auth.quotaExceeded': '今天寄信次數已經達上限了，這是 Firebase 的每日配額限制，請明天再試一次',
  'auth.nameRequired': '請輸入姓名',
  'auth.nameNoSlash': '姓名不能包含斜線',
  'auth.nameUnusable': '這個姓名不能使用',
  'auth.nameTooLong': '姓名太長',
  'auth.offline': '無法連線，請檢查網路',
  'auth.passwordRequired': '請輸入密碼',
  'auth.newAccountUseDefault': '這是新帳號，請用預設密碼 {password} 登入',
  'auth.wrongPassword': '密碼不正確',
  'auth.cannotCreate': '無法建立帳號，這個名字可能已被使用',
  'auth.newPasswordTooShort': '新密碼至少 4 個字元',
  'auth.noDefaultPassword': '請不要使用預設密碼',
  'auth.newPasswordSame': '新密碼不能和目前的一樣',
  'auth.changeFailed': '無法變更密碼，請重新登入後再試',
  'auth.emailInvalid': '請輸入有效的 Email',
  'auth.emailTaken': '這個 Email 已經被使用，換一個試試',
  'auth.confirmSendFailed': '寄送確認信失敗，請稍後再試',
  'auth.linkInvalid': '這個連結已經失效或不存在，請重新申請一次',
  'auth.resetSendFailed': '寄送失敗，請檢查網路後再試',
  'auth.noSuchAccount': '查無這個姓名的帳號',
  'auth.noRecoveryEmail': '這個帳號還沒設定救援 Email，請用密碼登入後到設定裡新增',
  'auth.reauthSentButFailed': '身份驗證成功，但寄送新 Email 的確認信失敗，請回到設定裡重新試一次',
  'auth.linkWrongDevice': '無法確認這個連結是哪個帳號的，請回到原本申請的裝置上開啟',
  'auth.emailAccountMissing': '找不到這個 Email 對應的帳號，請聯絡對方協助處理',
} as const;

export const en: Record<keyof typeof zh, string> = {
  'auth.quotaExceeded':
    'Today’s email limit has been reached (a daily quota set by Firebase). Please try again tomorrow.',
  'auth.nameRequired': 'Please enter your name',
  'auth.nameNoSlash': 'Names can’t contain a slash',
  'auth.nameUnusable': 'This name can’t be used',
  'auth.nameTooLong': 'That name is too long',
  'auth.offline': 'Can’t connect — please check your network',
  'auth.passwordRequired': 'Please enter your password',
  'auth.newAccountUseDefault': 'This is a new account — sign in with the default password {password}',
  'auth.wrongPassword': 'Incorrect password',
  'auth.cannotCreate': 'Couldn’t create the account — that name may already be taken',
  'auth.newPasswordTooShort': 'The new password must be at least 4 characters',
  'auth.noDefaultPassword': 'Please don’t use the default password',
  'auth.newPasswordSame': 'The new password can’t be the same as the current one',
  'auth.changeFailed': 'Couldn’t change the password — please sign in again and retry',
  'auth.emailInvalid': 'Please enter a valid email address',
  'auth.emailTaken': 'That email is already in use — try another one',
  'auth.confirmSendFailed': 'Couldn’t send the confirmation email. Please try again later.',
  'auth.linkInvalid': 'This link has expired or doesn’t exist. Please request a new one.',
  'auth.resetSendFailed': 'Couldn’t send the email — please check your connection and try again',
  'auth.noSuchAccount': 'No account found with that name',
  'auth.noRecoveryEmail':
    'This account has no recovery email yet. Sign in with your password and add one in settings.',
  'auth.reauthSentButFailed':
    'Identity confirmed, but the email to the new address couldn’t be sent. Please go back to settings and try again.',
  'auth.linkWrongDevice':
    'Can’t tell which account this link belongs to — please open it on the device where you requested it',
  'auth.emailAccountMissing':
    'No account is linked to this email. Please ask the other person to help.',
};

export const ja: Record<keyof typeof zh, string> = {
  'auth.quotaExceeded':
    '本日のメール送信回数の上限に達しました（Firebase の1日あたりの上限です）。明日もう一度お試しください。',
  'auth.nameRequired': '名前を入力してください',
  'auth.nameNoSlash': '名前にスラッシュは使えません',
  'auth.nameUnusable': 'この名前は使用できません',
  'auth.nameTooLong': '名前が長すぎます',
  'auth.offline': '接続できません。ネットワークを確認してください',
  'auth.passwordRequired': 'パスワードを入力してください',
  'auth.newAccountUseDefault': '新しいアカウントです。初期パスワード {password} でログインしてください',
  'auth.wrongPassword': 'パスワードが違います',
  'auth.cannotCreate': 'アカウントを作成できませんでした。この名前はすでに使われている可能性があります',
  'auth.newPasswordTooShort': '新しいパスワードは4文字以上にしてください',
  'auth.noDefaultPassword': '初期パスワードは使わないでください',
  'auth.newPasswordSame': '新しいパスワードは現在のものと違う必要があります',
  'auth.changeFailed': 'パスワードを変更できませんでした。ログインし直してからもう一度お試しください',
  'auth.emailInvalid': '有効なメールアドレスを入力してください',
  'auth.emailTaken': 'このメールアドレスはすでに使われています。別のものをお試しください',
  'auth.confirmSendFailed': '確認メールを送信できませんでした。しばらくしてからもう一度お試しください',
  'auth.linkInvalid': 'このリンクは期限切れか、存在しません。もう一度申請してください',
  'auth.resetSendFailed': 'メールを送信できませんでした。接続を確認してからもう一度お試しください',
  'auth.noSuchAccount': 'この名前のアカウントは見つかりません',
  'auth.noRecoveryEmail':
    'このアカウントには復旧用メールアドレスがまだありません。パスワードでログインし、設定から追加してください',
  'auth.reauthSentButFailed':
    '本人確認はできましたが、新しいメールアドレスへの確認メールを送信できませんでした。設定に戻ってもう一度お試しください',
  'auth.linkWrongDevice': 'このリンクがどのアカウントのものか確認できません。申請した端末で開いてください',
  'auth.emailAccountMissing':
    'このメールアドレスに対応するアカウントが見つかりません。相手に手伝ってもらってください',
};
