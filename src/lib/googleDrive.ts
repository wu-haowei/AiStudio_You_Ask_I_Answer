const env = (import.meta as any).env || {};

/** Google Cloud API key, restricted to the Drive API. Required only for cloud import. */
const DRIVE_API_KEY = env.VITE_GOOGLE_API_KEY || '';

/** Folder/file link the import modal pre-fills its input with. Optional — just a shortcut. */
export const DEFAULT_DRIVE_LINK = env.VITE_GOOGLE_API_URL || '';

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Local-only switch that swaps every Drive network call for canned fixture
 * data. Testing the picker (categories, "已答過" matching, the eye preview,
 * the progress bar) means clicking "從雲端讀取" over and over — against the
 * real API that is what tripped Google's abuse detector during development.
 * Never read in the production build path; see VITE_MOCK_GOOGLE_DRIVE in
 * .env.example.
 */
export const IS_MOCK_DRIVE = env.VITE_MOCK_GOOGLE_DRIVE === 'true';

/*
 * Deliberately out of order and covering every shape the picker has to cope
 * with: with and without a type, a count other than 50, a stray trailing
 * underscore, and one name that does not follow the convention at all.
 * Contents for the ones without an entry below fall back to mock-file-a's.
 */
const MOCK_FILES: DriveFileEntry[] = [
  { id: 'mock-file-e', name: 'notes_backup.json', mimeType: 'application/json' },
  { id: 'mock-file-b', name: 'gemini_spark_questions_20260904_01_50.json', mimeType: 'application/json' },
  { id: 'mock-file-d', name: 'claude_questions_20260820_02_37_.json', mimeType: 'application/json' },
  { id: 'mock-file-c', name: 'claude_scheduled_questions_20260828_01_50.json', mimeType: 'application/json' },
  { id: 'mock-file-a', name: 'claude_questions_20260821_05_50.json', mimeType: 'application/json' },
];

/** Deliberately includes one duplicate question (by text) across the two files, since real folders do too. */
const MOCK_FILE_CONTENTS: Record<string, unknown[]> = {
  'mock-file-a': [
    {
      question: '（範本）最喜歡的旅行地點是哪裡？',
      answer: '測試用題目，練習匯入流程用',
      category: '生活習慣',
      options: ['山上', '海邊', '大城市', '國外隨便走'],
    },
    {
      question: '（範本）假日通常都在做什麼？',
      answer: '測試用題目',
      category: '生活習慣',
      options: ['在家耍廢', '出門運動', '找朋友聚會'],
    },
    {
      question: '（範本）小時候的夢想是什麼？',
      answer: '測試用題目',
      category: '成長回憶',
      options: ['當老師', '當醫生', '當太空人', '沒認真想過'],
    },
  ],
  'mock-file-b': [
    {
      question: '（範本）最近一次感動落淚是什麼時候？',
      answer: '測試用題目，敏感分類的範例',
      category: '敏感題',
      options: ['看電影或劇的時候', '想到家人的時候', '不記得了'],
    },
    {
      // Same text as one in mock-file-a — exercises the duplicate-across-files path.
      question: '（範本）最喜歡的旅行地點是哪裡？',
      answer: '跟另一個檔案重複的題目，用來測試合併去重',
      category: '生活習慣',
      options: ['山上', '海邊', '大城市', '國外隨便走'],
    },
  ],
};

const requireApiKey = () => {
  if (!DRIVE_API_KEY) {
    throw new Error('尚未設定 Google API 金鑰（VITE_GOOGLE_API_KEY），無法從雲端讀取');
  }
};

/**
 * Pulls the file id out of the various forms a Drive file link takes, or
 * accepts a bare id typed directly.
 *
 *   https://drive.google.com/file/d/FILE_ID/view?usp=sharing
 *   https://drive.google.com/open?id=FILE_ID
 *   https://drive.google.com/uc?id=FILE_ID&export=download
 *   FILE_ID
 */
export const extractDriveFileId = (input: string): string | null => {
  const trimmed = input.trim();
  if (!trimmed) return null;

  const patterns = [/\/d\/([a-zA-Z0-9_-]+)/, /[?&]id=([a-zA-Z0-9_-]+)/];
  for (const pattern of patterns) {
    const match = trimmed.match(pattern);
    if (match) return match[1];
  }

  // A bare id has no slashes, spaces or "://" — anything else was a link we
  // failed to parse, and treating it as an id would just produce a 404.
  if (/^[a-zA-Z0-9_-]{10,}$/.test(trimmed)) return trimmed;
  return null;
};

export type DriveTarget = { type: 'file'; id: string } | { type: 'folder'; id: string };

