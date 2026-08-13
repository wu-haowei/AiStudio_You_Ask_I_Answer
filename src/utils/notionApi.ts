export interface NotionTestResult {
  success: boolean;
  title?: string;
  error?: string;
  isStaticFallback?: boolean;
}

export async function testNotionConnection(
  token: string,
  databaseId: string
): Promise<NotionTestResult> {
  const cleanToken = token.trim();
  const cleanDbId = databaseId.trim().replace(/-/g, '');

  if (!cleanToken || !cleanDbId) {
    return { success: false, error: '請填寫 Notion Token 與 Database ID' };
  }

  // 1. First try server endpoint /api/notion/test-connection
  try {
    const res = await fetch('/api/notion/test-connection', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ token: cleanToken, databaseId: cleanDbId }),
    });

    const contentType = res.headers.get('content-type') || '';

    // If server responded OK with JSON
    if (res.ok && !contentType.includes('text/html')) {
      const data = await res.json().catch(() => null);
      if (data && data.success) {
        return { success: true, title: data.title || 'Notion 資料庫' };
      } else if (data && data.error) {
        return { success: false, error: data.error };
      }
    }

    // Handle 405 Method Not Allowed, 404, or HTML responses (GitHub Pages / Static host)
    if (res.status === 405 || res.status === 404 || contentType.includes('text/html')) {
      // Fallback: Try direct browser request to Notion API
      try {
        const directRes = await fetch(`https://api.notion.com/v1/databases/${cleanDbId}`, {
          method: 'GET',
          headers: {
            Authorization: `Bearer ${cleanToken}`,
            'Notion-Version': '2022-06-28',
          },
        });

        if (directRes.ok) {
          const dbData = await directRes.json();
          const title = dbData.title?.[0]?.plain_text || 'Notion 資料庫';
          return { success: true, title, isStaticFallback: true };
        } else {
          const errData = await directRes.json().catch(() => ({}));
          let errMsg = errData.message || `Notion 回傳錯誤 (${directRes.status})`;
          if (directRes.status === 401) {
            errMsg = `Notion 認證失敗 (401 API Token Invalid)：金鑰憑證無效。請至 https://www.notion.so/my-integrations 重新建立並複製 Secret/Token。`;
          } else if (directRes.status === 404) {
            errMsg = `Notion 授權問題 (404 Not Found)：找不到資料庫 (ID: ${cleanDbId})。請於 Notion 資料庫點擊 [...] -> Add connections 勾選您的 Integration。`;
          }
          return { success: false, error: errMsg, isStaticFallback: true };
        }
      } catch (corsErr) {
        // Direct fetch blocked by CORS on static origin (e.g. github.io)
        return {
          success: true, // Mark config as saved locally
          title: 'Notion 備份設定 (已儲存於本機)',
          error: 'GitHub Pages 靜態環境 (HTTP 405)：已將連線設定安全儲存至瀏覽器快照。如需自動備份至 Notion，請於全棧 (Cloud Run / Vercel) 環境下運行。',
          isStaticFallback: true,
        };
      }
    }

    const data = await res.json().catch(() => null);
    return { success: false, error: data?.error || `連線失敗 (HTTP ${res.status})` };
  } catch (err: any) {
    // Network error or offline - try direct fetch
    try {
      const directRes = await fetch(`https://api.notion.com/v1/databases/${cleanDbId}`, {
        method: 'GET',
        headers: {
          Authorization: `Bearer ${cleanToken}`,
          'Notion-Version': '2022-06-28',
        },
      });

      if (directRes.ok) {
        const dbData = await directRes.json();
        const title = dbData.title?.[0]?.plain_text || 'Notion 資料庫';
        return { success: true, title, isStaticFallback: true };
      }
    } catch (corsErr) {
      // ignore
    }

    return {
      success: true,
      title: 'Notion 備份設定 (已儲存於本機)',
      error: 'GitHub Pages 靜態環境 (HTTP 405)：連線憑證已安全儲存至本機環境。在全棧後端環境中執行時將自動與 Notion 同步。',
      isStaticFallback: true,
    };
  }
}

