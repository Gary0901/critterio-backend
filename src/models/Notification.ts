import mongoose, { Document, Schema } from 'mongoose';

export type NotificationType = 'like' | 'comment' | 'health_reminder' | 'milestone' | 'lost_pet' | 'vet_visit_parsed';

export interface INotification extends Document {
  userId: mongoose.Types.ObjectId;
  type: NotificationType;
  title: string;
  body: string;
  read: boolean;
  data?: Record<string, string>;
  createdAt: Date;
}

const NotificationSchema = new Schema<INotification>(
  {
    userId: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    type:   { type: String, enum: ['like', 'comment', 'health_reminder', 'milestone', 'lost_pet', 'vet_visit_parsed'], required: true },
    title:  { type: String, required: true },
    body:   { type: String, required: true },
    read:   { type: Boolean, default: false },
    data:   { type: Map, of: String },
  },
  { timestamps: true }
);

NotificationSchema.index({ userId: 1, createdAt: -1 });
// 90 天後自動刪除
NotificationSchema.index({ createdAt: 1 }, { expireAfterSeconds: 7_776_000 });

export default mongoose.model<INotification>('Notification', NotificationSchema);