/**
 * A pasted link can point at either a single file or a whole folder —
 * `.../folders/FOLDER_ID` is checked first since a folder id would otherwise
 * also satisfy the bare-file-id fallback in extractDriveFileId.
 */
export const resolveDriveInput = (input: string): DriveTarget | null => {
  const trimmed = input.trim();
  if (!trimmed) return null;

  const folderMatch = trimmed.match(/\/folders\/([a-zA-Z0-9_-]+)/);
  if (folderMatch) return { type: 'folder', id: folderMatch[1] };

  const fileId = extractDriveFileId(trimmed);
  return fileId ? { type: 'file', id: fileId } : null;
};

export interface DriveFileEntry {
  id: string;
  name: string;
  mimeType: string;
}

/** Thrown when Drive is telling us to back off, not a permission or not-found problem. */
class DriveQuotaError extends Error {}

/**
 * Google reports rate/quota limits as 503 or 429, but also — confusingly —
 * as a plain 403 with one of these `reason` codes in the body. A 403 with any
 * other reason (or none at all, which is what a CORS-blocked response looks
 * like) is a real permission problem instead.
 */
const QUOTA_REASONS = new Set(['rateLimitExceeded', 'userRateLimitExceeded', 'dailyLimitExceeded', 'quotaExceeded']);

const handleDriveError = async (res: Response, notFoundMsg: string, forbiddenMsg: string): Promise<void> => {
  if (res.status === 404) throw new Error(notFoundMsg);
  if (res.status === 503 || res.status === 429) {
    throw new DriveQuotaError('Google Drive API 用量已達上限，請稍後再試');
  }
  if (res.status === 403) {
    const reason = await res
      .clone()
      .json()
      .then((body) => body?.error?.errors?.[0]?.reason as string | undefined)
      .catch(() => undefined);
    if (reason && QUOTA_REASONS.has(reason)) {
      throw new DriveQuotaError('Google Drive API 用量已達上限，請稍後再試');
    }
    throw new Error(forbiddenMsg);
  }
  if (!res.ok) throw new Error(`讀取失敗（HTTP ${res.status}）`);
};

/** The most Drive allows per page — a folder of a few hundred files is still a single request. */
const LIST_PAGE_SIZE = 1000;
/** Backstop against a runaway loop, not a limit anyone should meet. */
const LIST_MAX_PAGES = 20;

/**
 * Lists the files directly inside a publicly-shared folder (subfolders are
 * dropped — picking a question set one level deep is enough, and recursing
 * would make the picker unpredictable).
 *
 * Follows every page. The picker sorts on the client, so a listing cut off at
 * the first page would not just be incomplete, it would sort a random slice
 * and make older files look like they had vanished.
 */
export const listDriveFolderFiles = async (folderId: string): Promise<DriveFileEntry[]> => {
  if (IS_MOCK_DRIVE) {
    await sleep(150);
    return MOCK_FILES;
  }
  requireApiKey();

  const q = encodeURIComponent(`'${folderId}' in parents and trashed = false`);
  const baseUrl =
    `https://www.googleapis.com/drive/v3/files?q=${q}` +
    `&fields=nextPageToken,files(id,name,mimeType)&pageSize=${LIST_PAGE_SIZE}&key=${DRIVE_API_KEY}`;

  const files: DriveFileEntry[] = [];
  let pageToken: string | undefined;

  for (let page = 0; page < LIST_MAX_PAGES; page++) {
    let res: Response;
    try {
      res = await fetch(pageToken ? `${baseUrl}&pageToken=${encodeURIComponent(pageToken)}` : baseUrl);
    } catch {
      throw new Error('連線失敗，請檢查網路連線');
    }
    await handleDriveError(res, '找不到這個資料夾，請確認連結正確', '沒有權限讀取，請確認資料夾的共用設定是「知道連結的人皆可查看」');

    const data = await res.json();
    files.push(...((data.files || []) as DriveFileEntry[]));

    pageToken = data.nextPageToken;
    if (!pageToken) {
      return files.filter((f) => f.mimeType !== 'application/vnd.google-apps.folder');
    }
  }

  throw new Error('資料夾裡的檔案太多，無法完整列出');
};

/** Label for a file with no type in its name, so it still reads as a group of its own. */
export const UNTYPED_LABEL = '一般';
/** Label for the group of names that do not follow the naming convention. */
export const UNPARSED_LABEL = '其他';

export interface DriveFileGroup {
  /** Stable key for React and for comparing groups — lowercased, so "Claude" and "claude" are one group. */
  key: string;
  label: string;
  files: DriveFileEntry[];
}

