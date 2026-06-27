import { Expo, ExpoPushMessage } from 'expo-server-sdk';
import User from '../models/User';
import Notification, { NotificationType } from '../models/Notification';

const expo = new Expo();

interface SendOptions {
  recipientUserId: string;
  type: NotificationType;
  title: string;
  body: string;
  data?: Record<string, string>;
}

export async function sendNotification(opts: SendOptions): Promise<void> {
  const { recipientUserId, type, title, body, data } = opts;

  // 建立應用內通知記錄
  await Notification.create({ userId: recipientUserId, type, title, body, data, read: false });

  // 查推播 token
  const user = await User.findById(recipientUserId).select('pushToken').lean();
  const token = (user as any)?.pushToken;
  if (!token || !Expo.isExpoPushToken(token)) return;

  const message: ExpoPushMessage = {
    to: token,
    sound: 'default',
    title,
    body,
    data: data ?? {},
  };

  try {
    await expo.sendPushNotificationsAsync([message]);
  } catch {
    // 推播失敗不影響主流程
  }
}
