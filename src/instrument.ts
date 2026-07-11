import 'dotenv/config';
import * as Sentry from '@sentry/node';

// 這支檔案要在其他所有 import 之前被載入，才能捕捉到啟動階段的錯誤
if (process.env.SENTRY_DSN) {
  Sentry.init({
    dsn: process.env.SENTRY_DSN,
    environment: process.env.NODE_ENV ?? 'production',
  });
}
