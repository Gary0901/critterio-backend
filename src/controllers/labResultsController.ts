import { Response } from 'express';
import OpenAI from 'openai';
import { AuthRequest } from '../middleware/auth';
import Pet from '../models/Pet';
import LabResult, { LabResultItem } from '../models/LabResult';
import { uploadImage, deleteImageByUrl } from '../utils/cloudinary';
import { searchKnowledgeBase } from '../utils/knowledgeSearch';

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

// 鳥類/爬蟲類：base model 知識較弱，異常值的白話解釋要接 RAG 知識庫佐證
const EXOTIC_SPECIES = new Set(['bird', 'reptile']);

const SPECIES_LABEL: Record<string, string> = {
  dog: '狗', cat: '貓', rabbit: '兔子', small: '小型哺乳類（倉鼠/天竺鼠等）',
  bird: '鳥類', reptile: '爬蟲類', other: '寵物',
};

type ExtractedItem = Omit<LabResultItem, 'plainExplanation'>;

// ─── 第一階段：從報告照片抽取數值型項目（不生成白話解釋）─────────────────────────

const EXTRACTION_SYSTEM_PROMPT = `你是專業的獸醫數據解析助手。使用者會傳入一張寵物血檢/生化/尿檢等「數值型」檢驗報告照片。

請只抽取有「數值」的檢測項目（例如 ALT、BUN、GLU、WBC 等），不要嘗試解讀 X 光、超音波等影像類報告的內容——如果照片看起來是影像報告而非數值報告，items 請回傳空陣列。

規則：
1. status 的判定必須完全依照報告單上印出的參考範圍（reference range）。如果該項目報告單上沒有印出參考範圍，一律回傳 status: "UNKNOWN"，絕對不可以套用你自己知道的通用標準去猜測高低。
2. refRange 請照報告單上印出的原始文字填入；沒有印出就留空字串。
3. abbreviation 若報告單上有印出縮寫（如 ALT、BUN）就填入，沒有就留空字串。
4. value 請填數字（去除單位），unit 填該項目的單位。`;

const EXTRACTION_JSON_SCHEMA = {
  name: 'lab_result_extraction',
  schema: {
    type: 'object',
    properties: {
      reportType: { type: 'string', description: '報告類型英文代碼，例如 blood_biochemistry、cbc、urinalysis、unknown' },
      items: {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            itemName: { type: 'string', description: '檢測項目中文名稱' },
            abbreviation: { type: 'string' },
            value: { type: 'number' },
            unit: { type: 'string' },
            refRange: { type: 'string' },
            status: { type: 'string', enum: ['NORMAL', 'HIGH', 'LOW', 'UNKNOWN'] },
          },
          required: ['itemName', 'abbreviation', 'value', 'unit', 'refRange', 'status'],
          additionalProperties: false,
        },
      },
    },
    required: ['reportType', 'items'],
    additionalProperties: false,
  },
  strict: true,
} as const;

async function extractItemsFromImage(
  imageUrl: string,
  speciesLabel: string
): Promise<{ reportType: string; items: ExtractedItem[] }> {
  const completion = await openai.chat.completions.create({
    model: 'gpt-4o-mini',
    max_tokens: 2048,
    messages: [
      { role: 'system', content: EXTRACTION_SYSTEM_PROMPT },
      {
        role: 'user',
        content: [
          { type: 'text', text: `這是一隻${speciesLabel}的檢驗報告照片，請依規則抽取數值型項目。` },
          { type: 'image_url', image_url: { url: imageUrl } },
        ],
      },
    ],
    response_format: { type: 'json_schema', json_schema: EXTRACTION_JSON_SCHEMA },
  });

  const raw = completion.choices[0]?.message?.content ?? '{"reportType":"unknown","items":[]}';
  const parsed = JSON.parse(raw) as { reportType: string; items: ExtractedItem[] };
  return parsed;
}

// ─── 第二階段：生成白話文解釋（鳥類/爬蟲類異常值先查 RAG 佐證）─────────────────

