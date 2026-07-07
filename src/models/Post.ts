import mongoose, { Document, Schema } from 'mongoose';

export interface IPost extends Document {
  userId: mongoose.Types.ObjectId;
  petId?: mongoose.Types.ObjectId;
  content: string;
  images: string[];
  hashtags: string[];
  withPets: string[];
  postType: 'question' | 'meetup' | 'share';
  visibility: 'public' | 'private';
  status: 'active' | 'hidden';
  metrics: {
    likesCount: number;
    commentsCount: number;
  };
  createdAt: Date;
  updatedAt: Date;
}

const PostSchema = new Schema<IPost>(
  {
    userId:  { type: Schema.Types.ObjectId, ref: 'User', required: true },
    petId:   { type: Schema.Types.ObjectId, ref: 'Pet' },
    content:  { type: String, required: true },
    images:   [{ type: String }],
    hashtags: [{ type: String }],
    withPets: [{ type: String }],
    postType: { type: String, enum: ['question', 'meetup', 'share'], default: 'share' },
    visibility: { type: String, enum: ['public', 'private'], default: 'public' },
    status:   { type: String, enum: ['active', 'hidden'], default: 'active' },
    metrics: {
      likesCount:    { type: Number, default: 0 },
      commentsCount: { type: Number, default: 0 },
    },
  },
  { timestamps: true }
);

PostSchema.index({ status: 1, createdAt: -1 });

export default mongoose.model<IPost>('Post', PostSchema);
