import mongoose, { Document, Schema } from 'mongoose';

export interface IPlace extends Document {
  name: string;
  type: 'hospital' | 'restaurant' | 'hotel' | 'petstore' | 'park' | 'grooming';
  address: string;
  phone?: string;
  rating?: number;
  ratingCount?: number;
  weekdayHours?: string[];
  is24Hours?: boolean;
  exoticFriendly?: boolean;
  photoRefs?: string[];
  photoUrls?: string[];
  website?: string;
  googlePlaceId?: string;
  enriched?: boolean;

  /* --- 合作夥伴 --- */
  /** 由 scripts/seedPartners.ts 寫入，不會被 Google Places 的資料覆蓋 */
  isPartner?: boolean;
  partnerDescription?: string;
  partnerTags?: string[];
  /** 自己上傳的宣傳照，與 Google 抓來的 photoUrls 分開存 */
  partnerPhotos?: string[];
  /** 合作到期日。收費方案會有期限，到期後 API 就不再標記為夥伴 */
  partnerUntil?: Date;
  location: {
    type: 'Point';
    coordinates: [number, number]; // [lng, lat]
  };
}

const PlaceSchema = new Schema<IPlace>({
  name:          { type: String, required: true },
  type:          { type: String, enum: ['hospital', 'restaurant', 'hotel', 'petstore', 'park', 'grooming'], required: true },
  address:       { type: String, required: true },
  phone:         { type: String },
  rating:        { type: Number },
  ratingCount:   { type: Number },
  weekdayHours:  { type: [String] },
  is24Hours:     { type: Boolean, default: false },
  exoticFriendly: { type: Boolean, default: false },
  photoRefs:     { type: [String] },
  photoUrls:     { type: [String] },
  website:       { type: String },
  googlePlaceId: { type: String },
  enriched:      { type: Boolean },

  isPartner:          { type: Boolean, default: false, index: true },
  partnerDescription: { type: String },
  partnerTags:        { type: [String] },
  partnerPhotos:      { type: [String] },
  partnerUntil:       { type: Date },
  location: {
    type:        { type: String, enum: ['Point'], required: true },
    coordinates: { type: [Number], required: true },
  },
});

PlaceSchema.index({ location: '2dsphere' });

export default mongoose.model<IPlace>('Place', PlaceSchema);
