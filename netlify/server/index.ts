/**
 * Netlify Server entry point.
 *
 * Netlify Server instances have a writable /tmp disk that is erased whenever an
 * instance stops (idle timeout, deploy, or its 8 hour lifetime). This entry
 * restores the SQLite database and private uploads from Netlify Blobs on boot
 * and writes them back periodically and on shutdown, so data survives restarts.
 *
 * Static assets are published from dist/ by Netlify's CDN. Everything else,
 * including /api/* and the /ws WebSocket upgrade, is handled by server.ts.
 */

import fs from 'node:fs';
import path from 'node:path';
import { getStore, type Store } from '@netlify/blobs';
import { onShutdown } from '@netlify/server';

// These must be set before the server modules are imported: database.ts and
// storageAdapter.ts resolve their paths at module load time.
process.env.NODE_ENV = 'production';
process.env.DATABASE_PATH ||= '/tmp/recruitment_messenger.db';
process.env.PRIVATE_STORAGE_DIR ||= '/tmp/private_storage';

// Signed download URLs must keep working across instance restarts, so the
// fallback secret needs to be stable. Set SESSION_SECRET in Netlify for real use.
if (!process.env.SESSION_SECRET || process.env.SESSION_SECRET.trim().length < 16) {
  process.env.SESSION_SECRET = `recruitment-messenger-${process.env.NETLIFY_SITE_ID || 'netlify-local'}-signing-secret`;
}

const DB_PATH = path.resolve(process.env.DATABASE_PATH);
const STORAGE_DIR = path.resolve(process.env.PRIVATE_STORAGE_DIR);
const DB_KEY = 'recruitment_messenger.db';
const FLUSH_INTERVAL_MS = 10_000;

let dbStore: Store | null = null;
let filesStore: Store | null = null;
let blobsUnavailable = false;

function stores(): { db: Store; files: Store } | null {
  if (blobsUnavailable) return null;
  try {
    // Netlify injects NETLIFY_BLOBS_CONTEXT automatically. If a Server instance
    // does not have it, explicit credentials can be supplied instead.
    const siteID = process.env.NETLIFY_SITE_ID;
    const token = process.env.NETLIFY_BLOBS_TOKEN || process.env.NETLIFY_TOKEN;
    const explicit = siteID && token ? { siteID, token } : {};

    dbStore ||= getStore('recruitment-db', { consistency: 'strong', ...explicit });
    filesStore ||= getStore('recruitment-uploads', { consistency: 'strong', ...explicit });
    return { db: dbStore, files: filesStore };
  } catch (err) {
    // Blobs are configured automatically in Netlify functions. Outside Netlify
    // (for example a plain local run), just use the writable /tmp disk.
    blobsUnavailable = true;
    console.warn('[netlify] Blobs unavailable; running without remote persistence.', err);
    return null;
  }
}

function toArrayBuffer(data: Buffer): ArrayBuffer {
  return data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength) as ArrayBuffer;
}

async function restoreFromBlobs(): Promise<void> {
  const active = stores();
  if (!active) return;

  try {
    const savedDb = await active.db.get(DB_KEY, { type: 'arrayBuffer' });
    if (savedDb) {
      fs.mkdirSync(path.dirname(DB_PATH), { recursive: true });
      fs.writeFileSync(DB_PATH, Buffer.from(savedDb));
      console.log('[netlify] Restored database from Blobs.');
    }

    const { blobs } = await active.files.list();
    for (const { key } of blobs) {
      const savedFile = await active.files.get(key, { type: 'arrayBuffer' });
      if (!savedFile) continue;
      fs.mkdirSync(STORAGE_DIR, { recursive: true });
      fs.writeFileSync(path.join(STORAGE_DIR, path.basename(key)), Buffer.from(savedFile));
    }
    if (blobs.length > 0) {
      console.log(`[netlify] Restored ${blobs.length} private file(s) from Blobs.`);
    }
  } catch (err) {
    console.warn('[netlify] Failed to restore data from Blobs.', err);
  }
}

const uploadedFileVersions = new Map<string, string>();
let flushing = false;
let getDbPromise: Promise<typeof import('../../src/server/db/database').getDb> | null = null;

async function flushToBlobs(): Promise<void> {
  if (flushing) return;
  const active = stores();
  if (!active) return;

  flushing = true;
  try {
    getDbPromise ||= import('../../src/server/db/database').then((m) => m.getDb);
    const getDb = await getDbPromise;

    // Move everything from the WAL into the main database file before copying.
    getDb().pragma('wal_checkpoint(TRUNCATE)');
    if (fs.existsSync(DB_PATH)) {
      await active.db.set(DB_KEY, toArrayBuffer(fs.readFileSync(DB_PATH)));
    }

    if (fs.existsSync(STORAGE_DIR)) {
      for (const name of fs.readdirSync(STORAGE_DIR)) {
        const filePath = path.join(STORAGE_DIR, name);
        const stat = fs.statSync(filePath);
        if (!stat.isFile()) continue;

        const version = `${stat.size}:${stat.mtimeMs}`;
        if (uploadedFileVersions.get(name) === version) continue;

        await active.files.set(name, toArrayBuffer(fs.readFileSync(filePath)));
        uploadedFileVersions.set(name, version);
      }
    }
  } catch (err) {
    console.warn('[netlify] Failed to persist data to Blobs.', err);
  } finally {
    flushing = false;
  }
}

await restoreFromBlobs();

// Importing server.ts creates the Express app, attaches the WebSocket server,
// serves dist/, and starts listening on process.env.PORT.
await import('../../server');

const flushTimer = setInterval(() => {
  void flushToBlobs();
}, FLUSH_INTERVAL_MS);

onShutdown(async () => {
  clearInterval(flushTimer);
  try {
    const { realtimeHub } = await import('../../src/server/ws/realtime');
    realtimeHub.closeAll();
  } catch {
    // Ignore if the realtime module was never loaded.
  }
  await flushToBlobs();
});

// better-sqlite3 ships native .node binaries; include them in the server bundle.
export const config = {
  includedFiles: [
    '../../node_modules/better-sqlite3/build/Release/*.node',
    '../../node_modules/better-sqlite3/prebuilds/**/*',
  ],
};
