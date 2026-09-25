export const zh = {
  'drive.noKey': '尚未設定 Google API 金鑰（VITE_GOOGLE_API_KEY），無法從雲端讀取',
  'drive.quota': 'Google Drive API 用量已達上限，請稍後再試',
  'drive.readFailed': '讀取失敗（HTTP {status}）',
  'drive.offline': '連線失敗，請檢查網路連線',
  'drive.folderNotFound': '找不到這個資料夾，請確認連結正確',
  'drive.folderForbidden': '沒有權限讀取，請確認資料夾的共用設定是「知道連結的人皆可查看」',
  'drive.tooMany': '資料夾裡的檔案太多，無法完整列出',
  'drive.fileNotFound': '找不到這個檔案，請確認連結正確',
  'drive.fileForbidden': '沒有權限讀取，請確認檔案的共用設定是「知道連結的人皆可查看」',
  'drive.badLink': '看不出這是 Google Drive 的檔案連結或 ID',
  'drive.untyped': '一般',
  'drive.unparsed': '其他',
} as const;

export const en: Record<keyof typeof zh, string> = {
  'drive.noKey': 'The Google API key (VITE_GOOGLE_API_KEY) isn\'t set, so cloud import isn\'t available',
  'drive.quota': 'The Google Drive API usage limit has been reached — please try again shortly',
  'drive.readFailed': 'Read failed (HTTP {status})',
  'drive.offline': 'Connection failed — please check your network',
  'drive.folderNotFound': 'Couldn\'t find that folder — check the link',
  'drive.folderForbidden':
    'No permission to read it — make sure the folder is shared as “Anyone with the link can view”',
  'drive.tooMany': 'The folder has too many files to list completely',
  'drive.fileNotFound': 'Couldn\'t find that file — check the link',
  'drive.fileForbidden':
    'No permission to read it — make sure the file is shared as “Anyone with the link can view”',
  'drive.badLink': 'That doesn\'t look like a Google Drive file link or ID',
  'drive.untyped': 'General',
  'drive.unparsed': 'Other',
};

export const ja: Record<keyof typeof zh, string> = {
  'drive.noKey': 'Google API キー（VITE_GOOGLE_API_KEY）が未設定のため、クラウドから読み込めません',
  'drive.quota': 'Google Drive API の利用上限に達しました。しばらくしてからお試しください',
  'drive.readFailed': '読み込みに失敗しました（HTTP {status}）',
  'drive.offline': '接続に失敗しました。ネットワークを確認してください',
  'drive.folderNotFound': 'このフォルダが見つかりません。リンクを確認してください',
  'drive.folderForbidden': '読み取る権限がありません。フォルダの共有設定が「リンクを知っている全員が閲覧可」になっているか確認してください',
  'drive.tooMany': 'フォルダ内のファイルが多すぎて、すべてを一覧できません',
  'drive.fileNotFound': 'このファイルが見つかりません。リンクを確認してください',
  'drive.fileForbidden': '読み取る権限がありません。ファイルの共有設定が「リンクを知っている全員が閲覧可」になっているか確認してください',
  'drive.badLink': 'Google ドライブのファイルのリンクまたは ID には見えません',
  'drive.untyped': '一般',
  'drive.unparsed': 'その他',
};
