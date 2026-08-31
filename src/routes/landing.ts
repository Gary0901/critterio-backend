import { Router } from 'express';

const router = Router();

// App Store 產品頁連結（台灣區，Critterio 目前只在台灣上架）
const APP_STORE_URL = 'https://apps.apple.com/tw/app/id6802006464';

// App icon，直接內嵌 base64——這個頁面沒有其他圖片素材，
// 不想為了一張 icon 另外架靜態檔案伺服器
const ICON_DATA_URI = 'data:image/png;base64,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';

interface Faq {
  q: string;
  a: string;
}

// 跟 /support 頁面用同一批內容，避免兩邊各自維護一份、之後改到不同步
const FAQS: Faq[] = [
  {
    q: 'AI 助理的建議可以相信嗎？',
    a: 'AI 助理提供的內容僅供參考，不能取代獸醫的專業診斷。它可以幫您整理資訊、提供方向，但毛孩出現緊急或嚴重症狀時，請立即就醫。',
  },
  {
    q: '真的免費嗎？',
    a: '是的，Critterio 目前完全免費使用，沒有廣告、沒有訂閱付費項目。',
  },
  {
    q: '我的資料安全嗎？',
    a: '您的帳號與寵物資料受密碼加密與身份驗證保護，我們不會將您的個人資料出售給第三方。詳情請見隱私政策。',
  },
  {
    q: '可以刪除帳號嗎？',
    a: '可以，在 App 內「設定 → 隱私與安全 → 刪除帳號」即可自行刪除，所有資料會立即永久移除，無法復原。',
  },
];

interface Feature {
  icon: string;
  bg: string;
  fg: string;
  title: string;
  desc: string;
}

// 沒有配圖——用跟 App 相同的分類配色（themes.ts 的 cat* token）當圖示底色，
// 維持視覺語言一致，而不是隨機挑色
const FEATURES: Feature[] = [
  { icon: '🐾', bg: '#ffe8d6', fg: '#944a00', title: '寵物檔案', desc: '記錄每隻毛孩的基本資料、體重與身高變化，一目了然。' },
  { icon: '📷', bg: '#fff9c4', fg: '#7a5800', title: '每日照護', desc: '拍照記錄今天的心情與點滴，養成習慣、累積回憶。' },
  { icon: '🤖', bg: '#e8def8', fg: '#6750a4', title: 'AI 健康問答', desc: '針對貓、狗、兔子等不同物種提供客製化的照護建議，隨時可問。' },
  { icon: '🩺', bg: '#ffdad6', fg: '#ba1a1a', title: '就醫紀錄', desc: '拍下檢驗報告，AI 自動整理成白話說明，數值偏高偏低一眼看懂。' },
  { icon: '📍', bg: '#ccebc7', fg: '#4a6549', title: '在地地圖', desc: '快速找到附近的動物醫院、寵物美容、用品店與友善餐廳。' },
  { icon: '💬', bg: '#ffdcc5', fg: '#944a00', title: '寵物社群', desc: '跟其他飼主交流心得、分享毛孩日常，互相取暖打氣。' },
];

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

