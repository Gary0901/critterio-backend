#!/usr/bin/env node
// 把 MongoDB 資料庫用 mongodump 備份、壓縮，上傳到 Cloudinary（raw resource），並清掉超過保留天數的舊備份。
// 需要系統已安裝 mongodump（brew install mongodb-database-tools）。
// 本機手動跑：cd backend && node scripts/backupDatabase.js（會讀 .env）
// CI（GitHub Actions）跑：環境變數直接由 workflow 的 env 區塊帶入，不需要 .env 檔案

require('dotenv').config();
const { execSync } = require('child_process');
const cloudinary = require('cloudinary').v2;
const fs = require('fs');
const os = require('os');
const path = require('path');

const RETENTION_DAYS = 14;
const BACKUP_FOLDER = 'critterio/db-backups';

cloudinary.config({
  cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
  api_key: process.env.CLOUDINARY_API_KEY,
  api_secret: process.env.CLOUDINARY_API_SECRET,
});

async function main() {
  if (!process.env.MONGODB_URI) throw new Error('缺少 MONGODB_URI');

  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
  const fileName = `critterio-backup-${timestamp}.gz`;
  const filePath = path.join(os.tmpdir(), fileName);

  console.log(`[backup] 開始 mongodump → ${filePath}`);
  execSync(`mongodump --uri="${process.env.MONGODB_URI}" --gzip --archive="${filePath}"`, { stdio: 'inherit' });

  const { size } = fs.statSync(filePath);
  console.log(`[backup] mongodump 完成，檔案大小 ${(size / 1024 / 1024).toFixed(2)} MB`);

  console.log('[backup] 上傳到 Cloudinary...');
  const result = await cloudinary.uploader.upload(filePath, {
    resource_type: 'raw',
    folder: BACKUP_FOLDER,
    public_id: fileName,
    use_filename: true,
    unique_filename: false,
  });
  console.log(`[backup] 上傳完成：${result.secure_url}`);

  fs.unlinkSync(filePath);

  console.log(`[backup] 清理超過 ${RETENTION_DAYS} 天的舊備份...`);
  const cutoff = Date.now() - RETENTION_DAYS * 24 * 60 * 60 * 1000;
  const { resources } = await cloudinary.api.resources({
    type: 'upload',
    resource_type: 'raw',
    prefix: `${BACKUP_FOLDER}/`,
    max_results: 500,
  });

  const stale = resources.filter((r) => new Date(r.created_at).getTime() < cutoff);
  for (const r of stale) {
    await cloudinary.uploader.destroy(r.public_id, { resource_type: 'raw' });
    console.log(`[backup] 刪除舊備份：${r.public_id}`);
  }

  console.log(`[backup] 完成，目前保留 ${resources.length - stale.length} 份備份`);
}

main().catch((err) => {
  console.error('[backup] 失敗：', err);
  process.exit(1);
});
