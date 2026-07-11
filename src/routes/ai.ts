import { Router } from 'express';
import { requireAuth } from '../middleware/auth';
import upload from '../middleware/upload';
import { aiLimiter } from '../middleware/rateLimit';
import { listConversations, createConversation, getConversation, sendMessage, renameConversation, deleteConversation } from '../controllers/aiController';

const router = Router();
router.use(requireAuth);

router.get('/conversations', listConversations);
router.post('/conversations', createConversation);
router.get('/conversations/:id', getConversation);
router.post('/conversations/:id/messages', aiLimiter, upload.single('image'), sendMessage);
router.patch('/conversations/:id', renameConversation);
router.delete('/conversations/:id', deleteConversation);

export default router;
