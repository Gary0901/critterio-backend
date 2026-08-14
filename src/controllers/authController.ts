import { Request, Response } from 'express';
import crypto from 'crypto';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { Resend } from 'resend';
import { OAuth2Client } from 'google-auth-library';
import jwksClient from 'jwks-rsa';
import User from '../models/User';
import Pet from '../models/Pet';
import WeightLog from '../models/WeightLog';
import PetLog from '../models/PetLog';
import Post from '../models/Post';
import Comment from '../models/Comment';
import PostLike from '../models/PostLike';
import PostReport from '../models/PostReport';
import Favorite from '../models/Favorite';
import CalendarEvent from '../models/CalendarEvent';
import AiConversation from '../models/AiConversation';
import Notification from '../models/Notification';
import VetVisit from '../models/VetVisit';
import { AuthRequest } from '../middleware/auth';
import { uploadImage, deleteImageByUrl } from '../utils/cloudinary';

const resend = new Resend(process.env.RESEND_API_KEY);

// 可能有 iOS / Android / Web 多組 Client ID，逗號分隔
const GOOGLE_CLIENT_IDS = (process.env.GOOGLE_OAUTH_CLIENT_IDS ?? '')
  .split(',')
  .map((s) => s.trim())
  .filter(Boolean);
const googleClient = new OAuth2Client();

// ─── Sign in with Apple ───────────────────────────────────────────────────────
// Apple 的 identityToken 是它自己簽的 JWT，公鑰放在下面這個 JWKS 端點、且會輪替，
// 所以不能寫死金鑰，要用 jwks-rsa 依 token 標頭的 kid 動態取得（內建快取）。
const APPLE_ISSUER = 'https://appleid.apple.com';
const appleKeys = jwksClient({
  jwksUri: `${APPLE_ISSUER}/auth/keys`,
  cache: true,
  cacheMaxAge: 24 * 60 * 60 * 1000,
  rateLimit: true,
});

// aud 必須等於 App 的 bundle identifier。設成環境變數是為了讓之後
// 多一個 target（例如 watchOS）或改 bundle id 時不用動程式碼
const APPLE_AUDIENCES = (process.env.APPLE_CLIENT_IDS ?? 'com.critterio.app')
  .split(',')
  .map((s) => s.trim())
  .filter(Boolean);

function getAppleSigningKey(header: jwt.JwtHeader, callback: jwt.SigningKeyCallback): void {
  appleKeys.getSigningKey(header.kid, (err, key) => {
    if (err || !key) return callback(err ?? new Error('找不到 Apple 簽章金鑰'));
    callback(null, key.getPublicKey());
  });
}

function verifyAppleIdentityToken(identityToken: string): Promise<jwt.JwtPayload> {
  return new Promise((resolve, reject) => {
    if (APPLE_AUDIENCES.length === 0) {
      // 設定成空字串等於不驗 aud，任何 App 簽出來的 token 都會通過——不能放行
      return reject(new Error('APPLE_CLIENT_IDS 未設定'));
    }
    jwt.verify(
      identityToken,
      getAppleSigningKey,
      {
        algorithms: ['RS256'],
        issuer: APPLE_ISSUER,
        // jsonwebtoken 的型別要求非空 tuple，上面已確保長度 > 0
        audience: APPLE_AUDIENCES as [string, ...string[]],
      },
      (err: jwt.VerifyErrors | null, decoded: jwt.JwtPayload | string | undefined) => {
        if (err || !decoded || typeof decoded === 'string') {
          return reject(err ?? new Error('Apple token 格式不正確'));
        }
        resolve(decoded);
      }
    );
  });
}

function signToken(userId: string): string {
  return jwt.sign({ userId }, process.env.JWT_SECRET!, {
    expiresIn: process.env.JWT_EXPIRES_IN ?? '7d',
  } as jwt.SignOptions);
}

function formatUser(user: any) {
  const ns = user.settings?.notifSettings ?? {};
  return {
    id: user._id,
    name: user.profile.name,
    email: user.email,
    avatarUrl: user.profile.avatarUrl ?? null,
    avatarColor: user.profile.avatarColor ?? null,
    lastNameChangedAt: user.profile.lastNameChangedAt ?? null,
    defaultPostVisibility: user.settings?.defaultPostVisibility ?? 'public',
    notifSettings: {
      dailyCare: ns.dailyCare !== false,
      calendar:  ns.calendar  !== false,
      likes:     ns.likes     !== false,
      comments:  ns.comments  !== false,
    },
  };
}

