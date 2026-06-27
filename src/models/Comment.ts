import mongoose, { Document, Schema } from 'mongoose';

export interface IComment extends Document {
  postId: mongoose.Types.ObjectId;
  userId: mongoose.Types.ObjectId;
  content: string;
  createdAt: Date;
}

const CommentSchema = new Schema<IComment>(
  {
    postId:  { type: Schema.Types.ObjectId, ref: 'Post', required: true },
    userId:  { type: Schema.Types.ObjectId, ref: 'User', required: true },
    content: { type: String, required: true },
  },
  { timestamps: true }
);

CommentSchema.index({ postId: 1, createdAt: 1 });

export default mongoose.model<IComment>('Comment', CommentSchema);
