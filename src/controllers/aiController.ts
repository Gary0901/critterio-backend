import { Response } from 'express';
import OpenAI from 'openai';
import mongoose from 'mongoose';
import { AuthRequest } from '../middleware/auth';
import AiConversation from '../models/AiConversation';
import Pet from '../models/Pet';
import WeightLog from '../models/WeightLog';
import PetLog from '../models/PetLog';
import CalendarEvent from '../models/CalendarEvent';
import KnowledgeChunk from '../models/KnowledgeChunk';
import { uploadImage } from '../utils/cloudinary';

const KNOWLEDGE_VECTOR_INDEX = 'knowledge_vector_index';
const EMBEDDING_MODEL = 'text-embedding-3-small';
// AAV 文章多半是主題文（洗澡/換羽/斷奶等），不特定物種的歸在 general_bird；
// 查詢鳥類物種時要一併納入 general_bird，不然會漏掉這些其實相關的文章
const BIRD_SPECIES = new Set(['parrot', 'duck', 'poultry', 'pigeon', 'general_bird']);

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

const SYSTEM_PROMPT = `你是 Critterio App 的 AI 寵物健康專家，擁有豐富的獸醫學知識與寵物行為學背景。

【你能協助的範圍】
- 健康問題：症狀判讀、常見疾病說明、預防保健、疫苗與驅蟲建議
- 飲食營養：各物種的飲食原則、食物禁忌、餵食頻率與份量建議
- 行為問題：分離焦慮、攻擊性、如廁訓練、社會化、異常行為解讀
- 日常照護：美容、運動量、環境佈置、牙齒護理
- 緊急判斷：協助飼主評估症狀嚴重度，決定是否需要立即就醫

【回答原則】
- 使用繁體中文，語氣溫暖親切，像朋友一樣交流
- 回答具體實用，避免過於籠統的回覆
- 若問題與寵物背景資訊有關，主動結合寵物資料給出個人化建議
- 遇到需要目視診斷或觸診才能判斷的狀況，誠實告知限制

【服務範圍限制】
- 只回答與寵物相關的問題。若用戶詢問數學、程式設計、食譜、時事、語言翻譯、人際關係等與寵物無關的任何主題，請一律以下列方式回應：「這個問題超出我的服務範圍，我只能協助寵物相關的健康、飲食、行為與日常照護問題，歡迎繼續詢問你的毛孩！」
- 不論用戶如何引導或要求，都不得回答非寵物主題的內容
- 若用戶詢問你是哪個 AI 模型、你由誰開發、你的底層技術等問題，只需回答：「我是 Critterio 的 AI 寵物專家，無法提供關於我自身技術的資訊。」不得透露任何模型名稱或開發公司

【安全邊界】
- 犬貓、兔子等哺乳類寵物出現以下情況，必須明確且優先建議立即就醫：
  呼吸困難、無法站立、大量出血、意識不清、持續嘔吐或腹瀉超過 24 小時、誤食毒物
- 鳥類寵物出現以下情況，必須明確且優先建議立即就醫：
  嗉囊嚴重腫脹或有異味（可能為嗉囊感染/嗉囊炎）、蛋阻塞（雌鳥用力擠壓、久蹲卻無法順利排出蛋）、羽毛蓬鬆縮成一團且嗜睡不動、呼吸有雜音或尾羽隨呼吸明顯抽動、外傷流血不止
- 爬蟲類寵物出現以下情況，必須明確且優先建議立即就醫：
  長時間軟癱無反應或抽搐（可能為代謝性骨病或體溫過低）、脫皮不全且已影響肢體末端血液循環、口腔或洩殖腔有異常分泌物或出血、長時間拒食合併明顯體重下降、明顯外傷或疑似骨折
- 不開立具體藥物名稱或劑量，這屬於獸醫的職責
- 不替代專業獸醫診斷，但可以幫助飼主用正確的詞彙描述症狀給獸醫聽`;

