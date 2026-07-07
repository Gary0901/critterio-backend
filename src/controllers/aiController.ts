import { Response } from 'express';
import OpenAI from 'openai';
import { AuthRequest } from '../middleware/auth';
import AiConversation from '../models/AiConversation';
import Pet from '../models/Pet';
import { uploadImage } from '../utils/cloudinary';

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

  // 加入寵物背景資訊
  let systemPrompt = SYSTEM_PROMPT;
  if (conv.petId) {
    try {
      const pet = await Pet.findById(conv.petId).lean();
      if (pet) {
        const age = Math.floor(
          (Date.now() - new Date((pet as any).birthday).getTime()) / (1000 * 60 * 60 * 24 * 365)
        );
        systemPrompt += `\n\n目前諮詢的寵物：${(pet as any).name}，${(pet as any).species}，${(pet as any).breed}，${age} 歲，體重 ${(pet as any).weight} kg。`;
      }
    } catch {
      // invalid petId, skip
    }
  }

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
    const stream = await openai.chat.completions.create({
      model: 'gpt-4o-mini',
      max_tokens: 1024,
      messages: gptMessages,
      stream: true,
    });

    for await (const chunk of stream) {
      const delta = chunk.choices[0]?.delta?.content ?? '';
      if (delta) {
        fullContent += delta;
        res.write(`data: ${JSON.stringify({ delta })}\n\n`);
      }
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
