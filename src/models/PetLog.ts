import mongoose, { Document, Schema } from 'mongoose';

interface LogPhoto {
  url: string;
  takenAt?: string;
}

export interface IPetLog extends Document {
  petId: mongoose.Types.ObjectId;
  date: Date;
  title?: string;
  content: string;
  images: LogPhoto[];
  mood: string[];
  hashtags: string[];
  createdAt: Date;
}

const PetLogSchema = new Schema<IPetLog>(
  {
    petId:    { type: Schema.Types.ObjectId, ref: 'Pet', required: true },
    date:     { type: Date, required: true },
    title:    { type: String },
    content:  { type: String, required: true },
    images:   [{ url: String, takenAt: String }],
    mood:     [{ type: String }],
    hashtags: [{ type: String }],
  },
  { timestamps: true }
);

PetLogSchema.index({ petId: 1, date: -1 });

export default mongoose.model<IPetLog>('PetLog', PetLogSchema);
