/**
 * 合作夥伴名單 —— 手動維護，改完跑 `npm run seed:partners` 寫進資料庫。
 *
 * 放在 git 而不是後台介面，是因為合作是商業關係：誰、什麼時候談的、
 * 條件是什麼，有版本紀錄比藏在資料庫裡好追。等到要讓店家自己上傳照片，
 * 再考慮做管理介面。
 *
 * 比對方式：優先用 googlePlaceId（最可靠），沒有就用 name + 座標。
 * 找不到既有地點時會直接建立一筆，所以還沒被 Google Places 收錄的店家也能上。
 */

export type PartnerSeed = {
  /** 從 Google Maps 網址或 Places API 取得，最可靠的比對鍵 */
  googlePlaceId?: string;

  /** 店名。既有店家要跟資料庫完全一致（用 npm run find:place 查） */
  name: string;

  /* --- 以下只有「資料庫裡還沒有這家店」時才需要填 --- */
  type?: 'hospital' | 'restaurant' | 'hotel' | 'petstore' | 'park' | 'grooming';
  address?: string;
  lat?: number;
  lng?: number;
  phone?: string;

  /** 卡片上的詳細介紹 */
  description: string;
  /** 特色標籤，卡片上會排成一列 chip */
  tags: string[];
  /**
   * 宣傳照網址，會在卡片上自動輪播。
   * 建議先上傳到 Cloudinary 的 critterio/partners 資料夾再把網址貼進來 ——
   * 直接用店家官網的圖有失效風險，也不受你控制。
   */
  photos: string[];
  /** 合作到期日 YYYY-MM-DD。互惠型不設期限就留空 */
  until?: string;
};

export const PARTNERS: PartnerSeed[] = [
  {
    // 已在資料庫裡，所以不用填 type/address/lat/lng。
    // 資料庫裡有多家狗日子（台中西屯店也在），所以用 googlePlaceId 比對，
    // 靠店名有選錯家的風險。用 npm run find:place -- 狗日子 查出來的。
    name: '狗日子Dogday 信義遠百店',
    googlePlaceId: 'ChIJYSTqgMarQjQRQ1_daw500WA',

    description:
      'Dogday狗日子寵物精品館，是由一個超級愛狗的工作團隊組成，我們衷心希望有一天所有人都能把狗狗當成家人看待，' +
      '給狗狗最好的照顧和愛，因此我們找遍全世界親自參加歐美各大寵物展，精挑細選之後只引進各式各樣對狗狗最好的商品，' +
      '無論是質感、品味還是設計都是世界頂尖的！目的只是希望國內的消費者，也能擁有最好的狗狗商品給您的寶貝，最最真摯的愛！！',
    // 標籤只放「分類 chip 和店名沒說到」的事，全部有你提供的介紹文為依據
    tags: ['歐美進口', '親自選品', '設計精品', '寵物友善', '信義區'],
    // 由 npm run upload:partner-photos 上傳後產生，順序 = 卡片輪播順序
    photos: [
      'https://res.cloudinary.com/dq6ktbivt/image/upload/v1786282002/critterio/partners/vbziozoux8jlij99wzst.jpg',
      'https://res.cloudinary.com/dq6ktbivt/image/upload/v1786282006/critterio/partners/ubjjth6csey1cgdjwguo.jpg',
      'https://res.cloudinary.com/dq6ktbivt/image/upload/v1786282007/critterio/partners/zvbetgodi079dgkr52tl.jpg',
    ],
    // until: '2027-08-09', // 收費方案的到期日；互惠不設期限就整行刪掉
  },
];