const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const PASSWORD_REGEX = /^(?=.*[A-Z])(?=.*[0-9]).{8,}$/;

export async function register(req: Request, res: Response): Promise<void> {
  const { email, password, name } = req.body;
  if (!email || !password || !name) {
    res.status(400).json({ success: false, data: null, message: 'email、password、name 為必填' });
    return;
  }

  if (!EMAIL_REGEX.test(email)) {
    res.status(400).json({ success: false, data: null, message: 'Email 格式不正確' });
    return;
  }

  if (!PASSWORD_REGEX.test(password)) {
    res.status(400).json({ success: false, data: null, message: '密碼需至少 8 個字元、一個大寫字母、一個數字' });
    return;
  }

  const existing = await User.findOne({ email: email.toLowerCase() });
  if (existing) {
    res.status(409).json({ success: false, data: null, message: '此 Email 已被註冊' });
    return;
  }

  const passwordHash = await bcrypt.hash(password, 12);
  const user = await User.create({
    email: email.toLowerCase(),
    passwordHash,
    profile: { name },
  });

  const token = signToken(String(user._id));
  res.status(201).json({ success: true, data: { token, user: formatUser(user) }, message: '註冊成功' });
}

export async function login(req: Request, res: Response): Promise<void> {
  const { email, password } = req.body;
  if (!email || !password) {
    res.status(400).json({ success: false, data: null, message: 'email 與 password 為必填' });
    return;
  }

  const user = await User.findOne({ email: email.toLowerCase() });
  if (!user || !user.passwordHash) {
    res.status(401).json({ success: false, data: null, message: 'Email 或密碼錯誤' });
    return;
  }

  const isMatch = await bcrypt.compare(password, user.passwordHash);
  if (!isMatch) {
    res.status(401).json({ success: false, data: null, message: 'Email 或密碼錯誤' });
    return;
  }

  const token = signToken(String(user._id));
  res.json({ success: true, data: { token, user: formatUser(user) }, message: '登入成功' });
}

export async function googleLogin(req: Request, res: Response): Promise<void> {
  const { idToken } = req.body;
  if (!idToken) {
    res.status(400).json({ success: false, data: null, message: 'idToken 為必填' });
    return;
  }
  if (GOOGLE_CLIENT_IDS.length === 0) {
    res.status(500).json({ success: false, data: null, message: '伺服器尚未設定 Google 登入' });
    return;
  }

  let payload;
  try {
    const ticket = await googleClient.verifyIdToken({ idToken, audience: GOOGLE_CLIENT_IDS });
    payload = ticket.getPayload();
  } catch {
    res.status(401).json({ success: false, data: null, message: 'Google 驗證失敗' });
    return;
  }

  if (!payload?.sub || !payload.email) {
    res.status(401).json({ success: false, data: null, message: 'Google 驗證失敗' });
    return;
  }

  const googleId = payload.sub;
  const email = payload.email.toLowerCase();
  const name = payload.name ?? email.split('@')[0];

  let user = await User.findOne({ 'authProviders.googleId': googleId });

  if (!user) {
    // 若此 Email 已用密碼註冊過，直接連結帳號
    user = await User.findOne({ email });
    if (user) {
      user.authProviders.googleId = googleId;
      await user.save();
    }
  }

  if (!user) {
    user = await User.create({
      email,
      authProviders: { googleId },
      profile: { name },
    });
  }

  const token = signToken(String(user._id));
  res.json({ success: true, data: { token, user: formatUser(user) }, message: '登入成功' });
}

