import express from "express";
import path from "path";
import { GoogleGenAI, Type } from "@google/genai";

async function startServer() {
  const app = express();
  const PORT = 3000;

  app.use(express.json());

  // Initialize Gemini AI client lazily
  const getAi = () => {
    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) {
      throw new Error("GEMINI_API_KEY environment variable is missing.");
    }
    return new GoogleGenAI({
      apiKey,
      httpOptions: {
        headers: {
          "User-Agent": "aistudio-build",
        },
      },
    });
  };

  // Health check API
  app.get("/api/health", (req, res) => {
    res.json({ status: "ok", timestamp: new Date().toISOString() });
  });

  // AI Q&A Generator API
  app.post("/api/generate-qa", async (req, res) => {
    try {
      const { topic, category, count = 3 } = req.body;
      if (!topic) {
        return res.status(400).json({ error: "Topic is required" });
      }

      const ai = getAi();
      const prompt = `請根據主題「${topic}」與類別「${category || "一般常見問題"}」，自動生成 ${count} 個高品質的常見問題（Q&A）與詳細精確回答。
同時請為每個問題提供：
1. 繁體中文問題標題 (question)
2. 繁體中文詳細解答 (answer)
3. 類別名稱 (category)
4. 相關標籤 (tags, 2-4 個)
5. 互動小測驗選項 (options, 3-4 個選項，其中包含正確答案)
6. 正確選項索引 (correctOptionIndex, 0-based)
7. 測驗解析說明 (explanation)

請回傳嚴格的 JSON 陣列格式。`;

      const response = await ai.models.generateContent({
        model: "gemini-3.6-flash",
        contents: prompt,
        config: {
          responseMimeType: "application/json",
          responseSchema: {
            type: Type.ARRAY,
            items: {
              type: Type.OBJECT,
              properties: {
                question: { type: Type.STRING },
                answer: { type: Type.STRING },
                category: { type: Type.STRING },
                tags: {
                  type: Type.ARRAY,
                  items: { type: Type.STRING },
                },
                options: {
                  type: Type.ARRAY,
                  items: { type: Type.STRING },
                },
                correctOptionIndex: { type: Type.INTEGER },
                explanation: { type: Type.STRING },
              },
              required: ["question", "answer", "category", "tags"],
            },
          },
        },
      });

      const generatedData = JSON.parse(response.text || "[]");
      res.json({ success: true, items: generatedData });
    } catch (error: any) {
      console.error("AI QA Generation Error:", error);
      res.status(500).json({
        error: error.message || "Failed to generate Q&A using AI",
      });
    }
  });

  // AI Answer Polish API
  app.post("/api/polish-answer", async (req, res) => {
    try {
      const { question, answer, tone = "親切專業" } = req.body;
      if (!question || !answer) {
        return res.status(400).json({ error: "Question and Answer are required" });
      }

      const ai = getAi();
      const prompt = `你是一位專業親切的客服與問答專家。請將針對問題「${question}」的原始回答進行潤飾優化。
原始回答：
「${answer}」

要求：
1. 語氣設定：${tone}
2. 條理分明、條列式說明重點（如適用）
3. 保持繁體中文，親切流暢、易於閱讀
4. 直接回傳潤飾後的回答內文即可，不要加上額外開場白。`;

      const response = await ai.models.generateContent({
        model: "gemini-3.6-flash",
        contents: prompt,
      });

      res.json({ success: true, polishedAnswer: response.text?.trim() || answer });
    } catch (error: any) {
      console.error("AI Polish Answer Error:", error);
      res.status(500).json({
        error: error.message || "Failed to polish answer using AI",
      });
    }
  });

  // ==========================================
  // Notion Integration API Endpoints
  // ==========================================

  // Test Notion Database Connection
  app.post("/api/notion/test-connection", async (req, res) => {
    try {
      const { token, databaseId } = req.body;
      if (!token || !databaseId) {
        return res.status(400).json({ error: "Missing Notion Token or Database ID" });
      }

      const cleanDbId = databaseId.replace(/-/g, "");
      const notionRes = await fetch(`https://api.notion.com/v1/databases/${cleanDbId}`, {
        method: "GET",
        headers: {
          Authorization: `Bearer ${token}`,
          "Notion-Version": "2022-06-28",
        },
      });

      if (!notionRes.ok) {
        const errData = await notionRes.json().catch(() => ({}));
        let errMsg = errData.message || "無法連線至 Notion 資料庫，請檢查 Token 與權限設定。";
        if (notionRes.status === 401 || errMsg.toLowerCase().includes('token is invalid')) {
          errMsg = `Notion 認證失敗 (401 API Token Invalid)：金鑰憑證無效。請至 https://www.notion.so/my-integrations 重新建立並複製 Secret/Token (ntn_... 或 secret_...)。`;
        } else if (notionRes.status === 404 || errMsg.includes('Could not find database')) {
          errMsg = `Notion 授權問題 (404 Not Found)：找不到資料庫 (ID: ${cleanDbId})。請進入 Notion 資料庫頁面，點擊右上角 [...] -> Add connections (新增連結) 勾選您的 Integration 權限。`;
        }
        return res.status(notionRes.status).json({
          error: errMsg,
        });
      }

      const dbData = await notionRes.json();
      res.json({
        success: true,
        title: dbData.title?.[0]?.plain_text || "Notion 資料庫",
        properties: Object.keys(dbData.properties || {}),
      });
    } catch (error: any) {
      console.error("Notion Connection Test Error:", error);
      res.status(500).json({ error: error.message || "連線測試失敗" });
    }
  });

  // Sync Question / FAQ Item to Notion (Targeting Question DB: 3ba6e88209608047b0e3df6fe9b38c41)
  app.post("/api/notion/sync-question", async (req, res) => {
    try {
      const { token, databaseId, question, answer, category, tags = [], options = [] } = req.body;
      if (!token || !question) {
        return res.status(400).json({ error: "Missing required Notion parameters or question text." });
      }

      const reqDb = (databaseId && databaseId.trim()) || HARDCODED_NOTION_QUESTION_DB_ID;
      const targetDbId = (reqDb === HARDCODED_NOTION_ANSWER_DB_ID || reqDb.includes('2906e88209608305'))
        ? HARDCODED_NOTION_QUESTION_DB_ID
        : reqDb;

      const cleanDbId = targetDbId.replace(/-/g, "");

      // Format options into clean readable text
      const optionsList = Array.isArray(options) && options.length > 0 ? options : [];
      const formattedOptionsText = optionsList.length > 0
        ? optionsList.map((o: string, idx: number) => `${idx + 1}. ${o}`).join("\n")
        : "";

      // 1. Fetch Notion Database Schema dynamically to find matching column names
      let dbProperties: Record<string, any> = {};
      let titleKey = "Title";

      try {
        const schemaRes = await fetch(`https://api.notion.com/v1/databases/${cleanDbId}`, {
          headers: {
            Authorization: `Bearer ${token}`,
            "Notion-Version": "2022-06-28",
          },
        });
        if (schemaRes.ok) {
          const dbData = await schemaRes.json();
          dbProperties = dbData.properties || {};
          titleKey = Object.keys(dbProperties).find((k) => dbProperties[k].type === "title") || "Title";
        }
      } catch (e) {
        console.warn("Could not fetch Notion Question schema, fallback to defaults:", e);
      }

      const properties: Record<string, any> = {};

      // Title Property
      properties[titleKey] = {
        title: [{ text: { content: question.substring(0, 2000) } }],
      };

      // Question Column
      const questionPropKey = Object.keys(dbProperties).find(
        (k) => (k.toLowerCase().includes("question") || k.includes("題目") || k.includes("問題")) && dbProperties[k].type === "rich_text"
      );
      if (questionPropKey && questionPropKey !== titleKey) {
        properties[questionPropKey] = {
          rich_text: [{ text: { content: question.substring(0, 2000) } }],
        };
      }

      // Options Column (Guarantees Options column is populated in Notion)
      const optionsPropKey = Object.keys(dbProperties).find(
        (k) => (k.toLowerCase().includes("option") || k.includes("選項") || k.includes("項目") || k.includes("選擇") || k.includes("題目選項")) && dbProperties[k].type === "rich_text"
      );
      if (optionsPropKey) {
        properties[optionsPropKey] = {
          rich_text: [{ text: { content: (formattedOptionsText || "預設選項 1-4").substring(0, 2000) } }],
        };
      }

      // Answer Column
      const answerPropKey = Object.keys(dbProperties).find(
        (k) => (k.toLowerCase().includes("answer") || k.includes("解答") || k.includes("答案") || k.includes("說明") || k.includes("內容")) && dbProperties[k].type === "rich_text"
      );
      if (answerPropKey) {
        const ansContent = formattedOptionsText
          ? `${answer || "對應真心話題目"}\n\n【可選選項】:\n${formattedOptionsText}`
          : (answer || "對應真心話題目");
        properties[answerPropKey] = {
          rich_text: [{ text: { content: ansContent.substring(0, 2000) } }],
        };
      }

      // Category Column
      const catPropKey = Object.keys(dbProperties).find(
        (k) => (k.toLowerCase().includes("category") || k.includes("分類") || k.includes("類別")) && dbProperties[k].type === "select"
      );
      if (catPropKey) {
        properties[catPropKey] = {
          select: { name: (category || "雙人猜心").substring(0, 100) },
        };
      }

      // Fallback defaults if no schema properties matched
      if (!optionsPropKey && !answerPropKey) {
        properties["Options"] = {
          rich_text: [{ text: { content: (formattedOptionsText || "無選項").substring(0, 2000) } }],
        };
        properties["Answer"] = {
          rich_text: [{ text: { content: `${answer || "對應真心話題目"}\n\n【選項】:\n${formattedOptionsText}`.substring(0, 2000) } }],
        };
        properties["Question"] = {
          rich_text: [{ text: { content: question.substring(0, 2000) } }],
        };
      }

      // Children Page Blocks (Detailed view inside Notion page)
      const childrenBlocks: any[] = [
        {
          object: "block",
          type: "callout",
          callout: {
            rich_text: [{ text: { content: `❓ 題目內容：${question}` } }],
            icon: { emoji: "❓" },
          },
        },
      ];

      if (optionsList.length > 0) {
        childrenBlocks.push({
          object: "block",
          type: "heading_3",
          heading_3: {
            rich_text: [{ text: { content: "📋 題目可選選項：" } }],
          },
        });
        optionsList.forEach((opt: string, idx: number) => {
          childrenBlocks.push({
            object: "block",
            type: "numbered_list_item",
            numbered_list_item: {
              rich_text: [{ text: { content: `${opt}` } }],
            },
          });
        });
      }

      if (answer) {
        childrenBlocks.push({
          object: "block",
          type: "paragraph",
          paragraph: {
            rich_text: [{ text: { content: `💡 解答/說明：\n${answer}` } }],
          },
        });
      }

      const notionRes = await fetch("https://api.notion.com/v1/pages", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
          "Notion-Version": "2022-06-28",
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          parent: { database_id: cleanDbId },
          properties,
          children: childrenBlocks,
        }),
      });

      if (!notionRes.ok) {
        // Fallback simplified page payload
        const fallbackPayload = {
          parent: { database_id: cleanDbId },
          properties: {
            [titleKey]: {
              title: [{ text: { content: `[${category || "猜心題目"}] ${question}`.substring(0, 2000) } }],
            },
          },
          children: childrenBlocks,
        };

        const retryRes = await fetch("https://api.notion.com/v1/pages", {
          method: "POST",
          headers: {
            Authorization: `Bearer ${token}`,
            "Notion-Version": "2022-06-28",
            "Content-Type": "application/json",
          },
          body: JSON.stringify(fallbackPayload),
        });

        if (!retryRes.ok) {
          const errBody = await retryRes.json().catch(() => ({}));
          return res.status(400).json({ error: errBody.message || "同步至 Notion 失敗" });
        }

        const retryData = await retryRes.json();
        return res.json({ success: true, url: retryData.url });
      }

      const notionData = await notionRes.json();
      res.json({ success: true, url: notionData.url });
    } catch (error: any) {
      console.error("Notion Sync Error:", error);
      res.status(500).json({ error: error.message || "同步至 Notion 失敗" });
    }
  });

  // Sync Answer / User Response to Notion (Targeting Answer DB: 3ba6e882096080c18233fb5e88b8354d)
  app.post("/api/notion/sync-answer", async (req, res) => {
    try {
      const { token, questionText, answerText, category, author } = req.body;
      if (!token) {
        return res.status(400).json({ error: "Missing required Notion token." });
      }

      const cleanDbId = HARDCODED_NOTION_ANSWER_DB_ID.replace(/-/g, "");

      let dbProperties: Record<string, any> = {};
      let titleKey = "Title";

      try {
        const schemaRes = await fetch(`https://api.notion.com/v1/databases/${cleanDbId}`, {
          headers: {
            Authorization: `Bearer ${token}`,
            "Notion-Version": "2022-06-28",
          },
        });
        if (schemaRes.ok) {
          const dbData = await schemaRes.json();
          dbProperties = dbData.properties || {};
          titleKey = Object.keys(dbProperties).find((k) => dbProperties[k].type === "title") || "Title";
        }
      } catch (e) {
        console.warn("Could not fetch Answer DB schema:", e);
      }

      const titleContent = `🎯 [回答問題紀錄] ${author || '玩家'} - ${questionText || '雙人真心話'}`;
      const properties: Record<string, any> = {};

      properties[titleKey] = {
        title: [{ text: { content: titleContent.substring(0, 2000) } }],
      };

      const questionPropKey = Object.keys(dbProperties).find(
        (k) => (k.toLowerCase().includes("question") || k.includes("題目")) && dbProperties[k].type === "rich_text"
      );
      if (questionPropKey && questionPropKey !== titleKey) {
        properties[questionPropKey] = {
          rich_text: [{ text: { content: (questionText || titleContent).substring(0, 2000) } }],
        };
      }

      const answerPropKey = Object.keys(dbProperties).find(
        (k) => (k.toLowerCase().includes("answer") || k.includes("回答") || k.includes("選擇") || k.includes("對話")) && dbProperties[k].type === "rich_text"
      );
      if (answerPropKey) {
        properties[answerPropKey] = {
          rich_text: [{ text: { content: (answerText || "無回答內容").substring(0, 2000) } }],
        };
      }

      const catPropKey = Object.keys(dbProperties).find(
        (k) => (k.toLowerCase().includes("category") || k.includes("分類")) && dbProperties[k].type === "select"
      );
      if (catPropKey) {
        properties[catPropKey] = {
          select: { name: (category || "雙人猜心").substring(0, 100) },
        };
      }

      const childrenBlocks = [
        {
          object: "block",
          type: "callout",
          callout: {
            rich_text: [{ text: { content: `🎯 回答內容/結論：\n${answerText || ''}` } }],
            icon: { emoji: "📝" },
          },
        },
      ];

      const notionRes = await fetch("https://api.notion.com/v1/pages", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
          "Notion-Version": "2022-06-28",
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          parent: { database_id: cleanDbId },
          properties,
          children: childrenBlocks,
        }),
      });

      if (!notionRes.ok) {
        const fallbackPayload = {
          parent: { database_id: cleanDbId },
          properties: {
            [titleKey]: {
              title: [{ text: { content: titleContent.substring(0, 2000) } }],
            },
          },
          children: childrenBlocks,
        };

        const retryRes = await fetch("https://api.notion.com/v1/pages", {
          method: "POST",
          headers: {
            Authorization: `Bearer ${token}`,
            "Notion-Version": "2022-06-28",
            "Content-Type": "application/json",
          },
          body: JSON.stringify(fallbackPayload),
        });

        if (!retryRes.ok) {
          const errData = await retryRes.json().catch(() => ({}));
          return res.status(400).json({ error: errData.message || "同步作答結果至 Notion 失敗" });
        }

        const retryData = await retryRes.json();
        return res.json({ success: true, url: retryData.url });
      }

      const data = await notionRes.json();
      res.json({ success: true, url: data.url });
    } catch (error: any) {
      console.error("Notion Sync Answer Error:", error);
      res.status(500).json({ error: error.message || "同步作答結果失敗" });
    }
  });

  // Sync Chat / Discussion to Notion
  app.post("/api/notion/sync-chat", async (req, res) => {
    try {
      const { token, databaseId, author, messageText, roomCode } = req.body;
      if (!token || !databaseId || !messageText) {
        return res.status(400).json({ error: "Missing required chat parameters" });
      }

      const cleanDbId = databaseId.replace(/-/g, "");
      const payload = {
        parent: { database_id: cleanDbId },
        properties: {
          title: {
            title: [{ text: { content: `[房間 ${roomCode || "連線"}] ${author || "成員"} 的互動對話` } }],
          },
        },
        children: [
          {
            object: "block",
            type: "callout",
            callout: {
              rich_text: [{ text: { content: `${author || "成員"} 說：${messageText}` } }],
              icon: { emoji: "💬" },
            },
          },
        ],
      };

      const notionRes = await fetch("https://api.notion.com/v1/pages", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
          "Notion-Version": "2022-06-28",
          "Content-Type": "application/json",
        },
        body: JSON.stringify(payload),
      });

      if (!notionRes.ok) {
        const errData = await notionRes.json().catch(() => ({}));
        return res.status(400).json({ error: errData.message || "同步對話至 Notion 失敗" });
      }

      const data = await notionRes.json();
      res.json({ success: true, url: data.url });
    } catch (error: any) {
      console.error("Notion Sync Chat Error:", error);
      res.status(500).json({ error: error.message || "同步對話失敗" });
    }
  });

  // ==========================================
  // Real-Time Multi-Device Co-Play Room Store
  // ==========================================
  interface CoPlayRoomStore {
    code: string;
    hostName: string;
    players: {
      id: string;
      name: string;
      score: number;
      isHost: boolean;
      lastActive: string;
      answeredCurrent?: boolean;
      lastSelectedOption?: number;
      lastGuessOption?: number;
    }[];
    questions: any[];
    activeGameQuestion?: any;
    gameInvitation?: any;
    messages: {
      id: string;
      author: string;
      text: string;
      timestamp: string;
      type?: string;
      questionData?: any;
      isSyncedToNotion?: boolean;
    }[];
    currentQuestionIndex: number;
    status: "lobby" | "playing" | "finished";
    createdAt: string;
    updatedAt: string;
  }

  const rooms = new Map<string, CoPlayRoomStore>();

  let idCounter = 0;
  const generateId = (prefix = "msg") => {
    idCounter = (idCounter + 1) % 1000000;
    return `${prefix}-${Date.now()}-${idCounter}-${Math.random().toString(36).substring(2, 7)}`;
  };

  const generateRoomCode = () => Math.random().toString(36).substring(2, 8).toUpperCase();

  const HARDCODED_NOTION_QUESTION_DB_ID = process.env.NOTION_QUESTION_DB_ID || process.env.VITE_NOTION_QUESTION_DB_ID || "3ba6e88209608047b0e3df6fe9b38c41";
  const HARDCODED_NOTION_ANSWER_DB_ID = process.env.NOTION_ANSWER_DB_ID || process.env.VITE_NOTION_ANSWER_DB_ID || "3ba6e882096080c18233fb5e88b8354d";
  const HARDCODED_NOTION_DB_ID = HARDCODED_NOTION_ANSWER_DB_ID;
  const HARDCODED_NOTION_TOKEN = process.env.NOTION_TOKEN || process.env.VITE_NOTION_TOKEN || "";

  // Helper: Get or Create Persistent Passcode Room (DUAL-1105-1115)
  const getOrCreatePasscodeRoom = (defaultQuestions: any[] = []) => {
    const roomCode = "DUAL-1105-1115";
    if (!rooms.has(roomCode)) {
      const initialRoom: CoPlayRoomStore = {
        code: roomCode,
        hostName: "1105",
        players: [
          {
            id: "p-1105",
            name: "1105",
            score: 20,
            isHost: true,
            lastActive: new Date(0).toISOString(),
          },
          {
            id: "p-1115",
            name: "1115",
            score: 10,
            isHost: false,
            lastActive: new Date(0).toISOString(),
          },
        ],
        questions: defaultQuestions.length > 0 ? defaultQuestions : [
          {
            id: 'faq-0',
            question: '喜愛的旅遊地點偏好是哪個？',
            answer: '考驗雙方的渡假生活偏好。',
            category: '習性與喜好',
            tags: ['Notion連線', '雙人對決'],
            options: ['在家躺平追劇看動漫', '約朋友出門踩點喝咖啡', '戶外運動踏青接觸大自然', '好好睡覺打電競打整天'],
          },
          {
            id: 'faq-1',
            question: '假日最喜歡的放鬆度過方式是什麼？',
            answer: '考驗對方的日常習性與放鬆偏好。',
            category: '習性與喜好',
            tags: ['假日習慣', '休閒'],
            options: ['在家躺平追劇看動漫', '約朋友出門踩點喝咖啡', '戶外運動踏青接觸大自然', '好好睡覺打電競打整天'],
          },
          {
            id: 'faq-4',
            question: '如果獲得一筆 100 萬元的意外之財，會優先怎麼處理？',
            answer: '反應金錢觀與當下人生最重視的事。',
            category: '人生規劃與經歷',
            tags: ['金錢觀', '人生規劃'],
            options: ['全部存起來/投入理財投資', '安排豪華出國旅遊玩一場', '買心儀已久的奢侈品/犒賞自己', '拿去孝親或請重要親友吃飯'],
          },
          {
            id: 'faq-6',
            question: '在感情中最無法忍受的另一半缺點是？',
            answer: '揭示感情地雷與價值觀。',
            category: '感情相關',
            tags: ['感情地雷', '相處之道'],
            options: ['經常已讀不回或突發消失', '脾氣暴躁動不動就發火', '價值觀不合/過度浪費或斤斤計較', '與異性朋友界線模糊不清'],
          },
        ],
        messages: [
          {
            id: 'msg-init-1',
            author: '系統提示',
            text: '歡迎進入【雙人猜心對話框】！\n您可在對話框中發起題目、作答或發送訊息對話，紀錄將即時寫入 Notion Database！',
            timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
            isSyncedToNotion: true,
          },
          {
            id: 'msg-init-2',
            author: '1105',
            text: '發起題目：假日最喜歡的放鬆度過方式是什麼？',
            timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
            type: 'question',
            questionData: {
              id: 'faq-1',
              question: '假日最喜歡的放鬆度過方式是什麼？',
              answer: '考驗對方的日常習性與放鬆偏好。',
              category: '習性與喜好',
              tags: ['假日習慣', '休閒'],
              options: ['在家躺平追劇看動漫', '約朋友出門踩點喝咖啡', '戶外運動踏青接觸大自然', '好好睡覺打電競打整天'],
            },
            isSyncedToNotion: true,
          },
          {
            id: 'msg-init-3',
            author: '1115',
            text: '回答/對話：已同步連線，準備選擇真心話與猜測！',
            timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
            isSyncedToNotion: true,
          },
        ],
        currentQuestionIndex: 0,
        status: "playing",
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      };
      rooms.set(roomCode, initialRoom);
    }
    return rooms.get(roomCode)!;
  };

  // Passcode Auth Endpoint (Supports 1105, 1115 or ANY custom account name/passcode)
  app.post("/api/rooms/login-with-passcode", (req, res) => {
    try {
      const { passcode, questions, tabSessionId } = req.body;
      const cleanCode = String(passcode || "").trim();

      if (!cleanCode) {
        return res.status(400).json({ error: "請輸入有效的暗號或帳號名稱！" });
      }

      const room = getOrCreatePasscodeRoom(questions || []);
      const playerId = tabSessionId ? `p-${cleanCode}-${tabSessionId}` : `p-${cleanCode}`;

      // Update player in room
      let player = room.players.find((p) => p.id === playerId);
      if (!player) {
        // Reuse default placeholder if it hasn't been assigned to an active tab session
        const defaultPlayer = room.players.find((p) => p.name === cleanCode);
        if (defaultPlayer && (!defaultPlayer.lastActive || new Date(defaultPlayer.lastActive).getTime() === 0 || defaultPlayer.id === `p-${cleanCode}`)) {
          defaultPlayer.id = playerId;
          defaultPlayer.lastActive = new Date().toISOString();
          player = defaultPlayer;
        } else {
          player = {
            id: playerId,
            name: cleanCode,
            score: 0,
            isHost: room.players.length === 0,
            lastActive: new Date().toISOString(),
          };
          room.players.push(player);

          pushNotifyMessageWithLimit(room, {
            id: `msg-${Date.now()}`,
            author: "系統提示",
            text: `🎉 線上成員【${cleanCode}】加入房間對話！`,
            timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
          });
        }
      } else {
        player.lastActive = new Date().toISOString();
      }

      // Refresh room questions if provided
      if (questions && questions.length > 0) {
        room.questions = questions;
      }

      room.updatedAt = new Date().toISOString();

      res.json({
        success: true,
        passcode: cleanCode,
        playerName: cleanCode,
        playerId,
        room,
      });
    } catch (error: any) {
      res.status(500).json({ error: error.message || "帳號連線失敗" });
    }
  });

  // Create Room
  app.post("/api/rooms/create", (req, res) => {
    try {
      const { hostName = "房長", questions = [] } = req.body;
      const roomCode = generateRoomCode();
      const hostPlayerId = `player-${Date.now()}-1`;

      const newRoom: CoPlayRoomStore = {
        code: roomCode,
        hostName,
        players: [
          {
            id: hostPlayerId,
            name: hostName,
            score: 0,
            isHost: true,
            lastActive: new Date().toISOString(),
          },
        ],
        questions,
        messages: [
          {
            id: `msg-${Date.now()}`,
            author: "系統提示",
            text: `房間 ${roomCode} 已建立！分享房間代碼即可 invited 好友雙人跨裝置線上答題對決！`,
            timestamp: new Date().toLocaleTimeString(),
          },
        ],
        currentQuestionIndex: 0,
        status: "lobby",
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      };

      rooms.set(roomCode, newRoom);
      res.json({ success: true, roomCode, playerId: hostPlayerId, room: newRoom });
    } catch (error: any) {
      res.status(500).json({ error: error.message || "建立房間失敗" });
    }
  });

  // Join Room
  app.post("/api/rooms/join", (req, res) => {
    try {
      const { roomCode, playerName = "挑戰者" } = req.body;
      if (!roomCode) {
        return res.status(400).json({ error: "請提供房間代碼" });
      }

      const upperCode = roomCode.trim().toUpperCase();
      const room = rooms.get(upperCode);

      if (!room) {
        return res.status(404).json({ error: "找不到該房間，請確認代碼是否正確！" });
      }

      // Check if player already in room
      let existingPlayer = room.players.find((p) => p.name === playerName);
      let playerId = existingPlayer ? existingPlayer.id : `player-${Date.now()}-${Math.floor(Math.random() * 100)}`;

      if (!existingPlayer) {
        const newPlayer = {
          id: playerId,
          name: playerName,
          score: 0,
          isHost: false,
          lastActive: new Date().toISOString(),
        };
        room.players.push(newPlayer);
        room.messages.push({
          id: `msg-${Date.now()}`,
          author: "系統提示",
          text: `🎉 ${playerName} 加入了房間！兩位挑戰者準備就緒。`,
          timestamp: new Date().toLocaleTimeString(),
        });
      } else {
        existingPlayer.lastActive = new Date().toISOString();
      }

      room.updatedAt = new Date().toISOString();
      res.json({ success: true, room, playerId });
    } catch (error: any) {
      res.status(500).json({ error: error.message || "加入房間失敗" });
    }
  });

  // Get Room State (Polling Endpoint)
  app.get("/api/rooms/:code", (req, res) => {
    const code = req.params.code.toUpperCase();
    const playerId = req.query.playerId as string;
    let room = rooms.get(code);

    if (!room && code === "DUAL-1105-1115") {
      room = getOrCreatePasscodeRoom();
    }

    if (!room) {
      return res.status(404).json({ error: "房間已失效或已刪除" });
    }

    if (playerId) {
      const player = room.players.find((p) => p.id === playerId);
      if (player) {
        player.lastActive = new Date().toISOString();
      }
    }

    res.json({ success: true, room });
  });

  // Start Room Quiz
  app.post("/api/rooms/:code/start", (req, res) => {
    const code = req.params.code.toUpperCase();
    const room = rooms.get(code);

    if (!room) {
      return res.status(404).json({ error: "房間不存在" });
    }

    room.status = "playing";
    room.currentQuestionIndex = 0;
    room.players.forEach((p) => {
      p.score = 0;
      p.answeredCurrent = false;
      p.lastSelectedOption = undefined;
    });

    room.messages.push({
      id: `msg-${Date.now()}`,
      author: "系統提示",
      text: "🚀 線上問答對決正式開始！請雙方選擇正確答案累積高分。",
      timestamp: new Date().toLocaleTimeString(),
    });

    room.updatedAt = new Date().toISOString();
    res.json({ success: true, room });
  });

  // Submit Answer & Guess in Co-play Room
  app.post("/api/rooms/:code/answer", (req, res) => {
    const code = req.params.code.toUpperCase();
    const { playerId, myChoice, myGuess, selectedOptionIndex } = req.body;
    const room = rooms.get(code);

    if (!room) {
      return res.status(404).json({ error: "房間不存在" });
    }

    const player = room.players.find((p) => p.id === playerId || p.name === playerId);
    if (!player) {
      return res.status(400).json({ error: "玩家不在此房間內" });
    }

    const currentQ = room.questions[room.currentQuestionIndex];
    if (!currentQ) {
      return res.status(400).json({ error: "題目不存在" });
    }

    const actualChoice = myChoice !== undefined ? Number(myChoice) : Number(selectedOptionIndex ?? 0);
    const actualGuess = myGuess !== undefined ? Number(myGuess) : actualChoice;

    player.answeredCurrent = true;
    player.lastSelectedOption = actualChoice;
    player.lastGuessOption = actualGuess;

    const options = currentQ.options || [currentQ.answer, '選項 A', '選項 B', '選項 C'];

    // Check if both 1105 and 1115 (or all players in room) have answered
    const otherPlayers = room.players.filter((p) => p.id !== player.id);
    const allOthersAnswered = otherPlayers.length > 0 && otherPlayers.every((p) => p.answeredCurrent);

    if (allOthersAnswered) {
      // Reveal & evaluate guesses!
      let roundSummaryMessages: string[] = [];

      room.players.forEach((p) => {
        const partner = room.players.find((other) => other.id !== p.id);
        if (partner && p.lastGuessOption !== undefined && partner.lastSelectedOption !== undefined) {
          const guessedRight = p.lastGuessOption === partner.lastSelectedOption;
          const partnerSelectedText = options[partner.lastSelectedOption] || '未知選項';
          const myGuessText = options[p.lastGuessOption] || '未知選項';

          if (guessedRight) {
            p.score += 10;
            roundSummaryMessages.push(
              `✨ ${p.name} 猜中了！正確猜到 ${partner.name} 選的是「${partnerSelectedText}」(+10 分)`
            );
          } else {
            roundSummaryMessages.push(
              `❌ ${p.name} 猜「${myGuessText}」，但 ${partner.name} 的真實選擇是「${partnerSelectedText}」`
            );
          }
        }
      });

      room.messages.push({
        id: `msg-${Date.now()}`,
        author: "系統揭曉廣播",
        text: `🎯 【本題揭曉】：\n` + roundSummaryMessages.join('\n'),
        timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
      });
    } else {
      room.messages.push({
        id: `msg-${Date.now()}`,
        author: "系統提示",
        text: `📝 人員 ${player.name} 已完成真心話選擇與猜測，等待對方作答...`,
        timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
      });
    }

    room.updatedAt = new Date().toISOString();
    res.json({ success: true, room });
  });

  // Next Question
  app.post("/api/rooms/:code/next", (req, res) => {
    const code = req.params.code.toUpperCase();
    const room = rooms.get(code);

    if (!room) {
      return res.status(404).json({ error: "房間不存在" });
    }

    if (room.currentQuestionIndex < room.questions.length - 1) {
      room.currentQuestionIndex += 1;
      room.players.forEach((p) => {
        p.answeredCurrent = false;
        p.lastSelectedOption = undefined;
      });
      room.messages.push({
        id: `msg-${Date.now()}`,
        author: "系統提示",
        text: `進入第 ${room.currentQuestionIndex + 1} 題！`,
        timestamp: new Date().toLocaleTimeString(),
      });
    } else {
      room.status = "finished";
      room.messages.push({
        id: `msg-${Date.now()}`,
        author: "系統提示",
        text: "🏆 所有題目問答結束！請查看最終對戰結算排行榜。",
        timestamp: new Date().toLocaleTimeString(),
      });
    }

    room.updatedAt = new Date().toISOString();
    res.json({ success: true, room });
  });

  // Helper to append/overwrite system notify messages in room (Max 2 system notify messages)
  function pushNotifyMessageWithLimit(room: any, newMsg: any) {
    if (!room.messages) room.messages = [];

    const isSystemNotify = (m: any) =>
      m.author === '系統廣播' ||
      m.author === '系統提示' ||
      m.author === '🎯 揭曉報告' ||
      m.type === 'system' ||
      m.type === 'invite';

    if (isSystemNotify(newMsg)) {
      const systemMsgIndices: number[] = [];
      room.messages.forEach((m: any, idx: number) => {
        if (isSystemNotify(m)) systemMsgIndices.push(idx);
      });

      if (systemMsgIndices.length >= 2) {
        // Overwrite the oldest system notification message to keep at most 2
        const oldestIdx = systemMsgIndices[0];
        room.messages[oldestIdx] = {
          ...newMsg,
          text: `[最新廣播覆蓋] ${newMsg.text}`,
        };
        return;
      }
    }

    room.messages.push(newMsg);
  }

  // Real Notion Sync Helper (Supports Overwrite Mode - Max 2 pages per room)
  async function syncToNotionDatabase(
    type: 'question' | 'chat' | 'answer',
    data: any,
    reqToken?: string,
    reqDbId?: string,
    room?: any
  ) {
    try {
      const token = (reqToken && reqToken.trim()) || process.env.NOTION_TOKEN || HARDCODED_NOTION_TOKEN;

      const defaultDbForType = type === 'question' ? HARDCODED_NOTION_QUESTION_DB_ID : HARDCODED_NOTION_ANSWER_DB_ID;

      let dbId = defaultDbForType;
      if (reqDbId && reqDbId.trim() && !reqDbId.includes('2906e88209608305')) {
        const trimmed = reqDbId.trim();
        if (type === 'question' && trimmed === HARDCODED_NOTION_ANSWER_DB_ID) {
          dbId = HARDCODED_NOTION_QUESTION_DB_ID;
        } else if ((type === 'chat' || type === 'answer') && trimmed === HARDCODED_NOTION_QUESTION_DB_ID) {
          dbId = HARDCODED_NOTION_ANSWER_DB_ID;
        } else {
          dbId = trimmed;
        }
      }

      if (!token || token.length < 10) {
        return {
          success: false,
          error: '缺少有效 Notion Token。請至「後台管理」填寫您的 Notion Integration Token (starts with ntn_ or secret_)',
        };
      }

      if (!dbId || dbId.length < 10) {
        return {
          success: false,
          error: '缺少有效 Notion Database ID。請至「後台管理」填寫您的 Notion 資料庫 ID',
        };
      }

      const cleanDbId = dbId.replace(/-/g, '');

      let dbProperties: Record<string, any> = {};
      let titleKey = 'Title';

      try {
        const schemaRes = await fetch(`https://api.notion.com/v1/databases/${cleanDbId}`, {
          headers: {
            Authorization: `Bearer ${token}`,
            'Notion-Version': '2022-06-28',
          },
        });
        if (schemaRes.ok) {
          const dbData = await schemaRes.json();
          dbProperties = dbData.properties || {};
          titleKey = Object.keys(dbProperties).find((k) => dbProperties[k].type === 'title') || titleKey;
        }
      } catch (e: any) {
        console.warn('Could not fetch Notion schema, proceeding with fallback keys:', e);
      }

      let titleContent = '';
      if (type === 'question') {
        titleContent = `❓ [猜心題目] ${data.question || data.title}`;
      } else if (type === 'answer') {
        titleContent = `🎯 [結果揭曉] ${data.questionText || '雙人對決'}`;
      } else {
        titleContent = `💬 [人員 ${data.author || '1105/1115'}] ${data.text || '對話'}`;
      }

      const properties: Record<string, any> = {};

      const questionPropKey = Object.keys(dbProperties).find(
        (k) =>
          (k.toLowerCase().includes('question') || k.includes('題目')) &&
          dbProperties[k].type === 'rich_text'
      );
      if (questionPropKey) {
        properties[questionPropKey] = {
          rich_text: [{ text: { content: (data.question || data.questionText || titleContent).substring(0, 2000) } }],
        };
      }

      const answerPropKey = Object.keys(dbProperties).find(
        (k) =>
          (k.toLowerCase().includes('answer') || k.includes('回答') || k.includes('對話')) &&
          dbProperties[k].type === 'rich_text'
      );
      if (answerPropKey) {
        const answerContent = data.answerText || data.text || '無內容';
        properties[answerPropKey] = {
          rich_text: [{ text: { content: answerContent.substring(0, 2000) } }],
        };
      }

      const catPropKey = Object.keys(dbProperties).find(
        (k) =>
          (k.toLowerCase().includes('category') || k.includes('分類')) &&
          dbProperties[k].type === 'select'
      );
      if (catPropKey) {
        properties[catPropKey] = {
          select: { name: (data.category || '雙人猜心').substring(0, 100) },
        };
      }

      const optionsPropKey = Object.keys(dbProperties).find(
        (k) =>
          (k.toLowerCase().includes('option') || k.includes('選項') || k.includes('項目') || k.includes('選擇')) &&
          dbProperties[k].type === 'rich_text'
      );
      if (optionsPropKey && Array.isArray(data.options) && data.options.length > 0) {
        const optsText = data.options.map((o: string, idx: number) => `${idx + 1}. ${o}`).join('\n');
        properties[optionsPropKey] = {
          rich_text: [{ text: { content: optsText.substring(0, 2000) } }],
        };
      }

      // Preserve all historical records in Notion (do not overwrite historical pages)
      const targetOverwritePageId: string | null = null;

      // Fallback loop over candidate Title property names
      const candidateTitleKeys = Array.from(
        new Set([titleKey, 'Title', 'Name', 'title', 'Name / Title', '題目'])
      );

      let lastErrorMsg = 'Notion 同步失敗';

      for (const candidateKey of candidateTitleKeys) {
        const payloadProps = { ...properties };
        payloadProps[candidateKey] = {
          title: [{ text: { content: titleContent.substring(0, 2000) } }],
        };

        let currentRes: Response;
        if (targetOverwritePageId) {
          currentRes = await fetch(`https://api.notion.com/v1/pages/${targetOverwritePageId}`, {
            method: 'PATCH',
            headers: {
              Authorization: `Bearer ${token}`,
              'Notion-Version': '2022-06-28',
              'Content-Type': 'application/json',
            },
            body: JSON.stringify({ properties: payloadProps }),
          });
        } else {
          currentRes = await fetch('https://api.notion.com/v1/pages', {
            method: 'POST',
            headers: {
              Authorization: `Bearer ${token}`,
              'Notion-Version': '2022-06-28',
              'Content-Type': 'application/json',
            },
            body: JSON.stringify({
              parent: { database_id: cleanDbId },
              properties: payloadProps,
            }),
          });
        }

        if (currentRes.ok) {
          const resData = await currentRes.json();
          const pageId = resData.id || targetOverwritePageId;

          if (room && room.notionPageIds && pageId) {
            if (targetOverwritePageId) {
              room.notionPageIds = [room.notionPageIds[1], targetOverwritePageId];
            } else if (!room.notionPageIds.includes(pageId)) {
              room.notionPageIds.push(pageId);
            }
          }

          return { success: true, pageId };
        } else {
          const errJson = await currentRes.json().catch(() => ({}));
          lastErrorMsg = errJson.message || 'Notion 同步失敗';

          if (currentRes.status === 401 || lastErrorMsg.toLowerCase().includes('token is invalid')) {
            return {
              success: false,
              error: `Notion 認證失敗 (401 API Token Invalid)：金鑰憑證無效。請進入 https://www.notion.so/my-integrations 重新建立或複製 Secret/Token (格式為 ntn_... 或 secret_...)，並更新至後台管理。`,
            };
          }

          if (currentRes.status === 404 || lastErrorMsg.includes('Could not find database')) {
            return {
              success: false,
              error: `Notion 授權問題 (404 Not Found)：找不到資料庫 (ID: ${cleanDbId})。請進入 Notion 資料庫頁面，點擊右上角 [...] -> Add connections (新增連結) 勾選您的 Integration 權限。`,
            };
          }
        }
      }

      return { success: false, error: lastErrorMsg };
    } catch (err: any) {
      console.error('Notion Sync Exception:', err);
      return { success: false, error: err.message || 'Notion 連線發生未知錯誤' };
    }
  }

  // Post Game Invitation
  app.post("/api/rooms/:code/invite", async (req, res) => {
    const code = req.params.code.toUpperCase();
    const { sender, notionToken, notionDbId } = req.body;
    const room = rooms.get(code);
    if (!room) return res.status(404).json({ error: "房間不存在" });

    const partner = room.players.find((p) => p.name !== sender);
    const target = partner ? partner.name : (sender === '1105' ? '1115' : '1105');
    room.gameInvitation = {
      id: generateId('inv'),
      sender,
      target,
      status: 'pending',
      createdAt: new Date().toISOString(),
    };

    const syncRes = await syncToNotionDatabase(
      'chat',
      { author: sender, text: `發起猜心對決邀請給人員 ${target}` },
      notionToken,
      notionDbId,
      room
    );

    const sysMsg = {
      id: generateId('msg'),
      author: "系統廣播",
      text: `🎮 【人員 ${sender}】向【人員 ${target}】發起了猜心考驗！等待對方確認...`,
      timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
      type: 'invite' as const,
      isSyncedToNotion: syncRes.success,
      notionError: syncRes.error,
    };

    pushNotifyMessageWithLimit(room, sysMsg);
    room.updatedAt = new Date().toISOString();

    res.json({ success: true, room });
  });

  // Respond to Game Invitation (Accept or Decline)
  app.post("/api/rooms/:code/respond-invite", async (req, res) => {
    const code = req.params.code.toUpperCase();
    const { passcode, accept, notionToken, notionDbId } = req.body;
    const room = rooms.get(code);
    if (!room) return res.status(404).json({ error: "房間不存在" });

    if (!room.gameInvitation) {
      return res.status(400).json({ error: "目前無有效的考驗邀請" });
    }

    const sender = room.gameInvitation.sender;

    if (accept) {
      room.gameInvitation.status = 'accepted';
      const syncRes = await syncToNotionDatabase(
        'chat',
        { author: passcode, text: `接受了 ${sender} 的猜心挑戰` },
        notionToken,
        notionDbId,
        room
      );

      const msg = {
        id: generateId('msg'),
        author: "系統廣播",
        text: `👍 【人員 ${passcode}】接受了猜心挑戰！請【人員 ${sender}】選擇題目類型與問題考驗對方。`,
        timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
        type: 'system' as const,
        isSyncedToNotion: syncRes.success,
        notionError: syncRes.error,
      };
      pushNotifyMessageWithLimit(room, msg);
    } else {
      room.gameInvitation = null;
      const msg = {
        id: generateId('msg'),
        author: "系統廣播",
        text: `🙅 【人員 ${passcode}】暫時忙碌中，婉拒了本次猜心考驗。`,
        timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
        type: 'system' as const,
        isSyncedToNotion: false,
      };
      pushNotifyMessageWithLimit(room, msg);
    }

    room.updatedAt = new Date().toISOString();

    res.json({ success: true, room });
  });

  // Cancel Game Invitation
  app.post("/api/rooms/:code/cancel-invite", (req, res) => {
    const code = req.params.code.toUpperCase();
    const { passcode } = req.body;
    const room = rooms.get(code);
    if (!room) return res.status(404).json({ error: "房間不存在" });

    if (room.gameInvitation) {
      room.gameInvitation = null;
      const msg = {
        id: generateId('msg'),
        author: "系統廣播",
        text: `🚫 發起人已取消本次猜心對決邀請。`,
        timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
        type: 'system' as const,
      };
      pushNotifyMessageWithLimit(room, msg);
    }

    room.updatedAt = new Date().toISOString();

    res.json({ success: true, room });
  });

  // Submit Game Question (Initiator submits question & options)
  app.post("/api/rooms/:code/submit-game-question", async (req, res) => {
    const code = req.params.code.toUpperCase();
    const { sender, question, category, options, notionToken, notionDbId } = req.body;
    const room = rooms.get(code);
    if (!room) return res.status(404).json({ error: "房間不存在" });

    if (!question || !question.trim()) {
      return res.status(400).json({ error: "請輸入題目內容" });
    }

    const partner = room.players.find((p) => p.name !== sender);
    const target = partner ? partner.name : (sender === '1105' ? '1115' : '1105');
    const opts = options && options.length >= 2 ? options : ['選項 A', '選項 B', '選項 C', '選項 D'];

    const gameQuestion = {
      id: generateId('gq'),
      initiator: sender,
      target: target,
      question: question.trim(),
      category: category || '自訂題目',
      options: opts,
      createdAt: new Date().toISOString(),
    };

    room.activeGameQuestion = gameQuestion;
    room.gameInvitation = null;

    const syncRes = await syncToNotionDatabase(
      'question',
      {
        question: question.trim(),
        category: category || '雙人猜心',
        author: sender,
        text: `問人員 ${target} 的問題: ${question.trim()}`,
      },
      notionToken,
      notionDbId,
      room
    );

    const qMsg = {
      id: generateId('msg'),
      author: sender,
      text: `❓ 【猜心題目登場】：${question.trim()}\n(問對方的真心話，發起人猜對方的答案)`,
      timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
      type: 'question' as const,
      gameQuestion,
      isSyncedToNotion: syncRes.success,
      notionError: syncRes.error,
    };

    room.messages.push(qMsg);
    room.updatedAt = new Date().toISOString();

    res.json({ success: true, room, gameQuestion });
  });

  // Submit Game Answer or Guess
  app.post("/api/rooms/:code/submit-game-answer", async (req, res) => {
    const code = req.params.code.toUpperCase();
    const { passcode, selectedOption, selectedText, authorName, notionToken, notionDbId } = req.body;
    const room = rooms.get(code);
    if (!room) return res.status(404).json({ error: "房間不存在" });

    const q = room.activeGameQuestion as any;
    if (!q) {
      return res.status(400).json({ error: "目前無進行中的猜心題目" });
    }

    const displayName = authorName || passcode || `成員`;

    if (passcode !== q.initiator) {
      q.targetAnswer = selectedOption;
      q.targetAnswerText = selectedText || (q.options[selectedOption] || '自訂選項');
      pushNotifyMessageWithLimit(room, {
        id: generateId('msg'),
        author: "系統提示",
        text: `📝 ${displayName} 已選擇了自己的真心話，等待對方猜測...`,
        timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
      });
    } else {
      q.initiatorGuess = selectedOption;
      q.initiatorGuessText = selectedText || (q.options[selectedOption] || '自訂選項');
      pushNotifyMessageWithLimit(room, {
        id: generateId('msg'),
        author: "系統提示",
        text: `🔮 ${displayName} 已完成猜測，等待對方送出真心話...`,
        timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
      });
    }

    if (q.targetAnswer !== undefined && q.initiatorGuess !== undefined) {
      q.isRevealed = true;
      q.isCorrect = (q.targetAnswer === q.initiatorGuess);

      const targetAnsText = q.targetAnswerText || (q.options[q.targetAnswer] || '未知選項');
      const guessAnsText = q.initiatorGuessText || (q.options[q.initiatorGuess] || '未知選項');

      let feedbackText = "";
      if (q.isCorrect) {
        feedbackText = `🎉 【猜心結果揭曉：猜對了！】\n猜測者成功猜中！\n真心話答案是「${targetAnsText}」。`;
      } else {
        feedbackText = `❌ 【猜心結果揭曉：沒猜中！】\n真實選擇是「${targetAnsText}」\n猜測的是「${guessAnsText}」。`;
      }

      const syncRes = await syncToNotionDatabase(
        'answer',
        {
          questionText: q.question,
          category: q.category,
          answerText: feedbackText,
        },
        notionToken,
        notionDbId,
        room
      );

      const revealMsg = {
        id: generateId('msg'),
        author: "🎯 揭曉報告",
        text: feedbackText,
        timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
        type: 'system' as const,
        isSyncedToNotion: syncRes.success,
        notionError: syncRes.error,
      };

      pushNotifyMessageWithLimit(room, revealMsg);
    }

    room.updatedAt = new Date().toISOString();

    res.json({ success: true, room, gameQuestion: q });
  });

  // Post Chat Message in Room
  app.post("/api/rooms/:code/chat", async (req, res) => {
    const code = req.params.code.toUpperCase();
    const { author, text, notionToken, notionDbId } = req.body;
    const room = rooms.get(code);

    if (!room) {
      return res.status(404).json({ error: "房間不存在" });
    }

    if (!text || !text.trim()) {
      return res.status(400).json({ error: "訊息不能為空" });
    }

    const syncRes = await syncToNotionDatabase(
      'chat',
      { author: author || '成員', text: text.trim() },
      notionToken,
      notionDbId,
      room
    );

    const newMessage = {
      id: generateId('msg'),
      author: author || "匿名",
      text: text.trim(),
      timestamp: new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }),
      isSyncedToNotion: syncRes.success,
      notionError: syncRes.error,
    };

    room.messages.push(newMessage);
    room.updatedAt = new Date().toISOString();

    res.json({ success: true, message: newMessage, room });
  });

  // Post Question in Dialogue Box
  app.post("/api/rooms/:code/post-question", (req, res) => {
    const code = req.params.code.toUpperCase();
    const { author, question, options, category } = req.body;
    const room = rooms.get(code);

    if (!room) {
      return res.status(404).json({ error: "房間不存在" });
    }

    if (!question || !question.trim()) {
      return res.status(400).json({ error: "題目內容不能為空" });
    }

    const newQuestionObj = {
      id: generateId('faq-user'),
      question: question.trim(),
      answer: "考驗對方的真實想法與默契選擇",
      category: category || "自訂話題",
      tags: ["對話框發起", "雙人連線"],
      options: options && options.length >= 2 ? options : ["選項 A", "選項 B", "選項 C", "選項 D"],
      updatedAt: new Date().toISOString(),
    };

    room.questions.push(newQuestionObj);
    room.currentQuestionIndex = room.questions.length - 1;
    room.players.forEach((p) => {
      p.answeredCurrent = false;
      p.lastSelectedOption = undefined;
    });

    const newMessage = {
      id: generateId('msg-q'),
      author: author || "成員",
      text: `❓ 【發起新問題】：${question.trim()}`,
      timestamp: new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }),
      type: "question" as const,
      questionData: newQuestionObj,
      isSyncedToNotion: true,
    };

    room.messages.push(newMessage);
    room.updatedAt = new Date().toISOString();

    res.json({ success: true, newQuestion: newQuestionObj, message: newMessage, room });
  });

  // Vite middleware for development
  if (process.env.NODE_ENV !== "production") {
    const { createServer: createViteServer } = await import("vite");
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa",
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), "dist");
    app.use(express.static(distPath));
    app.get("*", (req, res) => {
      res.sendFile(path.join(distPath, "index.html"));
    });
  }

  app.listen(PORT, "0.0.0.0", () => {
    console.log(`Server running on http://0.0.0.0:${PORT}`);
  });
}

startServer();
