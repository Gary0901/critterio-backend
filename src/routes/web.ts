import { Router } from 'express';

const router = Router();

const APP_SCHEME = process.env.APP_SCHEME || 'critterio';

// forgotPassword 產生的 token 是 crypto.randomBytes(32).toString('hex')
const TOKEN_PATTERN = /^[a-f0-9]{64}$/;

function renderResetPage(token: string | null): string {
  const valid = token !== null && TOKEN_PATTERN.test(token);
  // token 已通過白名單驗證（純 hex），可安全嵌入；非法輸入一律不回填
  const deepLink = valid ? `${APP_SCHEME}://reset-password?token=${token}` : '';

  const body = valid
    ? `
    <h1>🐾 重設 Critterio 密碼</h1>
    <p class="lead">正在為您開啟 Critterio App…</p>
    <a class="btn" href="${deepLink}">開啟 App 重設密碼</a>
    <div class="hint">
      <p><strong>沒有自動開啟？</strong>請點上方按鈕。</p>
      <p>如果按鈕沒有反應，代表這台裝置沒有安裝 Critterio。請改用<strong>已安裝 App 的手機</strong>開啟這封信裡的連結。</p>
      <p class="muted">此連結自寄出後 1 小時內有效，且只能使用一次。</p>
    </div>
    <script>
      // 進頁面就嘗試喚起 App；沒安裝的話瀏覽器不會有任何反應，使用者仍看得到上方按鈕
      setTimeout(function () { window.location.href = ${JSON.stringify(deepLink)}; }, 400);
    </script>`
    : `
    <h1>連結無效</h1>
    <p class="lead">這個重設連結格式不正確，或已經被使用過。</p>
    <div class="hint">
      <p>請回到 Critterio App 的登入頁面，重新點選「忘記密碼」取得新的連結。</p>
      <p class="muted">重設連結自寄出後 1 小時內有效，且只能使用一次。</p>
    </div>`;

  return `<!DOCTYPE html>
<html lang="zh-Hant">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <meta name="robots" content="noindex, nofollow" />
  <title>Critterio － 重設密碼</title>
  <style>
    body { font-family: -apple-system, BlinkMacSystemFont, "PingFang TC", "Microsoft JhengHei", sans-serif; max-width: 480px; margin: 0 auto; padding: 48px 24px 60px; color: #1c1b1f; line-height: 1.7; text-align: center; }
    h1 { font-size: 22px; margin-bottom: 8px; }
    .lead { font-size: 15px; color: #49454f; margin-bottom: 28px; }
    .btn { display: inline-block; background: #944a00; color: #fff; padding: 14px 28px; border-radius: 10px; text-decoration: none; font-weight: bold; font-size: 16px; }
    .hint { margin-top: 36px; text-align: left; font-size: 14px; color: #49454f; }
    .hint p { margin: 10px 0; }
    .muted { color: #79747e; font-size: 13px; }
  </style>
</head>
<body>
  ${body}
</body>
</html>`;
}

router.get('/reset-password', (req, res) => {
  const raw = req.query.token;
  const token = typeof raw === 'string' ? raw : null;
  res.type('html').send(renderResetPage(token));
});

export default router;
