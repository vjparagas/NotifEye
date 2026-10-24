import express from 'express';
import helmet from 'helmet';
import cors from 'cors';
import { config } from './config';
import { pool } from './db';

/**
 * Builds the Express app. Kept separate from server.ts so integration tests can
 * mount it with supertest without opening a port.
 * Phase 1: health check only. Feature modules (auth, classes, ...) are mounted in later phases.
 */
export function createApp(): express.Express {
  const app = express();

  app.disable('x-powered-by');
  app.use(helmet());
  app.use(cors({ origin: config.corsOrigins, credentials: true }));
  app.use(express.json({ limit: '1mb' }));

  app.get('/health', async (_req, res) => {
    try {
      await pool.query('SELECT 1');
      res.json({ status: 'ok', db: 'up' });
    } catch {
      res.status(503).json({ status: 'degraded', db: 'down' });
    }
  });

  return app;
}
