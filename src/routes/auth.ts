import { Router } from 'express';
import { register, login, getMe, logout, forgotPassword, resetPassword, changePassword, updateProfile, updatePushToken, updateSettings } from '../controllers/authController';
import { requireAuth } from '../middleware/auth';
import upload from '../middleware/upload';

const router = Router();

router.post('/register', register);
router.post('/login', login);
router.post('/logout', requireAuth, logout);
router.post('/forgot-password', forgotPassword);
router.post('/reset-password', resetPassword);
router.get('/me', requireAuth, getMe);
router.patch('/password', requireAuth, changePassword);
router.patch('/profile', requireAuth, upload.single('avatar'), updateProfile);
router.patch('/push-token', requireAuth, updatePushToken);
router.patch('/settings', requireAuth, updateSettings);

export default router;
