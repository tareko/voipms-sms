import Database from 'better-sqlite3';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { config } from '../config.js';
import type { Contact, Conversation, Did, Message } from '../types.js';

let db: Database.Database;

export function initDb() {
  mkdirSync(dirname(config.dbPath), { recursive: true });
  db = new Database(config.dbPath);
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');

  db.exec(`
    CREATE TABLE IF NOT EXISTS messages (
      id            TEXT PRIMARY KEY,
      date          TEXT NOT NULL,
      ts            INTEGER NOT NULL,
      type          INTEGER NOT NULL,
      did           TEXT NOT NULL,
      contact       TEXT NOT NULL,
      contact_raw   TEXT NOT NULL,
      message       TEXT NOT NULL,
      carrier_status TEXT,
      read          INTEGER NOT NULL DEFAULT 0,
      source        TEXT NOT NULL DEFAULT 'poll'
    );
    CREATE INDEX IF NOT EXISTS idx_msg_thread ON messages(did, contact, ts);
    CREATE INDEX IF NOT EXISTS idx_msg_ts ON messages(ts);

    CREATE TABLE IF NOT EXISTS contacts (
      tel     TEXT PRIMARY KEY,
      name    TEXT NOT NULL,
      raw_tel TEXT
    );

    CREATE TABLE IF NOT EXISTS dids (
      did         TEXT PRIMARY KEY,
      description TEXT
    );

    CREATE TABLE IF NOT EXISTS kv (
      key   TEXT PRIMARY KEY,
      value TEXT
    );

    CREATE TABLE IF NOT EXISTS reaction_events (
      id        TEXT PRIMARY KEY,   -- voip.ms id of the reaction text (dedup)
      target_id TEXT,               -- matched message id (nullable if unmatched)
      did       TEXT NOT NULL,
      contact   TEXT NOT NULL,
      emoji     TEXT NOT NULL,
      from_tel  TEXT,
      ts        INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_react_thread ON reaction_events(did, contact);
    CREATE INDEX IF NOT EXISTS idx_react_target ON reaction_events(target_id);
  `);

  // Additive migration: add `media` column for MMS attachments (existing DBs).
  const cols = db.prepare('PRAGMA table_info(messages)').all() as { name: string }[];
  if (!cols.some((c) => c.name === 'media')) {
    db.exec('ALTER TABLE messages ADD COLUMN media TEXT');
  }
  return db;
}

export function getDb() {
  if (!db) throw new Error('DB not initialised');
  return db;
}

// ---------- KV ----------
export function getKv(key: string): string | undefined {
  const row = getDb().prepare('SELECT value FROM kv WHERE key = ?').get(key) as
    | { value: string }
    | undefined;
  return row?.value;
}
export function setKv(key: string, value: string): void {
  getDb()
    .prepare('INSERT INTO kv(key, value) VALUES(?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value')
    .run(key, value);
}

// ---------- messages ----------
function parseMedia(raw: unknown): import('../types.js').MediaRef[] | undefined {
  if (typeof raw !== 'string' || !raw) return undefined;
  try {
    const arr = JSON.parse(raw);
    if (Array.isArray(arr) && arr.length) return arr as import('../types.js').MediaRef[];
  } catch {
    /* malformed */
  }
  return undefined;
}

function rowToMessage(r: Record<string, unknown>): Message {
  return {
    id: String(r.id),
    date: String(r.date),
    ts: Number(r.ts),
    type: Number(r.type) as Message['type'],
    did: String(r.did),
    contact: String(r.contact),
    contactRaw: String(r.contact_raw),
    message: String(r.message),
    carrierStatus: r.carrier_status ? String(r.carrier_status) : '',
    read: Number(r.read),
    media: parseMedia(r.media),
  };
}

export function messageExists(id: string): boolean {
  const row = getDb().prepare('SELECT 1 FROM messages WHERE id = ?').get(id);
  return Boolean(row);
}

/**
 * Content-based duplicate check. voip.ms expands a group MMS into one row per
 * "leg" (same sender + body + timestamp, different ids); dedup by content so we
 * don't show the same bubble twice. A human re-sending identical text would
 * have a different second-precision timestamp, so this is safe.
 */
export function isDuplicateMessage(did: string, contact: string, message: string, ts: number): boolean {
  return Boolean(
    getDb()
      .prepare('SELECT 1 FROM messages WHERE did = ? AND contact = ? AND message = ? AND ts = ? LIMIT 1')
      .get(did, contact, message, ts)
  );
}

