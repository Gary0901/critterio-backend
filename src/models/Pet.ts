import mongoose, { Document, Schema } from 'mongoose';

interface CareTarget {
  title: string;
  value: number;
  unit: string;
  category?: string;
}

export interface IPet extends Document {
  userId: mongoose.Types.ObjectId;
  name: string;
  species: 'dog' | 'cat' | 'rabbit' | 'small' | 'other';
  breed: string;
  birthday?: Date;
  joinedFamilyAt?: Date;
  gender: 'male' | 'female';
  weight: number;
  heightCm: number;
  photoUrl?: string;
  traits: string[];
  careTargets: CareTarget[];
  createdAt: Date;
}

const PetSchema = new Schema<IPet>(
  {
    userId:   { type: Schema.Types.ObjectId, ref: 'User', required: true },
    name:     { type: String, required: true },
    species:  { type: String, enum: ['dog', 'cat', 'rabbit', 'small', 'other'], required: true },
    breed:    { type: String, default: '' },
    birthday:       { type: Date },
    joinedFamilyAt: { type: Date },
    gender:   { type: String, enum: ['male', 'female'], required: true },
    weight:   { type: Number, required: true },
    heightCm: { type: Number, default: 0 },
    photoUrl: { type: String },
    traits:   [{ type: String }],
    careTargets: [
      {
        title:    { type: String, required: true },
        value:    { type: Number, required: true },
        unit:     { type: String, required: true },
        category: { type: String },
      },
    ],
  },
  { timestamps: true }
);

PetSchema.index({ userId: 1 });

export default mongoose.model<IPet>('Pet', PetSchema);
