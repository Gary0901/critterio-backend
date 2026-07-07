import Groq from 'groq-sdk';

const groq = new Groq({ apiKey: process.env.GROQ_API_KEY });

export interface AiCareSuggestion {
  label: string;
  target: string;
  category: 'food' | 'activity' | 'grooming' | 'play' | 'health' | 'environment' | 'other';
}

export interface AiCareResult {
  suggestions: AiCareSuggestion[];
  idealWeightMin: number;
  idealWeightMax: number;
  idealHeightMin: number;
  idealHeightMax: number;
  healthNote: string;
  dailyKcal?: number;
  dailyWaterMl?: number;
}

// WSAVA 公式僅適用於哺乳類，鳥類/爬蟲類/兩棲類/魚類等（species: 'other'）不適用
const MAMMAL_SPECIES = new Set(['dog', 'cat', 'rabbit', 'small']);

// WSAVA 公式計算每日熱量與飲水量
function calculateDailyNeeds(pet: {
  species: string;
  age: number;
  weightKg: number;
}): { rer: number; dailyKcal: number; dailyWaterMl: number } {
  const { species, age, weightKg } = pet;

  // RER = (體重 kg × 30) + 70
  const rer = weightKg * 30 + 70;

  // DER 係數依物種與年齡決定
  let derFactor: number;
  if (species === 'cat') {
    derFactor = age < 1 ? 1.0 : 0.8;  // 幼貓 1.0，成貓室內 0.8
  } else if (species === 'dog') {
    if (age < 0.5) derFactor = 3.0;    // 幼犬 < 6 個月
    else if (age < 1) derFactor = 2.0; // 幼犬 6-12 個月
    else derFactor = 1.6;              // 成犬（已結紮，最常見）
  } else {
    derFactor = 1.0;                   // 兔子、小動物等
  }

  const roundTo50 = (n: number) => Math.ceil(n / 50) * 50;

  const dailyKcal = roundTo50(rer * derFactor);

  // 飲水量：狗 × 70 ml，貓 × 50 ml
  const waterMultiplier = species === 'cat' ? 50 : 70;
  const dailyWaterMl = roundTo50(weightKg * waterMultiplier);

  return { rer: Math.round(rer), dailyKcal, dailyWaterMl };
}

