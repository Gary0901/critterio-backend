import { Router } from 'express';

const router = Router();

interface Section {
  title: string;
  body: string;
}

const PRIVACY_SECTIONS: Section[] = [
  {
    title: '1. 我們收集哪些資料',
    body: '我們收集您在註冊與使用過程中提供的資料，包含：\n・帳號資料：姓名、電子郵件、頭像\n・寵物資料：名稱、品種、生日、體重、照片\n・使用資料：日誌內容、行事曆事件、社群貼文\n・裝置資訊：App 版本、作業系統（用於問題排查）',
  },
  {
    title: '2. 資料使用方式',
    body: '我們使用您的資料以：\n・提供並改善本服務功能\n・透過 AI 分析提供個人化照護建議\n・發送您訂閱的提醒通知\n・維護服務安全性與偵測異常行為\n\n我們不會將您的個人資料出售給第三方。',
  },
  {
    title: '3. 第三方服務',
    body: '本服務使用以下第三方服務處理特定功能：\n・OpenAI：提供 AI 問答與就醫報告 AI 解讀等分析功能\n・Groq：提供每日照護建議，並於 OpenAI 服務中斷時作為備援\n・Cloudinary：儲存您上傳的圖片\n・Resend：發送系統郵件（如密碼重設）\n・Google、Apple：提供第三方帳號登入驗證\n・Google Maps Platform：提供地圖上的店家照片\n・Google Analytics（Firebase）：收集匿名的功能使用行為，協助我們了解並優化 App 體驗\n・Sentry：監控應用程式錯誤，協助我們排查問題\n・Expo：傳送推播通知\n\n上述服務商均有各自的隱私政策，您的資料僅在提供服務所需範圍內共享。',
  },
  {
    title: '4. 資料安全',
    body: '我們採用業界標準措施保護您的資料，包含密碼加密儲存（bcrypt）及 JWT 身份驗證。儘管如此，網路傳輸無法保證絕對安全，請妥善保管您的帳號密碼。',
  },
  {
    title: '5. 資料保留',
    body: '您的帳號資料在帳號存續期間保留。AI 對話紀錄在最後活躍後 90 天自動刪除。您可隨時於「設定 > 隱私與安全」內直接刪除帳號，所有相關資料將立即永久刪除。',
  },
  {
    title: '6. 您的權利',
    body: '您有權：\n・查閱我們持有的您的個人資料\n・要求更正不正確的資料\n・於 App 內直接刪除您的帳號與資料\n・撤回對通知推播的同意\n\n如需協助，請聯絡 critterioyourpets@gmail.com。',
  },
  {
    title: '7. 隱私政策更新',
    body: '我們可能不定期更新本政策，重大變更將透過 App 通知告知。繼續使用本服務即表示您接受更新後的政策。',
  },
];

const TERMS_SECTIONS: Section[] = [
  {
    title: '1. 接受條款',
    body: '使用 Critterio（以下簡稱「本服務」）即表示您已閱讀、理解並同意遵守本服務條款。若您不同意，請停止使用本服務。',
  },
  {
    title: '2. 服務說明',
    body: 'Critterio 提供寵物健康紀錄、AI 照護建議、寵物日誌、社群討論及行事曆提醒等功能，協助飼主管理寵物日常照護。',
  },
  {
    title: '3. 帳號與安全',
    body: '您須提供真實資訊完成註冊，並負責妥善保管帳號密碼。如發現帳號遭未授權使用，請立即聯絡我們。每個帳號僅供個人使用，不得轉讓。',
  },
  {
    title: '4. 使用者內容',
    body: '您在社群發布的文字、照片等內容，著作權仍屬於您。您授予 Critterio 在本服務範圍內展示與傳播該內容的非專屬授權。您不得發布違法、侵權、騷擾或不實的內容。',
  },
  {
    title: '5. AI 助理免責聲明',
    body: 'AI 助理提供的建議僅供參考，不構成專業獸醫診斷或醫療意見。若您的寵物出現緊急或嚴重症狀，請立即就醫。Critterio 不對因採用 AI 建議而產生的任何損害負責。',
  },
  {
    title: '6. 禁止行為',
    body: '您同意不得：利用本服務從事違法活動、干擾或破壞服務運作、使用自動化工具大量存取資料、冒充他人或散布惡意軟體。',
  },
  {
    title: '7. 服務變更與終止',
    body: 'Critterio 保留隨時修改或終止服務的權利，並將提前以 App 通知告知重大變更。若您違反本條款，我們有權暫停或終止您的帳號。',
  },
  {
    title: '8. 法律適用',
    body: '本條款依中華民國法律解釋與執行。如有爭議，雙方同意以台灣台北地方法院為第一審管轄法院。',
  },
];

