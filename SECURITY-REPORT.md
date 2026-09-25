# 資安修補報告（`security/fixes` 分支）

對應「Firebase 與網站弱點測試報告」（2026-09-25）。以下分成：已解決、部分解決、未處理，以及驗證結果與上線順序。

## 一、總表

| 編號 | 問題 | 處理結果 |
| --- | --- | --- |
| F01 | 未登入可批次列舉 `users`，且救援 Email 公開在裡面 | **已解決** |
| F02 | 共享預設密碼 `0101`、單次 SHA-256 | **部分解決**（見下） |
| F03 | 存取設定遺失時 Fail Open | **依決定維持現狀，未修改** |
| F04 | 匿名 Auth 可由站外自動建立 | **部分解決**（App Check 已內建、待你在 Console 啟用） |
| F05 | 缺少瀏覽器安全標頭 | **部分解決**（能用 meta 做的已做） |
| F06 | Drive API key 來源限制 | 報告結論為「限制有效」，無需處理 |
| 額外 | `userPrefs` 任何登入者都能讀別人的 | **已解決** |
| 額外 | 舊頂層 `faqs`／`categories`、`MAIN-ROOM`、`presence` 對任何登入者開放 | **未處理**（見「未處理」） |

## 二、已解決

### F01　`users` 列舉與 Email 外洩

- 規則：`users` 只允許**單筆查詢**（登入畫面判斷名字有沒有人用需要），**禁止 list**。未登入與已登入的陌生人都無法列出整個集合，也無法用 `where('email', …)` 搜尋。
- 資料：救援 Email 不再存在公開的 `users`，改放新集合 `accountPrivate/{姓名}`，規則只讓本人讀寫。`users` 只留 `hasRecoveryEmail`（有／沒有）。
- 舊資料：舊帳號下次登入時，程式會自動把公開的 `email` 搬到 `accountPrivate`，並從 `users` 移除。
- Email 重複檢查：原本靠 `users` 的 `where` 查詢，現在改成讀單一的 `emails/{地址}`：沒人用或是自己的就通過，是別人的規則直接拒絕，畫面顯示「已被使用」，但**不會透露是誰的**。
- 忘記密碼：因為 Email 不再公開，不能再「輸入姓名就寄信」，改成輸入救援 Email 後寄出連結；畫面一律回答「已寄出」，不會透露這個地址有沒有對應帳號。
- `userPrefs` 也改成只有本人能讀。

### F02　密碼機制（短期修補）

- **移除共用預設密碼**：新名字第一次進來會出現「設定你自己的密碼」畫面，要輸入兩次，至少 8 個字元，且不能是 `0101`。
- **改用加鹽 + PBKDF2**：新帳號與改過密碼的帳號，改用 PBKDF2-SHA-256、210,000 輪，每個帳號有隨機 salt（存在公開的 `users`，salt 本來就不是祕密）。
- **舊帳號自動升級**：舊帳號用原本的密碼登入成功後，程式會用原子批次把密碼與 salt 一起換掉（兩者一起成功或一起失敗，不會鎖死帳號）。
- **重設密碼**：忘記密碼重設後也會換新 salt，規則加了「剛通過 Email 驗證的人可以寫自己那個帳號的 salt」這一條。
- **停在舊預設密碼的舊帳號**：登入後仍強制改密碼，新密碼一樣至少 8 個字元。

## 三、部分解決

### F02　仍未解決的部分

- 密碼比對仍在 Firestore 規則裡，而且沒有後端可以**限制猜測次數或鎖定帳號**。密碼長度要求與 PBKDF2 只是提高每次猜測與離線破解的成本，擋不住線上一直猜。
- **還停在舊預設密碼 `0101` 的舊帳號仍然可被任何人登入**，程式碼無法代替本人換掉。請到 Console 檢查 `mustChangePassword: true` 的帳號（見 SETUP.md 〈資安加固〉）。
- 真正的解法是換成 Firebase Authentication 帳號密碼或後端驗證，屬於大工程，這次未動。

### F04　App Check

- 程式碼已經內建（`firebase.ts`），並在 CI 加了 `VITE_APPCHECK_SITE_KEY` 變數；**沒有金鑰時完全不動作**，模擬器不受影響。
- **需要你在 Console 完成**：建立 reCAPTCHA v3 金鑰、填入 GitHub 變數，觀察指標一兩天後，再對 Firestore 按「強制執行」。步驟見 SETUP.md。
- 匿名登入（Authentication）的 App Check 強制需要升級 Identity Platform，這次不建議做；改用預算警示與匿名帳號數量監控。
- 在你啟用之前，這一項**實際上沒有防護效果**。

### F05　安全標頭