export async function appleLogin(req: Request, res: Response): Promise<void> {
  // fullName 只有「第一次授權」時 Apple 才會給，而且只給客戶端、不在 token 裡。
  // 之後再登入就永遠拿不到了，所以前端必須把第一次拿到的名字一起送上來。
  const { identityToken, fullName } = req.body as { identityToken?: string; fullName?: string };
  if (!identityToken) {
    res.status(400).json({ success: false, data: null, message: 'identityToken 為必填' });
    return;
  }

  let payload: jwt.JwtPayload;
  try {
    payload = await verifyAppleIdentityToken(identityToken);
  } catch {
    res.status(401).json({ success: false, data: null, message: 'Apple 驗證失敗' });
    return;
  }

  const appleId = payload.sub;
  if (!appleId) {
    res.status(401).json({ success: false, data: null, message: 'Apple 驗證失敗' });
    return;
  }

  // 使用者可以選「隱藏我的電子郵件」，這時 email 會是 @privaterelay.appleid.com 的轉發位址。
  // 那仍然是可寄信的有效地址，照常收下即可。
  // 也可能完全沒有 email（極少數情況），所以不能像 Google 那樣把 email 當必要條件。
  const email = typeof payload.email === 'string' ? payload.email.toLowerCase() : undefined;

  let user = await User.findOne({ 'authProviders.appleId': appleId });

  if (!user && email) {
    // 同一個 Email 若已用密碼或 Google 註冊過，連結到既有帳號，不要產生重複帳號
    user = await User.findOne({ email });
    if (user) {
      user.authProviders.appleId = appleId;
      await user.save();
    }
  }

  if (!user) {
    user = await User.create({
      email,
      authProviders: { appleId },
      // 沒有 fullName 又沒有 email 時（使用者隱藏了 email 且不是第一次授權），
      // 至少給一個可讀的預設名稱，之後可以在個人資料頁改
      profile: { name: fullName?.trim() || email?.split('@')[0] || '毛孩飼主' },
    });
  } else if (fullName?.trim() && !user.profile.name) {
    // 既有帳號沒有名字時才補，不要覆蓋使用者自己設定過的暱稱
    user.profile.name = fullName.trim();
    await user.save();
  }

  const token = signToken(String(user._id));
  res.json({ success: true, data: { token, user: formatUser(user) }, message: '登入成功' });
}

export async function getMe(req: AuthRequest, res: Response): Promise<void> {
  const user = await User.findById(req.userId);
  if (!user) {
    res.status(404).json({ success: false, data: null, message: '找不到使用者' });
    return;
  }
  res.json({ success: true, data: formatUser(user), message: '' });
}

export async function logout(_req: AuthRequest, res: Response): Promise<void> {
  res.json({ success: true, data: null, message: '登出成功' });
}

export async function forgotPassword(req: Request, res: Response): Promise<void> {
  const { email } = req.body;
  if (!email) {
    res.status(400).json({ success: false, data: null, message: 'email 為必填' });
    return;
  }

  // 回傳相同訊息避免 email 枚舉攻擊
  const GENERIC_MSG = '若此 Email 已註冊，重設連結已寄至您的信箱';

  const user = await User.findOne({ email: email.toLowerCase() });
  if (!user) {
    res.json({ success: true, data: null, message: GENERIC_MSG });
    return;
  }

  const rawToken = crypto.randomBytes(32).toString('hex');
  const hashedToken = crypto.createHash('sha256').update(rawToken).digest('hex');

  user.resetPasswordToken = hashedToken;
  user.resetPasswordExpires = new Date(Date.now() + 60 * 60 * 1000); // 1 小時有效
  await user.save();

  // 必須用 https 連結：Gmail、Outlook 等網頁信箱不會把 critterio:// 這類
  // custom scheme 變成可點的連結，甚至會直接濾掉。這個網頁再負責喚起 App。
  // 用 || 而非 ??：環境變數存在但為空字串時也要 fallback
  const publicBaseUrl = process.env.PUBLIC_BASE_URL || 'https://critterio-backend.zeabur.app';
  const resetLink = `${publicBaseUrl}/reset-password?token=${rawToken}`;

  const fromEmail = process.env.RESEND_FROM_EMAIL || 'Critterio <onboarding@resend.dev>';

  const { error: sendError } = await resend.emails.send({
    from: fromEmail,
    to: user.email!,
    subject: '重設您的 Critterio 密碼',
    html: `
      <div style="font-family:sans-serif;max-width:480px;margin:0 auto">
        <h2 style="color:#944a00">🐾 Critterio 密碼重設</h2>
        <p>您請求重設帳號密碼，點擊下方按鈕完成重設（連結 1 小時內有效）：</p>
        <a href="${resetLink}"
           style="display:inline-block;background:#944a00;color:#fff;padding:12px 24px;border-radius:8px;text-decoration:none;font-weight:bold">
          重設密碼
        </a>
        <p style="margin-top:24px;color:#887365;font-size:13px">
          如果您沒有發出此請求，請忽略此信件，密碼不會被變更。
        </p>
      </div>
    `,
  });

  if (sendError) console.error('[Resend] 寄信失敗:', sendError);

  res.json({ success: true, data: null, message: GENERIC_MSG });
}

