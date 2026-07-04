import { Response } from 'express';
import { AuthRequest } from '../middleware/auth';
import Post from '../models/Post';
import Comment from '../models/Comment';
import PostLike from '../models/PostLike';
import PostReport from '../models/PostReport';
import User from '../models/User';
import { uploadImage } from '../utils/cloudinary';
import { sendNotification } from '../utils/push';

const REPORT_HIDE_THRESHOLD = 5;

async function populateUser(userId: any) {
  const user = await User.findById(userId).lean();
  if (!user) return { id: userId, name: '未知用戶', avatarUrl: null };
  return { id: user._id, name: (user as any).profile.name, avatarUrl: (user as any).profile.avatarUrl ?? null };
}

// ─── Posts ────────────────────────────────────────────────────────────────────

export async function createPost(req: AuthRequest, res: Response): Promise<void> {
  const { content, petId, hashtags: hashtagsRaw, withPets: withPetsRaw } = req.body;
  if (!content) {
    res.status(400).json({ success: false, data: null, message: 'content 為必填' });
    return;
  }

  let hashtags: string[] = [];
  let withPets: string[] = [];
  try { hashtags = hashtagsRaw ? JSON.parse(hashtagsRaw) : []; } catch {}
  try { withPets = withPetsRaw ? JSON.parse(withPetsRaw) : []; } catch {}

  const files = (req.files ?? []) as Express.Multer.File[];
  const imageUrls = (
    await Promise.all(
      files.map(async (file) => {
        try { return await uploadImage(file.buffer, 'posts'); } catch { return null; }
      })
    )
  ).filter((url): url is string => url !== null);

  const postUser = await User.findById(req.userId).lean();
  const defaultVisibility = (postUser as any)?.settings?.defaultPostVisibility ?? 'public';

  const post = await Post.create({
    userId: req.userId,
    petId: petId || undefined,
    content,
    hashtags,
    withPets,
    images: imageUrls,
    visibility: defaultVisibility,
    status: 'active',
    metrics: { likesCount: 0, commentsCount: 0 },
  });
  const user = await populateUser(req.userId);
  res.status(201).json({
    success: true,
    data: { id: post._id, content: post.content, images: post.images, hashtags: post.hashtags, withPets: post.withPets, createdAt: post.createdAt, user },
    message: '發布成功',
  });
}

export async function getPosts(req: AuthRequest, res: Response): Promise<void> {
  const page   = parseInt(String(req.query.page  ?? '1'));
  const limit  = parseInt(String(req.query.limit ?? '10'));
  const skip   = (page - 1) * limit;
  const sort   = req.query.sort === 'hot' ? 'hot' : 'new';

  const filter: Record<string, any> = { status: 'active' };
  if (req.query.userId === 'me') {
    filter.userId = req.userId;
  } else {
    filter.visibility = { $ne: 'private' };
  }

  let posts: any[];

  if (sort === 'hot') {
    // Hot score = (likes×2 + comments×3 + 1) / (hoursAge + 2)^1.2
    // +1 確保新文有基礎分，gravity 1.2 讓熱貼約 3 天後沉降
    const now = new Date();
    posts = await Post.aggregate([
      { $match: filter },
      {
        $addFields: {
          hotScore: {
            $divide: [
              { $add: [
                { $multiply: ['$metrics.likesCount', 2] },
                { $multiply: ['$metrics.commentsCount', 3] },
                1,
              ]},
              { $pow: [
                { $add: [
                  { $divide: [{ $subtract: [now, '$createdAt'] }, 3_600_000] },
                  2,
                ]},
                1.2,
              ]},
            ],
          },
        },
      },
      { $sort: { hotScore: -1 } },
      { $skip: skip },
      { $limit: limit },
    ]);
  } else {
    posts = await Post.find(filter)
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(limit)
      .lean();
  }

  // 批次查詢當前用戶對這批貼文的按讚狀態
  const postIds = posts.map((p) => p._id);
  const myLikes = await PostLike.find({ postId: { $in: postIds }, userId: req.userId }).lean();
  const likedSet = new Set(myLikes.map((l) => String(l.postId)));

  const data = await Promise.all(
    posts.map(async (p) => ({
      id: p._id,
      content: p.content,
      images: p.images,
      hashtags: p.hashtags ?? [],
      withPets: p.withPets ?? [],
      metrics: p.metrics,
      isLiked: likedSet.has(String(p._id)),
      createdAt: p.createdAt,
      user: await populateUser(p.userId),
    }))
  );
  res.json({ success: true, data, message: '' });
}

export async function getPost(req: AuthRequest, res: Response): Promise<void> {
  const post = await Post.findOne({ _id: req.params.id, status: 'active' }).lean();
  if (!post) {
    res.status(404).json({ success: false, data: null, message: '找不到貼文' });
    return;
  }
  const [myLike, comments] = await Promise.all([
    PostLike.findOne({ postId: post._id, userId: req.userId }),
    Comment.find({ postId: post._id }).sort({ createdAt: 1 }).lean(),
  ]);
  const commentsWithUser = await Promise.all(
    comments.map(async (c) => ({ id: c._id, content: c.content, createdAt: c.createdAt, user: await populateUser(c.userId) }))
  );
  res.json({
    success: true,
    data: {
      id: post._id, content: post.content, images: post.images,
      hashtags: (post as any).hashtags ?? [], withPets: (post as any).withPets ?? [],
      metrics: post.metrics, isLiked: !!myLike,
      user: await populateUser(post.userId),
      comments: commentsWithUser, createdAt: post.createdAt,
    },
    message: '',
  });
}

