import { getDb, getThread, reactionExists, addReaction, deleteMessage } from '../store/db.js';
import { detectReaction, matchTarget } from '../reactions.js';

export interface BackfillResult {
  threads: number;
  scanned: number;
  reactions: number;
  matched: number;
  removed: number;
}

/**
 * One-time cleanup: scan all stored messages for iMessage-style reaction texts,
 * convert them into reaction_events attached to their matched target, and delete
 * the now-redundant "Liked …" text bubbles. Idempotent (reaction_events dedup
 * by message id). Unmatched reactions are left as text.
 */
export function backfillReactions(): BackfillResult {
  const threads = getDb()
    .prepare('SELECT DISTINCT did, contact FROM messages')
    .all() as { did: string; contact: string }[];

  const result: BackfillResult = { threads: threads.length, scanned: 0, reactions: 0, matched: 0, removed: 0 };

  for (const { did, contact } of threads) {
    const msgs = getThread(did, contact, 10000);
    const candidates = msgs.filter((m) => !detectReaction(m.message));
    for (const m of msgs) {
      result.scanned++;
      const d = detectReaction(m.message);
      if (!d || reactionExists(m.id)) continue;
      result.reactions++;
      const target = matchTarget(candidates, d.quoted);
      addReaction({
        id: m.id,
        targetId: target?.id ?? null,
        did,
        contact,
        emoji: d.emoji,
        fromTel: m.type === 1 ? contact : 'me',
        ts: m.ts,
      });
      if (target) {
        result.matched++;
        deleteMessage(m.id);
        result.removed++;
      }
    }
  }
  console.log(
    `[backfill] threads=${result.threads} scanned=${result.scanned} reactions=${result.reactions} matched=${result.matched} removed=${result.removed}`
  );
  return result;
}