export async function resetPassword(req: Request, res: Response): Promise<void> {
  const { token, newPassword } = req.body;
  if (!token || !newPassword) {
    res.status(400).json({ success: false, data: null, message: 'token 與 newPassword 為必填' });
    return;
  }

  if (!PASSWORD_REGEX.test(newPassword)) {
    res.status(400).json({ success: false, data: null, message: '密碼需至少 8 個字元、一個大寫字母、一個數字' });
    return;
  }

  const hashedToken = crypto.createHash('sha256').update(token).digest('hex');
  const user = await User.findOne({
    resetPasswordToken: hashedToken,
    resetPasswordExpires: { $gt: new Date() },
  });

  if (!user) {
    res.status(400).json({ success: false, data: null, message: '重設連結無效或已過期' });
    return;
  }

  user.passwordHash = await bcrypt.hash(newPassword, 12);
  user.resetPasswordToken = undefined;
  user.resetPasswordExpires = undefined;
  await user.save();

  res.json({ success: true, data: null, message: '密碼重設成功，請重新登入' });
}

export async function changePassword(req: AuthRequest, res: Response): Promise<void> {
  const { currentPassword, newPassword } = req.body;
  if (!currentPassword || !newPassword) {
    res.status(400).json({ success: false, data: null, message: 'currentPassword 與 newPassword 為必填' });
    return;
  }

  const user = await User.findById(req.userId);
  if (!user || !user.passwordHash) {
    res.status(400).json({ success: false, data: null, message: '此帳號無法使用密碼登入' });
    return;
  }

  const isMatch = await bcrypt.compare(currentPassword, user.passwordHash);
  if (!isMatch) {
    res.status(401).json({ success: false, data: null, message: '目前密碼錯誤' });
    return;
  }

  user.passwordHash = await bcrypt.hash(newPassword, 12);
  await user.save();
  res.json({ success: true, data: null, message: '密碼修改成功' });
}

/**
 * 頭像調色盤的長度。跟 frontend/src/constants/avatarColors.ts 綁在一起 ——
 * 那邊加色的話這裡要一起改，否則新色存不進來。
 */
const AVATAR_COLOR_COUNT = 6;

export async function updateProfile(req: AuthRequest, res: Response): Promise<void> {
  const { name, defaultPostVisibility, avatarColor } = req.body;
  const user = await User.findById(req.userId);
  if (!user) {
    res.status(404).json({ success: false, data: null, message: '找不到使用者' });
    return;
  }

  if (name && name !== user.profile.name) {
    const lastChanged = user.profile.lastNameChangedAt;
    if (lastChanged) {
      const daysSince = (Date.now() - lastChanged.getTime()) / (1000 * 60 * 60 * 24);
      if (daysSince < 14) {
        res.status(429).json({ success: false, data: null, message: `改名冷卻中，還需等待 ${Math.ceil(14 - daysSince)} 天` });
        return;
      }
    }
    user.profile.name = name;
    user.profile.lastNameChangedAt = new Date();
  }

  // 移除照片。multipart 的欄位是字串，所以比對 'true'
  if (req.body.removeAvatar === 'true' || req.body.removeAvatar === true) {
    if (user.profile.avatarUrl) {
      // 先刪雲端再清欄位；刪失敗不擋流程，最多留一張沒人引用的圖
      await deleteImageByUrl(user.profile.avatarUrl).catch(() => {});
    }
    user.profile.avatarUrl = undefined;
  } else if (req.file) {
    // 換新照片時把舊的一起刪掉，不然 Cloudinary 會越積越多
    const old = user.profile.avatarUrl;
    user.profile.avatarUrl = await uploadImage(req.file.buffer, 'critterio/avatars');
    if (old) await deleteImageByUrl(old).catch(() => {});
  }

  // multipart 表單的欄位一律是字串，所以不能直接用 typeof === 'number' 判斷
  if (avatarColor !== undefined && avatarColor !== null && avatarColor !== '') {
    const idx = Number(avatarColor);
    if (!Number.isInteger(idx) || idx < 0 || idx >= AVATAR_COLOR_COUNT) {
      res.status(400).json({ success: false, data: null, message: '頭像顏色索引不正確' });
      return;
    }
    user.profile.avatarColor = idx;
  }

  if (defaultPostVisibility === 'public' || defaultPostVisibility === 'private') {
    if (!user.settings) (user as any).settings = {};
    (user as any).settings.defaultPostVisibility = defaultPostVisibility;
    await Post.updateMany({ userId: user._id }, { $set: { visibility: defaultPostVisibility } });
  }

  await user.save();
  res.json({ success: true, data: formatUser(user), message: '個人資料更新成功' });
}

export async function updatePushToken(req: AuthRequest, res: Response): Promise<void> {
  const { token } = req.body;
  await User.findByIdAndUpdate(req.userId, { $set: { pushToken: token ?? null } });
  res.json({ success: true, data: null, message: '' });
}