export async function deletePost(req: AuthRequest, res: Response): Promise<void> {
  const post = await Post.findOneAndDelete({ _id: req.params.id, userId: req.userId });
  if (!post) {
    res.status(404).json({ success: false, data: null, message: '找不到貼文或無權限刪除' });
    return;
  }
  res.json({ success: true, data: null, message: '貼文已刪除' });
}

// ─── Likes ────────────────────────────────────────────────────────────────────

export async function toggleLike(req: AuthRequest, res: Response): Promise<void> {
  const post = await Post.findOne({ _id: req.params.id, status: 'active' });
  if (!post) {
    res.status(404).json({ success: false, data: null, message: '找不到貼文' });
    return;
  }
  const existing = await PostLike.findOne({ postId: post._id, userId: req.userId });
  let liked: boolean;
  if (existing) {
    await PostLike.findByIdAndDelete(existing._id);
    await Post.findByIdAndUpdate(post._id, { $inc: { 'metrics.likesCount': -1 } });
    liked = false;
  } else {
    await PostLike.create({ postId: post._id, userId: req.userId });
    await Post.findByIdAndUpdate(post._id, { $inc: { 'metrics.likesCount': 1 } });
    liked = true;
  }
  const updated = await Post.findById(post._id).lean();
  res.json({ success: true, data: { liked, likesCount: (updated as any).metrics.likesCount }, message: '' });

  // 推播通知（不擋 response）
  if (liked && String(post.userId) !== req.userId) {
    const liker = await User.findById(req.userId).select('profile.name').lean();
    const name = (liker as any)?.profile?.name ?? '有人';
    sendNotification({
      recipientUserId: String(post.userId),
      type: 'like',
      title: '有人對你的貼文按讚 ❤️',
      body: `${name} 喜歡你的貼文`,
      data: { postId: String(post._id) },
      notifCategory: 'likes',
    }).catch(() => {});
  }
}

// ─── Comments ─────────────────────────────────────────────────────────────────

export async function addComment(req: AuthRequest, res: Response): Promise<void> {
  const { content } = req.body;
  if (!content) {
    res.status(400).json({ success: false, data: null, message: 'content 為必填' });
    return;
  }
  const post = await Post.findOne({ _id: req.params.id, status: 'active' });
  if (!post) {
    res.status(404).json({ success: false, data: null, message: '找不到貼文' });
    return;
  }
  const comment = await Comment.create({ postId: post._id, userId: req.userId, content });
  await Post.findByIdAndUpdate(post._id, { $inc: { 'metrics.commentsCount': 1 } });
  const user = await populateUser(req.userId);
  res.status(201).json({
    success: true,
    data: { id: comment._id, content: comment.content, createdAt: comment.createdAt, user },
    message: '留言成功',
  });

  // 推播通知（不擋 response）
  if (String(post.userId) !== req.userId) {
    const commenter = await User.findById(req.userId).select('profile.name').lean();
    const name = (commenter as any)?.profile?.name ?? '有人';
    sendNotification({
      recipientUserId: String(post.userId),
      type: 'comment',
      title: '有人留言了 💬',
      body: `${name}：${content.slice(0, 40)}`,
      data: { postId: String(post._id) },
      notifCategory: 'comments',
    }).catch(() => {});
  }
}

export async function deleteComment(req: AuthRequest, res: Response): Promise<void> {
  const comment = await Comment.findOneAndDelete({ _id: req.params.commentId, userId: req.userId });
  if (!comment) {
    res.status(404).json({ success: false, data: null, message: '找不到留言或無權限刪除' });
    return;
  }
  await Post.findByIdAndUpdate(req.params.id, { $inc: { 'metrics.commentsCount': -1 } });
  res.json({ success: true, data: null, message: '留言已刪除' });
}

// ─── Report ───────────────────────────────────────────────────────────────────

export async function reportPost(req: AuthRequest, res: Response): Promise<void> {
  const post = await Post.findOne({ _id: req.params.id, status: 'active' });
  if (!post) {
    res.status(404).json({ success: false, data: null, message: '找不到貼文' });
    return;
  }

  const reason = (['SPAM', 'INAPPROPRIATE', 'OTHER'].includes(req.body.reason) ? req.body.reason : 'OTHER') as 'SPAM' | 'INAPPROPRIATE' | 'OTHER';

  try {
    await PostReport.create({ postId: post._id, userId: req.userId, reason });
  } catch {
    // 重複檢舉：同一用戶已檢舉過，靜默忽略
    res.json({ success: true, data: null, message: '我們已收到您的檢舉，將盡快處理' });
    return;
  }

  const reportCount = await PostReport.countDocuments({ postId: post._id });
  if (reportCount >= REPORT_HIDE_THRESHOLD) {
    await Post.findByIdAndUpdate(post._id, { $set: { status: 'hidden' } });
  }

  res.json({ success: true, data: null, message: '我們已收到您的檢舉，將盡快處理' });
}