const EXPLANATION_JSON_SCHEMA = {
  name: 'lab_result_explanation',
  schema: {
    type: 'object',
    properties: {
      items: {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            itemName: { type: 'string' },
            plainExplanation: { type: 'string', description: '給飼主看的通俗中文解釋，說明該指標偏高/偏低/正常代表什麼臨床意義，語氣溫暖不嚇人，非診斷' },
          },
          required: ['itemName', 'plainExplanation'],
          additionalProperties: false,
        },
      },
      summaryAdvice: { type: 'string', description: '整份報告的整體建議，1-2 句話' },
    },
    required: ['items', 'summaryAdvice'],
    additionalProperties: false,
  },
  strict: true,
} as const;

async function buildKnowledgeContext(species: string, items: ExtractedItem[]): Promise<string> {
  const abnormal = items.filter((i) => i.status === 'HIGH' || i.status === 'LOW');
  if (abnormal.length === 0) return '';

  const snippets: string[] = [];
  for (const item of abnormal) {
    try {
      const results = (await searchKnowledgeBase(
        `${item.itemName} ${item.abbreviation ?? ''}`.trim(), species, 'lab_interpretation'
      )) as Array<{ sourceTitle: string; text: string }>;
      if (results.length > 0) {
        snippets.push(`【${item.itemName}】文獻段落：${results[0].text}`);
      }
    } catch (e) {
      console.error(`[labResultsController] RAG 查詢失敗 item=${item.itemName}`, e);
    }
  }
  return snippets.join('\n\n');
}

async function generateExplanations(
  species: string,
  speciesLabel: string,
  reportType: string,
  items: ExtractedItem[]
): Promise<{ items: LabResultItem[]; summaryAdvice: string }> {
  if (items.length === 0) return { items: [], summaryAdvice: '' };

  const knowledgeContext = EXOTIC_SPECIES.has(species) ? await buildKnowledgeContext(species, items) : '';

  const systemPrompt = `你是 Critterio App 的 AI 寵物健康專家。以下是一隻${speciesLabel}的檢驗報告，已經結構化抽取出各項數值，請為每一項生成給飼主看的白話文解釋。

規則：
1. 不開立具體藥物名稱或劑量，不做診斷，只說明數值代表的臨床意義並提醒是否該留意/回診。
2. status 已經是根據報告單本身的參考範圍判定好的，直接引用，不要自己重新判斷。
3. 若某項目提供了「文獻段落」佐證，請在該項目的解釋中適度引用文獻內容讓建議更有根據；沒有提供文獻的項目，依你原有的專業知識回答即可。
4. summaryAdvice 用 1-2 句話總結整份報告，語氣溫暖，避免嚇到飼主。`;

  const userContent = [
    `報告類型：${reportType}`,
    `項目數值：${JSON.stringify(items)}`,
    knowledgeContext ? `\n可參考的權威文獻段落：\n${knowledgeContext}` : '',
  ].join('\n');

  const completion = await openai.chat.completions.create({
    model: 'gpt-4o-mini',
    max_tokens: 2048,
    messages: [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: userContent },
    ],
    response_format: { type: 'json_schema', json_schema: EXPLANATION_JSON_SCHEMA },
  });

  const raw = completion.choices[0]?.message?.content ?? '{"items":[],"summaryAdvice":""}';
  const parsed = JSON.parse(raw) as { items: { itemName: string; plainExplanation: string }[]; summaryAdvice: string };

  const explanationByName = new Map(parsed.items.map((i) => [i.itemName, i.plainExplanation]));
  const merged: LabResultItem[] = items.map((item) => ({
    ...item,
    plainExplanation: explanationByName.get(item.itemName) ?? '',
  }));

  return { items: merged, summaryAdvice: parsed.summaryAdvice };
}

function formatLabResult(doc: any) {
  return {
    id: doc._id,
    petId: doc.petId,
    imageUrl: doc.imageUrl,
    reportType: doc.reportType,
    reportDate: doc.reportDate,
    items: doc.items,
    summaryAdvice: doc.summaryAdvice,
    createdAt: doc.createdAt,
  };
}

// ─── Endpoints ──────────────────────────────────────────────────────────────

