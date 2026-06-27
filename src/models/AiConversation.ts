import mongoose, { Document, Schema } from 'mongoose';

interface AiMessage {
  role: 'user' | 'assistant';
  content: string;
  imageUrl?: string;
  createdAt: Date;
}

export interface IAiConversation extends Document {
  userId: mongoose.Types.ObjectId;
  petId?: mongoose.Types.ObjectId;
  title: string;
  messages: AiMessage[];
  createdAt: Date;
  updatedAt: Date;
}

const AiConversationSchema = new Schema<IAiConversation>(
  {
    userId: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    petId:  { type: Schema.Types.ObjectId, ref: 'Pet' },
    title:  { type: String, default: '新對話' },
    messages: [
      {
        role:      { type: String, enum: ['user', 'assistant'], required: true },
        content:   { type: String, required: true },
        imageUrl:  { type: String },
        createdAt: { type: Date, default: Date.now },
      },
    ],
  },
  { timestamps: true }
);

// 按最後更新時間排序；90 天後自動刪除
AiConversationSchema.index({ userId: 1, updatedAt: -1 });
AiConversationSchema.index({ updatedAt: 1 }, { expireAfterSeconds: 7776000 });

export default mongoose.model<IAiConversation>('AiConversation', AiConversationSchema);