router.get('/', (_req, res) => {
  const featuresHtml = FEATURES.map(
    (f) => `
        <div class="feature">
          <div class="feature-icon" style="background:${f.bg};color:${f.fg};">${f.icon}</div>
          <h3>${escapeHtml(f.title)}</h3>
          <p>${escapeHtml(f.desc)}</p>
        </div>`
  ).join('');

  const faqHtml = FAQS.map(
    (item) => `
        <details>
          <summary>${escapeHtml(item.q)}</summary>
          <p>${escapeHtml(item.a)}</p>
        </details>`
  ).join('');

  const html = `<!DOCTYPE html>
<html lang="zh-Hant">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>Critterio － 您的寵物照護與社群全方位夥伴</title>
  <meta name="description" content="Critterio 是一款寵物健康記錄 App，提供寵物檔案、每日照護、AI 健康問答、就醫紀錄 AI 解讀、在地地圖與寵物社群，完全免費。" />
  <style>
    :root {
      --accent: #944a00;
      --accent-light: #ffe8d6;
      --text: #211a16;
      --text-muted: #49454f;
      --text-faint: #79747e;
    }
    * { box-sizing: border-box; }
    body {
      font-family: -apple-system, BlinkMacSystemFont, "PingFang TC", "Microsoft JhengHei", sans-serif;
      margin: 0;
      color: var(--text);
      line-height: 1.7;
      background: #fffaf5;
    }
    a { color: var(--accent); }
    .wrap { max-width: 880px; margin: 0 auto; padding: 0 20px; }

    .hero {
      background: linear-gradient(180deg, var(--accent-light) 0%, #fffaf5 100%);
      padding: 56px 0 40px;
      text-align: center;
    }
    .hero img {
      width: 96px; height: 96px; border-radius: 22px;
      box-shadow: 0 8px 24px rgba(148, 74, 0, 0.18);
      margin-bottom: 20px;
    }
    .hero h1 {
      font-family: Georgia, "Times New Roman", serif;
      font-size: 40px;
      margin: 0 0 8px;
      color: var(--accent);
    }
    .hero p.tagline {
      font-size: 17px;
      color: var(--text-muted);
      margin: 0 0 28px;
    }
    .store-badge {
      display: inline-flex;
      align-items: center;
      gap: 8px;
      background: var(--accent);
      color: #fff;
      text-decoration: none;
      font-size: 16px;
      font-weight: 600;
      padding: 13px 28px;
      border-radius: 9999px;
      box-shadow: 0 4px 14px rgba(148, 74, 0, 0.28);
    }
    .store-badge:hover { opacity: 0.92; }

    section { padding: 48px 0; }
    h2 {
      font-size: 22px;
      text-align: center;
      margin: 0 0 8px;
    }
    .section-sub {
      text-align: center;
      font-size: 14px;
      color: var(--text-faint);
      margin: 0 0 36px;
    }

    /* ---- 畫面搶先看：用真的 HTML/CSS 依 App 的設計系統重畫的 UI 元件，
       不是截圖，所以在任何螢幕密度下都清晰、也能直接跟著調色盤變化 ---- */
    .showcase-row {
      display: flex;
      flex-wrap: wrap;
      justify-content: center;
      align-items: flex-start;
      gap: 30px;
    }
    .device { width: 230px; flex: 0 0 auto; }
    .device-frame {
      background: #211a16;
      border-radius: 32px;
      padding: 9px;
      box-shadow: 0 22px 44px rgba(148, 74, 0, 0.20);
    }
    .device-screen {
      background: #fffaf5;
      border-radius: 24px;
      overflow: hidden;
      position: relative;
      aspect-ratio: 9 / 18.5;
      display: flex;
      flex-direction: column;
    }
    .device-notch {
      position: absolute;
      top: 8px; left: 50%; transform: translateX(-50%);
      width: 64px; height: 16px;
      background: #211a16;
      border-radius: 10px;
      z-index: 5;
    }
    .device-caption {
      text-align: center;
      font-size: 13px;
      color: var(--text-muted);
      margin: 14px 0 0;
    }

    /* 地圖 */
    .map-screen { position: relative; flex: 1; }
    .map-bg {
      position: absolute; inset: 0;
      background: linear-gradient(160deg, #eaf3e6 0%, #f7efe0 55%, #eef2e9 100%);
      overflow: hidden;
    }
    .map-blob { position: absolute; border-radius: 50%; filter: blur(3px); opacity: 0.55; }
    .map-blob.b1 { width: 90px; height: 58px; background: #d8ead0; top: 16%; left: 8%; }
    .map-blob.b2 { width: 70px; height: 70px; background: #f4e2c4; bottom: 30%; right: 6%; }
    .map-blob.b3 { width: 110px; height: 40px; background: #dcebe0; bottom: 10%; left: 18%; }
    .map-road { position: absolute; background: #fff; opacity: 0.65; }
    .map-road.r1 { width: 220%; height: 9px; top: 42%; left: -40%; transform: rotate(-12deg); }
    .map-road.r2 { width: 9px; height: 220%; left: 58%; top: -40%; transform: rotate(10deg); }
    .map-search {
      position: absolute; top: 32px; left: 12px; right: 12px;
      background: #fff; border-radius: 9999px;
      padding: 9px 14px; font-size: 11px; color: var(--text-muted);
      box-shadow: 0 4px 10px rgba(0,0,0,0.10);
      z-index: 3;
    }
    .map-pin {
      position: absolute;
      width: 28px; height: 28px;
      border-radius: 50% 50% 50% 0;
      transform: rotate(-45deg);
      display: flex; align-items: center; justify-content: center;
      box-shadow: 0 3px 7px rgba(0,0,0,0.22);
      border: 2px solid rgba(255,255,255,0.85);
      z-index: 2;
    }
    .map-pin-icon { transform: rotate(45deg); font-size: 12px; }
    .map-place-card {
      position: absolute; left: 10px; right: 10px; bottom: 12px;
      background: #fff; border-radius: 16px;
      padding: 10px; display: flex; align-items: center; gap: 10px;
      box-shadow: 0 8px 18px rgba(0,0,0,0.16);
      z-index: 4;
    }
    .map-place-thumb {
      width: 38px; height: 38px; border-radius: 10px; flex: 0 0 auto;
      display: flex; align-items: center; justify-content: center; font-size: 17px;
    }
    .map-place-info { min-width: 0; }
    .map-place-name { font-size: 12px; font-weight: 700; color: var(--text); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
    .map-place-meta { font-size: 10px; color: var(--text-muted); margin-top: 3px; display: flex; align-items: center; gap: 6px; }
    .map-place-badge { font-size: 9px; font-weight: 700; padding: 2px 7px; border-radius: 9999px; }

    /* 寵物檔案卡 */
    .petcard-wrap { flex: 1; padding: 38px 13px 13px; display: flex; flex-direction: column; gap: 12px; }
    .pet-card { background: #fff; border-radius: 18px; overflow: hidden; border: 1px solid #f0e4d8; box-shadow: 0 4px 14px rgba(148,74,0,0.08); }
    .pet-card-photo {
      position: relative; height: 92px;
      background: linear-gradient(135deg, #ffdcc5 0%, #ffe8d6 100%);
      display: flex; align-items: center; justify-content: center; font-size: 32px;
    }
    .pet-card-photo.alt { height: 56px; font-size: 22px; background: linear-gradient(135deg, #e8def8 0%, #f3ecff 100%); }
    .pet-card-health {
      position: absolute; top: 9px; right: 9px;
      background: #ccebc7; color: #4a6549;
      font-size: 9px; font-weight: 700; padding: 3px 8px; border-radius: 9999px;
    }
    .pet-card-body { padding: 11px 13px 13px; }
    .pet-card-name { font-size: 14px; font-weight: 700; color: var(--text); }
    .pet-card-sub { font-size: 11px; color: var(--text-muted); margin-top: 2px; }
    .pet-card-stats { display: flex; gap: 7px; margin-top: 9px; }
    .pet-stat { font-size: 10px; font-weight: 700; color: #944a00; background: #ffe8d6; padding: 4px 8px; border-radius: 9999px; }
    .pet-card.small .pet-card-body { padding: 9px 13px 11px; }

    /* AI 聊天 */
    .chat-wrap { flex: 1; padding: 38px 11px 13px; display: flex; flex-direction: column; gap: 9px; }
    .chat-header { font-size: 11px; font-weight: 700; color: var(--accent); margin-bottom: 2px; }
    .chat-bubble { font-size: 11px; line-height: 1.6; padding: 9px 12px; border-radius: 15px; max-width: 88%; }
    .chat-bubble.user { align-self: flex-end; background: var(--accent); color: #fff; border-bottom-right-radius: 4px; }
    .chat-bubble.ai { align-self: flex-start; background: #fff; border: 1px solid #f0e4d8; color: var(--text); border-bottom-left-radius: 4px; }
    .chat-ai-tag { font-size: 9px; font-weight: 700; color: #6750a4; margin-bottom: 3px; }
    .chat-chip-row { display: flex; flex-wrap: wrap; gap: 6px; margin-top: 1px; }
    .chat-chip { font-size: 9px; color: var(--accent); background: #ffe8d6; padding: 5px 9px; border-radius: 9999px; border: 1px solid #f0d9c0; }

    /* 功能一覽 */
    .features {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(170px, 1fr));
      gap: 20px;
    }
    .feature {
      background: #fff;
      border: 1px solid #f0e4d8;
      border-radius: 18px;
      padding: 24px 20px 22px;
      text-align: center;
      box-shadow: 0 4px 16px rgba(148, 74, 0, 0.06);
    }
    .feature-icon {
      width: 50px; height: 50px; border-radius: 15px;
      display: flex; align-items: center; justify-content: center;
      font-size: 22px; margin: 0 auto 14px;
    }
    .feature h3 { font-size: 16px; margin: 0 0 6px; }
    .feature p { font-size: 14px; color: var(--text-muted); margin: 0; }

    .faq { max-width: 640px; margin: 0 auto; }
    details {
      background: #fff;
      border: 1px solid #f0e4d8;
      border-radius: 12px;
      padding: 14px 18px;
      margin-bottom: 12px;
    }
    summary {
      font-size: 15px;
      font-weight: 600;
      cursor: pointer;
    }
    details p {
      font-size: 14px;
      color: var(--text-muted);
      margin: 10px 0 0;
    }
    .faq-more {
      text-align: center;
      font-size: 14px;
      margin-top: 20px;
      color: var(--text-faint);
    }

    footer {
      text-align: center;
      padding: 32px 20px 48px;
      font-size: 13px;
      color: var(--text-faint);
    }
    footer a { color: var(--text-faint); margin: 0 8px; }
  </style>
</head>
<body>
  <div class="hero">
    <div class="wrap">
      <img src="${ICON_DATA_URI}" alt="Critterio icon" />
      <h1>Critterio</h1>
      <p class="tagline">您的寵物照護與社群全方位夥伴</p>
      <a class="store-badge" href="${APP_STORE_URL}">🍎 在 App Store 下載</a>
    </div>
  </div>

  <div class="wrap">
    <section>
      <h2>畫面搶先看</h2>
      <p class="section-sub">以下畫面依 App 實際的設計與配色重新繪製</p>
      <div class="showcase-row">
        <div class="device">
          <div class="device-frame">
            <div class="device-screen">
              <div class="device-notch"></div>
              <div class="map-screen">
                <div class="map-bg">
                  <div class="map-blob b1"></div>
                  <div class="map-blob b2"></div>
                  <div class="map-blob b3"></div>
                  <div class="map-road r1"></div>
                  <div class="map-road r2"></div>
                  <div class="map-search">🔍 搜尋附近店家</div>
                  <div class="map-pin" style="top:36%; left:26%; background:#ba1a1a;"><span class="map-pin-icon">🏥</span></div>
                  <div class="map-pin" style="top:50%; left:64%; background:#6750a4;"><span class="map-pin-icon">✂️</span></div>
                  <div class="map-pin" style="top:64%; left:38%; background:#4a6549;"><span class="map-pin-icon">🌳</span></div>
                  <div class="map-pin" style="top:28%; left:70%; background:#7a5800;"><span class="map-pin-icon">🍽️</span></div>
                  <div class="map-place-card">
                    <div class="map-place-thumb" style="background:#ccebc7;">🌳</div>
                    <div class="map-place-info">
                      <div class="map-place-name">中央寵物公園</div>
                      <div class="map-place-meta"><span class="map-place-badge" style="background:#ccebc7;color:#4a6549;">公園</span>距離 350m</div>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </div>
          <p class="device-caption">在地地圖 — 快速找到附近店家</p>
        </div>

        <div class="device">
          <div class="device-frame">
            <div class="device-screen">
              <div class="device-notch"></div>
              <div class="petcard-wrap">
                <div class="pet-card">
                  <div class="pet-card-photo">
                    <span>🐾</span>
                    <span class="pet-card-health">健康</span>
                  </div>
                  <div class="pet-card-body">
                    <div class="pet-card-name">小橘</div>
                    <div class="pet-card-sub">米克斯 · 2 歲 3 個月</div>
                    <div class="pet-card-stats">
                      <span class="pet-stat">⚖️ 4.2 kg</span>
                      <span class="pet-stat">📏 46 cm</span>
                    </div>
                  </div>
                </div>
                <div class="pet-card small">
                  <div class="pet-card-photo alt"><span>🐾</span></div>
                  <div class="pet-card-body">
                    <div class="pet-card-name">Momo</div>
                    <div class="pet-card-sub">柴犬 · 1 歲</div>
                  </div>
                </div>
              </div>
            </div>
          </div>
          <p class="device-caption">寵物檔案 — 一目了然的健康紀錄</p>
        </div>

        <div class="device">
          <div class="device-frame">
            <div class="device-screen">
              <div class="device-notch"></div>
              <div class="chat-wrap">
                <div class="chat-header">🤖 AI 健康助理</div>
                <div class="chat-bubble user">小橘最近一直舔前腳，正常嗎？</div>
                <div class="chat-bubble ai">
                  <div class="chat-ai-tag">AI 助理</div>
                  可能是皮膚搔癢、輕微過敏或無聊行為。建議先觀察腳掌有無紅腫、掉毛，若持續超過 2 天或出現傷口，建議儘快帶去給獸醫檢查喔。
                </div>
                <div class="chat-chip-row">
                  <span class="chat-chip">附近的動物醫院</span>
                  <span class="chat-chip">還有其他建議嗎</span>
                </div>
              </div>
            </div>
          </div>
          <p class="device-caption">AI 健康問答 — 隨時可問的照護建議</p>
        </div>
      </div>
    </section>

    <section>
      <h2>功能一覽</h2>
      <div class="features">${featuresHtml}
      </div>
    </section>

    <section>
      <h2>常見問題</h2>
      <div class="faq">${faqHtml}
        <p class="faq-more">更多問題請見<a href="/support">完整支援頁面</a></p>
      </div>
    </section>
  </div>

  <footer>
    <div><a href="${APP_STORE_URL}">下載 App</a>·<a href="/privacy">隱私政策</a>·<a href="/terms">服務條款</a>·<a href="/support">支援</a></div>
    <div style="margin-top: 8px;">© 2026 Critterio</div>
  </footer>
</body>
</html>`;

  res.type('html').send(html);
});

export default router;
