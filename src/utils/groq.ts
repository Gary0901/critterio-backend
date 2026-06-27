import Groq from 'groq-sdk';

const groq = new Groq({ apiKey: process.env.GROQ_API_KEY });

export interface AiCareSuggestion {
  label: string;
  target: string;
  category: 'food' | 'activity' | 'grooming' | 'play' | 'health' | 'other';
}

export interface AiCareResult {
  suggestions: AiCareSuggestion[];
  idealWeightMin: number;
  idealWeightMax: number;
  idealHeightMin: number;
  idealHeightMax: number;
  healthNote: string;
  dailyKcal: number;
  dailyWaterMl: number;
}

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
    dog: '狗', cat: '貓', rabbit: '兔子', small: '小動物', other: '其他',
  };
  const genderMap: Record<string, string> = { male: '公', female: '母' };

  const { dailyKcal, dailyWaterMl } = calculateDailyNeeds(pet);

  const prompt = `你是專業寵物健康顧問。請根據以下寵物資訊，以繁體中文回傳 JSON。

寵物資訊：
- 名字：${pet.name}
- 物種：${speciesMap[pet.species] ?? pet.species}
- 品種：${pet.breed || '未知'}
- 年齡：${pet.age} 歲
- 性別：${genderMap[pet.gender] ?? pet.gender}
- 目前體重：${pet.weightKg} kg
- 目前身高：${pet.heightCm > 0 ? pet.heightCm + ' cm' : '未知'}

【已用 WSAVA 公式計算的精確數值，suggestions 中必須直接使用，不得自行估算】
- 每日熱量需求：${dailyKcal} kcal
- 每日飲水量：${dailyWaterMl} ml

請回傳以下格式的 JSON（不要加任何 markdown 或說明文字，直接輸出 JSON）：
{
  "suggestions": [
    {
      "label": "項目名稱（2-4字）",
      "target": "含具體數字的目標（12字內）",
      "category": "activity|food|grooming|play|health|other 其中一個"
    }
  ],
  "idealWeightMin": 數字,
  "idealWeightMax": 數字,
  "idealHeightMin": 數字,
  "idealHeightMax": 數字,
  "healthNote": "根據目前體重給一句健康建議（20字內）"
}

requirements:
- suggestions 必須包含 5 個項目：
  1. 飲食（category: food）：target 必須寫「每日 ${dailyKcal} kcal，分 X 餐」，X 依品種習慣決定
  2. 喝水（category: food 或 other）：target 必須寫「每日 ${dailyWaterMl} ml」
  3. 活動（category: activity）：附具體時間或步數，依品種體型給出合理數值
  4. 梳理或玩耍（category: grooming 或 play）：附頻率
  5. 健康檢查（category: health）：附建議頻率
- idealWeight/Height 根據品種標準給出範圍（kg / cm）
- 如果品種未知，根據物種與目前體重估算`;

  const completion = await groq.chat.completions.create({
    model: 'llama-3.3-70b-versatile',
    messages: [{ role: 'user', content: prompt }],
    temperature: 0.5,
    max_tokens: 1024,
  });

  const text = completion.choices[0]?.message?.content?.trim() ?? '';
  const jsonStr = text.replace(/^```json\s*/i, '').replace(/^```\s*/i, '').replace(/```\s*$/i, '').trim();
  const parsed = JSON.parse(jsonStr);

  return {
    ...parsed,
    dailyKcal,
    dailyWaterMl,
  } as AiCareResult;
}
