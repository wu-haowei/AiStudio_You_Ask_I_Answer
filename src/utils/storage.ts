/**
 * Local-device housekeeping only.
 *
 * All shared content — the question library, rooms and chat history — lives in
 * Firebase Firestore (see src/lib/firebase.ts). This module just tracks which
 * cache version this browser last ran, so stale keys from older builds can be
 * cleared on upgrade.
 */

export const CURRENT_APP_VERSION = '3.1.0';
export const APP_VERSION_KEY = 'milktea_qa_app_version';

/** Keys written by pre-Firebase builds; removed on upgrade. */
const LEGACY_KEYS = [
  'milktea_qa_faqs_v1',
  'milktea_qa_categories_v1',
  'milktea_qa_user_questions_v1',
  'milktea_qa_notion_config_v1',
  'coplay_rooms_static_v1',
  'coplay_session_passcode',
  'milktea_qa_voted_faqs_v1',
  'milktea_coplay_passcode',
  'milktea_coplay_session_passcode',
];

/**
 * Compares the stored cache version with CURRENT_APP_VERSION. On a mismatch it
 * flushes sessionStorage, drops legacy keys (including every locally cached
 * room snapshot) and stamps the new version. Returns true if a migration ran.
 */
export function checkAndMigrateStorageVersion(): boolean {
  try {
    const storedVersion = localStorage.getItem(APP_VERSION_KEY);
    if (storedVersion === CURRENT_APP_VERSION) return false;

    console.log(
      `[App Version Upgrade] Upgrading from "${storedVersion || 'legacy'}" to "${CURRENT_APP_VERSION}"`
    );

    try {
      sessionStorage.clear();
    } catch (e) {
      console.warn('Failed to clear sessionStorage during version update:', e);
    }

    for (const key of LEGACY_KEYS) localStorage.removeItem(key);

    // Legacy per-room static snapshots (milktea_static_room_XXXX)
    for (const key of Object.keys(localStorage)) {
      if (key.startsWith('milktea_static_room_')) localStorage.removeItem(key);
    }

    localStorage.setItem(APP_VERSION_KEY, CURRENT_APP_VERSION);
    return true;
  } catch (err) {
    console.error('Failed to check and migrate storage version:', err);
    return false;
  }
}

/** Manual full purge for troubleshooting. Firestore content is untouched. */
export function clearAllStorageAndSession(): void {
  try {
    sessionStorage.clear();
    localStorage.clear();
    localStorage.setItem(APP_VERSION_KEY, CURRENT_APP_VERSION);
  } catch (err) {
    console.error('Failed to purge storage:', err);
  }
}

