import mongoose, { Document, Schema } from 'mongoose';

export interface IWeightLog extends Document {
  petId: mongoose.Types.ObjectId;
  weightKg: number;
  recordedAt: Date;
}

const WeightLogSchema = new Schema<IWeightLog>({
  petId:      { type: Schema.Types.ObjectId, ref: 'Pet', required: true },
  weightKg:   { type: Number, required: true },
  recordedAt: { type: Date, required: true, default: Date.now },
});

WeightLogSchema.index({ petId: 1, recordedAt: -1 });

export default mongoose.model<IWeightLog>('WeightLog', WeightLogSchema);
