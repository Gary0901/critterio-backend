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
    pushToken: { type: String },
    lastActiveAt: { type: Date, index: true },
  },
  { timestamps: true }
);

export default mongoose.model<IUser>('User', UserSchema);