export async function parseLabResult(req: AuthRequest, res: Response): Promise<void> {
  const pet = await Pet.findOne({ _id: req.params.id, userId: req.userId });
  if (!pet) {
    res.status(404).json({ success: false, data: null, message: '找不到寵物' });
    return;
  }
  if (!req.file) {
    res.status(400).json({ success: false, data: null, message: '報告照片為必填' });
    return;
  }

  const speciesLabel = SPECIES_LABEL[pet.species] ?? '寵物';
  let imageUrl: string;
  try {
    imageUrl = await uploadImage(req.file.buffer, 'critterio/lab-results');
  } catch (e) {
    console.error(`[labResultsController] 圖片上傳失敗，petId=${pet._id}`, e);
    res.status(500).json({ success: false, data: null, message: '圖片上傳失敗，請稍後再試' });
    return;
  }

  try {
    const { reportType, items } = await extractItemsFromImage(imageUrl, speciesLabel);
    const { items: itemsWithExplanation, summaryAdvice } = await generateExplanations(
      pet.species, speciesLabel, reportType, items
    );
    res.json({
      success: true,
      data: {
        imageUrl,
        reportType,
        items: itemsWithExplanation,
        summaryAdvice,
      },
      message: '',
    });
  } catch (e) {
    console.error(`[labResultsController] 報告解析失敗，petId=${pet._id}`, e);
    res.status(500).json({ success: false, data: null, message: 'AI 報告解析失敗，請稍後再試' });
  }
}

export async function saveLabResult(req: AuthRequest, res: Response): Promise<void> {
  const pet = await Pet.findOne({ _id: req.params.id, userId: req.userId });
  if (!pet) {
    res.status(404).json({ success: false, data: null, message: '找不到寵物' });
    return;
  }
  const { imageUrl, reportType, reportDate, items, summaryAdvice } = req.body;
  if (!imageUrl || !reportType || !reportDate || !Array.isArray(items)) {
    res.status(400).json({ success: false, data: null, message: 'imageUrl、reportType、reportDate、items 為必填' });
    return;
  }

  const result = await LabResult.create({
    petId: pet._id,
    imageUrl,
    reportType,
    reportDate: new Date(reportDate),
    items,
    summaryAdvice: summaryAdvice ?? '',
  });
  res.status(201).json({ success: true, data: formatLabResult(result), message: '報告已儲存' });
}

export async function getLabResults(req: AuthRequest, res: Response): Promise<void> {
  const pet = await Pet.findOne({ _id: req.params.id, userId: req.userId });
  if (!pet) {
    res.status(404).json({ success: false, data: null, message: '找不到寵物' });
    return;
  }
  const results = await LabResult.find({ petId: pet._id }).sort({ reportDate: -1 });
  res.json({ success: true, data: results.map(formatLabResult), message: '' });
}

export async function getLabResult(req: AuthRequest, res: Response): Promise<void> {
  const pet = await Pet.findOne({ _id: req.params.id, userId: req.userId });
  if (!pet) {
    res.status(404).json({ success: false, data: null, message: '找不到寵物' });
    return;
  }
  const result = await LabResult.findOne({ _id: req.params.resultId, petId: pet._id });
  if (!result) {
    res.status(404).json({ success: false, data: null, message: '找不到報告' });
    return;
  }
  res.json({ success: true, data: formatLabResult(result), message: '' });
}

export async function deleteLabResult(req: AuthRequest, res: Response): Promise<void> {
  const pet = await Pet.findOne({ _id: req.params.id, userId: req.userId });
  if (!pet) {
    res.status(404).json({ success: false, data: null, message: '找不到寵物' });
    return;
  }
  const result = await LabResult.findOneAndDelete({ _id: req.params.resultId, petId: pet._id });
  if (!result) {
    res.status(404).json({ success: false, data: null, message: '找不到報告' });
    return;
  }
  await deleteImageByUrl(result.imageUrl).catch((e) =>
    console.error(`[labResultsController] 報告圖片刪除失敗，resultId=${result._id}`, e)
  );
  res.json({ success: true, data: null, message: '報告已刪除' });
}
