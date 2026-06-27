import https from 'https';
import { Response } from 'express';
import { AuthRequest } from '../middleware/auth';
import Place from '../models/Place';
import Favorite from '../models/Favorite';

const GOOGLE_KEY = process.env.GOOGLE_GEOCODING_KEY ?? '';

// ─── Places ───────────────────────────────────────────────────────────────────

export async function searchNearby(req: AuthRequest, res: Response): Promise<void> {
  const { lat, lng, type, radius = '5000' } = req.query as Record<string, string>;
  if (!lat || !lng) {
    res.status(400).json({ success: false, data: null, message: 'lat 與 lng 為必填' });
    return;
  }
  const filter: Record<string, any> = {
    location: {
      $near: {
        $geometry: { type: 'Point', coordinates: [parseFloat(lng), parseFloat(lat)] },
        $maxDistance: parseInt(radius),
      },
    },
  };
  if (type) filter.type = type;

  const places = await Place.find(filter).limit(100).lean();

  // 查詢當前用戶的收藏
  const placeIds = places.map((p) => p._id);
  const favs = await Favorite.find({ userId: req.userId, placeId: { $in: placeIds } }).lean();
  const favSet = new Set(favs.map((f) => String(f.placeId)));

  const data = places.map((p) => ({
    id: p._id,
    name: p.name,
    type: p.type,
    address: p.address,
    lat: p.location.coordinates[1],
    lng: p.location.coordinates[0],
    isFavorite: favSet.has(String(p._id)),
    phone: p.phone ?? undefined,
    rating: p.rating ?? undefined,
    weekdayHours: p.weekdayHours?.length ? p.weekdayHours : undefined,
    photoRef: p.photoRefs?.[0] ?? undefined,
  }));
  res.json({ success: true, data, message: '' });
}

export async function listPlaces(req: AuthRequest, res: Response): Promise<void> {
  const { type, keyword, page = '1', limit = '10' } = req.query as Record<string, string>;
  const filter: Record<string, any> = {};
  if (type) filter.type = type;
  if (keyword) filter.name = { $regex: keyword, $options: 'i' };

  const skip = (parseInt(page) - 1) * parseInt(limit);
  const places = await Place.find(filter).skip(skip).limit(parseInt(limit)).lean();
  res.json({ success: true, data: places.map((p) => ({ id: p._id, name: p.name, address: p.address, type: p.type, phone: p.phone })), message: '' });
}

export async function createPlace(req: AuthRequest, res: Response): Promise<void> {
  // Admin-only endpoint（未來加 admin middleware）
  const { name, lat, lng, type, address, phone } = req.body;
  if (!name || lat == null || lng == null || !type || !address) {
    res.status(400).json({ success: false, data: null, message: 'name、lat、lng、type、address 為必填' });
    return;
  }
  const place = await Place.create({
    name, type, address,
    phone: phone ?? undefined,
    location: { type: 'Point', coordinates: [parseFloat(lng), parseFloat(lat)] },
  });
  res.status(201).json({ success: true, data: { id: place._id }, message: '地點建立成功' });
}

// ─── Favorites ────────────────────────────────────────────────────────────────

export async function addFavorite(req: AuthRequest, res: Response): Promise<void> {
  const { placeId } = req.body;
  if (!placeId) {
    res.status(400).json({ success: false, data: null, message: 'placeId 為必填' });
    return;
  }
  const exists = await Place.findById(placeId);
  if (!exists) {
    res.status(404).json({ success: false, data: null, message: '找不到地點' });
    return;
  }
  await Favorite.findOneAndUpdate(
    { userId: req.userId, placeId },
    { userId: req.userId, placeId },
    { upsert: true, new: true }
  );
  res.json({ success: true, data: null, message: '已加到喜愛地點' });
}

export async function getFavorites(req: AuthRequest, res: Response): Promise<void> {
  const favs = await Favorite.find({ userId: req.userId }).populate('placeId').lean();
  const data = favs
    .filter((f) => f.placeId)
    .map((f) => {
      const p = f.placeId as any;
      return {
        id: p._id,
        name: p.name,
        type: p.type,
        address: p.address,
        phone: p.phone ?? undefined,
        rating: p.rating ?? undefined,
        weekdayHours: p.weekdayHours?.length ? p.weekdayHours : undefined,
        photoRef: p.photoRefs?.[0] ?? undefined,
        lat: p.location.coordinates[1],
        lng: p.location.coordinates[0],
        isFavorite: true,
      };
    });
  res.json({ success: true, data, message: '' });
}

export async function removeFavorite(req: AuthRequest, res: Response): Promise<void> {
  const fav = await Favorite.findOneAndDelete({ userId: req.userId, placeId: req.params.placeId.trim() });
  if (!fav) {
    res.status(404).json({ success: false, data: null, message: '找不到收藏' });
    return;
  }
  res.json({ success: true, data: null, message: '已從喜愛地點移除' });
}

// ─── Photo proxy ──────────────────────────────────────────────────────────────
// 將 Google Places photoReference 轉為可直接顯示的圖片 URL（API key 留在後端）

export function getPlacePhoto(req: AuthRequest, res: Response): void {
  const { ref, maxwidth = '800' } = req.query as Record<string, string>;
  if (!ref || !GOOGLE_KEY) {
    res.status(400).json({ success: false, data: null, message: 'ref 為必填' });
    return;
  }
  const url =
    `https://maps.googleapis.com/maps/api/place/photo` +
    `?maxwidth=${maxwidth}&photoreference=${encodeURIComponent(ref)}&key=${GOOGLE_KEY}`;

  // 直接 redirect 給 Google — Google 會再 302 到實際 CDN 圖片
  https.get(url, (upstream) => {
    if (upstream.headers.location) {
      res.redirect(upstream.headers.location);
    } else {
      upstream.pipe(res);
    }
  }).on('error', () => res.status(502).end());
}