export async function updateSettings(req: AuthRequest, res: Response): Promise<void> {
  const user = await User.findById(req.userId);
  if (!user) {
    res.status(404).json({ success: false, data: null, message: '找不到使用者' });
    return;
  }
  if (!user.settings) (user as any).settings = {};

  const { notifSettings, defaultPostVisibility } = req.body;

  if (defaultPostVisibility === 'public' || defaultPostVisibility === 'private') {
    (user as any).settings.defaultPostVisibility = defaultPostVisibility;
    await Post.updateMany({ userId: user._id }, { $set: { visibility: defaultPostVisibility } });
  }

  if (notifSettings && typeof notifSettings === 'object') {
    const allowed = ['dailyCare', 'calendar', 'likes', 'comments'] as const;
    if (!(user as any).settings.notifSettings) (user as any).settings.notifSettings = {};
    for (const key of allowed) {
      if (typeof notifSettings[key] === 'boolean') {
        (user as any).settings.notifSettings[key] = notifSettings[key];
      }
    }
  }

  await user.save();
  res.json({ success: true, data: formatUser(user), message: '設定已更新' });
}

export async function deleteAccount(req: AuthRequest, res: Response): Promise<void> {
  const userId = req.userId;

  const pets = await Pet.find({ userId }).select('_id').lean();
  const petIds = pets.map((p) => p._id);

  const posts = await Post.find({ userId }).select('_id').lean();
  const postIds = posts.map((p) => p._id);

  // 修正因刪除而受影響的其他人貼文的按讚/留言數
  const myLikesOnOthers = await PostLike.find({ userId, postId: { $nin: postIds } }).select('postId').lean();
  for (const l of myLikesOnOthers) {
    await Post.findByIdAndUpdate(l.postId, { $inc: { 'metrics.likesCount': -1 } });
  }
  const myCommentsOnOthers = await Comment.find({ userId, postId: { $nin: postIds } }).select('postId').lean();
  for (const c of myCommentsOnOthers) {
    await Post.findByIdAndUpdate(c.postId, { $inc: { 'metrics.commentsCount': -1 } });
  }

  // 先把所有雲端圖片的網址收齊，再刪資料庫紀錄 —— 順序反了就再也找不到這些圖是誰的，
  // 會永遠留在 Cloudinary 的公開網址上。這是隱私問題，不只是儲存空間。
  const [petDocs, petLogDocs, postDocs, vetVisitDocs, convDocs, userDoc] = await Promise.all([
    Pet.find({ userId }).select('photoUrl').lean(),
    PetLog.find({ petId: { $in: petIds } }).select('images').lean(),
    Post.find({ userId }).select('images').lean(),
    VetVisit.find({ petId: { $in: petIds } }).select('imageUrl').lean(),
    AiConversation.find({ userId }).select('messages.imageUrl').lean(),
    User.findById(userId).select('profile.avatarUrl').lean(),
  ]);

  const imageUrls: string[] = [
    (userDoc as any)?.profile?.avatarUrl,
    ...petDocs.map((p: any) => p.photoUrl),
    ...petLogDocs.flatMap((l: any) => (l.images ?? []).map((img: any) => img.url)),
    ...postDocs.flatMap((p: any) => p.images ?? []),
    ...vetVisitDocs.map((v: any) => v.imageUrl),
    ...convDocs.flatMap((c: any) => (c.messages ?? []).map((m: any) => m.imageUrl)),
  ].filter((u): u is string => !!u);

  // 刪圖失敗不擋帳號刪除 —— 使用者的刪除請求優先於清理的完整性
  await Promise.all(imageUrls.map((u) => deleteImageByUrl(u).catch(() => {})));

  await Promise.all([
    WeightLog.deleteMany({ petId: { $in: petIds } }),
    PetLog.deleteMany({ petId: { $in: petIds } }),
    Pet.deleteMany({ userId }),
    Comment.deleteMany({ $or: [{ postId: { $in: postIds } }, { userId }] }),
    PostLike.deleteMany({ $or: [{ postId: { $in: postIds } }, { userId }] }),
    PostReport.deleteMany({ $or: [{ postId: { $in: postIds } }, { userId }] }),
    Post.deleteMany({ userId }),
    Favorite.deleteMany({ userId }),
    CalendarEvent.deleteMany({ userId }),
    AiConversation.deleteMany({ userId }),
    Notification.deleteMany({ userId }),
  ]);

  await User.findByIdAndDelete(userId);

  res.json({ success: true, data: null, message: '帳號已刪除' });
}
