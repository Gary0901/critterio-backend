import mongoose from 'mongoose';
import UserBlock from '../models/UserBlock';

/**
 * 取得應該對 userId 隱藏內容的所有使用者 ID。
 *
 * 封鎖是雙向生效的：我封鎖的人、以及封鎖我的人，雙方都看不到對方的內容。
 * 只做單向的話，被封鎖者仍可跑到對方貼文底下留言騷擾。
 */
export async function getBlockedUserIds(
  userId: string | undefined
): Promise<mongoose.Types.ObjectId[]> {
  if (!userId) return [];

  const blocks = await UserBlock.find({
    $or: [{ blockerId: userId }, { blockedId: userId }],
  })
    .select('blockerId blockedId')
    .lean();

  const ids = new Map<string, mongoose.Types.ObjectId>();
  for (const b of blocks) {
    // 取這筆關係中「不是我」的那一方
    const other = String(b.blockerId) === userId ? b.blockedId : b.blockerId;
    ids.set(String(other), other);
  }
  return [...ids.values()];
}

/** 兩人之間是否存在任一方向的封鎖 */
export async function isBlockedBetween(a: string, b: string): Promise<boolean> {
  const found = await UserBlock.findOne({
    $or: [
      { blockerId: a, blockedId: b },
      { blockerId: b, blockedId: a },
    ],
  }).lean();
  return !!found;
}
