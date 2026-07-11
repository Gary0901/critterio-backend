import { Router } from 'express';
import { register, login, googleLogin, getMe, logout, forgotPassword, resetPassword, changePassword, updateProfile, updatePushToken, updateSettings, deleteAccount } from '../controllers/authController';
import { requireAuth } from '../middleware/auth';
import upload from '../middleware/upload';
import { authLimiter, forgotPasswordLimiter } from '../middleware/rateLimit';

const router = Router();

router.post('/register', authLimiter, register);
router.post('/login', authLimiter, login);
router.post('/google', authLimiter, googleLogin);
router.post('/logout', requireAuth, logout);
router.post('/forgot-password', forgotPasswordLimiter, forgotPassword);
router.post('/reset-password', authLimiter, resetPassword);
router.get('/me', requireAuth, getMe);
router.patch('/password', requireAuth, changePassword);
router.patch('/profile', requireAuth, upload.single('avatar'), updateProfile);
router.patch('/push-token', requireAuth, updatePushToken);
router.patch('/settings', requireAuth, updateSettings);
router.delete('/account', requireAuth, deleteAccount);

export default router;
