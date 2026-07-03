import { insertMessage, getContactName, markThreadRead } from '../store/db.js';
import { broadcast } from '../realtime/sse.js';
import { notifyNewMessage } from '../notify/native.js';
import { normalizeTel } from '../contacts/match.js';
import type { NormalizedSms } from '../voipms/client.js';
import type { Message } from '../types.js';

function toMessage(sms: NormalizedSms): Message {
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
  };
}

/** Ingest a voip.ms message. Inserts, broadcasts, and notifies (if received & new). */
export function ingest(sms: NormalizedSms, source: 'poll' | 'webhook' | 'send'): boolean {
  const msg = toMessage(sms);
  const inserted = insertMessage(msg, source);
  if (inserted) {
    broadcast({ type: 'message', data: { ...msg } });
    if (msg.type === 1) {
      const name = getContactName(msg.contact) ?? msg.contactRaw;
      notifyNewMessage({ name, text: msg.message });
    }
  }
  return inserted;
}

export { markThreadRead };
