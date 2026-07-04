import cron from 'node-cron';
import CalendarEvent from '../models/CalendarEvent';
import Pet from '../models/Pet';
import PetLog from '../models/PetLog';
import WeightLog from '../models/WeightLog';
import Notification from '../models/Notification';
import { sendNotification } from '../utils/push';

const TZ = 'Asia/Taipei';

// ─── 輔助：計算兩個日期相差幾天（忽略時分秒）─────────────────────────────────
function daysBetween(a: Date, b: Date): number {
  const msPerDay = 24 * 60 * 60 * 1000;
  const utcA = Date.UTC(a.getFullYear(), a.getMonth(), a.getDate());
  const utcB = Date.UTC(b.getFullYear(), b.getMonth(), b.getDate());
  return Math.round(Math.abs(utcB - utcA) / msPerDay);
}

const TYPE_LABEL: Record<string, string> = {
  vaccine:  '疫苗注射',
  deworm:   '驅蟲',
  grooming: '美容',
  medical:  '看診',
  activity: '活動',
  other:    '行程',
};

// ─── 1a. 一般事件：每 15 分鐘掃，開始前 1 小時推（跳過全天事件）──────────────
function scheduleCalendarReminders() {
  cron.schedule('*/15 * * * *', async () => {
    const now = new Date();
    const windowStart = new Date(now.getTime() + 55 * 60 * 1000);
    const windowEnd   = new Date(now.getTime() + 65 * 60 * 1000);

    const events = await CalendarEvent.find({
      startTime: { $gte: windowStart, $lte: windowEnd },
      done: false,
    }).lean();

    for (const ev of events) {
      // 全天事件（startTime 為當天 00:00）由每日 08:00 的 cron 處理
      const st = new Date(ev.startTime);
      if (st.getHours() === 0 && st.getMinutes() === 0) continue;

      const alreadySent = await Notification.findOne({
        'data.eventId': String(ev._id),
        type: 'health_reminder',
        createdAt: { $gte: new Date(now.getTime() - 2 * 60 * 60 * 1000) },
      }).lean();
      if (alreadySent) continue;

      const label = TYPE_LABEL[ev.type] ?? '行程';
      await sendNotification({
        recipientUserId: String(ev.userId),
        type: 'health_reminder',
        title: `⏰ ${label}提醒`,
        body: `「${ev.title}」將在 1 小時後開始，記得準備喔！`,
        data: { eventId: String(ev._id) },
        notifCategory: 'calendar',
      });
    }
  }, { timezone: TZ });
}

// ─── 1b. 全天事件：每天 08:00 推今日全天行程────────────────────────────────────
function scheduleAllDayReminders() {
  cron.schedule('0 8 * * *', async () => {
    const today = new Date();
    // 今天 00:00:00 ~ 00:01:00（全天事件的 startTime 精確落在午夜）
    const dayStart = new Date(today.getFullYear(), today.getMonth(), today.getDate(), 0, 0, 0);
    const dayEnd   = new Date(today.getFullYear(), today.getMonth(), today.getDate(), 0, 1, 0);

    const events = await CalendarEvent.find({
      startTime: { $gte: dayStart, $lt: dayEnd },
      done: false,
    }).lean();

    for (const ev of events) {
      const label = TYPE_LABEL[ev.type] ?? '行程';
      await sendNotification({
        recipientUserId: String(ev.userId),
        type: 'health_reminder',
        title: `📅 今日${label}提醒`,
        body: `「${ev.title}」是今天的全天行程，別忘了！`,
        data: { eventId: String(ev._id) },
        notifCategory: 'calendar',
      });
    }
  }, { timezone: TZ });
}

