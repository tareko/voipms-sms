import { getDb, getThread, getReactionEvent, addReaction, deleteMessage } from '../store/db.js';
import { detectReaction, matchTarget } from '../reactions.js';

export interface BackfillResult {
  threads: number;
  scanned: number;
  reactions: number;
  matched: number;
  removed: number;
}

/**
 * Scan all stored messages for iMessage-style reaction texts, convert them into
 * reaction_events attached to their matched target, and delete the now-redundant
 * "Liked …" text bubbles. Self-healing and idempotent: a previously-unmatched
 * reaction whose text is still present is re-attempted on each run.
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
      if (!d) continue;
      const existing = getReactionEvent(m.id);
      const target = matchTarget(candidates, d.quoted);
      if (target) {
        if (!existing) result.reactions++;
        if (!existing || existing.target_id !== target.id) {
          addReaction({
            id: m.id,
            targetId: target.id,
            did,
            contact,
            emoji: d.emoji,
            fromTel: m.type === 1 ? contact : 'me',
            ts: m.ts,
          });
        }
        deleteMessage(m.id);
        result.removed++;
        result.matched++;
      } else if (!existing) {
        addReaction({
          id: m.id,
          targetId: null,
          did,
          contact,
          emoji: d.emoji,
          fromTel: m.type === 1 ? contact : 'me',
          ts: m.ts,
        });
        result.reactions++;
      }
    }
  }
  console.log(
    `[backfill] threads=${result.threads} scanned=${result.scanned} reactions=${result.reactions} matched=${result.matched} removed=${result.removed}`
  );
  return result;
}

