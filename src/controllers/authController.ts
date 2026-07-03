import { Request, Response } from 'express';
import crypto from 'crypto';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { Resend } from 'resend';
import User from '../models/User';
import { AuthRequest } from '../middleware/auth';
import { uploadImage } from '../utils/cloudinary';

const resend = new Resend(process.env.RESEND_API_KEY);

function signToken(userId: string): string {
  return jwt.sign({ userId }, process.env.JWT_SECRET!, {
    expiresIn: process.env.JWT_EXPIRES_IN ?? '7d',
  } as jwt.SignOptions);
}

function formatUser(user: any) {
  return {
    id: user._id,
    name: user.profile.name,
    email: user.email,
    avatarUrl: user.profile.avatarUrl ?? null,
    lastNameChangedAt: user.profile.lastNameChangedAt ?? null,
    defaultPostVisibility: user.settings?.defaultPostVisibility ?? 'public',
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

  const scheme = process.env.APP_SCHEME ?? 'critterio';
  const resetLink = `${scheme}://reset-password?token=${rawToken}`;

  const fromEmail = process.env.RESEND_FROM_EMAIL ?? 'Critterio <onboarding@resend.dev>';

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

export async function updateProfile(req: AuthRequest, res: Response): Promise<void> {
  const { name, defaultPostVisibility } = req.body;
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

  if (req.file) {
    user.profile.avatarUrl = await uploadImage(req.file.buffer, 'critterio/avatars');
  }

  if (defaultPostVisibility === 'public' || defaultPostVisibility === 'private') {
    if (!user.settings) (user as any).settings = {};
    (user as any).settings.defaultPostVisibility = defaultPostVisibility;
  }

  await user.save();
  res.json({ success: true, data: formatUser(user), message: '個人資料更新成功' });
}

export async function updatePushToken(req: AuthRequest, res: Response): Promise<void> {
  const { token } = req.body;
  await User.findByIdAndUpdate(req.userId, { $set: { pushToken: token ?? null } });
  res.json({ success: true, data: null, message: '' });
}
