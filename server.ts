import express from "express";
import path from "path";
import fetch from "node-fetch";
import { GoogleGenAI, Type } from "@google/genai";
import { createServer as createViteServer } from "vite";
import dotenv from "dotenv";
import { createRequire } from "module";
import { setGlobalDispatcher, Agent } from "undici";

dotenv.config();

// Configure undici globally to prevent HeadersTimeoutError (default 30s) when waiting for large schema generations
setGlobalDispatcher(new Agent({
  connect: { timeout: 120000 },
  bodyTimeout: 300000,
  headersTimeout: 300000,
}));

const require = createRequire(import.meta.url);
const { PDFParse } = require("pdf-parse");

const app = express();
const PORT = 3000;

// Enable JSON bodies with higher limits for book contents
app.use(express.json({ limit: "50mb" }));
app.use(express.urlencoded({ limit: "50mb", extended: true }));

// Lazy initializer for GoogleGenAI
let aiInstance: GoogleGenAI | null = null;
function getAIClient(): GoogleGenAI {
  if (!aiInstance) {
    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) {
      throw new Error("GEMINI_API_KEY environment variable is required. Please manage it in Settings > Secrets.");
    }
    aiInstance = new GoogleGenAI({
      apiKey,
      httpOptions: {
        headers: {
          "User-Agent": "aistudio-build",
        },
        timeout: 300000,
      },
    });
  }
  return aiInstance;
}

// Reconstruct paragraphs and group them into blocks
function cleanRawTextIntoParagraphs(text: string): string[] {
  if (!text) return [];
  
  const lines = text.split(/\r?\n/);
  const paragraphs: string[] = [];
  let currentGroup = "";

  for (let i = 0; i < lines.length; i++) {
    const rawLine = lines[i];
    const trimmed = rawLine.trim();
    
    // Empty line always means paragraph break
    if (trimmed === "") {
      if (currentGroup) {
        paragraphs.push(currentGroup);
        currentGroup = "";
      }
      continue;
    }

    // Checking for paragraph indentations (common in ebooks/PDFs to start a new paragraph)
    const isIndented = /^[ \t\u3000]{2,}/.test(rawLine);
    
    if (isIndented && currentGroup) {
      paragraphs.push(currentGroup);
      currentGroup = trimmed;
    } else {
      if (!currentGroup) {
        currentGroup = trimmed;
      } else {
        const currentEndsWithAlphanumeric = /[a-zA-Z0-9]$/.test(currentGroup);
        const lineStartsWithAlphanumeric = /^[a-zA-Z0-9]/.test(trimmed);
        const separator = (currentEndsWithAlphanumeric && lineStartsWithAlphanumeric) ? " " : "";
        currentGroup += separator + trimmed;
      }
    }
  }

  if (currentGroup) {
    paragraphs.push(currentGroup);
  }

  return paragraphs.map(p => p.trim()).filter(Boolean);
}

// Simple and intelligent paragraph block constructor with count limit
function getParagraphBlocks(text: string, maxBlocks = 60): { id: number; text: string }[] {
  if (!text || text.trim().length === 0) return [];
  const rawPara = cleanRawTextIntoParagraphs(text);
  if (rawPara.length === 0) return [];
  
  if (rawPara.length <= maxBlocks) {
    return rawPara.map((t, i) => ({ id: i + 1, text: t }));
  }
  
  // Group them into exactly maxBlocks
  const groupSize = Math.ceil(rawPara.length / maxBlocks);
  const blocks: { id: number; text: string }[] = [];
  for (let i = 0; i < rawPara.length; i += groupSize) {
    const chunk = rawPara.slice(i, i + groupSize).join("\n\n");
    blocks.push({
      id: blocks.length + 1,
      text: chunk
    });
  }
  return blocks;
}

async function generateContentWithRetry(ai: any, params: any, maxRetries = 3) {
  for (let i = 0; i < maxRetries; i++) {
    try {
      return await ai.models.generateContent(params);
    } catch (error: any) {
      if (
        i < maxRetries - 1 &&
        (error?.status === "UNAVAILABLE" || error?.status === "DEADLINE_EXCEEDED" || error?.message?.includes("503") || error?.message?.includes("Spikes in demand"))
      ) {
        console.warn(`Gemini API 503/504 error, retrying (${i + 1}/${maxRetries})... wait ${2000 * (i + 1)}ms`);
        await new Promise(resolve => setTimeout(resolve, 2000 * (i + 1)));
        continue;
      }
      throw error;
    }
  }
}

