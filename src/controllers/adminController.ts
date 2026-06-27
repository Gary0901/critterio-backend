import { Request, Response } from 'express';
import User from '../models/User';
import Pet from '../models/Pet';
import Post from '../models/Post';
import PetLog from '../models/PetLog';
import WeightLog from '../models/WeightLog';
import CalendarEvent from '../models/CalendarEvent';
import AiConversation from '../models/AiConversation';
import Notification from '../models/Notification';

function startOfDay(d: Date): Date {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate());
}

function daysAgo(n: number): Date {
  return new Date(Date.now() - n * 24 * 60 * 60 * 1000);
}

// ─── 每日 timeseries（過去 N 天）───────────────────────────────────────────────
async function buildDailyTimeseries(days: number) {
  const since = daysAgo(days);

  const [newUsers, activeUsers] = await Promise.all([
    User.aggregate([
      { $match: { createdAt: { $gte: since } } },
      { $group: { _id: { $dateToString: { format: '%Y-%m-%d', date: '$createdAt' } }, count: { $sum: 1 } } },
      { $sort: { _id: 1 } },
    ]),
    User.aggregate([
      { $match: { lastActiveAt: { $gte: since } } },
      { $group: { _id: { $dateToString: { format: '%Y-%m-%d', date: '$lastActiveAt' } }, count: { $sum: 1 } } },
      { $sort: { _id: 1 } },
    ]),
  ]);

  // 補全日期（讓沒資料的天數顯示 0）
  const labels: string[] = [];
  const newUsersMap: Record<string, number> = {};
  const activeMap: Record<string, number> = {};
  newUsers.forEach((r) => (newUsersMap[r._id] = r.count));
  activeUsers.forEach((r) => (activeMap[r._id] = r.count));

  for (let i = days - 1; i >= 0; i--) {
    const d = new Date(Date.now() - i * 24 * 60 * 60 * 1000);
    const key = d.toISOString().slice(0, 10);
    labels.push(key);
  }

  return {
    labels,
    newUsers: labels.map((l) => newUsersMap[l] ?? 0),
    activeUsers: labels.map((l) => activeMap[l] ?? 0),
  };
}

// ─── 留存率 Cohort（以週為單位，最近 8 週）──────────────────────────────────────
async function buildRetentionCohorts() {
  const now = new Date();
  const cohorts = [];

  for (let w = 7; w >= 0; w--) {
    const cohortStart = new Date(now.getTime() - (w + 1) * 7 * 24 * 60 * 60 * 1000);
    const cohortEnd   = new Date(now.getTime() - w * 7 * 24 * 60 * 60 * 1000);

    const usersInCohort = await User.find({
      createdAt: { $gte: cohortStart, $lt: cohortEnd },
    }).select('_id createdAt lastActiveAt');

    const total = usersInCohort.length;
    if (total === 0) continue;

    const check = (minDays: number) =>
      usersInCohort.filter((u) => {
        if (!u.lastActiveAt) return false;
        const diffMs = u.lastActiveAt.getTime() - u.createdAt.getTime();
        return diffMs >= minDays * 24 * 60 * 60 * 1000;
      }).length;

    cohorts.push({
      week: `W${8 - w}`,
      weekLabel: `${cohortStart.toISOString().slice(0, 10)}`,
      total,
      d1:  w > 0 ? Math.round((check(1)  / total) * 100) : null,
      d7:  w > 0 ? Math.round((check(7)  / total) * 100) : null,
      d30: cohortStart < daysAgo(30) ? Math.round((check(30) / total) * 100) : null,
    });
  }

  return cohorts;
}