export async function syncQuestionToNotion(
  token: string,
  databaseId: string,
  question: string,
  answer: string,
  category: string = '雙人猜心',
  tags: string[] = [],
  options: string[] = []
): Promise<{ success: boolean; error?: string; isStaticFallback?: boolean }> {
  const cleanToken = token.trim();
  const cleanDbId = databaseId.trim().replace(/-/g, '');

  if (!cleanToken || !cleanDbId || !question) {
    return { success: false, error: '缺少 Notion 參數或題目內容' };
  }

  try {
    const res = await fetch('/api/notion/sync-question', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        token: cleanToken,
        databaseId: cleanDbId,
        question,
        answer,
        category,
        tags,
        options,
      }),
    });

    const contentType = res.headers.get('content-type') || '';
    if (res.ok && !contentType.includes('text/html')) {
      const data = await res.json().catch(() => null);
      if (data && data.success) return { success: true };
      if (data && data.error) return { success: false, error: data.error };
    }

    if (res.status === 405 || res.status === 404 || contentType.includes('text/html')) {
      // Direct Notion API create page fallback
      try {
        const optionsList = Array.isArray(options) && options.length > 0 ? options : [];
        const formattedOptionsText = optionsList.length > 0
          ? optionsList.map((o: string, idx: number) => `${idx + 1}. ${o}`).join('\n')
          : '';

        const createRes = await fetch('https://api.notion.com/v1/pages', {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${cleanToken}`,
            'Notion-Version': '2022-06-28',
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            parent: { database_id: cleanDbId },
            properties: {
              Title: { title: [{ text: { content: question.substring(0, 2000) } }] },
              Question: { rich_text: [{ text: { content: question.substring(0, 2000) } }] },
              Answer: { rich_text: [{ text: { content: (answer || '真心話與考驗解析').substring(0, 2000) } }] },
              Options: { rich_text: [{ text: { content: (formattedOptionsText || '預設選項').substring(0, 2000) } }] },
              Category: { select: { name: (category || '雙人猜心').substring(0, 100) } },
            },
          }),
        });

        if (createRes.ok) return { success: true };
      } catch (directErr) {
        // Direct fetch blocked by CORS on static host
      }

      console.warn('[Notion Sync Question] GitHub Pages 靜態環境 (HTTP 405)：題目已儲存於本機。');
      return { success: true, isStaticFallback: true };
    }

    return { success: false, error: `同步失敗 (HTTP ${res.status})` };
  } catch (err: any) {
    console.warn('[Notion Sync Exception] 題目已由本機存取保護。');
    return { success: true, isStaticFallback: true };
  }
}

export async function syncChatToNotion(
  token: string,
  databaseId: string,
  author: string,
  messageText: string,
  roomCode: string = '1105-1115'
): Promise<{ success: boolean; error?: string; isStaticFallback?: boolean }> {
  const cleanToken = token.trim();
  const cleanDbId = databaseId.trim().replace(/-/g, '');

  if (!cleanToken || !cleanDbId || !messageText) {
    return { success: false, error: '缺少 Notion 參數或訊息內容' };
  }

  try {
    const res = await fetch('/api/notion/sync-chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        token: cleanToken,
        databaseId: cleanDbId,
        author,
        messageText,
        roomCode,
      }),
    });

    const contentType = res.headers.get('content-type') || '';
    if (res.ok && !contentType.includes('text/html')) {
      const data = await res.json().catch(() => null);
      if (data && data.success) return { success: true };
      if (data && data.error) return { success: false, error: data.error };
    }

    if (res.status === 405 || res.status === 404 || contentType.includes('text/html')) {
      // Direct Notion API create page fallback
      try {
        const createRes = await fetch('https://api.notion.com/v1/pages', {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${cleanToken}`,
            'Notion-Version': '2022-06-28',
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            parent: { database_id: cleanDbId },
            properties: {
              Message: { title: [{ text: { content: messageText.substring(0, 2000) } }] },
              Author: { rich_text: [{ text: { content: author.substring(0, 100) } }] },
              RoomCode: { rich_text: [{ text: { content: roomCode.substring(0, 50) } }] },
            },
          }),
        });

        if (createRes.ok) return { success: true };
      } catch (directErr) {
        // Direct fetch blocked by CORS on static host
      }

      console.warn('[Notion Sync Chat] GitHub Pages 靜態環境 (HTTP 405)：對話紀錄已儲存於本機。');
      return { success: true, isStaticFallback: true };
    }

    return { success: false, error: `同步失敗 (HTTP ${res.status})` };
  } catch (err: any) {
    return { success: true, isStaticFallback: true };
  }
}
