import mongoose, { Document, Schema } from 'mongoose';

export interface IPostLike extends Document {
  postId: mongoose.Types.ObjectId;
  userId: mongoose.Types.ObjectId;
  createdAt: Date;
}

const PostLikeSchema = new Schema<IPostLike>(
  {
    postId: { type: Schema.Types.ObjectId, ref: 'Post', required: true },
    userId: { type: Schema.Types.ObjectId, ref: 'User', required: true },
  },
  { timestamps: true }
);

PostLikeSchema.index({ postId: 1, userId: 1 }, { unique: true });

export default mongoose.model<IPostLike>('PostLike', PostLikeSchema);
