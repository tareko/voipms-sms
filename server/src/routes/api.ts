import { Router } from 'express';
import multer from 'multer';
import { existsSync } from 'node:fs';
import { basename } from 'node:path';
import { config } from '../config.js';
import { getConversations, getThread, getMessage, getReactionsForMessage, addReaction, dedupMessages, dedupReactionEvents, registerPushEndpoint, unregisterPushEndpoint, markThreadRead, searchContacts } from '../store/db.js';
import { sendSMS, sendMMS, setSmsCallback } from '../voipms/client.js';
import { runPollOnce, backfillHistoryChunk, getPollerStatus, getActiveDids } from '../voipms/poller.js';
import { syncContacts, getCarddavStatus } from '../contacts/carddav.js';
import { broadcast } from '../realtime/sse.js';
import { ingest } from '../services/ingest.js';
import { saveUploadedMedia, getMediaPath, mediaContentType } from '../services/media.js';
import { buildReactionText } from '../reactions.js';
import { backfillReactions } from '../services/backfill.js';
import { parseVoipDate } from '../voipms/client.js';
import { getDb } from '../store/db.js';
import type { NormalizedSms } from '../voipms/client.js';
import { normalizeTel } from '../contacts/match.js';

export const api = Router();

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 8 * 1024 * 1024 }, // headroom; client resizes before upload
});

// Optional bearer-token auth. If APP_API_TOKEN is unset (default), the backend
// is open and relies on the VPN for access control.
api.use((req, res, next) => {
  if (!config.auth.token) return next();
  const got = req.headers.authorization || '';
  if (got === `Bearer ${config.auth.token}`) return next();
  return res.status(401).json({ error: 'unauthorized' });
});

function nowVoipDate(): string {
  // Format current time in the voip.ms account tz, to match voip.ms's date
  // convention (so the `date` column is consistent for sent and received).
  const p = new Intl.DateTimeFormat('en-CA', {
    timeZone: config.voipms.timezone,
    hour12: false,
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit',
  }).formatToParts(new Date());
  const m: Record<string, string> = {};
  for (const x of p) m[x.type] = x.value;
  return `${m.year}-${m.month}-${m.day} ${m.hour}:${m.minute}:${m.second}`;
}

/** voip.ms sendSMS expects 10-digit NANP numbers (no leading country code). */
function toVoipNumber(tel: string): string {
  const digits = tel.replace(/\D/g, '');
  if (digits.length === 11 && digits.startsWith('1')) return digits.slice(1);
  if (digits.length === 10) return digits;
  return digits || tel;
}

api.get('/status', (_req, res) => {
  res.json({
    poller: getPollerStatus(),
    carddav: getCarddavStatus(),
    webhook: { configured: Boolean(config.webhook.key), publicUrl: config.webhook.publicUrl },
    dids: getActiveDids(),
  });
});

api.get('/dids', (_req, res) => {
  res.json(getActiveDids());
});

api.get('/conversations', (req, res) => {
  const did = String(req.query.did || '');
  if (!did) return res.status(400).json({ error: 'did required' });
  res.json(getConversations(normalizeTel(did) ?? did));
});

api.get('/messages', (req, res) => {
  const did = normalizeTel(String(req.query.did || '')) ?? String(req.query.did || '');
  const contact = normalizeTel(String(req.query.contact || '')) ?? String(req.query.contact || '');
  if (!did || !contact) return res.status(400).json({ error: 'did and contact required' });
  const limit = Number(req.query.limit || 500);
  res.json(getThread(did, contact, limit));
});

api.post('/send', async (req, res) => {
  try {
    const { did, contact, message } = req.body as {
      did: string;
      contact: string;
      message: string;
    };
    if (!did || !contact || !message) return res.status(400).json({ error: 'did, contact, message required' });

    const didNorm = normalizeTel(did) ?? did;
    const contactNorm = normalizeTel(contact) ?? contact;
    const tooLong = message.length > 160;

    const id = tooLong
      ? await sendMMS(toVoipNumber(didNorm), toVoipNumber(contactNorm), message, [])
      : await sendSMS(toVoipNumber(didNorm), toVoipNumber(contactNorm), message);

    const sms: NormalizedSms = {
      id: id || `local-${Date.now()}`,
      date: nowVoipDate(),
      ts: Date.now(),
      type: 0,
      did: didNorm,
      contact: contactNorm,
      contactRaw: contact,
      message,
      carrierStatus: '',
    };
    await ingest(sms, 'send');
    res.json({ ok: true, id: sms.id });
  } catch (err) {
    console.error('[api] send failed:', (err as Error).message);
    res.status(500).json({ error: (err as Error).message });
  }
});

