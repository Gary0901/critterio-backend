import './instrument';
import * as Sentry from '@sentry/node';
import express from 'express';
import cors from 'cors';
import path from 'path';
import { connectDB } from './config/db';

import authRoutes from './routes/auth';
import petRoutes from './routes/pets';
import postRoutes from './routes/posts';
import aiRoutes from './routes/ai';
import mapRoutes from './routes/map';
import calendarRoutes from './routes/calendar';
import notificationsRoutes from './routes/notifications';
import usersRoutes from './routes/users';
import adminRoutes from './routes/admin';
import legalRoutes from './routes/legal';
import webRoutes from './routes/web';
import landingRoutes from './routes/landing';
import { startNotificationJobs } from './jobs/notificationJobs';

const app = express();

app.use(cors({ exposedHeaders: ['RateLimit-Limit', 'RateLimit-Remaining', 'RateLimit-Reset'] }));
app.use(express.json({ limit: '10mb' }));

// landing.ts 用的 App 截圖，dist/ 跟 src/ 對 backend 根目錄的相對深度一樣，
// 這條路徑在 dev（ts-node 跑 src/）跟 production（跑 dist/）都會指到同一個 public/
app.use(express.static(path.join(__dirname, '../public')));

app.use('/', legalRoutes);
app.use('/', webRoutes);
app.use('/', landingRoutes);

app.use('/api/v1/auth', authRoutes);
app.use('/api/v1/pets', petRoutes);
app.use('/api/v1/posts', postRoutes);
app.use('/api/v1/ai', aiRoutes);
app.use('/api/v1/map', mapRoutes);
app.use('/api/v1/calendar', calendarRoutes);
app.use('/api/v1/notifications', notificationsRoutes);
app.use('/api/v1/users', usersRoutes);
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
