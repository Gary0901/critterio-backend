import { Router } from 'express';
import { requireAuth } from '../middleware/auth';
import { getNotifications, markRead, markAllRead, deleteNotification, getUnreadCount } from '../controllers/notificationsController';

const router = Router();

router.use(requireAuth);

router.get('/',              getNotifications);
router.get('/unread-count',  getUnreadCount);
router.patch('/read-all',    markAllRead);
router.patch('/:id/read',    markRead);
router.delete('/:id',        deleteNotification);

export default router;
