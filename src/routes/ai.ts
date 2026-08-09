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
// 同 pets.ts 的說明：限流要放在 upload.single 之後。
// 放前面的話，AI 額度用完時若使用者正在傳圖片，伺服器會在上傳途中回 429 並斷線，
// 客戶端只會看到「網路連線失敗」，看不到「AI 對話次數已達上限」
router.post('/conversations/:id/messages', upload.single('image'), aiLimiter, sendMessage);
router.patch('/conversations/:id', renameConversation);
router.delete('/conversations/:id', deleteConversation);

export default router;
