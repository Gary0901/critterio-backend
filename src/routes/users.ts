import { Router } from 'express';
import { requireAuth } from '../middleware/auth';
import { blockUser, unblockUser, getBlockedUsers } from '../controllers/usersController';

const router = Router();
router.use(requireAuth);

router.get('/blocks', getBlockedUsers);
router.post('/:id/block', blockUser);
router.delete('/:id/block', unblockUser);

export default router;
