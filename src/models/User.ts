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
