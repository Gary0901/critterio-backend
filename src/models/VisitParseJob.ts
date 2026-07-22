import mongoose, { Document, Schema } from 'mongoose';
import { LabResultItem } from './VetVisit';

export interface IVisitParseJob extends Document {
  userId: mongoose.Types.ObjectId;
  petId: mongoose.Types.ObjectId;
  status: 'processing' | 'ready' | 'failed';
  imageUrl: string;
  reportType?: string;
  items: LabResultItem[];
  summaryAdvice?: string;
  errorMessage?: string;
  createdAt: Date;
}

const VisitParseJobSchema = new Schema<IVisitParseJob>(
  {
    userId:   { type: Schema.Types.ObjectId, ref: 'User', required: true },
    petId:    { type: Schema.Types.ObjectId, ref: 'Pet', required: true },
    status:   { type: String, enum: ['processing', 'ready', 'failed'], default: 'processing' },
    imageUrl: { type: String, required: true },
    reportType: { type: String, default: '' },
    items: [
      {
        itemName:     { type: String, required: true },
        abbreviation: { type: String, default: '' },
        value:        { type: Number, required: true },
        unit:         { type: String, default: '' },
        refRange:     { type: String, default: '' },
        status:       { type: String, enum: ['NORMAL', 'HIGH', 'LOW', 'UNKNOWN'], required: true },
        plainExplanation: { type: String, default: '' },
      },
    ],
    summaryAdvice: { type: String, default: '' },
    errorMessage:  { type: String, default: '' },
  },
  { timestamps: { createdAt: true, updatedAt: false } }
);

VisitParseJobSchema.index({ petId: 1, createdAt: -1 });
// 這只是暫存的解析草稿，使用者確認後會另外存進 VetVisit，7 天後自動清掉即可
VisitParseJobSchema.index({ createdAt: 1 }, { expireAfterSeconds: 604_800 });

export default mongoose.model<IVisitParseJob>('VisitParseJob', VisitParseJobSchema);