interface ParsedFileName {
  ai: string;
  /** Empty when the name carries no type. */
  type: string;
  /** yyyymmdd, kept as text — it sorts correctly as text and never needs to be a Date. */
  date: string;
  seq: number;
}

/*
 * AI_[type_]questions_yyyymmdd_seq[_count][_].json
 *
 * `questions` is the anchor: what comes before it is the AI name plus an
 * optional type (which may itself contain underscores), what comes after is
 * the date and running number. The trailing count is matched but ignored — it
 * is whatever number of questions the file happens to hold, not always 50.
 */
const FILE_NAME_PATTERN = /^(.+?)_questions_(\d{8})_(\d+)(?:_\d+)?$/i;

const parseDriveFileName = (name: string): ParsedFileName | null => {
  const stem = name.replace(/\.json$/i, '').replace(/_+$/, '');
  const match = FILE_NAME_PATTERN.exec(stem);
  if (!match) return null;

  const [ai, ...typeParts] = match[1].split('_');
  if (!ai) return null;
  return { ai, type: typeParts.join('_'), date: match[2], seq: Number(match[3]) };
};

const compareText = (a: string, b: string): number => a.localeCompare(b, undefined, { sensitivity: 'base' });

/**
 * Sorts a folder listing by AI, then type, then newest first, and gathers it
 * into groups for the picker.
 *
 * A file with no type sorts ahead of the typed ones of the same AI. Names that
 * do not fit the convention are never dropped or guessed at — they collect in
 * one trailing group, ordered by name.
 */
export const groupAndSortDriveFiles = (files: DriveFileEntry[]): DriveFileGroup[] => {
  const parsed: { file: DriveFileEntry; info: ParsedFileName }[] = [];
  const unparsed: DriveFileEntry[] = [];

  for (const file of files) {
    const info = parseDriveFileName(file.name);
    if (info) parsed.push({ file, info });
    else unparsed.push(file);
  }

  // An empty type compares lower than any real one, which is what puts the untyped files first.
  parsed.sort(
    (a, b) =>
      compareText(a.info.ai, b.info.ai) ||
      compareText(a.info.type, b.info.type) ||
      b.info.date.localeCompare(a.info.date) ||
      b.info.seq - a.info.seq ||
      compareText(a.file.name, b.file.name)
  );

  const groups: DriveFileGroup[] = [];
  for (const { file, info } of parsed) {
    const key = `${info.ai.toLowerCase()}\u0000${info.type.toLowerCase()}`;
    const last = groups[groups.length - 1];
    if (last && last.key === key) {
      last.files.push(file);
    } else {
      groups.push({ key, label: `${info.ai} · ${info.type || UNTYPED_LABEL}`, files: [file] });
    }
  }

  if (unparsed.length > 0) {
    unparsed.sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: 'base' }));
    groups.push({ key: '\u0000unparsed', label: UNPARSED_LABEL, files: unparsed });
  }

  return groups;
};

/**
 * Downloads a publicly-shared Drive file's raw text via the Drive API.
 *
 * Deliberately not OAuth: the file only needs to be shared "anyone with the
 * link", and a project-level API key (restricted to the Drive API, see
 * VITE_GOOGLE_API_KEY in SETUP.md) is enough to read it — nobody has to sign
 * into a Google account to import questions.
 */
export const fetchGoogleDriveFileTextById = async (fileId: string): Promise<string> => {
  if (IS_MOCK_DRIVE) {
    await sleep(150 + Math.random() * 200);
    // An id outside the fixture set (e.g. a single-file link pasted while
    // mocking) still gets something back rather than a confusing 404.
    return JSON.stringify(MOCK_FILE_CONTENTS[fileId] || MOCK_FILE_CONTENTS['mock-file-a']);
  }
  requireApiKey();

  const url = `https://www.googleapis.com/drive/v3/files/${fileId}?alt=media&key=${DRIVE_API_KEY}`;
  let res: Response;
  try {
    res = await fetch(url);
  } catch {
    throw new Error('連線失敗，請檢查網路連線');
  }
  await handleDriveError(res, '找不到這個檔案，請確認連結正確', '沒有權限讀取，請確認檔案的共用設定是「知道連結的人皆可查看」');

  return res.text();
};

/** Same as fetchGoogleDriveFileTextById, but accepts a raw link/id and resolves it first. */
export const fetchGoogleDriveFileText = async (linkOrId: string): Promise<string> => {
  const fileId = extractDriveFileId(linkOrId);
  if (!fileId) {
    throw new Error('看不出這是 Google Drive 的檔案連結或 ID');
  }
  return fetchGoogleDriveFileTextById(fileId);
};

