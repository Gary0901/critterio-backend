import mongoose, { Document, Schema } from 'mongoose';

export interface IUserBlock extends Document {
  blockerId: mongoose.Types.ObjectId;
  blockedId: mongoose.Types.ObjectId;
  createdAt: Date;
}

const UserBlockSchema = new Schema<IUserBlock>(
  {
    blockerId: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    blockedId: { type: Schema.Types.ObjectId, ref: 'User', required: true },
  },
  { timestamps: true }
);

// 同一用戶對同一對象只能封鎖一次
UserBlockSchema.index({ blockerId: 1, blockedId: 1 }, { unique: true });
// 反向查詢「誰封鎖了我」，用於雙向隱藏內容
UserBlockSchema.index({ blockedId: 1 });

export default mongoose.model<IUserBlock>('UserBlock', UserBlockSchema);
