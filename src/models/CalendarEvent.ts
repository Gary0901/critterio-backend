import mongoose, { Document, Schema } from 'mongoose';

export interface ICalendarEvent extends Document {
  userId: mongoose.Types.ObjectId;
  petId?: mongoose.Types.ObjectId;
  title: string;
  type: 'vaccine' | 'deworm' | 'grooming' | 'medical' | 'activity' | 'other';
  startTime: Date;
  endTime?: Date;
  note?: string;
  done: boolean;
  repeat: 'none' | 'daily' | 'weekly' | 'monthly';
  recurringId?: string;
  createdAt: Date;
}

const CalendarEventSchema = new Schema<ICalendarEvent>(
  {
    userId:      { type: Schema.Types.ObjectId, ref: 'User', required: true },
    petId:       { type: Schema.Types.ObjectId, ref: 'Pet' },
    title:       { type: String, required: true },
    type:        { type: String, enum: ['vaccine', 'deworm', 'grooming', 'medical', 'activity', 'other'], required: true },
    startTime:   { type: Date, required: true },
    endTime:     { type: Date },
    note:        { type: String },
    done:        { type: Boolean, default: false },
    repeat:      { type: String, enum: ['none', 'daily', 'weekly', 'monthly'], default: 'none' },
    recurringId: { type: String },
  },
  { timestamps: true }
);

CalendarEventSchema.index({ userId: 1, startTime: 1 });
CalendarEventSchema.index({ recurringId: 1 });

export default mongoose.model<ICalendarEvent>('CalendarEvent', CalendarEventSchema);
