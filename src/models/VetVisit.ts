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

export interface Medication {
  name: string;
  dosage?: string;
  frequency?: string;
  notes?: string;
}

export interface IVetVisit extends Document {
  petId: mongoose.Types.ObjectId;
  visitDate: Date;
  clinicName?: string;
  diagnosisNote?: string;
  imageUrl?: string;
  reportType?: string;
  items: LabResultItem[];
  medications: Medication[];
  summaryAdvice: string;
  calendarEventId?: mongoose.Types.ObjectId;
  createdAt: Date;
}

const VetVisitSchema = new Schema<IVetVisit>(
  {
    petId:         { type: Schema.Types.ObjectId, ref: 'Pet', required: true },
    visitDate:     { type: Date, required: true },
    clinicName:    { type: String, default: '' },
    diagnosisNote: { type: String, default: '' },
    imageUrl:      { type: String, default: '' },
    reportType:    { type: String, default: '' },
    items: [
      {
        itemName:     { type: String, required: true },
        abbreviation: { type: String, default: '' },
        value:        { type: Number, required: true },
        // unit 跟 plainExplanation 故意不設 required：Mongoose 對 String 的 required 檢查會把空字串視為「沒有值」，
        // 但無單位比值（如 ALB/GLOB）本來就該是空字串、AI 也可能生不出解釋，設 required 會讓存檔直接失敗
        unit:         { type: String, default: '' },
        refRange:     { type: String, default: '' },
        status:       { type: String, enum: ['NORMAL', 'HIGH', 'LOW', 'UNKNOWN'], required: true },
        plainExplanation: { type: String, default: '' },
      },
    ],
    medications: [
      {
        name:      { type: String, required: true },
        dosage:    { type: String, default: '' },
        frequency: { type: String, default: '' },
        notes:     { type: String, default: '' },
      },
    ],
    summaryAdvice:   { type: String, default: '' },
    calendarEventId: { type: Schema.Types.ObjectId, ref: 'CalendarEvent' },
  },
  { timestamps: { createdAt: true, updatedAt: false } }
);

VetVisitSchema.index({ petId: 1, visitDate: -1 });

export default mongoose.model<IVetVisit>('VetVisit', VetVisitSchema);
