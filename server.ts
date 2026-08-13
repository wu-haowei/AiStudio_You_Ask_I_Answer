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