/** Remove existing duplicate bubbles (keeps the first of each content group). */
export function dedupMessages(): number {
  const res = getDb()
    .prepare(
      `DELETE FROM messages WHERE rowid NOT IN (
         SELECT MIN(rowid) FROM messages GROUP BY did, contact, message, ts
       )`
    )
    .run();
  return res.changes;
}

/** Insert a message; returns true if it was new. */
export function insertMessage(msg: Message, source: 'poll' | 'webhook' | 'send' = 'poll'): boolean {
  const res = getDb()
    .prepare(
      `INSERT INTO messages(id, date, ts, type, did, contact, contact_raw, message, carrier_status, read, source, media)
       VALUES(@id, @date, @ts, @type, @did, @contact, @contact_raw, @message, @carrier_status, @read, @source, @media)
       ON CONFLICT(id) DO NOTHING`
    )
    .run({
      id: msg.id,
      date: msg.date,
      ts: msg.ts,
      type: msg.type,
      did: msg.did,
      contact: msg.contact,
      contact_raw: msg.contactRaw,
      message: msg.message,
      carrier_status: msg.carrierStatus ?? '',
      read: msg.read ?? 0,
      source,
      media: msg.media ? JSON.stringify(msg.media) : null,
    });
  return res.changes > 0;
}

export function getThread(did: string, contact: string, limit = 500): Message[] {
  const rows = getDb()
    .prepare(
      `SELECT * FROM messages WHERE did = ? AND contact = ? ORDER BY ts ASC LIMIT ?`
    )
    .all(did, contact, limit) as Record<string, unknown>[];
  const messages = rows.map(rowToMessage);
  return attachReactions(messages, did, contact);
}

export function markThreadRead(did: string, contact: string): void {
  getDb()
    .prepare(`UPDATE messages SET read = 1 WHERE did = ? AND contact = ? AND type = 1 AND read = 0`)
    .run(did, contact);
}

export function getMessage(id: string): Message | null {
  const row = getDb().prepare('SELECT * FROM messages WHERE id = ?').get(id) as
    | Record<string, unknown>
    | undefined;
  return row ? rowToMessage(row) : null;
}

export function getReactionsForMessage(id: string): import('../types.js').ReactionRef[] {
  const rows = getDb()
    .prepare('SELECT emoji, from_tel FROM reaction_events WHERE target_id = ?')
    .all(id) as { emoji: string; from_tel: string | null }[];
  return rows.map((r) => ({ emoji: r.emoji, from: r.from_tel ?? undefined }));
}

export function deleteMessage(id: string): void {
  getDb().prepare('DELETE FROM messages WHERE id = ?').run(id);
}

// ---------- reactions ----------
interface ReactionRow {
  id: string;
  target_id: string | null;
  emoji: string;
  from_tel: string | null;
}

export function reactionExists(id: string): boolean {
  return Boolean(getDb().prepare('SELECT 1 FROM reaction_events WHERE id = ?').get(id));
}

export function getReactionEvent(id: string): { target_id: string | null } | undefined {
  return getDb().prepare('SELECT target_id FROM reaction_events WHERE id = ?').get(id) as
    | { target_id: string | null }
    | undefined;
}

export function isDuplicateReaction(did: string, contact: string, emoji: string, ts: number): boolean {
  return Boolean(
    getDb()
      .prepare('SELECT 1 FROM reaction_events WHERE did = ? AND contact = ? AND emoji = ? AND ts = ? LIMIT 1')
      .get(did, contact, emoji, ts)
  );
}

/** Remove duplicate reaction events (keeps the first of each group). */
export function dedupReactionEvents(): number {
  const res = getDb()
    .prepare(
      `DELETE FROM reaction_events WHERE rowid NOT IN (
         SELECT MIN(rowid) FROM reaction_events GROUP BY did, contact, emoji, ts
       )`
    )
    .run();
  return res.changes;
}

export function addReaction(ev: {
  id: string;
  targetId: string | null;
  did: string;
  contact: string;
  emoji: string;
  fromTel?: string;
  ts: number;
}): void {
  getDb()
    .prepare(
      `INSERT INTO reaction_events(id, target_id, did, contact, emoji, from_tel, ts)
       VALUES(?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(id) DO UPDATE SET target_id = excluded.target_id, emoji = excluded.emoji`
    )
    .run(ev.id, ev.targetId, ev.did, ev.contact, ev.emoji, ev.fromTel ?? null, ev.ts);
}

/** Group reactions by target message id for a thread. */
function reactionsForThread(did: string, contact: string): Map<string, import('../types.js').ReactionRef[]> {
  const rows = getDb()
    .prepare(
      `SELECT id, target_id, emoji, from_tel FROM reaction_events
       WHERE did = ? AND contact = ? AND target_id IS NOT NULL`
    )
    .all(did, contact) as ReactionRow[];
  const map = new Map<string, import('../types.js').ReactionRef[]>();
  for (const r of rows) {
    if (!r.target_id) continue;
    const list = map.get(r.target_id) ?? [];
    list.push({ emoji: r.emoji, from: r.from_tel ?? undefined });
    map.set(r.target_id, list);
  }
  return map;
}