/**
 * App Store Connect 的「支援 URL」是必填欄位，Apple 要求使用者能透過它聯絡到開發者。
 * 直接掛在既有的公開頁網域下，跟隱私政策、服務條款同一套版型。
 */
const SUPPORT_SECTIONS: Section[] = [
  {
    title: '聯絡我們',
    body: '有任何問題、建議或想回報的狀況，都歡迎來信：\n\ncritterioyourpets@gmail.com\n\n我們會盡快回覆。來信時如果能附上您使用的 iPhone 型號、iOS 版本與 App 版本，會幫助我們更快找到問題。',
  },
  {
    title: '常見問題',
    body: '',
  },
  {
    title: '忘記密碼怎麼辦？',
    body: '在登入畫面點「忘記密碼？」，輸入註冊時的電子郵件，我們會寄一封重設連結給您。連結有效時間為 1 小時，且只能使用一次。\n\n如果沒收到信，請先檢查垃圾郵件匣。若使用 Google 或 Apple 登入註冊，請直接用原本的方式登入，不需要密碼。',
  },
  {
    title: '如何刪除帳號？',
    body: '在 App 內前往「設定 → 隱私與安全 → 刪除帳號」即可自行刪除，不需要來信申請。\n\n刪除後，您的寵物資料、日誌、社群貼文、就醫紀錄與上傳的照片都會立即永久移除，無法復原。若您是使用 Apple 帳號登入，我們也會一併撤銷授權。',
  },
  {
    title: 'AI 助理的建議可以相信嗎？',
    body: 'AI 助理提供的內容僅供參考，不能取代獸醫的專業診斷。它可以幫您整理資訊、提供方向，但毛孩出現緊急或嚴重症狀時，請立即就醫。\n\n檢驗報告的辨識結果也請務必對照紙本核對，數值可以在 App 內自行修改。',
  },
  {
    title: '如何檢舉或封鎖其他使用者？',
    body: '在任何一篇社群貼文右上角的「⋯」選單中，可以選擇檢舉貼文或封鎖該使用者。\n\n封鎖後雙方都不會再看到彼此的貼文與留言。已封鎖的名單可在「設定 → 隱私與安全 → 已封鎖的使用者」查看與解除。',
  },
  {
    title: '為什麼地圖上找不到我家附近的店家？',
    body: '地圖目前收錄的是台灣的動物醫院、寵物用品店、美容店與公園。資料來源可能有遺漏或過期，如果您發現缺少或資訊有誤的店家，歡迎來信告訴我們。',
  },
];

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

function renderPage(title: string, sections: Section[]): string {
  const sectionsHtml = sections
    .map(
      // body 留空時只出標題，讓它單純當分隔用的小標，不要留一個空段落
      (s) => `
      <section>
        <h2>${escapeHtml(s.title)}</h2>${
        s.body ? `\n        <p>${escapeHtml(s.body).replace(/\n/g, '<br/>')}</p>` : ''
      }
      </section>`
    )
    .join('\n');

  return `<!DOCTYPE html>
<html lang="zh-Hant">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>Critterio － ${escapeHtml(title)}</title>
  <style>
    body { font-family: -apple-system, BlinkMacSystemFont, "PingFang TC", "Microsoft JhengHei", sans-serif; max-width: 720px; margin: 0 auto; padding: 32px 20px 60px; color: #1c1b1f; line-height: 1.7; }
    h1 { font-size: 24px; margin-bottom: 4px; }
    .updated { color: #79747e; font-size: 13px; margin-bottom: 32px; }
    h2 { font-size: 17px; margin-top: 28px; margin-bottom: 8px; }
    p { font-size: 15px; color: #49454f; white-space: pre-wrap; }
    a { color: #944a00; }
  </style>
</head>
<body>
  <h1>Critterio － ${escapeHtml(title)}</h1>
  <p class="updated">最後更新：2026 年 6 月</p>
  ${sectionsHtml}
</body>
</html>`;
}

router.get('/privacy', (_req, res) => {
  res.type('html').send(renderPage('隱私政策', PRIVACY_SECTIONS));
});

router.get('/terms', (_req, res) => {
  res.type('html').send(renderPage('服務條款', TERMS_SECTIONS));
});

router.get('/support', (_req, res) => {
  res.type('html').send(renderPage('支援與常見問題', SUPPORT_SECTIONS));
});

export default router;
