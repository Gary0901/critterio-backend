import { Expo, ExpoPushMessage } from 'expo-server-sdk';
import User from '../models/User';
import Notification, { NotificationType } from '../models/Notification';

const expo = new Expo();

export type NotifCategory = 'dailyCare' | 'calendar' | 'likes' | 'comments';

interface SendOptions {
  recipientUserId: string;
  type: NotificationType;
  title: string;
  body: string;
  data?: Record<string, string>;
  notifCategory?: NotifCategory;
}

export async function sendNotification(opts: SendOptions): Promise<void> {
  const { recipientUserId, type, title, body, data, notifCategory } = opts;

  // 建立應用內通知記錄
  await Notification.create({ userId: recipientUserId, type, title, body, data, read: false });

  // 查推播 token 與通知設定
  const user = await User.findById(recipientUserId).select('pushToken settings').lean();
  const token = (user as any)?.pushToken;
  if (!token || !Expo.isExpoPushToken(token)) return;

  // 檢查用戶是否關閉了這類通知
  if (notifCategory) {
    const ns = (user as any)?.settings?.notifSettings;
    if (ns && ns[notifCategory] === false) return;
  }

  const message: ExpoPushMessage = {
    to: token,
    sound: 'default',
    title,
    body,
    // type 原本沒有放進推播的 data 裡（只存在應用內的 Notification 紀錄）。
    // 點系統推播橫幅時前端要靠它判斷該跳去哪一頁，沒有這欄就無從判斷
    data: { ...(data ?? {}), type },
  };

  try {
    await expo.sendPushNotificationsAsync([message]);
  } catch {
    // 推播失敗不影響主流程
  }
}
