import 'dotenv/config';
import mongoose from 'mongoose';
import Place from '../src/models/Place';

/**
 * 用關鍵字在資料庫裡找地點，印出寫進 partners.ts 需要的欄位。
 *
 *   npm run find:place -- 狗日子
 *
 * 談合作的店家多半已經被 Google Places 收錄進資料庫了，
 * 這支就是用來拿它的 googlePlaceId（最可靠的比對鍵），
 * 不用手動去 Google Maps 網址裡挖。
 */

async function main() {
  const keyword = process.argv.slice(2).join(' ').trim();
  if (!keyword) {
    console.error('用法：npm run find:place -- <關鍵字>');
    process.exit(1);
  }

  const uri = process.env.MONGODB_URI;
  if (!uri) throw new Error('缺少 MONGODB_URI');
  await mongoose.connect(uri);

  const places = await Place.find({ name: { $regex: keyword, $options: 'i' } })
    .limit(10)
    .lean();

  if (places.length === 0) {
    console.log(`\n找不到符合「${keyword}」的地點。`);
    console.log('可能它還沒被收錄 —— 那就在 partners.ts 補齊 type/address/lat/lng，腳本會直接建立。\n');
  } else {
    console.log(`\n找到 ${places.length} 筆：\n`);
    for (const p of places) {
      const [lng, lat] = p.location.coordinates;
      console.log(`  ${p.name}`);
      console.log(`    type          ${p.type}`);
      console.log(`    address       ${p.address}`);
      console.log(`    lat / lng     ${lat} / ${lng}`);
      console.log(`    phone         ${p.phone ?? '(無)'}`);
      console.log(`    googlePlaceId ${p.googlePlaceId ?? '(無，請改用 name + 座標比對)'}`);
      console.log(`    已是合作夥伴  ${p.isPartner ? '是' : '否'}`);
      console.log('');
    }
  }

  await mongoose.disconnect();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
