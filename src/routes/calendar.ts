import { Router } from 'express';
import { requireAuth } from '../middleware/auth';
import { createEvent, getEvents, getEvent, updateEvent, toggleDone, deleteEvent } from '../controllers/calendarController';

const router = Router();
router.use(requireAuth);

router.post('/events', createEvent);
router.get('/events', getEvents);
router.get('/events/:eventId', getEvent);
router.patch('/events/:eventId', updateEvent);
router.patch('/events/:eventId/done', toggleDone);
router.delete('/events/:eventId', deleteEvent);

export default router;