// Extractor helper for web URL link
async function fetchAndExtractUrl(url: string): Promise<string> {
  try {
    const res = await fetch(url, {
      headers: {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"
      }
    });
    if (!res.ok) throw new Error(`HTTP status ${res.status}`);
    
    const buffer = await res.arrayBuffer();
    const uint8 = new Uint8Array(buffer);
    let text = "";
    try {
      // Decode as UTF-8 first (fatal: true forces error if invalid sequences exist)
      const utf8Decoder = new TextDecoder("utf-8", { fatal: true });
      text = utf8Decoder.decode(uint8);
    } catch (e) {
      try {
        // Fallback to GB18030 which handles Chinese web encodings beautifully
        const gbkDecoder = new TextDecoder("gb18030");
        text = gbkDecoder.decode(uint8);
      } catch (err2) {
        // Final fallback
        const fallbackDecoder = new TextDecoder("utf-8");
        text = fallbackDecoder.decode(uint8);
      }
    }
    
    // Simple HTML content filtering
    let content = text
      .replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, " ")
      .replace(/<style\b[^<]*(?:(?!<\/style>)<[^<]*)*<\/style>/gi, " ")
      .replace(/<footer\b[^<]*(?:(?!<\/footer>)<[^<]*)*<\/footer>/gi, " ")
      .replace(/<header\b[^<]*(?:(?!<\/header>)<[^<]*)*<\/header>/gi, " ")
      .replace(/<nav\b[^<]*(?:(?!<\/nav>)<[^<]*)*<\/nav>/gi, " ")
      .replace(/<[^>]+>/g, " ")
      .replace(/\s+/g, " ")
      .trim();

    return content.slice(0, 35000); // Cap content sizes to stay elegant and fast
  } catch (err: any) {
    throw new Error(`无法获取或解析链接：${err.message}`);
  }
}

