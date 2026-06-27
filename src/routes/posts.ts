import { Router } from 'express';
import { requireAuth } from '../middleware/auth';
import upload from '../middleware/upload';
import { createPost, getPosts, getPost, deletePost, toggleLike, addComment, deleteComment, reportPost } from '../controllers/postsController';

const router = Router();
router.use(requireAuth);

router.post('/', upload.array('images', 5), createPost);
router.get('/', getPosts);
router.get('/:id', getPost);
router.delete('/:id', deletePost);
router.post('/:id/like', toggleLike);
router.post('/:id/comments', addComment);
router.delete('/:id/comments/:commentId', deleteComment);
router.post('/:id/report', reportPost);

export default router;
