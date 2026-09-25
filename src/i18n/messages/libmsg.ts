export const zh = {
  'lib.badRoom': '目標房間不正確',
  'backup.notFound': '找不到這個對話',
  'backup.and': ' 與 ',
  'backup.sep': '、',
  'backup.unknownRoom': '未知的對話',
  'backup.wrongRoom': '這份備份是【{name}】的資料，不是目前這一組對話',
  'backup.notBackup': '這不是備份檔（缺少 collections 欄位）',
} as const;

export const en: Record<keyof typeof zh, string> = {
  'lib.badRoom': 'The target room is not valid',
  'backup.notFound': 'Conversation not found',
  'backup.and': ' and ',
  'backup.sep': ', ',
  'backup.unknownRoom': 'an unknown conversation',
  'backup.wrongRoom': 'This backup is for [{name}], not the current conversation',
  'backup.notBackup': 'This is not a backup file (missing the collections field)',
};

export const ja: Record<keyof typeof zh, string> = {
  'lib.badRoom': '対象の部屋が正しくありません',
  'backup.notFound': 'この会話が見つかりません',
  'backup.and': ' と ',
  'backup.sep': '、',
  'backup.unknownRoom': '不明な会話',
  'backup.wrongRoom': 'このバックアップは【{name}】のもので、現在の会話のものではありません',
  'backup.notBackup': 'バックアップファイルではありません（collections フィールドがありません）',
};
