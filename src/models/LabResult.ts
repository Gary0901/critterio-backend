import mongoose, { Document, Schema } from 'mongoose';

export interface LabResultItem {
  itemName: string;
  abbreviation?: string;
  value: number;
  unit: string;
  refRange?: string;
  status: 'NORMAL' | 'HIGH' | 'LOW' | 'UNKNOWN';
  plainExplanation: string;
}

export interface ILabResult extends Document {
  petId: mongoose.Types.ObjectId;
  imageUrl: string;
  reportType: string;
  reportDate: Date;
  items: LabResultItem[];
  summaryAdvice: string;
  createdAt: Date;
}

const LabResultSchema = new Schema<ILabResult>(
  {
    petId:     { type: Schema.Types.ObjectId, ref: 'Pet', required: true },
    imageUrl:  { type: String, required: true },
    reportType: { type: String, required: true },
    reportDate: { type: Date, required: true },
    items: [
      {
        itemName:     { type: String, required: true },
        abbreviation: { type: String },
        value:        { type: Number, required: true },
        unit:         { type: String, required: true },
        refRange:     { type: String },
        status:       { type: String, enum: ['NORMAL', 'HIGH', 'LOW', 'UNKNOWN'], required: true },
        plainExplanation: { type: String, required: true },
      },
    ],
    summaryAdvice: { type: String, default: '' },
  },
  { timestamps: { createdAt: true, updatedAt: false } }
);

LabResultSchema.index({ petId: 1, reportDate: -1 });

export default mongoose.model<ILabResult>('LabResult', LabResultSchema);