async function extractPdfText(pdfBase64: string): Promise<string> {
  try {
    const buffer = Buffer.from(pdfBase64, "base64");
    const parser = new PDFParse({ data: buffer });
    const data = await parser.getText();
    return data.text || "";
  } catch (err: any) {
    console.error("PDF extraction error:", err);
    throw new Error(`PDF 文件解析失败，可能受密码保护或由于扫描格式，请确认其完整度。`);
  }
}
// API endpoint: Start reading journey & generate timeline schedule via Gemini
app.post("/api/start-journey", async (req, res) => {
  try {
    const { title, author, days, inputType, content, fileUrl, pdfBase64 } = req.body;
    
    if (!title || !days) {
      return res.status(400).json({ error: "书名和阅读天数是必需的" });
    }

    let parsedContent = content || "";
    
    if (inputType === "url" && fileUrl) {
      parsedContent = await fetchAndExtractUrl(fileUrl);
    } else if (inputType === "pdf" && pdfBase64) {
      parsedContent = await extractPdfText(pdfBase64);
    }

    // Limit the character extraction count, but Gemini 1.5/3.5 can handle 1M+ tokens comfortably
    const truncatedContent = parsedContent.slice(0, 2000000);

    // Split text into numbered paragraph blocks for semantic analysis.
    // Ensure we give enough blocks to cover the whole book cleanly.
    const blocks = getParagraphBlocks(truncatedContent, Math.max(100, days * 15));
    const blockPrompts = blocks.map(b => `[段落块 #${b.id} (字数:${b.text.length})]:\n${b.text.slice(0, 5000)}`).join("\n\n");

    // Call Gemini to generate the core analytical structure
    const ai = getAIClient();
    
    const prompt = `您将为一本图书制定一个极其深刻、充满思想厚度的 ${days} 天“核心共读规划”。
图书名：《${title}》${author ? `，作者：${author}` : ""}。

${blocks.length > 0 ? `我们已将本书的完整文本切分成了以下 ${blocks.length} 个连续的段落块。
请你仔细阅读全部文本内容，通盘理解其论证逻辑、叙事节奏或学术框架，根据实际的逻辑边界或章节重点进行分配。
绝对禁止字数简单平均分！而是应当把语义、论点、文章章节或情节高潮的完整度作为最高考量。

【书籍完整文本段落块】：
${blockPrompts}

【极重要划分规则】：
请将这 ${blocks.length} 个段落块无缝分配给这 ${days} 天。
第 1 天必须从 1 开始。每一天必须紧接上一天的结束（例如，第 1 天: 1至12；第 2 天: 13至30；第 3 天: 31至${blocks.length}）。第 ${days} 天的结束块ID必须是 ${blocks.length}。所有块都必须被覆盖，不能有遗漏或重叠，且天数必须是连续的且严格递增！每一位学者都会对你高水平的学术、逻辑划分感到震撼。
请在 JSON 中输出每天分配的 "startBlockId" 和 "endBlockId" 指标。` : "本书未上传正文，请基于您海量的经典知识库，生成本著作最经典的章节和核心要点。此时，请将 startBlockId 和 endBlockId 均设置为 0。"}

请对这 ${days} 天进行精心排布，输出一个合规的 JSON 对象，包含 days 数组。
每天包含以下字段：
- day: 从 1 开始的整数天数
- title: 每天阅读篇章的主题标题（例如：“寻找驯养的奥秘” 或 “二加二等于五的思想洗礼”）
- summary: 该天内容之核心导读与名家级精炼摘要（100-150字）。请保持高品位的学术性、文学美感与反思度，突出其人文厚度。
- hints: 2-3个在阅读该天前用户应留心和预备的核心词汇、哲学概念、隐性意向或背景（hints 必须是字符串数组）
- questions: 3个该天阅读完后，触发用户“主动回想 (Active Recall)”的主动思考题。这些问题不应该通过简单搜索找到答案，而是启发生活对照、文本思辩或深度反思（questions 必须是包含3个元素的字符串数组）
- reflection: 【现代社会映射】。强制且鲜明地将此天书本中的思想、道理、隐喻、理论，无缝映射 to 我们如今二十一世纪现代社会的命题中。给读者提醍醐灌顶的当下启发感。（80-100字，中文）
- outlook: 【未来展望】针对今天探讨的论题，提出一段关于人类文明或个体在未来演变中的洞察与方向性的终极启发。（50-80字，中文）
- startBlockId: 该天大纲起点段落块 ID (没有上传正文时为 0)
- endBlockId: 该天大纲结束段落块 ID (没有上传正文时为 0)
- storyAnalyses: 【核心故事/情节/案例深度剖析数组】每天仅限提取 1 个贯穿该阅读篇章最具决定性的核心故事或案例。一定要精要、有洞察力。
  每个故事/案例包含：
  - storyName: 故事、情节或案例名称（如：阿Q调戏吴妈等）
  - background: 【当时的大环境】现实大环境与历史洪流的压抑性（50-80字，中文）
  - psychology: 【当时的人物心理剖析】角色的内在动机与隐秘潜意识（50-80字，中文）
  - socialStatus: 【当时的社会地位】社会阶层结构带来的限制（40-60字，中文）
  - socialRelations: 【复杂的社会关系】与周围权力的冲突与人际结构（40-60字，中文）
  - essence: 【核心义理】剖示它如何折射书中的至高真理，带来振聋发聩的体悟（80-100字，中文）

如果设定的共读天数超过 10 天，请让所有的输出文字极其凝练精简（例如 summary 控制在 50 字以内），确保能够完整输出。`;

    const response = await generateContentWithRetry(ai, {
      model: "gemini-3.5-flash",
      contents: prompt,
      config: {
        systemInstruction: `你是一个极富人类文化洞察力、学术积淀、和敏锐现代触角的“高级文学伴读主笔”。你拒绝平庸与空泛。对任何经典文稿或经典图书的阐发，你都能提供充满力量与美感的中文导读。你的页面排版设计要求简雅纯粹。你输出的每一词、每一句都精益求精，结构符合所要求的严格JSON Schema类型。`,
        responseMimeType: "application/json",
        responseSchema: {
          type: Type.OBJECT,
          properties: {
            days: {
              type: Type.ARRAY,
              items: {
                type: Type.OBJECT,
                properties: {
                  day: { type: Type.INTEGER },
                  title: { type: Type.STRING },
                  summary: { type: Type.STRING },
                  hints: {
                    type: Type.ARRAY,
                    items: { type: Type.STRING }
                  },
                  questions: {
                    type: Type.ARRAY,
                    items: { type: Type.STRING }
                  },
                  reflection: { type: Type.STRING },
                  outlook: { type: Type.STRING },
                  startBlockId: { type: Type.INTEGER },
                  endBlockId: { type: Type.INTEGER },
                  storyAnalyses: {
                    type: Type.ARRAY,
                    items: {
                      type: Type.OBJECT,
                      properties: {
                        storyName: { type: Type.STRING },
                        background: { type: Type.STRING },
                        psychology: { type: Type.STRING },
                        socialStatus: { type: Type.STRING },
                        socialRelations: { type: Type.STRING },
                        essence: { type: Type.STRING }
                      },
                      required: ["storyName", "background", "psychology", "socialStatus", "socialRelations", "essence"]
                    }
                  }
                },
                required: ["day", "title", "summary", "hints", "questions", "reflection", "outlook", "startBlockId", "endBlockId", "storyAnalyses"]
              }
            }
          },
          required: ["days"]
        }
      }
    });

    const resultText = response.text;
    if (!resultText) {
      throw new Error("Failed to receive structured results from Gemini.");
    }

    const parsedJson = JSON.parse(resultText);
    
    let lastEndId = 0;
    
    // Inject parsed excerpt segments and word counts into structured days output
    const enrichedDays = parsedJson.days.map((item: any, index: number) => {
      let excerptStr = "";
      if (blocks.length > 0) {
        let startId = item.startBlockId;
        let endId = item.endBlockId;
        
        // Enforce strict non-overlapping boundaries
        if (typeof startId !== "number" || startId <= lastEndId) {
          startId = lastEndId + 1;
        }
        if (typeof endId !== "number" || endId < startId) {
          endId = startId;
        }
        
        // Force the last day to encompass all remaining blocks
        if (index === parsedJson.days.length - 1) {
          endId = blocks.length;
        }
        
        if (startId > blocks.length) startId = blocks.length;
        if (endId > blocks.length) endId = blocks.length;
        
        lastEndId = endId;

        item.startBlockId = startId;
        item.endBlockId = endId;
        
        // Slice blocks within range inclusive
        const dayBlocks = blocks.filter(b => b.id >= startId && b.id <= endId);
        excerptStr = dayBlocks.map(b => b.text).join("\n\n");
      }

      return {
        ...item,
        excerpt: excerptStr,
        wordCount: excerptStr.length
      };
    });

    res.json({
      title,
      author: author || "经典作者",
      totalDays: Number(days),
      schedule: enrichedDays
    });

  } catch (error: any) {
    console.error("journey init error:", error);
    res.status(500).json({ error: error.message || "初始化共读计划失败。" });
  }
});