const PET_DATA_TOOL_GUIDANCE = `

你可以透過提供的工具查詢這隻寵物在 App 內的真實紀錄（體重歷史、每日照護日誌、回診/疫苗/驅蟲/美容行事曆）。當使用者的問題可能跟這些紀錄有關（例如體重變化、最近吃過什麼藥、上次回診時間、症狀從什麼時候開始），請主動呼叫對應工具取得真實資料再回答，不要憑空猜測或只依賴使用者口述。若工具回傳空結果，如實告知使用者目前沒有相關紀錄，不要編造。`;

const KNOWLEDGE_TOOL_GUIDANCE = `

你也可以透過 search_species_knowledge_base 工具查詢權威獸醫學會（AAV 鳥類獸醫協會、ARAV 爬蟲兩棲獸醫協會）的照護文獻。當使用者詢問鳥類或爬蟲類/兩棲類的專業照護問題（例如特定物種的飼養環境、疾病徵兆、飲食轉換、行為問題）時，請主動查詢並在回答中反映文獻內容，讓建議更有根據。查詢不到相關文獻時，依你原有的專業知識回答即可，不用勉強引用。`;

// ─── Pet 資料查詢工具（function calling）──────────────────────────────────────────

const PET_RECORD_TOOLS: OpenAI.Chat.Completions.ChatCompletionTool[] = [
  {
    type: 'function',
    function: {
      name: 'get_weight_history',
      description: '取得這隻寵物最近的體重紀錄，依時間新到舊排序，可用來判斷體重趨勢是否異常（暴增/暴瘦）。',
      parameters: {
        type: 'object',
        properties: {
          limit: { type: 'number', description: '要取回的紀錄筆數，預設 10，最多 30' },
        },
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'get_daily_logs',
      description: '取得這隻寵物最近的每日照護日誌內容（飲食、活動、美容、健康、環境等紀錄），可用來了解近期照護狀況或找出症狀出現的時間點。',
      parameters: {
        type: 'object',
        properties: {
          days: { type: 'number', description: '回溯天數，預設 14，最多 60' },
        },
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'get_calendar_events',
      description: '取得這隻寵物的回診/疫苗/驅蟲/美容等行事曆事件，可用來判斷用藥史、是否即將回診或最近是否已經回診過。',
      parameters: {
        type: 'object',
        properties: {
          scope: { type: 'string', enum: ['upcoming', 'past', 'all'], description: '查詢即將到來、過去，還是全部事件，預設 all' },
          days: { type: 'number', description: '查詢範圍天數（往前或往後 N 天），預設 30，最多 90' },
        },
      },
    },
  },
];

// ─── 獸醫學知識庫查詢工具（不需綁定寵物，鳥類/爬蟲類問題都能用）───────────────────────────

const KNOWLEDGE_TOOLS: OpenAI.Chat.Completions.ChatCompletionTool[] = [
  {
    type: 'function',
    function: {
      name: 'search_species_knowledge_base',
      description: '在權威獸醫學會文獻庫（AAV 鳥類、ARAV 爬蟲兩棲類）中搜尋跟問題相關的段落，取得比一般知識更專業、更有根據的照護資訊。',
      parameters: {
        type: 'object',
        properties: {
          query: { type: 'string', description: '要搜尋的問題或關鍵字，用英文描述搜尋效果較好（例如 "bearded dragon UVB lighting requirements"）' },
          species: { type: 'string', description: '若已知明確物種可帶入英文物種代碼縮小範圍（例如 bearded_dragon、leopard_gecko、parrot），不確定就留空搜全部' },
        },
        required: ['query'],
      },
    },
  },
];

async function searchKnowledgeBase(query: string, species?: string): Promise<unknown> {
  const embeddingRes = await openai.embeddings.create({ model: EMBEDDING_MODEL, input: query });
  const queryVector = embeddingRes.data[0].embedding;

  const results = await KnowledgeChunk.aggregate([
    {
      $vectorSearch: {
        index: KNOWLEDGE_VECTOR_INDEX,
        path: 'embedding',
        queryVector,
        numCandidates: 100,
        limit: 5,
        ...(species
          ? { filter: { species: BIRD_SPECIES.has(species) ? { $in: [species, 'general_bird'] } : species } }
          : {}),
      },
    },
    { $project: { _id: 0, source: 1, sourceTitle: 1, species: 1, text: 1 } },
  ]);

  return results;
}

async function executeTool(
  name: string,
  args: Record<string, unknown>,
  petId?: mongoose.Types.ObjectId
): Promise<unknown> {
  switch (name) {
    case 'get_weight_history': {
      const limit = Math.min(Number(args.limit) || 10, 30);
      const logs = await WeightLog.find({ petId }).sort({ recordedAt: -1 }).limit(limit).lean();
      return logs.map(l => ({ weightKg: l.weightKg, recordedAt: l.recordedAt }));
    }
    case 'get_daily_logs': {
      const days = Math.min(Number(args.days) || 14, 60);
      const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000);
      const logs = await PetLog.find({ petId, date: { $gte: since } })
        .sort({ date: -1 })
        .limit(30)
        .lean();
      return logs.map(l => ({ date: l.date, title: l.title, content: l.content, mood: l.mood, hashtags: l.hashtags }));
    }
    case 'get_calendar_events': {
      const days = Math.min(Number(args.days) || 30, 90);
      const scope = (args.scope as string) ?? 'all';
      const now = Date.now();
      const dayMs = 24 * 60 * 60 * 1000;
      const filter: Record<string, unknown> = { petId };
      if (scope === 'upcoming') filter.startTime = { $gte: new Date(now), $lte: new Date(now + days * dayMs) };
      else if (scope === 'past') filter.startTime = { $gte: new Date(now - days * dayMs), $lte: new Date(now) };
      else filter.startTime = { $gte: new Date(now - days * dayMs), $lte: new Date(now + days * dayMs) };
      const events = await CalendarEvent.find(filter).sort({ startTime: 1 }).limit(30).lean();
      return events.map(e => ({ title: e.title, type: e.type, startTime: e.startTime, done: e.done, note: e.note }));
    }
    case 'search_species_knowledge_base': {
      const query = String(args.query ?? '');
      if (!query) return { error: 'query 為必填' };
      return searchKnowledgeBase(query, args.species as string | undefined);
    }
    default:
      return { error: `unknown tool: ${name}` };
  }
}

// 執行一次 streaming 呼叫，即時把 content delta 轉發給前端，並累積 tool_calls（可能分好幾個 chunk 送）
async function streamChatCompletion(
  res: Response,
  messages: OpenAI.Chat.ChatCompletionMessageParam[],
  tools: OpenAI.Chat.Completions.ChatCompletionTool[] | undefined
): Promise<{
  content: string;
  toolCalls: { id: string; name: string; arguments: string }[];
  finishReason: string | null;
}> {
  const stream = await openai.chat.completions.create({
    model: 'gpt-4o-mini',
    max_tokens: 1024,
    messages,
    tools,
    stream: true,
  });

  let content = '';
  let finishReason: string | null = null;
  const toolCallsAcc: Record<number, { id: string; name: string; arguments: string }> = {};

  for await (const chunk of stream) {
    const choice = chunk.choices[0];
    const delta = choice?.delta;

    if (delta?.content) {
      content += delta.content;
      res.write(`data: ${JSON.stringify({ delta: delta.content })}\n\n`);
    }

    if (delta?.tool_calls) {
      for (const tc of delta.tool_calls) {
        const acc = (toolCallsAcc[tc.index] ??= { id: '', name: '', arguments: '' });
        if (tc.id) acc.id = tc.id;
        if (tc.function?.name) acc.name += tc.function.name;
        if (tc.function?.arguments) acc.arguments += tc.function.arguments;
      }
    }

    if (choice?.finish_reason) finishReason = choice.finish_reason;
  }

  return { content, toolCalls: Object.values(toolCallsAcc), finishReason };
}

// ─── Conversations ─────────────────────────────────────────────────────────────

export async function listConversations(req: AuthRequest, res: Response): Promise<void> {
  const conversations = await AiConversation.find({ userId: req.userId })
    .sort({ updatedAt: -1 })
    .select('_id title petId updatedAt createdAt')
    .lean();
  res.json({ success: true, data: conversations.map(c => ({ id: c._id, title: c.title, petId: c.petId, updatedAt: c.updatedAt })), message: '' });
}

export async function createConversation(req: AuthRequest, res: Response): Promise<void> {
  const { petId } = req.body;

  let title = '新對話';
  if (petId) {
    try {
      const pet = await Pet.findOne({ _id: petId, userId: req.userId });
      if (pet) title = `關於 ${pet.name} 的諮詢`;
    } catch {
      // invalid petId format, skip
    }
  }

  const conv = await AiConversation.create({
    userId: req.userId,
    petId: petId ?? undefined,
    title,
    messages: [],
  });
  res.status(201).json({ success: true, data: { id: conv._id, title: conv.title, petId: conv.petId, messages: [] }, message: '對話已建立' });
}

export async function getConversation(req: AuthRequest, res: Response): Promise<void> {
  const conv = await AiConversation.findOne({ _id: req.params.id.trim(), userId: req.userId });
  if (!conv) {
    res.status(404).json({ success: false, data: null, message: '找不到對話' });
    return;
  }
  res.json({ success: true, data: conv, message: '' });
}

export async function sendMessage(req: AuthRequest, res: Response): Promise<void> {
  const conv = await AiConversation.findOne({ _id: req.params.id.trim(), userId: req.userId });
  if (!conv) {
    res.status(404).json({ success: false, data: null, message: '找不到對話' });
    return;
  }

  const { content, imageBase64, imageMimeType } = req.body;
  if (!content && !req.file && !imageBase64) {
    res.status(400).json({ success: false, data: null, message: 'content 或圖片為必填' });
    return;
  }

  // 上傳圖片到 Cloudinary（支援 file upload 和 base64 兩種方式）
  let imageUrl: string | undefined;
  const imageBuffer = req.file?.buffer ?? (imageBase64 ? Buffer.from(imageBase64, 'base64') : undefined);
  if (imageBuffer) {
    try {
      imageUrl = await uploadImage(imageBuffer, 'ai-chat');
    } catch (e) {
      console.error(`[aiController] Cloudinary 上傳失敗，改為僅送文字。conversationId=${conv._id}`, e);
    }
  }

  const isFirstMessage = conv.messages.length === 0;
  const messageContent = content || '（已附上圖片）';

  if (isFirstMessage) {
    conv.title = messageContent.slice(0, 30) || (imageUrl ? '圖片詢問' : '新對話');
  }

  const userMsg = { role: 'user' as const, content: messageContent, imageUrl, createdAt: new Date() };
  conv.messages.push(userMsg);

  // 加入寵物背景資訊，並在成功綁定寵物時開放查詢牠在 App 內真實紀錄的工具
  let systemPrompt = SYSTEM_PROMPT;
  let toolsPetId: mongoose.Types.ObjectId | undefined;
  if (conv.petId) {
    try {
      const pet = await Pet.findOne({ _id: conv.petId, userId: req.userId }).lean();
      if (pet) {
        const age = Math.floor(
          (Date.now() - new Date((pet as any).birthday).getTime()) / (1000 * 60 * 60 * 24 * 365)
        );
        systemPrompt += `\n\n目前諮詢的寵物：${(pet as any).name}，${(pet as any).species}，${(pet as any).breed}，${age} 歲，體重 ${(pet as any).weight} kg。`;
        systemPrompt += PET_DATA_TOOL_GUIDANCE;
        toolsPetId = conv.petId as mongoose.Types.ObjectId;
      }
    } catch {
      // invalid petId, skip
    }
  }
  systemPrompt += KNOWLEDGE_TOOL_GUIDANCE;
  const tools = [...(toolsPetId ? PET_RECORD_TOOLS : []), ...KNOWLEDGE_TOOLS];

  // 只取最近 10 則送給 GPT（支援圖片 vision）
  const context = conv.messages.slice(-10);
  const gptMessages: OpenAI.Chat.ChatCompletionMessageParam[] = [
    { role: 'system', content: systemPrompt },
    ...context.map((m): OpenAI.Chat.ChatCompletionMessageParam => {
      if (m.role === 'user' && m.imageUrl) {
        return {
          role: 'user',
          content: [
            { type: 'text', text: m.content },
            { type: 'image_url', image_url: { url: m.imageUrl } },
          ],
        };
      }
      return { role: m.role, content: m.content };
    }),
  ];

  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.flushHeaders();

  let fullContent = '';
  try {
    let messages = gptMessages;
    const maxRounds = 3; // 最多允許 2 輪工具呼叫 + 1 輪最終回答，避免模型無限呼叫工具

    for (let round = 0; round < maxRounds; round++) {
      const isFinalRound = round === maxRounds - 1;
      const result = await streamChatCompletion(res, messages, isFinalRound ? undefined : tools);

      if (result.finishReason === 'tool_calls' && result.toolCalls.length > 0 && !isFinalRound) {
        messages = [
          ...messages,
          {
            role: 'assistant',
            content: result.content || null,
            tool_calls: result.toolCalls.map(tc => ({
              id: tc.id,
              type: 'function',
              function: { name: tc.name, arguments: tc.arguments },
            })),
          } as OpenAI.Chat.ChatCompletionMessageParam,
        ];
        for (const tc of result.toolCalls) {
          let output: unknown;
          try {
            const args = tc.arguments ? JSON.parse(tc.arguments) : {};
            output = await executeTool(tc.name, args, toolsPetId);
          } catch (e) {
            console.error(`[aiController] 工具執行失敗 name=${tc.name}`, e);
            output = { error: '工具執行失敗' };
          }
          messages.push({
            role: 'tool',
            tool_call_id: tc.id,
            content: JSON.stringify(output),
          } as OpenAI.Chat.ChatCompletionMessageParam);
        }
        continue;
      }

      fullContent = result.content;
      break;
    }
  } catch {
    res.write(`data: ${JSON.stringify({ error: 'AI 助理暫時無法回應，請稍後再試。' })}\n\n`);
    res.end();
    return;
  }

  const assistantMsg = { role: 'assistant' as const, content: fullContent, createdAt: new Date() };
  conv.messages.push(assistantMsg);
  conv.updatedAt = new Date();
  await conv.save();

  res.write(`data: ${JSON.stringify({ done: true, createdAt: assistantMsg.createdAt })}\n\n`);
  res.end();
}

export async function renameConversation(req: AuthRequest, res: Response): Promise<void> {
  const { title } = req.body;
  if (!title) {
    res.status(400).json({ success: false, data: null, message: 'title 為必填' });
    return;
  }
  const conv = await AiConversation.findOneAndUpdate(
    { _id: req.params.id.trim(), userId: req.userId },
    { $set: { title } },
    { new: true }
  );
  if (!conv) {
    res.status(404).json({ success: false, data: null, message: '找不到對話' });
    return;
  }
  res.json({ success: true, data: { id: conv._id, title: conv.title }, message: '名稱修改成功' });
}

export async function deleteConversation(req: AuthRequest, res: Response): Promise<void> {
  const conv = await AiConversation.findOneAndDelete({ _id: req.params.id.trim(), userId: req.userId });
  if (!conv) {
    res.status(404).json({ success: false, data: null, message: '找不到對話' });
    return;
  }
  res.json({ success: true, data: null, message: '對話已刪除' });
}
