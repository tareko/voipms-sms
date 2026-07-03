import { createHash } from 'node:crypto';
import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve, basename, extname } from 'node:path';
import { config, projectRoot } from '../config.js';
import type { MediaRef } from '../types.js';

const mediaDir = resolve(projectRoot, 'data', 'media');
mkdirSync(mediaDir, { recursive: true });

const EXT_BY_TYPE: Record<string, string> = {
  'image/jpeg': 'jpg',
  'image/jpg': 'jpg',
  'image/png': 'png',
  'image/gif': 'gif',
  'image/webp': 'webp',
  'image/bmp': 'bmp',
  'image/tiff': 'tiff',
};

function extFor(contentType: string): string {
  return EXT_BY_TYPE[contentType.toLowerCase()] ?? 'bin';
}

function contentTypeForFile(file: string): string {
  const ext = extname(file).slice(1).toLowerCase();
  for (const [ct, e] of Object.entries(EXT_BY_TYPE)) {
    if (e === ext) return ct;
  }
  return 'application/octet-stream';
}

export function getMediaPath(file: string): string {
  return resolve(mediaDir, basename(file));
}

export function mediaContentType(file: string): string {
  return contentTypeForFile(basename(file));
}

/** Save an uploaded image buffer (sent MMS) and return its local serving ref. */
export function saveUploadedMedia(buf: Buffer, contentType: string): MediaRef {
  const ct = contentType || 'image/jpeg';
  const hash = createHash('sha1').update(buf).digest('hex').slice(0, 20);
  const file = `${hash}.${extFor(ct)}`;
  writeFileSync(resolve(mediaDir, file), buf);
  return { url: `/api/media/${file}`, contentType: ct };
}

function authHeader(): string {
  return 'Basic ' + Buffer.from(`${config.voipms.username}:${config.voipms.password}`).toString('base64');
}

/**
 * Download a voip.ms media.php URL and cache it locally. Tries anonymous first,
 * then retries with API Basic auth if the server rejects (401/403).
 */
export async function downloadAndCacheMedia(url: string): Promise<MediaRef | null> {
  const fileBase = createHash('sha1').update(url).digest('hex').slice(0, 20);
  for (const headers of [{}, { Authorization: authHeader() }] as Array<Record<string, string>>) {
    try {
      const res = await fetch(url, { headers });
      if (res.status === 401 || res.status === 403) continue; // try with auth next round
      if (!res.ok) {
        console.error(`[media] download ${res.status} for ${url}`);
        return null;
      }
      const buf = Buffer.from(await res.arrayBuffer());
      const contentType = (res.headers.get('content-type')?.split(';')[0] || 'image/jpeg').trim();
      const file = `${fileBase}.${extFor(contentType)}`;
      writeFileSync(resolve(mediaDir, file), buf);
      return { url: `/api/media/${file}`, contentType };
    } catch (e) {
      console.error('[media] download failed for', url, (e as Error).message);
      // try auth round if available, else give up
    }
  }
  return null;
}
