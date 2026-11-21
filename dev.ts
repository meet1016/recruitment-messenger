import { createServer as createViteServer } from 'vite';
import { startServer } from './app';

// Development entry point. Vite lives here, not in server.ts, so production
// server bundles never include Vite or its native bundler dependencies.
const vite = await createViteServer({
  server: {
    middlewareMode: true,
    hmr: false,
  },
  appType: 'spa',
});

startServer({ devMiddleware: vite.middlewares }).catch((err) => {
  console.error('Failed to start server:', err);
  process.exit(1);
});
