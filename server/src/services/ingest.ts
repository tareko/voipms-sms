import { insertMessage, getContactName, markThreadRead, messageExists } from '../store/db.js';
import { broadcast } from '../realtime/sse.js';
import { notifyNewMessage } from '../notify/native.js';
import { normalizeTel } from '../contacts/match.js';
import { downloadAndCacheMedia } from './media.js';
import type { NormalizedSms } from '../voipms/client.js';
import type { MediaRef, Message } from '../types.js';

function toMessage(sms: NormalizedSms, media?: MediaRef[]): Message {
  const contact = normalizeTel(sms.contact) ?? sms.contactRaw;
  const did = normalizeTel(sms.did) ?? sms.did;
  return {
    id: sms.id,
    date: sms.date,
    ts: sms.ts,
    type: sms.type,
    did,
    contact,
    contactRaw: sms.contactRaw,
    message: sms.message,
    carrierStatus: sms.carrierStatus,
    read: 0,
    media,
  };
}

/**
 * Ingest a voip.ms message. For MMS, downloads + caches media (unless already
 * stored, or unless prebuilt media is supplied — e.g. a sent MMS). Inserts,
 * broadcasts via SSE, and fires a native notification (if received & new).
 */
export async function ingest(
  sms: NormalizedSms,
  source: 'poll' | 'webhook' | 'send',
  prebuiltMedia?: MediaRef[]
): Promise<boolean> {
  let media = prebuiltMedia;
  if (!media && sms.mediaUrls && sms.mediaUrls.length && !messageExists(sms.id)) {
    const refs = await Promise.all(sms.mediaUrls.map((u) => downloadAndCacheMedia(u)));
    media = refs.filter((r): r is MediaRef => r !== null);
    if (!media.length) media = undefined;
  }
  const msg = toMessage(sms, media);
  const inserted = insertMessage(msg, source);
  if (inserted) {
    broadcast({ type: 'message', data: { ...msg } });
    if (msg.type === 1) {
      const name = getContactName(msg.contact) ?? msg.contactRaw;
      notifyNewMessage({ name, text: msg.message || (msg.media?.length ? '📷 Photo' : '') });
    }
  }
  return inserted;
}

export { markThreadRead };
