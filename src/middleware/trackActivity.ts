import { Response, NextFunction } from 'express';
import { AuthRequest } from './auth';
import User from '../models/User';

const THROTTLE_MS = 5 * 60 * 1000; // 5 分鐘內不重複寫入

export async function trackActivity(req: AuthRequest, _res: Response, next: NextFunction): Promise<void> {
  if (req.userId) {
    const now = new Date();
    const throttleThreshold = new Date(now.getTime() - THROTTLE_MS);
    await User.updateOne(
      { _id: req.userId, $or: [{ lastActiveAt: { $lt: throttleThreshold } }, { lastActiveAt: { $exists: false } }] },
      { $set: { lastActiveAt: now } }
    );
  }
  next();
}
