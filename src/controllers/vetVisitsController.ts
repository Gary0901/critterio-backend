import { Response } from 'express';
import OpenAI from 'openai';
import { AuthRequest } from '../middleware/auth';
import Pet from '../models/Pet';
import VetVisit, { LabResultItem } from '../models/VetVisit';
import CalendarEvent from '../models/CalendarEvent';
import VisitParseJob from '../models/VisitParseJob';
import { uploadImage, deleteImageByUrl } from '../utils/cloudinary';
import { searchKnowledgeBase } from '../utils/knowledgeSearch';
import { sendNotification } from '../utils/push';

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

// 鳥類/爬蟲類：base model 知識較弱，異常值的白話解釋要接 RAG 知識庫佐證
const EXOTIC_SPECIES = new Set(['bird', 'reptile']);

const SPECIES_LABEL: Record<string, string> = {
  dog: '狗', cat: '貓', rabbit: '兔子', small: '小型哺乳類（倉鼠/天竺鼠等）',
  bird: '鳥類', reptile: '爬蟲類', other: '寵物',
};

type ExtractedItem = Omit<LabResultItem, 'plainExplanation'>;

// ─── 檢驗報告數值解析（就醫紀錄裡的可選子步驟）：抽取數值型項目（不生成白話解釋）─────

const EXTRACTION_SYSTEM_PROMPT = `你是專業的獸醫數據解析助手。使用者會傳入一張寵物血檢/生化/尿檢等「數值型」檢驗報告照片。

請只抽取有「數值」的檢測項目（例如 ALT、BUN、GLU、WBC 等），不要嘗試解讀 X 光、超音波等影像類報告的內容——如果照片看起來是影像報告而非數值報告，items 請回傳空陣列。

規則：
1. **只抽取「結果」欄位真的印刷或手寫了實際檢測數值的項目**。如果某一列只印出項目名稱和參考範圍，但結果欄位是空白、沒有實際數值，這一列直接跳過、不要放進 items，絕對不可以拿參考範圍、典型值或你自己的醫學知識去杜撰一個數字填進去——沒有真實數據就是沒有，寧可漏掉也不能編造。
2. 報告上每一列只要「結果」欄位有真實數值，就要逐一列出，不可以因為欄位多、篇幅長而漏掉任何一列。
3. status 的判定必須完全依照報告單上印出的參考範圍（reference range）。如果該項目報告單上沒有印出參考範圍，一律回傳 status: "UNKNOWN"，絕對不可以套用你自己知道的通用標準去猜測高低。
4. refRange 請照報告單上印出的原始文字填入；沒有印出就留空字串。
5. abbreviation 若報告單上有印出縮寫（如 ALT、BUN）就填入，沒有就留空字串。
6. value 請填數字（去除單位），unit 填該項目的單位。
7. ⚠️ **特別禁止這個具體錯誤：把參考範圍的下界（或上界、或中間值）當成檢驗結果填進 value**。
   例如看到「RBC　6.54 - 12.20」而結果欄是空白的，就回傳 value: 6.54——這是嚴重錯誤，實測發生過。
   正確做法是**完全不要回傳 RBC 這一項**。
8. 若整張報告的結果欄都是空的（例如尚未填寫的空白檢驗單、日期還是 ____年__月__日 這種填空底線），
   items 必須回傳空陣列 []，且 resultColumnHasPrintedValues 必須為 false。`;

// 滾動 7 天內每位使用者可解析的報告張數。
// 一次看診常常拿到多張（血球＋生化就是 2 張），照片拍歪重傳也很常見，
// 所以不能訂得太緊；但也要壓住最壞成本（8 × $0.07 ≈ $0.58／人／週）。
const WEEKLY_PARSE_LIMIT = 8;