// API endpoint: Active Recall Interactive Chat with day-specific tutor
app.post("/api/chat-companion", async (req, res) => {
  try {
    const { bookTitle, totalDays, currentDay, dayTitle, daySummary, dayExcerpt, history, userMessage } = req.body;
    
    if (!bookTitle || !userMessage) {
      return res.status(400).json({ error: "Missing required reading context or message" });
    }

    const ai = getAIClient();

    const previousLog = history && history.length > 0 
      ? history.map((h: any) => `${h.role === "user" ? "读者" : "伴学导师"}: ${h.parts}`).join("\n")
      : "无对话历史";

    const chatPrompt = `你当前正担任一本特别的共读丛书的“AI 随身伴读导师” (Reading Companion Mentor)。
正在阅读的图书：《${bookTitle}》（全书共 ${totalDays} 天计划）。
今天我们的进度是第 ${currentDay} 天，今天本章的共学论题是：《${dayTitle}》。
今天导读核心：${daySummary}

${dayExcerpt ? `本章用户读取的对应正文或文选片段如下：\n"""\n${dayExcerpt.slice(0, 3000)}\n"""` : "无上传正文文本，请根据该书在公有领域的真实篇章和学术知识与用户交谈。"}

在这里是你们之前的伴读交流历史：
${previousLog}

读者最新提出的深刻追问或分享内容：
"${userMessage}"

请对读者进行富有智慧、温暖、亲切又不失学术深度与哲学思辨高度的解答。
要求：
1. 用心倾听读者的观点，无论是困惑还是感悟，给予极其温厚且富有智慧的肯定或拓展。
2. 将回答字数控制在200-300字左右，排版采用段落清晰的中文。
3. 结尾可以点到为止地留下一句启发性反问，鼓励读者继续思索。`;

    const response = await generateContentWithRetry(ai, {
      model: "gemini-3.5-flash",
      contents: chatPrompt,
      config: {
        systemInstruction: "你是一位兼具文史哲底蕴、温和敦厚且擅长启发式苏格拉底提问的高级伴读学者。你总是以优雅的句法、丰盈的涵养与热切的共鸣回复读者。"
      }
    });

    res.json({ reply: response.text });
  } catch (error: any) {
    console.error("Chat error:", error);
    res.status(500).json({ error: error.message || "伴读导师走神了，请稍后再试。" });
  }
});

