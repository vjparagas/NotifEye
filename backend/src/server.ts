import { createApp } from './app';
import { config } from './config';
import { startScheduler } from './modules/scheduler';

const app = createApp();

// Plan §11: local dev is HTTP on localhost only, so dev/test bind to loopback and are not
// reachable from the LAN. Production binds all interfaces (it sits behind an HTTPS proxy).
const host = config.isProduction ? '0.0.0.0' : '127.0.0.1';

app.listen(config.PORT, host, () => {
  console.log(`[notifeye] API listening on http://${host}:${config.PORT} (${config.NODE_ENV})`);
  startScheduler();
});
