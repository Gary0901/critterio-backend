import { Router, Request, Response, NextFunction } from 'express';
import { getStats } from '../controllers/adminController';

const router = Router();

// 用 ADMIN_SECRET 環境變數做簡單 token 驗證
function requireAdmin(req: Request, res: Response, next: NextFunction): void {
  const secret = process.env.ADMIN_SECRET;
  const provided = req.headers['x-admin-secret'] ?? req.query.secret;
  if (!secret || provided !== secret) {
    res.status(401).json({ success: false, data: null, message: 'Unauthorized' });
    return;
  }
  next();
}

router.get('/stats', requireAdmin, getStats);

export default router;
