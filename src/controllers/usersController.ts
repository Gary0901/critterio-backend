import { Response } from 'express';
import { AuthRequest } from '../middleware/auth';
import User from '../models/User';
import UserBlock from '../models/UserBlock';

export async function blockUser(req: AuthRequest, res: Response): Promise<void> {
  const targetId = req.params.id;

  if (targetId === req.userId) {
    res.status(400).json({ success: false, data: null, message: '無法封鎖自己' });
    return;
  }

  const target = await User.findById(targetId).lean();
  if (!target) {
    res.status(404).json({ success: false, data: null, message: '找不到該使用者' });
    return;
  }

  try {
    await UserBlock.create({ blockerId: req.userId, blockedId: targetId });
  } catch {
    // 重複封鎖：唯一索引擋下，視為已成功
  }

  res.json({ success: true, data: null, message: '已封鎖，你將不會再看到對方的內容' });
}

export async function unblockUser(req: AuthRequest, res: Response): Promise<void> {
  await UserBlock.findOneAndDelete({ blockerId: req.userId, blockedId: req.params.id });
  res.json({ success: true, data: null, message: '已解除封鎖' });
}

export async function getBlockedUsers(req: AuthRequest, res: Response): Promise<void> {
  // 只列出「我主動封鎖的人」，才能解除；封鎖我的人不該曝光給我
  const blocks = await UserBlock.find({ blockerId: req.userId })
    .sort({ createdAt: -1 })
    .lean();

  const users = await User.find({ _id: { $in: blocks.map((b) => b.blockedId) } })
    .select('profile.name profile.avatarUrl')
    .lean();
  const userMap = new Map(users.map((u) => [String(u._id), u]));

  const data = blocks
    .map((b) => {
      const u = userMap.get(String(b.blockedId));
      if (!u) return null; // 對方已刪除帳號
      return {
        id: u._id,
        name: (u as any).profile.name,
        avatarUrl: (u as any).profile.avatarUrl ?? null,
        blockedAt: b.createdAt,
      };
    })
    .filter((u) => u !== null);

  res.json({ success: true, data, message: '' });
}
