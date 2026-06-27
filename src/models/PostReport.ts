import mongoose, { Document, Schema } from 'mongoose';

export interface IPostReport extends Document {
  postId: mongoose.Types.ObjectId;
  userId: mongoose.Types.ObjectId;
  reason: 'SPAM' | 'INAPPROPRIATE' | 'OTHER';
  createdAt: Date;
}

const PostReportSchema = new Schema<IPostReport>(
  {
    postId: { type: Schema.Types.ObjectId, ref: 'Post', required: true },
    userId: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    reason: { type: String, enum: ['SPAM', 'INAPPROPRIATE', 'OTHER'], required: true },
  },
  { timestamps: true }
);

// 同一用戶對同一貼文只能檢舉一次
PostReportSchema.index({ postId: 1, userId: 1 }, { unique: true });

export default mongoose.model<IPostReport>('PostReport', PostReportSchema);