- 已做：`Content-Security-Policy`（meta，只在正式 build）、`Referrer-Policy: strict-origin-when-cross-origin`、`public/frame-guard.js`（被別人用 iframe 包起來時把頁面藏起來並嘗試跳出）。
- 未能做：`frame-ancestors`、`X-Frame-Options`、`X-Content-Type-Options: nosniff`、`Permissions-Policy`、COOP／CORP。這些只能是真正的回應標頭，GitHub Pages 不能設。
- 框架防護是盡力而為：框住的一方可以用 `sandbox` 讓腳本不執行。真正的做法是搬到能設標頭的主機（例如 Firebase Hosting）。

## 四、未處理

| 項目 | 原因 |
| --- | --- |
| **F03**　設定缺失時預設拒絕 | 你決定維持現狀。目前 `config/access` 不存在等於開放註冊。 |
| 舊頂層 `faqs`／`categories`（共用預設題庫）任何登入者可寫、可刪 | 「編輯預設題庫」功能依賴它。要收緊需要先設計「誰是管理者」（例如在 `config` 放管理者名單），是功能設計，不是單純改規則。 |
| `MAIN-ROOM` 舊共用房間對任何登入者開放 | 給「搬移舊資料」按鈕用。等大家都搬完就可以拿掉這個例外。 |
| `presence` 任何登入者都能看到所有上線名字 | 「邀請對方」功能需要。 |
| 線上猜密碼的次數限制 | 沒有後端就做不到。 |
| 改用 Firebase Authentication | 大工程，另案評估。 |
| 搬到能設回應標頭的主機 | 會換網址，授權網域與 Email 連結都要跟著改，另案評估。 |
| 已經外洩的 Email | 已被公開讀取過的無法收回。 |

## 五、驗證結果

- **Firestore 規則測試**：71 項全過（原本 50 項＋新增 21 項），新增涵蓋：未登入無法 list `users`、加 `limit` 也不行、陌生人無法用 Email 搜尋、他人無法讀寫 `accountPrivate`、Email 重複查詢（自己的／沒人用的／別人的／未登入）、重設密碼只能寫自己帳號的 salt、`userPrefs` 隔離。
- **模擬器實機測試**（獨立的測試專案，不動你原本的模擬器資料）：
  - 新帳號註冊：8 字元限制與 `0101` 被擋下、成功後 `secrets` 為 `v2:` 開頭、`users` 有 salt。
  - 登入：對的密碼成功、錯的被拒。
  - 舊帳號（單次 SHA-256）登入：自動升級成 v2，公開的 Email 搬到 `accountPrivate` 並從 `users` 移除。
  - 停在 `0101` 的舊帳號：登入後被要求改密碼，7 字元被擋、通過後升級。
  - 設定救援 Email → 點確認連結 → 重新登入：Email 只出現在 `accountPrivate`，`users` 沒有。
  - 忘記密碼（輸入 Email）→ 點連結 → 設定新密碼：成功，salt 換新。
  - 重複 Email（含大小寫不同）：被擋下。
  - 已有 Email 的帳號改 Email：目前 Email 正確顯示、確認信寄到**舊**信箱。
- **CSP**：用模擬器版的 build 跑註冊與登入，沒有任何違規；頁面被 iframe 包住時，防護腳本確實會跳出。
- **`tsc --noEmit`** 與 `npm run build:pages` 通過。

**未驗證**：真實 reCAPTCHA／App Check（沒有金鑰）、Google Drive 匯入在 CSP 下的實際請求（規則上已允許 `*.googleapis.com`）、真正的 Google 寄信。

## 六、上線順序與風險

1. **先發布 Firestore 規則**（`firestore.rules` 全文）。對舊版網站相容。
2. **再合併 `security/fixes` 到 `main`**，由 GitHub Actions 自動部署。
3. 合併後，到 Console 檢查 `mustChangePassword: true` 的帳號。
4. 依 SETUP.md 設定 App Check，觀察後再強制。

若把順序顛倒，新版網站的 Email 重複檢查會被舊規則拒絕，任何地址都會顯示「已被使用」，直到規則更新為止。

**要知道的行為改變**

- 忘記密碼要輸入 Email，不再是輸入姓名就寄信。
- 登入畫面不再顯示預設密碼提示，新名字要自己設密碼（至少 8 個字元）。
- 改過的密碼與舊帳號升級後，**只能用新版網站登入**；舊版網站（尚未更新的快取）因為不認得 salt，會顯示「密碼不正確」。整個轉換期間請提醒使用者重新整理。
- 若之後加了新的外部服務而網站壞掉，第一個要看的是 `vite.config.ts` 的 CSP。
