import './instrument';
import * as Sentry from '@sentry/node';
import express from 'express';
import cors from 'cors';
import { connectDB } from './config/db';

import authRoutes from './routes/auth';
import petRoutes from './routes/pets';
import postRoutes from './routes/posts';
import aiRoutes from './routes/ai';
import mapRoutes from './routes/map';
import calendarRoutes from './routes/calendar';
import notificationsRoutes from './routes/notifications';
import adminRoutes from './routes/admin';
import legalRoutes from './routes/legal';
import { startNotificationJobs } from './jobs/notificationJobs';

const app = express();

app.use(cors({ exposedHeaders: ['RateLimit-Limit', 'RateLimit-Remaining', 'RateLimit-Reset'] }));
app.use(express.json({ limit: '10mb' }));

app.use('/', legalRoutes);

app.use('/api/v1/auth', authRoutes);
app.use('/api/v1/pets', petRoutes);
app.use('/api/v1/posts', postRoutes);
app.use('/api/v1/ai', aiRoutes);
app.use('/api/v1/map', mapRoutes);
app.use('/api/v1/calendar', calendarRoutes);
app.use('/api/v1/notifications', notificationsRoutes);
app.use('/api/v1/admin', adminRoutes);

// 要接在所有路由之後、才能捕捉到 controller 裡沒被 catch 到的錯誤
Sentry.setupExpressErrorHandler(app);

app.get('/health', (_req, res) => {
  res.json({ success: true, data: null, message: 'Server is running' });
});

const PORT = process.env.PORT ?? 3000;

connectDB()
  .then(() => {
    app.listen(PORT, () => console.log(`Server running on port ${PORT}`));
    startNotificationJobs();
  })
  .catch((err) => {
    console.error('DB connection failed:', err);
    process.exit(1);
  });

export default app;
