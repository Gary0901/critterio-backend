import jwt from 'jsonwebtoken';

/**
 * Sign in with Apple 的 token 撤銷。
 *
 * App Store 審核指南 5.1.1(v) 規定：有提供 Apple 登入的 App，使用者刪除帳號時
 * 必須呼叫 Apple 的 REST API 撤銷授權，否則 Critterio 會一直留在使用者
 * 「設定 → 使用 Apple 帳號登入」的清單裡。這是常見的退件理由。
 *
 * 流程是兩段的：
 *   登入時 —— 拿 authorizationCode 換 refresh_token 存起來
 *   刪帳號時 —— 用 refresh_token 呼叫 /auth/revoke
 * authorizationCode 只能用一次而且幾分鐘就過期，所以一定要在登入當下換掉。
 */

const APPLE_AUTH_BASE = 'https://appleid.apple.com';

const TEAM_ID = process.env.APPLE_TEAM_ID || '';
const KEY_ID = process.env.APPLE_KEY_ID || '';
// .p8 的內容。放進環境變數時換行通常會被寫成字面上的 \n，這裡還原回真正的換行
const PRIVATE_KEY = (process.env.APPLE_PRIVATE_KEY || '').replace(/\\n/g, '\n');
const CLIENT_ID = (process.env.APPLE_CLIENT_IDS || 'com.critterio.app').split(',')[0].trim();

/** 三個環境變數缺一不可；沒設定時整段功能靜默略過，不影響登入本身 */
export function isAppleRevokeConfigured(): boolean {
  return Boolean(TEAM_ID && KEY_ID && PRIVATE_KEY);
}

/**
 * Apple 的 client_secret 不是固定字串，是一個用 .p8 私鑰簽的 ES256 JWT，
 * 每次呼叫現簽即可（Apple 允許最長 6 個月，但沒有必要快取）。
 */
function clientSecret(): string {
  const now = Math.floor(Date.now() / 1000);
  return jwt.sign(
    {
      iss: TEAM_ID,
      iat: now,
      exp: now + 300,
      aud: APPLE_AUTH_BASE,
      sub: CLIENT_ID,
    },
    PRIVATE_KEY,
    { algorithm: 'ES256', keyid: KEY_ID }
  );
}

async function postForm(path: string, params: Record<string, string>): Promise<Response> {
  return fetch(`${APPLE_AUTH_BASE}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams(params).toString(),
  });
}

/**
 * 用登入時拿到的 authorizationCode 換 refresh_token。
 * 失敗時回傳 undefined —— 換不到不該擋住使用者登入。
 */
export async function exchangeAppleAuthCode(code: string): Promise<string | undefined> {
  if (!isAppleRevokeConfigured()) return undefined;
  try {
    const res = await postForm('/auth/token', {
      client_id: CLIENT_ID,
      client_secret: clientSecret(),
      code,
      grant_type: 'authorization_code',
    });
    if (!res.ok) {
      console.warn('[apple] 換 refresh_token 失敗', res.status, await res.text());
      return undefined;
    }
    const data = (await res.json()) as { refresh_token?: string };
    return data.refresh_token;
  } catch (e) {
    console.warn('[apple] 換 refresh_token 例外', e);
    return undefined;
  }
}

/**
 * 撤銷授權。回傳是否成功——但呼叫端不該因為失敗就不刪帳號，
 * 使用者的刪除請求優先於清理的完整性。
 */
export async function revokeAppleToken(refreshToken: string): Promise<boolean> {
  if (!isAppleRevokeConfigured()) return false;
  try {
    const res = await postForm('/auth/revoke', {
      client_id: CLIENT_ID,
      client_secret: clientSecret(),
      token: refreshToken,
      token_type_hint: 'refresh_token',
    });
    if (!res.ok) {
      console.warn('[apple] 撤銷失敗', res.status, await res.text());
      return false;
    }
    return true;
  } catch (e) {
    console.warn('[apple] 撤銷例外', e);
    return false;
  }
}
