import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { signDownloadToken, verifyDownloadToken } from '../domain/rules';

const STORAGE_DIR = path.resolve(
  process.env.PRIVATE_STORAGE_DIR || path.resolve(process.cwd(), 'private_storage')
);
const FALLBACK_SIGNING_SECRET = crypto.randomBytes(32).toString('hex');

export function getSigningSecret(): string {
  return process.env.SESSION_SECRET && process.env.SESSION_SECRET.trim().length >= 16
    ? process.env.SESSION_SECRET.trim()
    : FALLBACK_SIGNING_SECRET;
}

export function isR2Configured(): boolean {
  return Boolean(
    process.env.R2_ACCOUNT_ID &&
      process.env.R2_ACCESS_KEY_ID &&
      process.env.R2_SECRET_ACCESS_KEY &&
      process.env.R2_BUCKET_NAME
  );
}

export function getStorageStatus() {
  return {
    provider: isR2Configured() ? 'cloudflare_r2' : 'local_private_storage',
    bucket: process.env.R2_BUCKET_NAME || 'local-private-vault',
    signedUrlsEnabled: true,
    signedUrlTtlSeconds: 180,
  };
}

function ensureStorageDir(): void {
  if (!fs.existsSync(STORAGE_DIR)) {
    fs.mkdirSync(STORAGE_DIR, { recursive: true });
  }
}

function resolveConfinedPath(storageKey: string): string {
  ensureStorageDir();
  const safeKey = path.basename(storageKey);
  const resolved = path.resolve(STORAGE_DIR, safeKey);
  if (!resolved.startsWith(STORAGE_DIR + path.sep)) {
    throw new Error('Invalid storage path boundary');
  }
  return resolved;
}

export function storePrivateObject(storageKey: string, data: Buffer): void {
  const target = resolveConfinedPath(storageKey);
  fs.writeFileSync(target, data);
}

export function readPrivateObject(storageKey: string): Buffer | null {
  const target = resolveConfinedPath(storageKey);
  if (!fs.existsSync(target)) return null;
  return fs.readFileSync(target);
}

export function createSignedDownloadUrl(
  attachmentId: string,
  userId: string,
  ttlSeconds = 180
): { url: string; expiresAt: string } {
  const exp = Date.now() + ttlSeconds * 1000;
  const token = signDownloadToken({ attachmentId, userId, exp }, getSigningSecret());
  return {
    url: `/api/files/download/${encodeURIComponent(attachmentId)}?token=${encodeURIComponent(token)}`,
    expiresAt: new Date(exp).toISOString(),
  };
}

export function verifySignedDownloadRequest(token: string) {
  return verifyDownloadToken(token, getSigningSecret());
}
