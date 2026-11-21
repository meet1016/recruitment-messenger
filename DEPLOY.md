# Deploying to Netlify

This project is a full-stack app: a Vite/React frontend **plus** an Express + WebSocket backend with SQLite storage. A static-only deploy would leave login, messaging, calls, uploads and realtime broken, so this setup uses **Netlify Server** for the backend and **Netlify Blobs** for free persistent storage.

> Netlify Server is in Early Access at the time of writing and must be enabled for your team. It is free during Early Access on credit-based plans, including the Free plan (300 credits/month). Netlify's managed Postgres database also has a free tier, but this app uses a synchronous SQLite API in ~55 routes, so porting it to Postgres would be a substantial rewrite. The Blobs-backed SQLite approach below keeps the app code unchanged.

## What was added

| File | Purpose |
| --- | --- |
| `netlify.toml` | Build command, `dist/` publish directory, Node 24, server settings |
| `.npmrc` | `legacy-peer-deps=true` so Netlify's `npm ci` works around the Vite/esbuild peer conflict |
| `netlify/server/index.ts` | Netlify Server entry: restores SQLite + private uploads from Blobs, starts the existing `server.ts`, flushes data every 10 s and on shutdown |
| `src/server/storage/storageAdapter.ts` | Honors `PRIVATE_STORAGE_DIR` so uploads go to writable `/tmp` |
| `src/server/ws/realtime.ts` | `closeAll()` so WebSocket clients reconnect cleanly when an instance stops |

## Deploy steps

1. **Put the project in a Git repository.** This folder is not currently a Git repo. Create one and push it to GitHub, GitLab or Bitbucket. Do not commit `.env` files (they are gitignored).
2. **Confirm Netlify Server Early Access** is enabled for your Netlify team.
3. In Netlify, choose **Add new site → Import an existing project** and connect that repository.
4. Netlify reads `netlify.toml` automatically. Verify:
   - Build command: `npm run build`
   - Publish directory: `dist`
   - Node version: `24` (Netlify Server requires Node 24+)
5. Add these environment variables with **Functions** scope (Netlify UI → Project configuration → Environment variables):
   - `SESSION_SECRET` — a random string of at least 16 characters (used to sign download URLs; a per-site fallback exists if omitted, but set your own).
   - `ADMIN_PASSCODE` — optional; overrides the seeded Team Lead password.
   - `ENABLE_SANDBOX_LOGIN` — optional; set to `false` to hide one-click persona logins.
   - If the deploy log says `[netlify] Blobs unavailable`, also add `NETLIFY_SITE_ID` (Project ID from Netlify) and `NETLIFY_BLOBS_TOKEN` (a Netlify Personal Access Token). Normally Netlify injects Blobs credentials automatically.
6. Deploy. The log should show `Recruitment Messenger listening on http://0.0.0.0:<port>`.
7. Sign in with `sarah.jenkins@benchbridge.io` / `RecruitSafe!2026` (or change it with `ADMIN_PASSCODE`), or use a sandbox persona.

## How persistence works

- Netlify Server instances have a writable `/tmp` disk that is wiped when the instance stops. On boot, the entry file downloads `recruitment_messenger.db` and private uploads from two Netlify Blobs stores (`recruitment-db` and `recruitment-uploads`) into `/tmp`.
- The SQLite database is checkpointed and uploaded every 10 seconds, and again on graceful shutdown.
- Because writes are batched, an abrupt crash can lose up to ~10 seconds of data. This is fine for a demo/internal tool, not for a system of record.
- On the Free plan a server runs at most one instance, which matters because WebSocket presence and WebRTC signaling state live in process memory. With multiple instances, users connected to different instances would not see each other's presence/call signals.

## Troubleshooting

- **`ERESOLVE` during install:** `.npmrc` already sets `legacy-peer-deps=true`; make sure Netlify uses npm rather than another package manager.
- **`[netlify] Failed to persist data to Blobs`:** check the Blobs credentials above and confirm Blobs is enabled for the site.
- **Native `better-sqlite3` bundling error:** `netlify/server/index.ts` declares `includedFiles` for the `.node` binaries. If your Netlify plan/bundler still rejects native modules, the backend needs a container/VM host (Render, Fly.io, Railway) while the `dist/` frontend stays on Netlify.
- **Netlify Server unavailable for your team:** there is no way to run this backend on classic Netlify Functions without a substantial port (async Postgres, object storage, and an external WebSocket service).