// ─── 2. 每天 08:00 — 生日 & 家庭週年 & 里程碑天數────────────────────────────
function scheduleDailyMilestones() {
  cron.schedule('0 8 * * *', async () => {
    const today = new Date();
    const mm = today.getMonth() + 1;
    const dd = today.getDate();
    const MILESTONE_DAYS = [100, 300, 500, 1000];

    const pets = await Pet.find({
      $or: [
        { birthday: { $exists: true } },
        { joinedFamilyAt: { $exists: true } },
      ],
    }).lean();

    for (const pet of pets) {
      const userId = String(pet.userId);
      const name   = pet.name;

      // 🎂 寵物生日
      if (pet.birthday) {
        const bday = new Date(pet.birthday);
        if (bday.getMonth() + 1 === mm && bday.getDate() === dd) {
          const age = today.getFullYear() - bday.getFullYear();
          await sendNotification({
            recipientUserId: userId,
            type: 'milestone',
            title: `🎂 ${name} 生日快樂！`,
            body: `今天是 ${name} ${age > 0 ? `${age} 歲` : '的'}生日，去給牠一個大大的擁抱吧！`,
            data: { petId: String(pet._id), petName: name, kind: 'birthday' },
            notifCategory: 'calendar',
          });
        }
      }

      // 🐾 加入家庭紀念日（年週年 + 里程碑天數）
      if (pet.joinedFamilyAt) {
        const joined = new Date(pet.joinedFamilyAt);
        const totalDays = daysBetween(joined, today);

        // 年週年（第 1、2、3… 年的同月同日）
        if (joined.getMonth() + 1 === mm && joined.getDate() === dd) {
          const years = today.getFullYear() - joined.getFullYear();
          if (years > 0) {
            await sendNotification({
              recipientUserId: userId,
              type: 'milestone',
              title: `🐾 ${name} 加入家庭 ${years} 週年！`,
              body: `與 ${name} 相伴的 ${years} 年，每一天都是珍貴的回憶 ❤️`,
              data: { petId: String(pet._id), petName: name, kind: 'anniversary', years: String(years) },
              notifCategory: 'calendar',
            });
          }
        }

        // 100 / 300 / 500 / 1000 天里程碑
        if (MILESTONE_DAYS.includes(totalDays)) {
          const EMOJI: Record<number, string> = { 100: '🎉', 300: '⭐', 500: '💫', 1000: '👑' };
          await sendNotification({
            recipientUserId: userId,
            type: 'milestone',
            title: `${EMOJI[totalDays]} ${name} 加入家庭滿 ${totalDays} 天！`,
            body: `你們已經一起度過了 ${totalDays} 個美好的日子，繼續加油！`,
            data: { petId: String(pet._id), petName: name, kind: 'milestone_days', days: String(totalDays) },
            notifCategory: 'calendar',
          });
        }
      }
    }
  }, { timezone: TZ });
}

// ─── 3. 每天 20:00 — 今日日誌提醒（當天還沒有任何寵物記錄才推）──────────────
function scheduleDailyLogReminder() {
  cron.schedule('0 20 * * *', async () => {
    const today = new Date();
    const startOfDay = new Date(today.getFullYear(), today.getMonth(), today.getDate());

    // 取得所有有寵物的用戶
    const pets = await Pet.find({}).select('userId _id').lean();
    const userPets = new Map<string, string[]>();
    for (const p of pets) {
      const uid = String(p.userId);
      if (!userPets.has(uid)) userPets.set(uid, []);
      userPets.get(uid)!.push(String(p._id));
    }

    for (const [userId, petIds] of userPets) {
      const hasLog = await PetLog.exists({
        petId: { $in: petIds },
        date:  { $gte: startOfDay },
      });
      if (hasLog) continue;

      await sendNotification({
        recipientUserId: userId,
        type: 'health_reminder',
        title: '📔 今天還沒記錄喔！',
        body: '花幾分鐘記下毛孩今天的點點滴滴，讓回憶更完整 🐾',
        notifCategory: 'dailyCare',
      });
    }
  }, { timezone: TZ });
}

// ─── 4. 每天 09:00 — 體重記錄提醒（7 天沒記錄才推）────────────────────────────
function scheduleWeightReminder() {
  cron.schedule('0 9 * * *', async () => {
    const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);

    const pets = await Pet.find({}).select('userId _id name').lean();
    const userPets = new Map<string, { id: string; name: string }[]>();
    for (const p of pets) {
      const uid = String(p.userId);
      if (!userPets.has(uid)) userPets.set(uid, []);
      userPets.get(uid)!.push({ id: String(p._id), name: p.name });
    }

    for (const [userId, petList] of userPets) {
      for (const pet of petList) {
        const recent = await WeightLog.exists({
          petId:      pet.id,
          recordedAt: { $gte: sevenDaysAgo },
        });
        if (recent) continue;

        await sendNotification({
          recipientUserId: userId,
          type: 'health_reminder',
          title: `⚖️ ${pet.name} 的體重該記錄了`,
          body: `已超過 7 天沒有記錄 ${pet.name} 的體重，定期追蹤有助於健康管理！`,
          data: { petId: pet.id },
          notifCategory: 'dailyCare',
        });
      }
    }
  }, { timezone: TZ });
}

// ─── 啟動所有排程 ─────────────────────────────────────────────────────────────
export function startNotificationJobs() {
  scheduleCalendarReminders();
  scheduleAllDayReminders();
  scheduleDailyMilestones();
  scheduleDailyLogReminder();
  scheduleWeightReminder();
  console.log('✅ Notification cron jobs started');
}
