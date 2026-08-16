import { Response } from 'express';
import { AuthRequest } from '../middleware/auth';
import Notification from '../models/Notification';

const APP_TIME_ZONE = 'Asia/Taipei';

function formatTimeAgo(date: Date): string {
  const diff = Date.now() - date.getTime();
  const mins = Math.floor(diff / 60_000);
  if (mins < 1) return '剛剛';
  if (mins < 60) return `${mins} 分鐘前`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs} 小時前`;
  const days = Math.floor(hrs / 24);
  if (days < 7) return `${days} 天前`;
  return date.toLocaleDateString('zh-TW', { timeZone: APP_TIME_ZONE });
}

// 用台北當地日期字串（YYYY-MM-DD）比較，不要用 Date 物件的 toDateString()——
// 伺服器跑在 UTC，凌晨 0-8 點時 toDateString() 會整組算成前一天
function taipeiDateStr(d: Date): string {
  return d.toLocaleDateString('en-CA', { timeZone: APP_TIME_ZONE });
}

// 用純日期字串重建一個 UTC 午夜的 Date 只為了算「星期幾」——
// 這個算法不受伺服器時區影響，因為輸入已經是不含時區資訊的日曆日期
function weekdayOf(dateStr: string): number {
  return new Date(`${dateStr}T00:00:00Z`).getUTCDay();
}

function dayGroup(date: Date): 'today' | 'thisWeek' | 'earlier' {
  const todayStr = taipeiDateStr(new Date());
  const dStr = taipeiDateStr(date);
  if (dStr === todayStr) return 'today';

  // 本週起點：往前推到本週日（跟前端 DailyLogScreen 的週起點算法一致，週日為一週的第 0 天）
  const weekStart = new Date(`${todayStr}T00:00:00Z`);
  weekStart.setUTCDate(weekStart.getUTCDate() - weekdayOf(todayStr));
  const weekStartStr = weekStart.toISOString().slice(0, 10);

  if (dStr >= weekStartStr) return 'thisWeek';
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
