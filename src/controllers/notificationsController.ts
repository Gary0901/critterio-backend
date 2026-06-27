import { Response } from 'express';
import { AuthRequest } from '../middleware/auth';
import Notification from '../models/Notification';

function formatTimeAgo(date: Date): string {
  const diff = Date.now() - date.getTime();
  const mins = Math.floor(diff / 60_000);
  if (mins < 1) return '剛剛';
  if (mins < 60) return `${mins} 分鐘前`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs} 小時前`;
  const days = Math.floor(hrs / 24);
  if (days < 7) return `${days} 天前`;
  return date.toLocaleDateString('zh-TW');
}

function dayGroup(date: Date): 'today' | 'yesterday' | 'earlier' {
  const now = new Date();
  const d = new Date(date);
  if (d.toDateString() === now.toDateString()) return 'today';
  const yesterday = new Date(now);
  yesterday.setDate(now.getDate() - 1);
  if (d.toDateString() === yesterday.toDateString()) return 'yesterday';
  return 'earlier';
}

export async function getNotifications(req: AuthRequest, res: Response): Promise<void> {
  const page  = parseInt(String(req.query.page  ?? '1'));
  const limit = parseInt(String(req.query.limit ?? '30'));
  const skip  = (page - 1) * limit;

  const notifs = await Notification.find({ userId: req.userId })
    .sort({ createdAt: -1 })
    .skip(skip)
    .limit(limit)
    .lean();

  const data = notifs.map((n) => ({
    id:          n._id,
    type:        n.type,
    title:       n.title,
    body:        n.body,
    read:        n.read,
    timeAgo:     formatTimeAgo(n.createdAt),
    day:         dayGroup(n.createdAt),
    data:        n.data,
    createdAt:   n.createdAt,
  }));

  res.json({ success: true, data, message: '' });
}

export async function markRead(req: AuthRequest, res: Response): Promise<void> {
  await Notification.findOneAndUpdate(
    { _id: req.params.id, userId: req.userId },
    { $set: { read: true } }
  );
  res.json({ success: true, data: null, message: '' });
}

export async function markAllRead(req: AuthRequest, res: Response): Promise<void> {
  await Notification.updateMany({ userId: req.userId, read: false }, { $set: { read: true } });
  res.json({ success: true, data: null, message: '' });
}

export async function deleteNotification(req: AuthRequest, res: Response): Promise<void> {
  await Notification.findOneAndDelete({ _id: req.params.id, userId: req.userId });
  res.json({ success: true, data: null, message: '' });
}

export async function getUnreadCount(req: AuthRequest, res: Response): Promise<void> {
  const count = await Notification.countDocuments({ userId: req.userId, read: false });
  res.json({ success: true, data: { count }, message: '' });
}
