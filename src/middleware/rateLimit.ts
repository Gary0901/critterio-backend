import rateLimit, { ipKeyGenerator } from 'express-rate-limit';
import { Request } from 'express';
import { AuthRequest } from './auth';

// 註冊/登入等帳號端點：以 IP 為單位，防止暴力破解密碼
export const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 10,
  standardHeaders: true,
  legacyHeaders: false,
  message: { success: false, data: null, message: '嘗試次數過多，請 15 分鐘後再試' },
});

// 忘記密碼：比登入更嚴格，避免被用來狂發驗證信
export const forgotPasswordLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  limit: 5,
  standardHeaders: true,
  legacyHeaders: false,
  message: { success: false, data: null, message: '請求次數過多，請 1 小時後再試' },
});

// AI 對話：以登入使用者為單位（不是 IP），因為每次呼叫都會產生 Groq API 費用
export const aiLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  limit: 30,
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: (req: Request) => (req as AuthRequest).userId ?? ipKeyGenerator(req.ip ?? 'unknown'),
  message: { success: false, data: null, message: 'AI 對話次數已達上限，請稍後再試' },
});
