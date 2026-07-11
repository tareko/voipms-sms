import { insertMessage, getContactName, markThreadRead, messageExists, isDuplicateMessage, isDuplicateReaction, getMessage, getReactionsForMessage, getThread, reactionExists, addReaction } from '../store/db.js';
import { broadcast } from '../realtime/sse.js';
import { notifyMessage } from '../notify/notify.js';
import { normalizeTel } from '../contacts/match.js';
import { downloadAndCacheMedia } from './media.js';
import { detectReaction, matchTarget } from '../reactions.js';
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

/** Broadcast a target message refreshed with its current reactions. */
function broadcastUpdated(targetId: string): void {
  const msg = getMessage(targetId);
  if (!msg) return;
  msg.reactions = getReactionsForMessage(targetId);
  broadcast({ type: 'message-updated', data: msg });
}

/**
 * Handle an iMessage-style reaction text. Records it (dedup by voip.ms id),
 * attaches it to the matched message if found (and suppresses the text bubble),
 * otherwise falls through so the raw text is still shown.
 * Returns true if the message was consumed as a reaction (do not store as text).
 */
function handleReaction(sms: NormalizedSms): boolean {
  const detected = detectReaction(sms.message);
  if (!detected) return false;
  if (reactionExists(sms.id)) return true; // already processed

  const did = normalizeTel(sms.did) ?? sms.did;
  const contact = normalizeTel(sms.contact) ?? sms.contactRaw;
  const fromTel = sms.type === 1 ? contact : 'me';

  // Group-MMS leg duplicate (different id, same content) — skip.
  if (isDuplicateReaction(did, contact, detected.emoji, sms.ts)) return true;

  const recent = getThread(did, contact, 200);
  const target = matchTarget(recent, detected.quoted);

  addReaction({
    id: sms.id,
    targetId: target?.id ?? null,
    did,
    contact,
    emoji: detected.emoji,
    fromTel,
    ts: sms.ts,
  });

  if (target) {
    broadcastUpdated(target.id);
    if (sms.type === 1) {
      const name = getContactName(contact) ?? sms.contactRaw;
      void notifyMessage({ name, did, contact, preview: `reacted ${detected.emoji}`, id: sms.id });
    }
    return true; // suppress the "Liked …" text bubble
  }
  return false; // no target → keep as a normal text message
}

/**
 * Ingest a voip.ms message. Reactions are detected and attached as badges.
 * For MMS, downloads + caches media (unless already stored, or prebuilt media
 * is supplied — e.g. a sent MMS). Inserts, broadcasts via SSE, and fires a
 * native notification (if received & new).
 */
export async function ingest(
  sms: NormalizedSms,
  source: 'poll' | 'webhook' | 'send',
  prebuiltMedia?: MediaRef[]
): Promise<boolean> {
  if (handleReaction(sms)) return true;

  let media = prebuiltMedia;
  if (!media && sms.mediaUrls && sms.mediaUrls.length && !messageExists(sms.id)) {
    const refs = await Promise.all(sms.mediaUrls.map((u) => downloadAndCacheMedia(u)));
    media = refs.filter((r): r is MediaRef => r !== null);
    if (!media.length) media = undefined;
  }
  const msg = toMessage(sms, media);
  // Group-MMS leg duplicate (different id, same content+timestamp) — skip.
  if (isDuplicateMessage(msg.did, msg.contact, msg.message, msg.ts)) return false;
  const inserted = insertMessage(msg, source);
  if (inserted) {
    broadcast({ type: 'message', data: { ...msg } });
    if (msg.type === 1) {
      const name = getContactName(msg.contact) ?? msg.contactRaw;
      void notifyMessage({
        name,
        did: msg.did,
        contact: msg.contact,
        preview: msg.message || (msg.media?.length ? '📷 Photo' : ''),
        id: msg.id,
      });
    }
  }
  return inserted;
}

export { markThreadRead };
