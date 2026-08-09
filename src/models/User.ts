import mongoose, { Document, Schema } from 'mongoose';

export interface IUser extends Document {
  email?: string;
  passwordHash?: string;
  resetPasswordToken?: string;
  resetPasswordExpires?: Date;
  authProviders: {
    googleId?: string;
    appleId?: string;
  };
  profile: {
    name: string;
    avatarUrl?: string;
    /**
     * 沒上傳照片時，頭像圓圈底色在調色盤中的索引。
     * 存索引而不是 hex —— 每個佈景主題對同一個索引有各自調過的色值，
     * 存 hex 的話切到深色主題會變成一個沒調過的亮色。
     * 調色盤定義在 frontend/src/constants/avatarColors.ts。
     * undefined 表示沒選過，前端會依 id 雜湊自動配一個。
     */
    avatarColor?: number;
    lastNameChangedAt?: Date;
  };
  settings?: {
    defaultPostVisibility?: 'public' | 'private';
    notifSettings?: {
      dailyCare?: boolean;
      calendar?: boolean;
      likes?: boolean;
      comments?: boolean;
    };
  };
  pushToken?: string;
  lastActiveAt?: Date;
  createdAt: Date;
  updatedAt: Date;
}

const UserSchema = new Schema<IUser>(
  {
    email: { type: String, sparse: true, unique: true, lowercase: true },
    passwordHash: { type: String },
    resetPasswordToken: { type: String },
    resetPasswordExpires: { type: Date },
    authProviders: {
      googleId: { type: String, sparse: true, unique: true },
      appleId:  { type: String, sparse: true, unique: true },
    },
    profile: {
      name: { type: String, required: true },
      avatarUrl: { type: String },
      avatarColor: { type: Number, min: 0, max: 5 },
      lastNameChangedAt: { type: Date },
    },
    settings: {
      defaultPostVisibility: { type: String, enum: ['public', 'private'], default: 'public' },
      notifSettings: {
        dailyCare: { type: Boolean, default: true },
        calendar:  { type: Boolean, default: true },
        likes:     { type: Boolean, default: true },
        comments:  { type: Boolean, default: true },
      },
    },
    pushToken: { type: String },
    lastActiveAt: { type: Date, index: true },
  },
  { timestamps: true }
);

export default mongoose.model<IUser>('User', UserSchema);
