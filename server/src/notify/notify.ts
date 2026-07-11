import { config } from '../config.js';
import { getPushEndpoints } from '../store/db.js';

export interface NotifyEvent {
  name: string;
  did: string;
  contact: string;
  preview: string;
  id: string;
}

/**
 * Fan a new-message notification out to all subscribers:
 *   - the shared ntfy topic (desktop subscribers on boldness/courage/etc.)
 *   - each registered UnifiedPush endpoint (the Android app)
 *
 * The shared topic carries Title=name + body=preview (plain text) so desktop
 * `ntfy subscribe | notify-send` works without parsing. Per-device endpoints
 * receive the same body; the Android app treats it as a wake-up and fetches.
 */
export async function notifyMessage(ev: NotifyEvent): Promise<void> {
  const body = ev.preview.slice(0, 200);
  const headers: Record<string, string> = {
    Title: ev.name,
    Tags: 'speech_balloon',
    'X-Voipms-Did': ev.did,
    'X-Voipms-Contact': ev.contact,
    'X-Voipms-Id': ev.id,
  };
  if (config.ntfy.token) headers.Authorization = `Bearer ${config.ntfy.token}`;

  const targets: string[] = [];
  if (config.ntfy.url && config.ntfy.topic) {
    targets.push(`${config.ntfy.url}/${config.ntfy.topic}`);
  }
  for (const ep of getPushEndpoints()) targets.push(ep);

  await Promise.all(
    targets.map(async (url) => {
      try {
        const res = await fetch(url, { method: 'POST', headers, body });
        if (!res.ok) console.error(`[notify] ${url} -> HTTP ${res.status}`);
      } catch (e) {
        console.error(`[notify] ${url} failed:`, (e as Error).message);
      }
    })
  );
}
