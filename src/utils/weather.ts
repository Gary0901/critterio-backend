/**
 * 今日天氣 —— 給地圖左上角那顆天氣圈用。
 *
 * 資料來源：Open-Meteo（https://open-meteo.com）。免金鑰、免註冊，非商用額度
 * 每日 1 萬次，對「同一個城市共用一份快取」的用法綽綽有餘。之後若要換成
 * Apple WeatherKit 或中央氣象署，只要改這支檔案，controller 與 App 都不用動。
 *
 * 座標是全球通用的經緯度，不是固定城市清單 —— 台灣本島與離島任何一點都查得到。
 */

export type WeatherCondition =
  | 'clear'
  | 'partly-cloudy'
  | 'cloudy'
  | 'fog'
  | 'drizzle'
  | 'rain'
  | 'snow'
  | 'showers'
  | 'thunderstorm';

export interface WeatherInfo {
  tempC: number;
  code: number;               // WMO weather code
  condition: WeatherCondition;
  label: string;              // 中文描述
  isDay: boolean;
  highC: number;
  lowC: number;
  precipProb: number;         // 今日最高降雨機率 %
  updatedAt: string;          // ISO
}

/** WMO weather_code → 分類 + 中文。對照表見 https://open-meteo.com/en/docs */
function classify(code: number): { condition: WeatherCondition; label: string } {
  if (code === 0) return { condition: 'clear', label: '晴' };
  if (code === 1 || code === 2) return { condition: 'partly-cloudy', label: '多雲時晴' };
  if (code === 3) return { condition: 'cloudy', label: '陰' };
  if (code === 45 || code === 48) return { condition: 'fog', label: '有霧' };
  if (code >= 51 && code <= 57) return { condition: 'drizzle', label: '毛毛雨' };
  if (code >= 61 && code <= 67) return { condition: 'rain', label: '下雨' };
  if (code >= 71 && code <= 77) return { condition: 'snow', label: '下雪' };
  if (code >= 80 && code <= 82) return { condition: 'showers', label: '陣雨' };
  if (code >= 95) return { condition: 'thunderstorm', label: '雷雨' };
  return { condition: 'cloudy', label: '多雲' };
}

// 粗網格快取：key 只取到小數點後 1 位（約 11km），同一個縣市內拖來拖去都命中同一份。
// 全台實際上就 20 幾個 key，TTL 25 分鐘，幾百個使用者也只會打十幾次上游 API。
const CACHE_TTL_MS = 25 * 60 * 1000;
const cache = new Map<string, { data: WeatherInfo; timestamp: number }>();

function cacheKey(lat: number, lng: number): string {
  return `${lat.toFixed(1)}|${lng.toFixed(1)}`;
}

export async function getWeather(lat: number, lng: number): Promise<WeatherInfo> {
  const key = cacheKey(lat, lng);
  const hit = cache.get(key);
  if (hit && Date.now() - hit.timestamp < CACHE_TTL_MS) return hit.data;

  const url =
    `https://api.open-meteo.com/v1/forecast` +
    `?latitude=${lat.toFixed(3)}&longitude=${lng.toFixed(3)}` +
    `&current=temperature_2m,weather_code,is_day` +
    `&daily=temperature_2m_max,temperature_2m_min,precipitation_probability_max,weather_code` +
    `&timezone=auto&forecast_days=1`;

  // Node 18+ 的全域 fetch。上游偶爾會慢，設個 8 秒上限免得卡住請求
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 8000);
  let json: any;
  try {
    const res = await fetch(url, { signal: controller.signal });
    if (!res.ok) throw new Error(`open-meteo ${res.status}`);
    json = await res.json();
  } finally {
    clearTimeout(timer);
  }

  const cur = json.current ?? {};
  const daily = json.daily ?? {};
  const code = Number(cur.weather_code ?? daily.weather_code?.[0] ?? 3);
  const { condition, label } = classify(code);

  const data: WeatherInfo = {
    tempC: Math.round(cur.temperature_2m ?? daily.temperature_2m_max?.[0] ?? 0),
    code,
    condition,
    label,
    isDay: (cur.is_day ?? 1) === 1,
    highC: Math.round(daily.temperature_2m_max?.[0] ?? cur.temperature_2m ?? 0),
    lowC: Math.round(daily.temperature_2m_min?.[0] ?? cur.temperature_2m ?? 0),
    precipProb: Math.round(daily.precipitation_probability_max?.[0] ?? 0),
    updatedAt: new Date().toISOString(),
  };

  cache.set(key, { data, timestamp: Date.now() });
  // key 本來就不多，但還是設個上限保險，超過就淘汰最舊的一筆
  if (cache.size > 200) {
    let oldestKey: string | undefined;
    let oldestTs = Infinity;
    for (const [k, v] of cache) {
      if (v.timestamp < oldestTs) { oldestTs = v.timestamp; oldestKey = k; }
    }
    if (oldestKey) cache.delete(oldestKey);
  }
  return data;
}
