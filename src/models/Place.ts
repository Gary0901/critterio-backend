import mongoose, { Document, Schema } from 'mongoose';

export interface IPlace extends Document {
  name: string;
  type: 'hospital' | 'restaurant' | 'hotel' | 'petstore' | 'park' | 'grooming';
  address: string;
  phone?: string;
  rating?: number;
  ratingCount?: number;
  weekdayHours?: string[];
  photoRefs?: string[];
  website?: string;
  googlePlaceId?: string;
  enriched?: boolean;
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
  photoRefs:     { type: [String] },
  website:       { type: String },
  googlePlaceId: { type: String },
  enriched:      { type: Boolean },
  location: {
    type:        { type: String, enum: ['Point'], required: true },
    coordinates: { type: [Number], required: true },
  },
});

PlaceSchema.index({ location: '2dsphere' });

export default mongoose.model<IPlace>('Place', PlaceSchema);