export async function generatePetCare(pet: {
  name: string;
  species: string;
  breed: string;
  age: number;
  gender: string;
  weightKg: number;
  heightCm: number;
}): Promise<AiCareResult> {
  const speciesMap: Record<string, string> = {
    dog: '狗', cat: '貓', rabbit: '兔子', small: '小動物', bird: '鳥類', reptile: '爬蟲類', other: '其他',
  };
  const genderMap: Record<string, string> = { male: '公', female: '母' };

  const isMammal = MAMMAL_SPECIES.has(pet.species);
  const daily = isMammal ? calculateDailyNeeds(pet) : null;

  const basicInfo = `寵物資訊：
- 名字：${pet.name}
- 物種：${speciesMap[pet.species] ?? pet.species}
- 品種：${pet.breed || '未知'}
- 年齡：${pet.age} 歲
- 性別：${genderMap[pet.gender] ?? pet.gender}
- 目前體重：${pet.weightKg} kg
- 目前身高：${pet.heightCm > 0 ? pet.heightCm + ' cm' : '未知'}`;

  const reasoningBlock = `【先思考再回答】在生成建議前，請先在心裡評估這隻寵物的特性：
- 體型分類（依品種或目前體重推估）
- 被毛/外皮類型（短毛/長毛/捲毛/無毛/鱗片/羽毛等，依物種與品種常態推估）
- 常見的活力水準與習性
- 常見的好發健康風險

這些評估不需要輸出，但你給的每一項建議都必須反映這些差異，禁止使用「每日散步 30 分鐘」「每週梳毛一次」這類對任何品種都通用的萬用建議。`;

  const jsonShape = `{
  "suggestions": [
    { "label": "項目名稱（2-4字）", "target": "含具體數字或頻率的目標（12字內）", "category": "activity|food|grooming|play|health|environment|other 其中一個" }
  ],
  "idealWeightMin": 數字,
  "idealWeightMax": 數字,
  "idealHeightMin": 數字,
  "idealHeightMax": 數字,
  "healthNote": "根據現況給一句健康建議（20字內）"
}`;

  let prompt: string;

  if (isMammal) {
    const { dailyKcal, dailyWaterMl } = daily!;
    prompt = `你是專業寵物健康顧問。請根據以下寵物資訊，以繁體中文回傳 JSON。

${basicInfo}

【已用 WSAVA 公式計算的精確數值，suggestions 中必須直接使用，不得自行估算】
- 每日熱量需求：${dailyKcal} kcal
- 每日飲水量：${dailyWaterMl} ml

${reasoningBlock}

請回傳以下格式的 JSON（不要加任何 markdown 或說明文字，直接輸出 JSON）：
${jsonShape}

requirements:
- suggestions 必須包含 5 個項目：
  1. 飲食（category: food）：target 必須寫「每日 ${dailyKcal} kcal，分 X 餐」，X 依品種習慣與年齡決定
  2. 喝水（category: food 或 other）：target 必須寫「每日 ${dailyWaterMl} ml」
  3. 活動（category: activity）：依該品種活力水準與體型給出具體時間/強度，高活力品種與溫和品種的建議必須明顯不同
  4. 梳理或玩耍（category: grooming 或 play）：依被毛長度/類型給出具體頻率，長毛與短毛品種的建議必須明顯不同
  5. 健康檢查（category: health）：依該品種常見好發疾病給出具體檢查項目與頻率，不同體型/品種的重點必須不同
- idealWeight/Height 根據品種標準給出範圍（kg / cm）
- 如果品種未知或為混種，依物種與目前體重估算，可在 healthNote 反映「混種」的不確定性`;
  } else {
    prompt = `你是專業的特殊寵物（鳥類、爬蟲類、兩棲類、魚類等）健康顧問。請根據以下寵物資訊，以繁體中文回傳 JSON。

${basicInfo}

註：此寵物物種歸類為「其他」，實際種類請你依「品種」欄位判斷（例如鸚鵡、守宮、蜥蜴、烏龜、蛇等），並用你對該物種的專業知識給出建議，不要套用犬貓的哺乳類照護邏輯——例如不要假設牠需要「每日」進食固定次數（爬蟲類等可能是數天到數週餵食一次），也不要假設牠用飲水碗喝水（可能需要噴霧、泡水等方式補水）。

${reasoningBlock}

請回傳以下格式的 JSON（不要加任何 markdown 或說明文字，直接輸出 JSON）：
${jsonShape}

requirements:
- suggestions 必須包含 5 個項目，且必須符合這個物種真實的飼養方式：
  1. 餵食（category: food）：依這個物種實際的餵食頻率與份量給出建議（不一定是「每日」）
  2. 補水或環境濕度（category: environment）：依這個物種實際的補水/濕度需求給出建議
  3. 活動或環境豐富化（category: activity 或 play）：依該物種習性給出具體建議
  4. 環境或清潔（category: environment）：例如溫度、UVB 燈光、底材更換、脫皮協助等，依物種決定
  5. 健康檢查（category: health）：依該物種常見好發疾病給出具體檢查項目與頻率
- idealWeight/Height 依該物種/品種常態給出合理範圍（若該物種沒有明確身高概念，可用體型/體長估計值替代）
- 如果品種欄位無法判斷具體物種，依「其他」與現有資訊盡力給出保守、安全的通用建議`;
  }

  const completion = await groq.chat.completions.create({
    model: 'llama-3.3-70b-versatile',
    messages: [{ role: 'user', content: prompt }],
    temperature: 0.7,
    max_tokens: 1024,
  });

  const text = completion.choices[0]?.message?.content?.trim() ?? '';
  const jsonStr = text.replace(/^```json\s*/i, '').replace(/^```\s*/i, '').replace(/```\s*$/i, '').trim();
  const parsed = JSON.parse(jsonStr);

  return {
    ...parsed,
    ...(isMammal ? { dailyKcal: daily!.dailyKcal, dailyWaterMl: daily!.dailyWaterMl } : {}),
  } as AiCareResult;
}
