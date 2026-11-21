import http from 'node:http';
import path from 'node:path';
import express, { type RequestHandler } from 'express';
import dotenv from 'dotenv';
import { getDb } from './src/server/db/database';
import { createApiRouter } from './src/server/routes/api';
import { realtimeHub } from './src/server/ws/realtime';

dotenv.config();

export interface StartServerOptions {
  /**
   * Development-only middleware (Vite's dev server). When omitted, the built
   * client in dist/ is served instead. Keeping this as an injected handler
   * means this module — and therefore the Netlify Server bundle — never
   * imports Vite or its platform-specific native binaries.
   */
  devMiddleware?: RequestHandler;
}

export async function startServer(options: StartServerOptions = {}) {
  const PORT = Number(process.env.PORT || 3000);
  const app = express();

  app.set('trust proxy', true);
  app.use(express.json({ limit: '2mb' }));

  // Initialize SQLite database & run migrations + deterministic seed
  getDb();

  // Security headers (iframe-compatible)
  app.use((_req, res, next) => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
    next();
  });

  // Mount REST API
  app.use('/api', createApiRouter());

  // Health probe
  app.get('/healthz', (_req, res) => {
    res.json({ status: 'ok' });
  });

  if (options.devMiddleware) {
    app.use(options.devMiddleware);
  } else {
    const distDir = path.resolve(process.cwd(), 'dist');
    app.use(express.static(distDir));
    app.get('*', (_req, res) => {
      res.sendFile(path.join(distDir, 'index.html'));
    });
  }

  const server = http.createServer(app);

  // Attach authenticated WebSocket server for messaging, presence, notifications & WebRTC signaling
  realtimeHub.attach(server);

  server.listen(PORT, '0.0.0.0', () => {
    console.log(`Recruitment Messenger listening on http://0.0.0.0:${PORT}`);
  });

  return server;
}
