import 'dotenv/config';
import mongoose from 'mongoose';
import Place from '../src/models/Place';
import { PARTNERS, PartnerSeed } from './partners';

/**
 * 把 partners.ts 的名單寫進資料庫。可重複執行（upsert）。
 *
 *   npm run seed:partners
 *
 * 名單裡被移除的夥伴會被取消標記 —— 這樣「不續約」只要把那筆從
 * partners.ts 刪掉再跑一次，不用手動去資料庫改。
 */

function partnerFilter(p: PartnerSeed): Record<string, unknown> {
  if (p.googlePlaceId) return { googlePlaceId: p.googlePlaceId };
  // 有座標就加上近似比對，0.0005 度約 55 公尺 —— 足以容忍座標誤差，
  // 又不會誤中隔壁店家。沒座標就只靠店名精準比對。
  if (p.lat !== undefined && p.lng !== undefined) {
    return {
      name: p.name,
      'location.coordinates.0': { $gte: p.lng - 0.0005, $lte: p.lng + 0.0005 },
      'location.coordinates.1': { $gte: p.lat - 0.0005, $lte: p.lat + 0.0005 },
    };
  }
  return { name: p.name };
}

async function main() {
  const uri = process.env.MONGODB_URI;
  if (!uri) throw new Error('缺少 MONGODB_URI');
  await mongoose.connect(uri);
  console.log('已連線資料庫\n');

  const seededIds: mongoose.Types.ObjectId[] = [];

  for (const p of PARTNERS) {
    const partnerFields = {
      isPartner: true,
      partnerDescription: p.description,
      partnerTags: p.tags,
      partnerPhotos: p.photos,
      partnerUntil: p.until ? new Date(p.until) : undefined,
    };

    const existing = await Place.findOne(partnerFilter(p));

    if (existing) {
      // 只覆寫合作夥伴欄位，Google 抓來的評分、營業時間、照片維持原樣
      Object.assign(existing, partnerFields);
      if (p.phone && !existing.phone) existing.phone = p.phone;
      await existing.save();
      seededIds.push(existing._id as mongoose.Types.ObjectId);
      console.log(`  更新  ${p.name}`);
    } else {
      // 資料庫裡沒有這家店才需要基本資料。既有店家漏填不會走到這裡，
      // 但打錯店名會 —— 明確報錯比默默建一筆殘缺的地點好。
      if (!p.type || !p.address || p.lat === undefined || p.lng === undefined) {
        throw new Error(
          `找不到「${p.name}」。若要新建請補上 type / address / lat / lng；` +
          `若這家店應該已存在，請用 npm run find:place 確認店名是否完全一致。`
        );
      }
      const created = await Place.create({
        name: p.name,
        type: p.type,
        address: p.address,
        phone: p.phone,
        googlePlaceId: p.googlePlaceId,
        location: { type: 'Point', coordinates: [p.lng, p.lat] },
        ...partnerFields,
      });
      seededIds.push(created._id as mongoose.Types.ObjectId);
      console.log(`  新建  ${p.name}`);
    }
  }

  // 已經不在名單上的，取消夥伴標記但保留地點本身 —— 那可能是 Google
  // 抓來的正常地點，直接刪掉會讓它從地圖上消失
  const cleared = await Place.updateMany(
    { isPartner: true, _id: { $nin: seededIds } },
    { $unset: { partnerDescription: '', partnerTags: '', partnerPhotos: '', partnerUntil: '' }, $set: { isPartner: false } },
  );
  if (cleared.modifiedCount > 0) {
    console.log(`\n  取消 ${cleared.modifiedCount} 筆已不在名單上的夥伴標記`);
  }

  console.log(`\n完成：${PARTNERS.length} 筆合作夥伴`);
  await mongoose.disconnect();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