function attachReactions(messages: Message[], did: string, contact: string): Message[] {
  const byTarget = reactionsForThread(did, contact);
  if (byTarget.size === 0) return messages;
  return messages.map((m) => {
    const r = byTarget.get(m.id);
    return r && r.length ? { ...m, reactions: r } : m;
  });
}

export function getMaxMessageId(): bigint {
  const row = getDb().prepare(`SELECT MAX(CAST(id AS INTEGER)) AS m FROM messages`).get() as
    | { m: number | string | null }
    | undefined;
  if (!row || row.m == null || row.m === '') return 0n;
  try {
    return BigInt(row.m);
  } catch {
    return 0n;
  }
}

// ---------- conversations ----------
interface ConvRow extends Record<string, unknown> {
  name?: string | null;
}

export function getConversations(did: string): Conversation[] {
  const lastPerContact = getDb()
    .prepare(
      `SELECT m.*, c.name FROM messages m
       LEFT JOIN contacts c ON c.tel = m.contact
       WHERE m.did = ?
         AND m.ts = (SELECT MAX(m2.ts) FROM messages m2 WHERE m2.did = m.did AND m2.contact = m.contact)
       ORDER BY m.ts DESC`
    )
    .all(did) as ConvRow[];

  const unreadRows = getDb()
    .prepare(
      `SELECT contact, COUNT(*) AS n FROM messages WHERE did = ? AND type = 1 AND read = 0 GROUP BY contact`
    )
    .all(did) as { contact: string; n: number }[];
  const unread = new Map<string, number>(unreadRows.map((r) => [r.contact, r.n]));

  return lastPerContact.map((r) => {
    const msg = rowToMessage(r);
    return {
      did: msg.did,
      contact: msg.contact,
      contactRaw: msg.contactRaw,
      name: r.name ? String(r.name) : null,
      lastMessage: msg,
      unread: unread.get(msg.contact) ?? 0,
      ts: msg.ts,
    };
  });
}

// ---------- contacts ----------
/** Replace the entire contact set atomically (CardDAV sync is a full refresh). */
export function upsertContacts(contacts: Contact[]): number {
  const tx = getDb().transaction((items: Contact[]) => {
    getDb().prepare(`DELETE FROM contacts`).run();
    const stmt = getDb().prepare(
      `INSERT INTO contacts(tel, name, raw_tel) VALUES(?, ?, ?)
       ON CONFLICT(tel) DO UPDATE SET name = excluded.name, raw_tel = excluded.raw_tel`
    );
    for (const c of items) stmt.run(c.tel, c.name, c.rawTel ?? null);
    return items.length;
  });
  return tx(contacts);
}

export function getContactName(tel: string): string | null {
  const row = getDb().prepare(`SELECT name FROM contacts WHERE tel = ?`).get(tel) as
    | { name: string }
    | undefined;
  return row?.name ?? null;
}

export function searchContacts(query: string, limit = 50): Contact[] {
  const q = `%${query.replace(/[%_]/g, (m) => '\\' + m)}%`;
  const rows = getDb()
    .prepare(
      `SELECT tel, name, raw_tel AS rawTel FROM contacts
       WHERE name LIKE ? ESCAPE '\\' OR raw_tel LIKE ? ESCAPE '\\' OR tel LIKE ? ESCAPE '\\'
       ORDER BY name COLLATE NOCASE LIMIT ?`
    )
    .all(q, q, q, limit) as Record<string, unknown>[];
  return rows.map((r) => ({
    tel: String(r.tel),
    name: String(r.name),
    rawTel: r.rawTel ? String(r.rawTel) : '',
  }));
}

// ---------- DIDs (cache) ----------
export function setDids(dids: Did[]): void {
  const tx = getDb().transaction((items: Did[]) => {
    getDb().prepare(`DELETE FROM dids`).run();
    const stmt = getDb().prepare(`INSERT INTO dids(did, description) VALUES(?, ?)`);
    for (const d of items) stmt.run(d.did, d.description ?? null);
  });
  tx(dids);
}

export function getCachedDids(): Did[] {
  const rows = getDb().prepare(`SELECT did, description FROM dids ORDER BY did`).all() as Record<
    string,
    unknown
  >[];
  return rows.map((r) => ({ did: String(r.did), description: r.description ? String(r.description) : '' }));
}