// API endpoint: Generate Downloadable, Exquisitely-Styled HTML Journal Output
app.post("/api/generate-journal", async (req, res) => {
  try {
    const { bookTitle, author, totalDays, schedule, userAnswers, userNotes, chatHistories } = req.body;

    if (!bookTitle || !schedule) {
      return res.status(400).json({ error: "缺少期刊生成必要的阅读记录和计划" });
    }

    // Build the beautiful embedded style system
    // Noto Serif SC, EB Garamond, Georgia style
    let journalHtml = `<!DOCTYPE html>
<html lang="zh-CN">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>《${bookTitle}》共读思辨周刊 / 个人心智研习志</title>
  <style>
    @import url('https://fonts.googleapis.com/css2?family=Georgia&family=Noto+Serif+SC:wght@300;400;600;700&family=Zhi+Mang+Xing&display=swap');
    
    :root {
      --bg-color: #faf7f2;
      --text-main: #2b2a27;
      --accent-sepia: #8c6239;
      --accent-dark: #3d3b36;
      --card-bg: #ffffff;
      --border-color: #e6e1d5;
      --shadow: 0 4px 18px rgba(115, 95, 75, 0.05);
    }

    * {
      box-sizing: border-box;
      margin: 0;
      padding: 0;
    }

    body {
      background-color: var(--bg-color);
      color: var(--text-main);
      font-family: 'Georgia', 'Noto Serif SC', serif;
      line-height: 1.7;
      padding: 3rem 1.5rem;
    }

    .container {
      max-width: 820px;
      margin: 0 auto;
      background-color: var(--card-bg);
      border: 1px solid var(--border-color);
      box-shadow: var(--shadow);
      border-radius: 12px;
      padding: 4rem 3.5rem;
      position: relative;
    }

    header {
      text-align: center;
      border-bottom: 2px solid var(--accent-sepia);
      padding-bottom: 2.5rem;
      margin-bottom: 3.5rem;
    }

    .editorial-badge {
      font-family: 'Georgia', sans-serif;
      text-transform: uppercase;
      letter-spacing: 0.15em;
      font-size: 0.75rem;
      color: var(--accent-sepia);
      font-weight: 600;
      border: 1px solid var(--accent-sepia);
      display: inline-block;
      padding: 0.2rem 1rem;
      margin-bottom: 1.2rem;
      border-radius: 20px;
    }

    h1 {
      font-size: 2.6rem;
      font-weight: 700;
      color: var(--accent-dark);
      letter-spacing: -0.02em;
      margin-bottom: 0.8rem;
    }

    .meta {
      font-size: 0.9rem;
      color: #6e6a5f;
      font-style: italic;
    }

    .meta span {
      margin: 0 0.8rem;
    }

    .intro-paragraph {
      font-size: 1.05rem;
      color: #555146;
      text-align: center;
      margin: -1.5rem auto 3rem auto;
      max-width: 650px;
      line-height: 1.8;
      border-bottom: 1px dashed var(--border-color);
      padding-bottom: 2rem;
    }

    .day-deck {
      margin-bottom: 4rem;
      page-break-inside: avoid;
    }

    .day-header {
      display: flex;
      align-items: baseline;
      border-bottom: 1px solid var(--accent-sepia);
      padding-bottom: 0.5rem;
      margin-bottom: 1.8rem;
    }

    .day-num {
      font-family: 'Georgia', serif;
      font-size: 1.8rem;
      font-weight: bold;
      color: var(--accent-sepia);
      margin-right: 1rem;
    }

    .day-title {
      font-size: 1.35rem;
      font-weight: 600;
      color: var(--accent-dark);
    }

    .section-grid {
      display: grid;
      grid-template-columns: 1fr;
      gap: 2rem;
    }

    .col-card {
      background-color: #fafaf7;
      border: 1px solid #eeebe3;
      border-radius: 8px;
      padding: 1.8rem;
    }

    .card-title {
      font-size: 0.85rem;
      font-weight: bold;
      text-transform: uppercase;
      letter-spacing: 0.1em;
      color: var(--accent-sepia);
      margin-bottom: 1rem;
      display: flex;
      align-items: center;
    }

    .summary-text {
      font-size: 0.95rem;
      color: #3d3b36;
      text-align: justify;
    }

    .qa-block {
      border-left: 2px solid #dfdcd3;
      padding-left: 1.2rem;
      margin-bottom: 1.5rem;
    }

    .item-q {
      font-size: 0.95rem;
      font-weight: 600;
      color: #4b4840;
      margin-bottom: 0.4rem;
    }

    .item-a {
      font-size: 0.95rem;
      color: #5e5a50;
      font-style: italic;
      background-color: #edf2ed;
      padding: 0.6rem 1rem;
      border-radius: 4px;
      border-left: 3px solid #8ba88f;
    }

    .unanswered {
      color: #a5a195;
      font-size: 0.85rem;
      font-style: italic;
    }

    .society-box {
      background: linear-gradient(135deg, #fdfbfa 0%, #f6f1ec 100%);
      border-left: 4px solid var(--accent-sepia);
    }

    .outlook-txt {
      font-size: 0.92rem;
      color: #555146;
      border-top: 1px dashed #e6e1d5;
      padding-top: 1rem;
      margin-top: 1rem;
    }

    .chat-transcript {
      background-color: #f6f8f6;
      border-radius: 6px;
      padding: 1.2rem;
      max-height: 250px;
      overflow-y: auto;
      border: 1px solid #e1e7e2;
    }

    .chat-msg {
      margin-bottom: 0.8rem;
      font-size: 0.88rem;
    }

    .chat-msg.user {
      color: #3b5c3f;
    }

    .chat-msg.model {
      color: #6c4f31;
    }

    .chat-role {
      font-weight: bold;
      margin-right: 0.4rem;
    }

    .notes-box {
      background-color: #f7f6f2;
      border: 1px solid var(--border-color);
      font-family: inherit;
      padding: 1rem;
      border-radius: 6px;
      font-size: 0.95rem;
      white-space: pre-wrap;
    }

    .footer-note {
      text-align: center;
      font-size: 0.85rem;
      color: #9c988d;
      border-top: 1px solid var(--border-color);
      padding-top: 2rem;
      margin-top: 5rem;
    }

    .action-row {
      text-align: center;
      margin-bottom: 2rem;
    }

    .print-btn {
      background-color: var(--accent-sepia);
      color: white;
      border: none;
      padding: 0.75rem 2rem;
      font-size: 1rem;
      font-family: inherit;
      font-weight: 600;
      border-radius: 30px;
      cursor: pointer;
      transition: all 0.2s ease;
      box-shadow: 0 4px 10px rgba(140, 98, 57, 0.2);
    }

    .print-btn:hover {
      background-color: var(--accent-dark);
      transform: translateY(-2px);
    }

    @media print {
      body {
        background-color: white;
        padding: 0;
      }
      .container {
        border: none;
        box-shadow: none;
        padding: 0;
      }
      .print-btn, .action-row {
        display: none !important;
      }
      .section-grid {
        grid-template-columns: 1fr;
      }
      .col-card {
        page-break-inside: avoid;
      }
    }
  </style>
</head>
<body>

  <div class="action-row">
    <button class="print-btn" onclick="window.print()">珍赏打印 / 保存为 PDF 周刊</button>
  </div>

  <div class="container">
    <header>
      <div class="editorial-badge">AI Human-Companion Journal</div>
      <h1>《${bookTitle}》思想共学研习志</h1>
      <div class="meta">
        <span>著者：${author || "经典大师"}</span>|
        <span>研习时长：${totalDays} 天</span>|
        <span>生成日期：${new Date().toLocaleDateString("zh-CN")}</span>
      </div>
    </header>

    <div class="intro-paragraph">
      “当纯真的文字与人工智能的时代视角激情碰撞，思想便架起了跨越时空的桥梁。”<br>
      本刊记录了读者在 ${totalDays} 天内的思想火花、对经典的深度主动反思、与AI伴学导师的苏格拉底式哲学追问，以及每一章节映射回现代数字社会的终极启示。
    </div>

    <div class="stream">
`;

    schedule.forEach((day: any) => {
      const answers: string[] = userAnswers[day.day] || [];
      const notes: string = userNotes[day.day] || "";
      const chat = chatHistories[day.day] || [];

      journalHtml += `
      <div class="day-deck">
        <div class="day-header">
          <span class="day-num">DAY ${day.day}</span>
          <span class="day-title">${day.title}</span>
        </div>
        
        <div class="section-grid">
          <!-- Left Col: Day Summary & Excerpt -->
          <div class="col-card">
            <div class="card-title">📖 经典导读与思想微光</div>
            <div class="summary-text" style="margin-bottom: 1.5rem;">
              ${day.summary}
            </div>
            
            ${day.hints && day.hints.length > 0 ? `
              <div style="font-size: 0.85rem; color:#8c6239; margin-top: 0.5rem;">
                <strong>核心预习提示：</strong> ${day.hints.join(" · ")}
              </div>
            ` : ""}
          </div>

          <!-- Story Analyses Breakdown -->
          ${day.storyAnalyses && day.storyAnalyses.length > 0 ? `
          <div class="col-card" style="border-left: 4px solid var(--accent-sepia);">
            <div class="card-title">📖 核心故事与至真义理剖解</div>
            
            ${day.storyAnalyses.map((story: any, sIdx: number) => `
              <div style="margin-bottom: 2rem; border-bottom: 1px dashed #dfdcd3; padding-bottom: 1.5rem; ${sIdx === day.storyAnalyses.length - 1 ? 'border-bottom: none; margin-bottom: 0; padding-bottom: 0;' : ''}">
                <div style="font-size: 1.1rem; font-weight: bold; color: var(--accent-dark); margin-bottom: 0.8rem;">
                  故事 ${sIdx + 1}: 《${story.storyName}》
                </div>
                
                <div style="display: grid; grid-template-columns: 1fr; gap: 0.8rem; margin-bottom: 1rem; font-size: 0.9rem; color: #5e5a50;">
                  <div style="margin-bottom: 0.4rem;">
                    <strong>🏛️ 时代大环境：</strong> ${story.background}
                  </div>
                  <div style="margin-bottom: 0.4rem;">
                    <strong>🧠 人物隐秘心理：</strong> ${story.psychology}
                  </div>
                  <div style="margin-bottom: 0.4rem;">
                    <strong>👑 社会地位：</strong> ${story.socialStatus}
                  </div>
                  <div style="margin-bottom: 0.4rem;">
                    <strong>🕸️ 复杂社会关系：</strong> ${story.socialRelations}
                  </div>
                </div>
                
                <div style="background-color: #faf8f5; border-left: 3px solid var(--accent-sepia); padding: 0.8rem 1.2rem; border-radius: 4px; font-size: 0.92rem; color: var(--text-main); margin-top: 0.5rem; line-height: 1.6;">
                  <strong>💡 核心义理与醍醐灌顶：</strong> ${story.essence}
                </div>
              </div>
            `).join("")}
          </div>
          ` : ""}

          <!-- Bottom: Active Recall & User Interaction Answers -->
          <div class="col-card">
            <div class="card-title">✍️ 主动回想与其思想回响</div>
            
            ${day.questions.map((q: string, qIdx: number) => {
              const uAns = answers[qIdx] || "";
              return `
              <div class="qa-block">
                <div class="item-q">问：${q}</div>
                <div class="item-a">
                  ${uAns.trim() ? uAns : `<span class="unanswered">（读者该题未做答，但在静思中完成了内省）</span>`}
                </div>
              </div>
              `;
            }).join("")}
          </div>

          <!-- Society reflection -->
          <div class="col-card society-box">
            <div class="card-title" style="color: #6b3e15;">⚡ 二十一世纪现代投影</div>
            <div class="summary-text">
              ${day.reflection}
            </div>
            <div class="outlook-txt">
              <strong>未来长远展望：</strong> ${day.outlook}
            </div>
          </div>

          <!-- Chat history transcript -->
          ${chat && chat.length > 0 ? `
            <div class="col-card">
              <div class="card-title">💬 AI伴学导师追问实录</div>
              <div class="chat-transcript">
                ${chat.map((msg: any) => `
                  <div class="chat-msg ${msg.role === "user" ? "user" : "model"}">
                    <span class="chat-role">${msg.role === "user" ? "读者" : "伴学导师"}:</span>
                    <span>${msg.parts}</span>
                  </div>
                `).join("")}
              </div>
            </div>
          ` : ""}

          <!-- User daily notes -->
          ${notes.trim() ? `
            <div class="col-card">
              <div class="card-title">📓 读者岁末札记与随笔</div>
              <div class="notes-box">${notes}</div>
            </div>
          ` : ""}
        </div>
      </div>
      `;
    });

    journalHtml += `
    </div>

    <div class="footer-note">
      <p>© ${new Date().getFullYear()} AI Reading Companion · 阅伴思想周刊</p>
      <p style="font-size: 0.75rem; margin-top: 0.5rem; letter-spacing: 0.05em; color: #b5b1a5;">
        由 Google Gemini-3.5 认知底座提供学术支持 · 追求纸质铅印质感 @media print 排版设计
      </p>
    </div>
  </div>

</body>
</html>`;

    // Make it downloadable as direct HTML file attachment
    res.setHeader("Content-Type", "text/html; charset=utf-8");
    res.setHeader("Content-Disposition", `attachment; filename="${encodeURIComponent(bookTitle)}_思辨周刊_成果展示.html"`);
    res.send(journalHtml);

  } catch (error: any) {
    console.error("Journal generate error:", error);
    res.status(500).json({ error: error.message || "生成阅读刊物模板失败。" });
  }
});

