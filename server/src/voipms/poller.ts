import { config } from '../config.js';
import { getSMS, getMMS, getMediaMMS, getDIDsInfo, type NormalizedSms } from './client.js';
import { getCachedDids, getMaxMessageId, messageExists, reactionExists, setDids, getKv, setKv } from '../store/db.js';
import { ingest } from '../services/ingest.js';
import { backfillReactions } from '../services/backfill.js';
import { broadcast } from '../realtime/sse.js';
import type { Did } from '../types.js';

let status = 'idle';
let timer: NodeJS.Timeout | undefined;
let running = false;

export function getPollerStatus(): string {
  return status;
}

function dateNDaysAgo(days: number): string {
  const d = new Date();
  d.setDate(d.getDate() - days);
  return d.toISOString().slice(0, 10);
}

async function refreshDids(): Promise<Did[]> {
  try {
    const dids = await getDIDsInfo();
    setDids(dids);
    broadcast({ type: 'dids', data: dids });
    return dids;
  } catch (err) {
    console.error('[poller] getDIDsInfo failed:', (err as Error).message);
    return getCachedDids();
  }
}

export function getActiveDids(): Did[] {
  const cached = getCachedDids();
  if (config.voipms.dids.length > 0) {
    const wanted = new Set(config.voipms.dids);
    return cached.filter((d) => wanted.has(d.did));
  }
  return cached;
}

async function pollOnce(): Promise<number> {
  if (running) return 0;
  running = true;
  let newCount = 0;
  try {
    const dids = await refreshDids();
    // Track the highest SMS id we've SEEN (not just ingested) so suppressed
    // reactions (not stored in the messages table) still advance the cursor.
    // Without this, the same reaction is re-processed every cycle.
    const storedSince = getKv('poller_since_id');
    const sinceId = storedSince ? BigInt(storedSince) : getMaxMessageId();
    const from = dateNDaysAgo(7);
    let maxSmsId = sinceId;

    for (const { did } of dids) {
      let messages: NormalizedSms[];
      try {
        messages = await getSMS({ did, from, limit: 200 });
      } catch (err) {
        console.error(`[poller] getSMS failed for ${did}:`, (err as Error).message);
        status = `error: ${(err as Error).message}`;
        continue;
      }
      for (const sms of messages) {
        const id = BigInt(sms.id || '0');
        if (id > maxSmsId) maxSmsId = id;
        if (sinceId > 0n && id <= sinceId) continue;
        if (await ingest(sms, 'poll')) newCount++;
      }

      // MMS pass (namespaced PK mms:<id> so it can't collide with SMS ids).
      let mms: NormalizedSms[];
      try {
        mms = await getMMS({ did, from, limit: 200 });
      } catch (err) {
        console.error(`[poller] getMMS failed for ${did}:`, (err as Error).message);
        continue;
      }
      for (const m of mms) {
        const key = `mms:${m.id}`;
        // Skip if already stored as a message OR processed as a reaction.
        if (messageExists(key) || reactionExists(key)) continue;
        // getMMS omits media inline even for image MMS — fetch via getMediaMMS.
        let mediaUrls = m.mediaUrls;
        if (!mediaUrls || !mediaUrls.length) {
          try {
            mediaUrls = await getMediaMMS(m.id);
          } catch (err) {
            console.error(`[poller] getMediaMMS failed for ${m.id}:`, (err as Error).message);
          }
        }
        const namespaced = {
          ...m,
          id: key,
          mediaUrls: mediaUrls && mediaUrls.length ? mediaUrls : undefined,
        };
        if (await ingest(namespaced, 'poll')) newCount++;
      }
    }
    // Persist the highest id seen so suppressed reactions don't loop forever.
    setKv('poller_since_id', maxSmsId.toString());
    status = `ok (${new String(newCount)} new @ ${new Date().toLocaleTimeString()})`;
    // A reaction may be ingested before its target within a batch; heal.
    if (newCount > 0) backfillReactions();
  } catch (err) {
    status = `error: ${(err as Error).message}`;
    console.error('[poller] error:', (err as Error).message);
  } finally {
    running = false;
  }
  return newCount;
}

export async function startPoller(): Promise<void> {
  status = 'starting';
  await pollOnce(); // immediate catch-up on boot
  const interval = Math.max(5_000, config.voipms.pollIntervalMs);
  timer = setInterval(() => {
    void pollOnce();
  }, interval);
  console.log(`[poller] started, polling every ${interval}ms`);
}

export async function runPollOnce(): Promise<number> {
  return pollOnce();
}

const HISTORY_CHUNK_DAYS = 90; // voip.ms caps date-range queries at ~92 days

export interface BackfillResult {
  from: string;
  to: string;
  newMessages: number;
  reachedLimit: boolean; // true when a chunk yields nothing (likely past account history)
}

/**
 * Fetch one 90-day chunk of history older than the last backfill point and
 * ingest it. Idempotent (deduped by message id). Call repeatedly to page back
 * through history; each call surfaces older conversations and older messages.
 */
export async function backfillHistoryChunk(): Promise<BackfillResult> {
  const oldestStr = getKv('history_oldest');
  const oldest = oldestStr ? Number(oldestStr) : Date.now();
  const fromTs = oldest - HISTORY_CHUNK_DAYS * 86400000;
  const from = new Date(fromTs).toISOString().slice(0, 10);
  const to = new Date(oldest).toISOString().slice(0, 10);
  const dids = await refreshDids();
  let n = 0;
  for (const { did } of dids) {
    try {
      for (const sms of await getSMS({ did, from, to, limit: 9999 })) {
        if (await ingest(sms, 'poll', undefined, false)) n++;
      }
    } catch (e) {
      console.error(`[backfill] getSMS ${did}:`, (e as Error).message);
    }
    try {
      for (const m of await getMMS({ did, from, to, limit: 9999 })) {
        const key = `mms:${m.id}`;
        if (messageExists(key)) continue;
        let mediaUrls = m.mediaUrls;
        if (!mediaUrls?.length) {
          try {
            mediaUrls = await getMediaMMS(m.id);
          } catch {
            /* non-fatal */
          }
        }
        if (
          await ingest(
            { ...m, id: key, mediaUrls: mediaUrls && mediaUrls.length ? mediaUrls : undefined },
            'poll',
            undefined,
            false
          )
        ) {
          n++;
        }
      }
    } catch (e) {
      console.error(`[backfill] getMMS ${did}:`, (e as Error).message);
    }
  }
  setKv('history_oldest', String(fromTs));
  console.log(`[backfill] ${from} → ${to}: ${n} new`);
  // A reaction may be ingested before its target within/across chunks; heal now.
  backfillReactions();
  return { from, to, newMessages: n, reachedLimit: n === 0 };
}

export function stopPoller(): void {
  if (timer) clearInterval(timer);
}