export const isJsonDriveFile = (file: DriveFileEntry): boolean =>
  file.mimeType === 'application/json' || /\.json$/i.test(file.name);

export interface FolderImportResult {
  /** Every question object pulled out of every file that parsed as a JSON array. */
  items: unknown[];
  /** File names read successfully. */
  loadedFiles: string[];
  /** File names that were JSON but failed to parse, didn't hold an array, or were never attempted. */
  failedFiles: string[];
  /** True when the run gave up early because Drive kept answering with 503/429. */
  quotaExceeded?: boolean;
}

export interface FolderFetchProgress {
  /** Files that have finished — successfully or not — including the one just settled. */
  completed: number;
  total: number;
}

/**
 * Firing every file in a folder at once trips Drive's anonymous-request rate
 * limit for a handful of them — the folder listing and most files succeed, but
 * a few come back 403 with no CORS header (the browser can't tell that apart
 * from a permission error). Retrying with a short backoff rides out that kind
 * of throttling, since it is transient.
 *
 * A quota error is different: it will not clear up in the time a couple of
 * short retries take, so one is thrown straight through — the folder-level
 * circuit breaker below is what actually responds to it.
 */
const fetchWithRetry = async (fileId: string, attempts = 3, baseDelayMs = 400): Promise<string> => {
  let lastErr: unknown;
  for (let attempt = 0; attempt < attempts; attempt++) {
    if (attempt > 0) await sleep(baseDelayMs * attempt);
    try {
      return await fetchGoogleDriveFileTextById(fileId);
    } catch (err) {
      lastErr = err;
      if (err instanceof DriveQuotaError) throw err;
    }
  }
  throw lastErr;
};

/** How many files to have in flight at once — keeps bursts small enough to avoid the rate limit above. */
const DRIVE_FETCH_CONCURRENCY = 4;

/**
 * How many quota errors in a row give up on the rest of the folder.
 *
 * Without this, a genuinely exhausted quota meant every file in a large
 * folder ground through its own failed attempt before the whole thing
 * reported nothing read — tens of seconds of a spinner for a result the
 * first few failures already told us was coming.
 */
const QUOTA_BAIL_STREAK = 3;

/**
 * Reads the given `.json` files (as listed by `listDriveFolderFiles`) and
 * concatenates whatever arrays they contain into one list — the import modal
 * lists a folder's files first, then calls this with whichever ones the user
 * checked.
 *
 * `onProgress` fires once per file as its own attempt (retries included)
 * settles — not once per batch — so a slow file doesn't hold up the count for
 * the three others already done alongside it.
 */
export const fetchDriveFiles = async (
  files: DriveFileEntry[],
  onProgress?: (progress: FolderFetchProgress) => void
): Promise<FolderImportResult> => {
  const total = files.length;
  onProgress?.({ completed: 0, total });

  const items: unknown[] = [];
  const loadedFiles: string[] = [];
  const failedFiles: string[] = [];
  let quotaFailureStreak = 0;
  let quotaExceeded = false;
  let completed = 0;

  for (let i = 0; i < files.length && !quotaExceeded; i += DRIVE_FETCH_CONCURRENCY) {
    const batch = files.slice(i, i + DRIVE_FETCH_CONCURRENCY);
    const results = await Promise.all(
      batch.map(async (file) => {
        try {
          return { file, text: await fetchWithRetry(file.id) };
        } catch (err) {
          return { file, err };
        } finally {
          completed++;
          onProgress?.({ completed, total });
        }
      })
    );

    for (const result of results) {
      if ('text' in result) {
        quotaFailureStreak = 0;
        try {
          const parsed = JSON.parse(result.text);
          if (Array.isArray(parsed)) {
            items.push(...parsed);
            loadedFiles.push(result.file.name);
          } else {
            failedFiles.push(result.file.name);
          }
        } catch {
          failedFiles.push(result.file.name);
        }
        continue;
      }

      failedFiles.push(result.file.name);
      if (result.err instanceof DriveQuotaError) {
        quotaFailureStreak++;
        if (quotaFailureStreak >= QUOTA_BAIL_STREAK) quotaExceeded = true;
      } else {
        quotaFailureStreak = 0;
      }
    }
  }

  if (quotaExceeded) {
    const attempted = new Set([...loadedFiles, ...failedFiles]);
    files.forEach((f) => {
      if (!attempted.has(f.name)) failedFiles.push(f.name);
    });
  }

  return { items, loadedFiles, failedFiles, quotaExceeded };
};