// API endpoint: Generate comparative modern translations and expert annotations for the reading excerpt
app.post("/api/generate-annotations", async (req, res) => {
  try {
    const { bookTitle, dayTitle, excerpt } = req.body;

    if (!excerpt) {
      return res.status(400).json({ error: "无原文文本，无法产出标注对比。" });
    }

    const allParagraphs = excerpt.split(/\n\n+/).map((p: string) => p.trim()).filter(Boolean);
    const paragraphs = allParagraphs.slice(0, 15); // limit to max 15 paragraphs to avoid timeout

    if (paragraphs.length === 0) {
      return res.json({ modernParaphrase: [], expertAnnotations: [] });
    }

    const ai = getAIClient();

    const annotationPrompt = `你现在是一位学富五车、洞察幽微的顶级经典伴读者与名校人文学科终身教授。
我们在共读的书籍是：《${bookTitle}》，本章研读论题为：《${dayTitle}》。

以下是今日章节的原文摘录（已经整理为 ${paragraphs.length} 个自然段段落）：
${paragraphs.map((p: string, idx: number) => `[第 ${idx + 1} 段 (原本)]:\n${p}`).join("\n\n")}

请针对每一个段落依次产出：
1. 【白话意译 / 核心精译对比 (modernParaphrase)】：用最通俗易懂、温润优美且富有现代应用视角的信息，对该段原本进行极富启示性的重写和对照，字数适中，解释原文中生涩或高度学术化的理路。
2. 【名家研读批注与微盲区提示 (expertAnnotations)】：指出该段落中的核心学术隐喻、作者背景冲突、人物隐秘微心理挣扎，或者现代凡夫俗子容易自我忽略的盲区见解。批注要求字句直接切入痛点，醍醐灌顶。

请严格返回符合 JSON 模式的返回对象。
重要约束：
- "modernParaphrase" 数组的长度必须【严格等于 ${paragraphs.length}】。
- "expertAnnotations" 数组的长度必须【严格等于 ${paragraphs.length}】。
- 每一个元素要和相对应的第 n 段原文严格 1:1 对齐，不能发生段落串行、漏翻译或者漏批注的历史。`;

    const response = await generateContentWithRetry(ai, {
      model: "gemini-3.5-flash",
      contents: annotationPrompt,
      config: {
        responseMimeType: "application/json",
        responseSchema: {
          type: Type.OBJECT,
          properties: {
            modernParaphrase: {
              type: Type.ARRAY,
              items: { type: Type.STRING },
              description: "与原文每个段落一一对应的现代释义对比，数量应严格等于原本段落数"
            },
            expertAnnotations: {
              type: Type.ARRAY,
              items: { type: Type.STRING },
              description: "与原文每个段落一一对应的专家/名师导享深度批注，数量应严格等于原本段落数"
            }
          },
          required: ["modernParaphrase", "expertAnnotations"]
        }
      }
    });

    const parsedData = JSON.parse(response.text);

    // Dynamic defense: If model returns fewer list elements, pad the arrays so we never crash the UI
    while (parsedData.modernParaphrase.length < paragraphs.length) {
      parsedData.modernParaphrase.push("伴读者心领神会，本段原文精要尽在此行。");
    }
    while (parsedData.expertAnnotations.length < paragraphs.length) {
      parsedData.expertAnnotations.push("研读重点：本段理路顺畅，可带着批判意图进一步向两侧思考。");
    }

    res.json({
      modernParaphrase: parsedData.modernParaphrase.slice(0, paragraphs.length),
      expertAnnotations: parsedData.expertAnnotations.slice(0, paragraphs.length)
    });

  } catch (error: any) {
    console.error("Generate annotations error:", error);
    res.status(500).json({ error: error.message || "生成智译批注和名家解读失败。" });
  }
});

// Start integration server middleware or production serving
async function bootstrap() {
  if (process.env.NODE_ENV !== "production") {
    // Vite Dev Server Middleware mode
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa",
    });
    app.use(vite.middlewares);
  } else {
    // Serve production static folder
    const distPath = path.join(process.cwd(), "dist");
    app.use(express.static(distPath));
    app.get("*", (req, res) => {
      res.sendFile(path.join(distPath, "index.html"));
    });
  }

  app.listen(PORT, "0.0.0.0", () => {
    console.log(`Express and Vite fullstack development server running on port ${PORT}`);
  });
}

bootstrap();