/** Send an MMS with an image attachment (multipart upload). */
api.post('/send-media', upload.single('media'), async (req, res) => {
  try {
    const did = String(req.body?.did || '');
    const contact = String(req.body?.contact || '');
    const message = String(req.body?.message || '');
    const file = req.file;
    if (!did || !contact || !file) {
      return res.status(400).json({ error: 'did, contact, and media file required' });
    }
    if (!file.mimetype.startsWith('image/')) {
      return res.status(400).json({ error: 'only image attachments are supported' });
    }

    const didNorm = normalizeTel(did) ?? did;
    const contactNorm = normalizeTel(contact) ?? contact;
    const contentType = file.mimetype;
    const data = file.buffer.toString('base64');

    const id = await sendMMS(
      toVoipNumber(didNorm),
      toVoipNumber(contactNorm),
      message,
      [{ data, contentType }]
    );

    // Cache the sent image locally so it shows in the thread immediately.
    const mediaRef = saveUploadedMedia(file.buffer, contentType);
    const sms: NormalizedSms = {
      id: id || `local-mms-${Date.now()}`,
      date: nowVoipDate(),
      ts: Date.now(),
      type: 0,
      did: didNorm,
      contact: contactNorm,
      contactRaw: contact,
      message,
      carrierStatus: '',
    };
    await ingest(sms, 'send', [mediaRef]);
    res.json({ ok: true, id: sms.id });
  } catch (err) {
    console.error('[api] send-media failed:', (err as Error).message);
    res.status(500).json({ error: (err as Error).message });
  }
});

/** Serve a cached media attachment. */
api.get('/media/:file', (req, res) => {
  const file = basename(String(req.params.file));
  const path = getMediaPath(file);
  if (!existsSync(path)) return res.status(404).send('not found');
  res.setHeader('Content-Type', mediaContentType(file));
  res.setHeader('Cache-Control', 'private, max-age=31536000, immutable');
  res.sendFile(path);
});

/** React to a message (sends the iMessage-style fallback text). */
api.post('/react', async (req, res) => {
  try {
    const { did, contact, messageId, emoji } = req.body as {
      did: string;
      contact: string;
      messageId: string;
      emoji: string;
    };
    if (!did || !contact || !messageId || !emoji) {
      return res.status(400).json({ error: 'did, contact, messageId, emoji required' });
    }
    const target = getMessage(messageId);
    if (!target) return res.status(404).json({ error: 'message not found' });

    let targetText = (target.message || '').trim();
    if (!targetText && target.media?.length) targetText = 'an image';
    const body = buildReactionText(emoji, targetText);
    if (!body) return res.status(400).json({ error: 'unsupported emoji' });

    const didNorm = normalizeTel(did) ?? did;
    const contactNorm = normalizeTel(contact) ?? contact;
    const id = await sendSMS(toVoipNumber(didNorm), toVoipNumber(contactNorm), body);

    addReaction({
      id: id || `react-${Date.now()}`,
      targetId: messageId,
      did: didNorm,
      contact: contactNorm,
      emoji,
      fromTel: 'me',
      ts: Date.now(),
    });

    const updated = getMessage(messageId);
    if (updated) {
      updated.reactions = getReactionsForMessage(messageId);
      broadcast({ type: 'message-updated', data: updated });
    }
    res.json({ ok: true, id });
  } catch (err) {
    console.error('[api] react failed:', (err as Error).message);
    res.status(500).json({ error: (err as Error).message });
  }
});

api.post('/markread', (req, res) => {
  const { did, contact } = req.body as { did: string; contact: string };
  if (!did || !contact) return res.status(400).json({ error: 'did and contact required' });
  markThreadRead(normalizeTel(did) ?? did, normalizeTel(contact) ?? contact);
  broadcast({ type: 'status', data: { poller: getPollerStatus(), carddav: getCarddavStatus() } });
  res.json({ ok: true });
});

api.get('/contacts', (req, res) => {
  const q = String(req.query.q || '');
  res.json(searchContacts(q, 50));
});

api.post('/contacts/refresh', async (_req, res) => {
  const count = await syncContacts();
  broadcast({ type: 'contacts-refreshed', data: { count } });
  res.json({ ok: true, count });
});

api.post('/poll', async (_req, res) => {
  const n = await runPollOnce();
  res.json({ ok: true, newMessages: n });
});

/** Fetch one older 90-day chunk of history from voip.ms (the "Load older" button). */
api.post('/backfill-history', async (_req, res) => {
  try {
    const result = await backfillHistoryChunk();
    broadcast({ type: 'contacts-refreshed', data: { count: 0 } });
    res.json({ ok: true, ...result });
  } catch (err) {
    res.status(500).json({ error: (err as Error).message });
  }
});

