import 'dotenv/config';
import fs from 'fs';
import path from 'path';
import { uploadImage } from '../src/utils/cloudinary';

/**
 * 把一個資料夾裡的照片上傳到 Cloudinary，印出可以直接貼進 partners.ts 的網址。
 *
 *   npm run upload:partner-photos -- "../parner_test/狗日子信義遠百店"
 *
 * 為什麼要上傳而不是直接用店家官網的圖：那些網址會失效、會被改、也不受你控制。
 * 存進自己的 Cloudinary 才能保證合作期間畫面不會開天窗。
 */

const IMAGE_EXT = new Set(['.jpg', '.jpeg', '.png', '.webp', '.heic']);

async function main() {
  const dir = process.argv[2];
  if (!dir) {
    console.error('用法：npm run upload:partner-photos -- <資料夾路徑>');
    process.exit(1);
  }

  const abs = path.resolve(process.cwd(), dir);
  if (!fs.existsSync(abs)) throw new Error(`找不到資料夾：${abs}`);

  const files = fs
    .readdirSync(abs)
    .filter((f) => IMAGE_EXT.has(path.extname(f).toLowerCase()))
    .sort(); // 檔名排序 = 輪播順序，想調順序就改檔名

  if (files.length === 0) throw new Error('資料夾裡沒有圖片檔');

  console.log(`\n找到 ${files.length} 張，開始上傳到 critterio/partners …\n`);

  const urls: string[] = [];
  for (const f of files) {
    const buf = fs.readFileSync(path.join(abs, f));
    // uploadImage 已經帶了 quality:auto / fetch_format:auto，
    // webp、heic 都會被轉成瀏覽器友善的格式，不用先手動轉檔
    const url = await uploadImage(buf, 'critterio/partners');
    urls.push(url);
    console.log(`  ✓ ${f}`);
  }

  console.log('\n貼進 partners.ts 的 photos：\n');
  console.log('    photos: [');
  for (const u of urls) console.log(`      '${u}',`);
  console.log('    ],\n');
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
