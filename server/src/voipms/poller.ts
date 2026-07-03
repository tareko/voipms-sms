import { config } from '../config.js';
import { getSMS, getMMS, getDIDsInfo, type NormalizedSms } from './client.js';
import { getCachedDids, getMaxMessageId, messageExists, setDids } from '../store/db.js';
import { ingest } from '../services/ingest.js';
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
    const sinceId = getMaxMessageId();
    const from = dateNDaysAgo(7);

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
        if (sinceId > 0n && BigInt(sms.id || '0') <= sinceId) continue;
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
        if (messageExists(key)) continue;
        const namespaced = { ...m, id: key };
        if (await ingest(namespaced, 'poll')) newCount++;
      }
    }
    status = `ok (${new String(newCount)} new @ ${new Date().toLocaleTimeString()})`;
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

export function stopPoller(): void {
  if (timer) clearInterval(timer);
}