/** Convert existing iMessage-style reaction texts into reaction badges. */
api.post('/backfill-reactions', (_req, res) => {
  const result = backfillReactions();
  res.json({ ok: true, ...result });
});

/** Remove duplicate bubbles created by voip.ms group-MMS leg expansion. */
api.post('/dedup', (_req, res) => {
  const messages = dedupMessages();
  const reactions = dedupReactionEvents();
  res.json({ ok: true, removedMessages: messages, removedReactions: reactions });
});

/**
 * Recompute message timestamps from the stored voip.ms `date` string using the
 * configured account timezone. Existing rows were parsed as server-local (UTC),
 * which skewed non-UTC accounts. App-sent rows (source='send') already have a
 * correct Date.now() ts and are left untouched.
 */
api.post('/fix-timestamps', (_req, res) => {
  const db = getDb();
  const rows = db
    .prepare("SELECT id, date FROM messages WHERE source <> 'send'")
    .all() as { id: string; date: string }[];
  const upd = db.prepare('UPDATE messages SET ts = ? WHERE id = ?');
  let n = 0;
  const tx = db.transaction(() => {
    for (const r of rows) {
      upd.run(parseVoipDate(r.date), r.id);
      n++;
    }
  });
  tx();
  res.json({ ok: true, updatedMessages: n, timezone: config.voipms.timezone });
});

/** Register a UnifiedPush/ntfy endpoint for push (the Android app). */
api.post('/push/register', (req, res) => {
  const { endpoint } = req.body as { endpoint?: string };
  if (!endpoint) return res.status(400).json({ error: 'endpoint required' });
  registerPushEndpoint(endpoint);
  res.json({ ok: true });
});

api.post('/push/unregister', (req, res) => {
  const { endpoint } = req.body as { endpoint?: string };
  if (endpoint) unregisterPushEndpoint(endpoint);
  res.json({ ok: true });
});

/** Apply the voip.ms SMS URL callback to a DID (Milestone 2 helper). */
api.post('/webhook/apply', async (req, res) => {
  try {
    const { did } = req.body as { did: string };
    if (!did) return res.status(400).json({ error: 'did required' });
    if (!config.webhook.key || !config.webhook.publicUrl) {
      return res.status(400).json({ error: 'WEBHOOK_KEY and PUBLIC_WEBHOOK_URL must be set' });
    }
    const url = `${config.webhook.publicUrl}/api/webhook/inbound?to={TO}&from={FROM}&message={MESSAGE}&id={ID}&date={TIMESTAMP}&media={MEDIA}&key=${config.webhook.key}`;
    await setSmsCallback(did, url, true);
    res.json({ ok: true, url });
  } catch (err) {
    res.status(500).json({ error: (err as Error).message });
  }
});

/**
 * voip.ms inbound SMS callback. Accepts GET (per spec). voip.ms may delimit params
 * with ';' or '&', so we parse both. Must respond with the literal text "ok".
 */
api.all('/webhook/inbound', (rawReq, res) => {
  const req = rawReq;
  try {
    if (!config.webhook.key) return res.status(503).send('webhook disabled');
    const params: Record<string, string> = {};
    const qIndex = req.url.indexOf('?');
    const qs = qIndex >= 0 ? req.url.slice(qIndex + 1) : '';
    for (const pair of qs.split(/[&;]/)) {
      if (!pair) continue;
      const [k, ...rest] = pair.split('=');
      params[decodeURIComponent(k)] = decodeURIComponent(rest.join('='));
    }

    if (!params.key || params.key !== config.webhook.key) {
      return res.status(401).send('unauthorized');
    }

    const from = params.from || params.FROM || '';
    const to = params.to || params.TO || '';
    const id = params.id || params.ID || `hw-${Date.now()}`;
    const date = params.date || params.TIMESTAMP || nowVoipDate();
    const text = params.message || params.MESSAGE || '';
    if (!from || !to) return res.send('ok'); // nothing to do, still ack

    const sms: NormalizedSms = {
      id: String(id),
      date,
      ts: new Date(date.replace(' ', 'T')).getTime() || Date.now(),
      type: 1,
      did: to,
      contact: from,
      contactRaw: from,
      message: text.replace(/\+/g, ' '),
      carrierStatus: '',
    };
    ingest(sms, 'webhook');
    res.send('ok');
  } catch (err) {
    console.error('[webhook] error:', (err as Error).message);
    res.send('ok'); // always ack so voip.ms doesn't retry-loop
  }
});