// ─── 功能使用統計 ────────────────────────────────────────────────────────────────
async function buildFeatureStats() {
  const thirtyDaysAgo = daysAgo(30);

  const [
    postsMonth, logsMonth, weightMonth,
    calendarMonth, aiMonth,
    likesMonth, commentsMonth,
  ] = await Promise.all([
    Post.countDocuments({ createdAt: { $gte: thirtyDaysAgo } }),
    PetLog.countDocuments({ createdAt: { $gte: thirtyDaysAgo } }),
    WeightLog.countDocuments({ createdAt: { $gte: thirtyDaysAgo } }),
    CalendarEvent.countDocuments({ createdAt: { $gte: thirtyDaysAgo } }),
    AiConversation.countDocuments({ createdAt: { $gte: thirtyDaysAgo } }),
    Post.aggregate([{ $match: { createdAt: { $gte: thirtyDaysAgo } } }, { $group: { _id: null, total: { $sum: { $size: { $ifNull: ['$likes', []] } } } } }]),
    Post.aggregate([{ $match: { createdAt: { $gte: thirtyDaysAgo } } }, { $group: { _id: null, total: { $sum: { $size: { $ifNull: ['$comments', []] } } } } }]),
  ]);

  return [
    { label: '日記記錄', value: logsMonth, icon: '📔' },
    { label: 'AI 對話', value: aiMonth, icon: '🤖' },
    { label: '社群貼文', value: postsMonth, icon: '📸' },
    { label: '按讚', value: likesMonth[0]?.total ?? 0, icon: '❤️' },
    { label: '留言', value: commentsMonth[0]?.total ?? 0, icon: '💬' },
    { label: '行事曆事件', value: calendarMonth, icon: '📅' },
    { label: '體重記錄', value: weightMonth, icon: '⚖️' },
  ];
}

// ─── 主要 stats endpoint ─────────────────────────────────────────────────────
export async function getStats(_req: Request, res: Response): Promise<void> {
  const now = new Date();
  const todayStart = startOfDay(now);

  const [
    totalUsers, newToday, newThisWeek, newThisMonth,
    mau, dau,
    totalPets, totalPosts, totalAiConversations,
    totalLogs, totalWeightLogs, totalCalendarEvents,
    churnedUsers,
    avgPetsPerUser,
    timeseries30,
    retentionCohorts,
    featureStats,
    totalNotifications,
  ] = await Promise.all([
    User.countDocuments(),
    User.countDocuments({ createdAt: { $gte: todayStart } }),
    User.countDocuments({ createdAt: { $gte: daysAgo(7) } }),
    User.countDocuments({ createdAt: { $gte: daysAgo(30) } }),
    User.countDocuments({ lastActiveAt: { $gte: daysAgo(30) } }),
    User.countDocuments({ lastActiveAt: { $gte: todayStart } }),
    Pet.countDocuments(),
    Post.countDocuments(),
    AiConversation.countDocuments(),
    PetLog.countDocuments(),
    WeightLog.countDocuments(),
    CalendarEvent.countDocuments(),
    // 流失：超過 14 天沒有開 app，且已註冊超過 14 天
    User.countDocuments({ lastActiveAt: { $lt: daysAgo(14) }, createdAt: { $lt: daysAgo(14) } }),
    Pet.aggregate([{ $group: { _id: '$userId' } }, { $group: { _id: null, avg: { $avg: { $sum: 1 } } } }]),
    buildDailyTimeseries(30),
    buildRetentionCohorts(),
    buildFeatureStats(),
    Notification.countDocuments(),
  ]);

  const stickinessRatio = mau > 0 ? Math.round((dau / mau) * 1000) / 10 : 0;
  const avgPets = avgPetsPerUser[0]?.avg
    ? Math.round((avgPetsPerUser[0].avg) * 10) / 10
    : 0;

  res.json({
    success: true,
    data: {
      overview: {
        totalUsers,
        newToday,
        newThisWeek,
        newThisMonth,
        mau,
        dau,
        stickinessRatio,
        churnedUsers,
      },
      content: {
        totalPets,
        totalPosts,
        totalAiConversations,
        totalLogs,
        totalWeightLogs,
        totalCalendarEvents,
        totalNotifications,
        avgPetsPerUser: avgPets,
      },
      timeseries: timeseries30,
      retentionCohorts,
      featureStats,
      generatedAt: now.toISOString(),
    },
  });
}