const EXTRACTION_JSON_SCHEMA = {
  name: 'lab_result_extraction',
  schema: {
    type: 'object',
    properties: {
      reportType: { type: 'string', description: '報告類型英文代碼，例如 blood_biochemistry、cbc、urinalysis、unknown' },
      // 獨立問一次「結果欄到底有沒有印數字」。同一次呼叫不增加成本，
      // 而且這是個是非題，比要求模型「自我克制不要填 items」可靠
      resultColumnHasPrintedValues: {
        type: 'boolean',
        description: '這張報告的「檢驗結果」欄位是否真的印有實際數值。若整欄空白、只印了項目名稱與參考範圍（例如尚未填寫的空白檢驗單），必須回 false。',
      },
      // 先數再抽，數出來的總數拿來跟實際抽到的項目數交叉比對。
      // 漏行本身沒有任何可辨識的信號，這是唯一能自動察覺遺漏的方法
      totalRowsWithValues: {
        type: 'integer',
        description: '先仔細數過整張報告，「檢驗結果」欄位有印出實際數值的列總共有幾列。這個數字要獨立計算，不受你實際抽出幾項影響。',
      },
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
    required: ['reportType', 'resultColumnHasPrintedValues', 'totalRowsWithValues', 'items'],
    additionalProperties: false,
  },
  strict: true,
} as const;

/** 把 "6.54 - 12.20"、"0.0-0.9" 這類參考範圍字串解析成上下界 */
function parseRefRange(refRange?: string): { min: number; max: number } | null {
  if (!refRange) return null;
  const m = refRange.replace(/\s/g, '').match(/^(-?\d+(?:\.\d+)?)[-–~](-?\d+(?:\.\d+)?)$/);
  if (!m) return null;
  const min = parseFloat(m[1]);
  const max = parseFloat(m[2]);
  if (isNaN(min) || isNaN(max) || max <= min) return null;
  return { min, max };
}

/**
 * 偵測「模型是照著參考範圍編數字」的樣態。
 *
 * 實測（2026-08-08，空白 ProCyte One 檢驗單）：模型不會老實回空陣列，
 * 而是把每一項的**參考區間最小值**當成結果填進去，回了 23 項。
 * 這種捏造最難察覺——每個數字都落在合理範圍內，看起來就像一份「指標偏低但正常」的真報告。
 *
 * 真實報告不可能大量出現數值剛好等於參考上下界或正中央的情況，
 * 所以用「可比對項目中有多高比例貼齊特徵點」當判準。
 */
function looksFabricatedFromRefRange(items: ExtractedItem[]): boolean {
  const comparable = items
    .map((it) => ({ value: it.value, range: parseRefRange(it.refRange) }))
    .filter((x): x is { value: number; range: { min: number; max: number } } => x.range !== null);

  // 樣本太少時比例不具意義（兩三項剛好貼邊是有可能的）
  if (comparable.length < 5) return false;

  const EPS = 1e-6;
  const hits = comparable.filter(({ value, range }) => {
    const mid = (range.min + range.max) / 2;
    return (
      Math.abs(value - range.min) < EPS ||
      Math.abs(value - range.max) < EPS ||
      Math.abs(value - mid) < EPS
    );
  }).length;

  return hits / comparable.length >= 0.6;
}

async function extractItemsFromImage(
  imageUrl: string,
  speciesLabel: string
): Promise<{
  reportType: string;
  resultColumnHasPrintedValues: boolean;
  possiblyIncomplete: boolean;
  items: ExtractedItem[];
}> {
  const completion = await openai.chat.completions.create({
    // 抽取用完整版 gpt-4o：實測 gpt-4o-mini 在 test4（16 項）只抽到 9 項，
    // finish_reason=stop（不是截斷）、prompt_tokens=26601（圖片已高解析讀取），
    // 純粹是 mini 的密集表格 OCR 能力不足。漏行沒有任何可辨識的信號——
    // 使用者看到的每個數值都對，只是不完整，人工複核也擋不住，
    // 對醫療數據來說比多花錢嚴重得多。
    // 注意：白話解釋那次呼叫維持 gpt-4o-mini，那是生成文字、不需要視覺精度。
    model: 'gpt-4o',
    // 一份 24 項的血球報告，光是 items 陣列（含中文項目名）就可能吃掉 1700+ tokens。
    // max_tokens 只是上限、按實際用量計費，開大不會增加成本
    max_tokens: 4096,
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

  // 診斷用：漏項時要能分辨是「輸出被截斷」還是「模型根本沒讀出來」，
  // 這兩者症狀一樣（都是少幾列）但解法完全不同
  const finishReason = completion.choices[0]?.finish_reason;
  console.log(
    `[vetVisitsController] 抽取完成 finish_reason=${finishReason} ` +
    `completion_tokens=${completion.usage?.completion_tokens} ` +
    `prompt_tokens=${completion.usage?.prompt_tokens}`
  );
  if (finishReason === 'length') {
    console.warn('[vetVisitsController] ⚠️ 輸出被 max_tokens 截斷，項目可能不完整');
  }

  const raw = completion.choices[0]?.message?.content
    ?? '{"reportType":"unknown","resultColumnHasPrintedValues":false,"items":[]}';
  const parsed = JSON.parse(raw) as {
    reportType: string;
    resultColumnHasPrintedValues?: boolean;
    totalRowsWithValues?: number;
    items: ExtractedItem[];
  };

  // 兩道防線，任一觸發就整批丟棄——寧可要使用者重拍，也不能讓捏造的醫療數值落庫
  const declaredEmpty = parsed.resultColumnHasPrintedValues === false;
  const fabricated = looksFabricatedFromRefRange(parsed.items ?? []);
  if (declaredEmpty || fabricated) {
    console.warn(
      `[vetVisitsController] 判定為空白/捏造報告，丟棄 ${parsed.items?.length ?? 0} 筆結果` +
      `（模型自述結果欄為空=${declaredEmpty}，貼齊參考範圍特徵點=${fabricated}）`
    );
    return {
      reportType: parsed.reportType,
      resultColumnHasPrintedValues: false,
      possiblyIncomplete: false,
      items: [],
    };
  }

  // 交叉比對：模型自己數出的列數 vs 實際抽出的項目數。
  // 漏行不像捏造有可辨識的樣態，使用者看到的每個數值都是對的、只是不完整，
  // 這是唯一能自動察覺遺漏的訊號。不擋存檔，只提醒使用者對照紙本
  const extracted = parsed.items?.length ?? 0;
  const claimedTotal = parsed.totalRowsWithValues ?? 0;
  const possiblyIncomplete = claimedTotal > 0 && extracted < claimedTotal;
  console.log(
    `[vetVisitsController] 抽取到 ${extracted} 個項目（模型自述整張共 ${claimedTotal} 列有數值）` +
    (possiblyIncomplete ? ` ⚠️ 疑似漏抓 ${claimedTotal - extracted} 列` : '')
  );

  return {
    reportType: parsed.reportType,
    resultColumnHasPrintedValues: true,
    possiblyIncomplete,
    items: parsed.items ?? [],
  };
}

// ─── 白話文解釋生成（鳥類/爬蟲類異常值先查 RAG 佐證）─────────────────────────────

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
      console.error(`[vetVisitsController] RAG 查詢失敗 item=${item.itemName}`, e);
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
4. **不要把每個項目當成互相獨立的數字**。先檢查有沒有同一個生理系統的多項指標「一起」異常（例如肝功能：ALT/AST/ALP/GGT/膽紅素；腎功能：BUN/CREA/SDMA/磷；紅血球系統：RBC/HCT/HGB/MCV 等），單一項目輕微異常，跟同系統好幾項一起異常，臨床意義差很多——如果偵測到這種組合模式，個別項目的解釋裡可以提一句「這跟其他 OO 項目一起看」，並且一定要反映在 summaryAdvice 裡（例如「肝指數三項同時偏高，比單一項目異常更需要留意整體肝臟狀況」），不要只逐項各自描述。
5. summaryAdvice 用 1-2 句話總結整份報告，語氣溫暖，避免嚇到飼主，並優先反映上一條提到的組合異常模式（如果有的話）。`;

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
    // AI 偶爾會漏生成某個項目的解釋（itemName 對不上或回傳空字串），
    // 給個保底文字讓飼主至少知道要自己核對，而不是留白讓人以為系統壞掉
    plainExplanation: explanationByName.get(item.itemName) || `AI 尚未提供這項的說明，請自行核對報告單上的數值（狀態：${item.status}）。`,
  }));

  return { items: merged, summaryAdvice: parsed.summaryAdvice };
}

function formatVetVisit(doc: any) {
  return {
    id: doc._id,
    petId: doc.petId,
    visitDate: doc.visitDate,
    clinicName: doc.clinicName ?? '',
    diagnosisNote: doc.diagnosisNote ?? '',
    imageUrl: doc.imageUrl ?? '',
    reportType: doc.reportType ?? '',
    items: doc.items,
    medications: doc.medications,
    summaryAdvice: doc.summaryAdvice,
    calendarEventId: doc.calendarEventId ?? null,
    createdAt: doc.createdAt,
  };
}

// ─── Endpoints ──────────────────────────────────────────────────────────────

// 解析要跑兩輪 GPT 呼叫，常常要十幾秒以上，不讓使用者卡在畫面上等——
// 上傳圖片後立刻回傳 jobId，實際解析在背景進行（fire-and-forget，不 await），
// 完成後把結果寫回 VisitParseJob 並推播通知使用者
async function runParseJob(
  jobId: string,
  userId: string,
  petId: string,
  petName: string,
  species: string,
  speciesLabel: string,
  imageUrl: string
): Promise<void> {
  const notifData = { petId, petName, jobId };
  try {
    const { reportType, items, possiblyIncomplete } = await extractItemsFromImage(imageUrl, speciesLabel);
    const { items: itemsWithExplanation, summaryAdvice } = await generateExplanations(
      species, speciesLabel, reportType, items
    );

    if (itemsWithExplanation.length === 0) {
      await VisitParseJob.findByIdAndUpdate(jobId, {
        status: 'failed',
        errorMessage: '這張照片看起來沒有可辨識的數值型檢驗項目，請確認是血檢/生化等報告照片。',
      });
      await sendNotification({
        recipientUserId: userId,
        type: 'vet_visit_parsed',
        title: '報告解析失敗',
        body: `${petName} 的報告沒有辨識到可用的檢驗數值，請重新拍攝或確認照片內容。`,
        data: notifData,
      });
      return;
    }

    await VisitParseJob.findByIdAndUpdate(jobId, {
      status: 'ready',
      reportType,
      items: itemsWithExplanation,
      summaryAdvice,
      // 抽出的項目數少於模型自己數出的列數 → 提醒使用者對照紙本。
      // 不擋存檔，因為抽到的資料本身是對的，只是可能不完整
      warningMessage: possiblyIncomplete
        ? '部分項目可能未被辨識，請對照紙本報告確認是否有遺漏。'
        : '',
    });
    await sendNotification({
      recipientUserId: userId,
      type: 'vet_visit_parsed',
      title: '檢驗報告解析完成',
      body: `${petName} 的報告已經解析好了，點擊查看並確認存檔。`,
      data: notifData,
    });
  } catch (e) {
    console.error(`[vetVisitsController] 背景解析失敗，jobId=${jobId}`, e);
    await VisitParseJob.findByIdAndUpdate(jobId, {
      status: 'failed',
      errorMessage: 'AI 報告解析失敗，請稍後再試。',
    }).catch(() => {});
    await sendNotification({
      recipientUserId: userId,
      type: 'vet_visit_parsed',
      title: '報告解析失敗',
      body: `${petName} 的報告解析時發生錯誤，請重新嘗試。`,
      data: notifData,
    }).catch(() => {});
  }
}

export async function parseVisitReport(req: AuthRequest, res: Response): Promise<void> {
  const pet = await Pet.findOne({ _id: req.params.id, userId: req.userId });
  if (!pet) {
    res.status(404).json({ success: false, data: null, message: '找不到寵物' });
    return;
  }
  if (!req.file) {
    res.status(400).json({ success: false, data: null, message: '報告照片為必填' });
    return;
  }

  // 滾動 7 天的用量上限。單次解析用 gpt-4o 的視覺辨識，成本約 $0.07——
  // 光靠 rateLimit.ts 的每日 5 次不夠（5×30 = 150 次/月 ≈ $10.8／人），
  // 而且 express-rate-limit 存在記憶體，每次重新部署就歸零。
  // 這裡直接數 VisitParseJob（有 userId 與 createdAt），計數在資料庫、重啟不受影響。
  // 選 7 天是因為 VisitParseJob 本身就是 7 天 TTL，再長的窗口資料已經被清掉了。
  const weekAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
  const recentParses = await VisitParseJob.countDocuments({
    userId: req.userId,
    createdAt: { $gte: weekAgo },
  });
  if (recentParses >= WEEKLY_PARSE_LIMIT) {
    res.status(429).json({
      success: false,
      data: null,
      message: `最近 7 天的報告解析次數已達上限（${WEEKLY_PARSE_LIMIT} 次），請過幾天再試。你仍然可以手動新增就醫紀錄。`,
    });
    return;
  }

  const speciesLabel = SPECIES_LABEL[pet.species] ?? '寵物';
  let imageUrl: string;
  try {
    imageUrl = await uploadImage(req.file.buffer, 'critterio/vet-visits');
  } catch (e) {
    console.error(`[vetVisitsController] 圖片上傳失敗，petId=${pet._id}`, e);
    res.status(500).json({ success: false, data: null, message: '圖片上傳失敗，請稍後再試' });
    return;
  }

  const job = await VisitParseJob.create({
    userId: req.userId,
    petId: pet._id,
    status: 'processing',
    imageUrl,
  });

  // 不 await：讓這支 API 立刻回應，解析在背景繼續跑
  runParseJob(String(job._id), req.userId!, String(pet._id), pet.name, pet.species, speciesLabel, imageUrl);

  res.status(202).json({
    success: true,
    data: { jobId: job._id, status: 'processing', imageUrl },
    message: '報告已上傳，正在解析中',
  });
}

export async function getVisitParseJob(req: AuthRequest, res: Response): Promise<void> {
  const pet = await Pet.findOne({ _id: req.params.id, userId: req.userId });
  if (!pet) {
    res.status(404).json({ success: false, data: null, message: '找不到寵物' });
    return;
  }
  const job = await VisitParseJob.findOne({ _id: req.params.jobId, petId: pet._id });
  if (!job) {
    res.status(404).json({ success: false, data: null, message: '找不到解析工作' });
    return;
  }
  res.json({
    success: true,
    data: {
      jobId: job._id,
      status: job.status,
      imageUrl: job.imageUrl,
      reportType: job.reportType ?? '',
      items: job.items ?? [],
      summaryAdvice: job.summaryAdvice ?? '',
      errorMessage: job.errorMessage ?? '',
      warningMessage: job.warningMessage ?? '',
    },
    message: '',
  });
}

export async function createVetVisit(req: AuthRequest, res: Response): Promise<void> {
  const pet = await Pet.findOne({ _id: req.params.id, userId: req.userId });
  if (!pet) {
    res.status(404).json({ success: false, data: null, message: '找不到寵物' });
    return;
  }
  const {
    visitDate, clinicName, diagnosisNote, medications,
    imageUrl, reportType, items, summaryAdvice, syncToCalendar,
  } = req.body;
  if (!visitDate) {
    res.status(400).json({ success: false, data: null, message: 'visitDate 為必填' });
    return;
  }

  try {
    let calendarEventId: string | undefined;
    if (syncToCalendar) {
      const event = await CalendarEvent.create({
        userId: req.userId,
        petId: pet._id,
        type: 'medical',
        title: clinicName ? `回診：${clinicName}` : '回診紀錄',
        startTime: new Date(visitDate),
        note: diagnosisNote ?? '',
        // 就醫紀錄是回顧性登記（看診當下或之後才補記），不是還沒發生的提醒事項，預設標記完成
        done: true,
      });
      calendarEventId = String(event._id);
    }

    const visit = await VetVisit.create({
      petId: pet._id,
      visitDate: new Date(visitDate),
      clinicName: clinicName ?? '',
      diagnosisNote: diagnosisNote ?? '',
      imageUrl: imageUrl ?? '',
      reportType: reportType ?? '',
      items: Array.isArray(items) ? items : [],
      medications: Array.isArray(medications) ? medications : [],
      summaryAdvice: summaryAdvice ?? '',
      calendarEventId,
    });
    res.status(201).json({ success: true, data: formatVetVisit(visit), message: '就醫紀錄已儲存' });
  } catch (e) {
    console.error(`[vetVisitsController] 就醫紀錄儲存失敗，petId=${pet._id}`, e);
    res.status(500).json({ success: false, data: null, message: '就醫紀錄儲存失敗，請稍後再試' });
  }
}

export async function getVetVisits(req: AuthRequest, res: Response): Promise<void> {
  const pet = await Pet.findOne({ _id: req.params.id, userId: req.userId });
  if (!pet) {
    res.status(404).json({ success: false, data: null, message: '找不到寵物' });
    return;
  }
  const visits = await VetVisit.find({ petId: pet._id }).sort({ visitDate: -1 });
  res.json({ success: true, data: visits.map(formatVetVisit), message: '' });
}

export async function getVetVisit(req: AuthRequest, res: Response): Promise<void> {
  const pet = await Pet.findOne({ _id: req.params.id, userId: req.userId });
  if (!pet) {
    res.status(404).json({ success: false, data: null, message: '找不到寵物' });
    return;
  }
  const visit = await VetVisit.findOne({ _id: req.params.visitId, petId: pet._id });
  if (!visit) {
    res.status(404).json({ success: false, data: null, message: '找不到就醫紀錄' });
    return;
  }
  res.json({ success: true, data: formatVetVisit(visit), message: '' });
}

export async function updateVetVisit(req: AuthRequest, res: Response): Promise<void> {
  const pet = await Pet.findOne({ _id: req.params.id, userId: req.userId });
  if (!pet) {
    res.status(404).json({ success: false, data: null, message: '找不到寵物' });
    return;
  }
  const visit = await VetVisit.findOne({ _id: req.params.visitId, petId: pet._id });
  if (!visit) {
    res.status(404).json({ success: false, data: null, message: '找不到就醫紀錄' });
    return;
  }

  const {
    visitDate, clinicName, diagnosisNote, medications,
    items, summaryAdvice, syncToCalendar,
  } = req.body;

  // 只覆寫有送上來的欄位，沒送的維持原值（PATCH 語意）
  if (visitDate !== undefined) {
    const parsed = new Date(visitDate);
    if (isNaN(parsed.getTime())) {
      res.status(400).json({ success: false, data: null, message: 'visitDate 格式不正確' });
      return;
    }
    visit.visitDate = parsed;
  }
  if (clinicName !== undefined)    visit.clinicName = clinicName;
  if (diagnosisNote !== undefined) visit.diagnosisNote = diagnosisNote;
  if (summaryAdvice !== undefined) visit.summaryAdvice = summaryAdvice;
  if (Array.isArray(medications))  visit.medications = medications;
  if (Array.isArray(items))        visit.items = items;
  // imageUrl／reportType 不開放修改：報告圖片與解析結果綁定，
  // 要換報告請刪除整筆重建，否則會出現「圖片是 A、數值是 B」的狀態

  try {
    // 行事曆事件跟著同步：開關可能被切換，日期與診所名也可能改了
    if (syncToCalendar === true) {
      const title = visit.clinicName ? `回診：${visit.clinicName}` : '回診紀錄';
      if (visit.calendarEventId) {
        await CalendarEvent.findByIdAndUpdate(visit.calendarEventId, {
          $set: { title, startTime: visit.visitDate, note: visit.diagnosisNote ?? '' },
        });
      } else {
        const event = await CalendarEvent.create({
          userId: req.userId,
          petId: pet._id,
          type: 'medical',
          title,
          startTime: visit.visitDate,
          note: visit.diagnosisNote ?? '',
          done: true,
        });
        visit.calendarEventId = event._id as any;
      }
    } else if (syncToCalendar === false && visit.calendarEventId) {
      await CalendarEvent.findByIdAndDelete(visit.calendarEventId);
      visit.calendarEventId = undefined;
    }

    await visit.save();
    res.json({ success: true, data: formatVetVisit(visit), message: '就醫紀錄已更新' });
  } catch (e) {
    console.error(`[vetVisitsController] 就醫紀錄更新失敗，visitId=${visit._id}`, e);
    res.status(500).json({ success: false, data: null, message: '就醫紀錄更新失敗，請稍後再試' });
  }
}

export async function deleteVetVisit(req: AuthRequest, res: Response): Promise<void> {
  const pet = await Pet.findOne({ _id: req.params.id, userId: req.userId });
  if (!pet) {
    res.status(404).json({ success: false, data: null, message: '找不到寵物' });
    return;
  }
  const visit = await VetVisit.findOneAndDelete({ _id: req.params.visitId, petId: pet._id });
  if (!visit) {
    res.status(404).json({ success: false, data: null, message: '找不到就醫紀錄' });
    return;
  }
  if (visit.imageUrl) {
    await deleteImageByUrl(visit.imageUrl).catch((e) =>
      console.error(`[vetVisitsController] 報告圖片刪除失敗，visitId=${visit._id}`, e)
    );
  }
  // 同步建立的行事曆事件要一起清掉，否則會留下指向已刪除紀錄的孤兒事件
  if (visit.calendarEventId) {
    await CalendarEvent.findByIdAndDelete(visit.calendarEventId).catch((e) =>
      console.error(`[vetVisitsController] 行事曆事件刪除失敗，visitId=${visit._id}`, e)
    );
  }
  res.json({ success: true, data: null, message: '就醫紀錄已刪除' });
}
