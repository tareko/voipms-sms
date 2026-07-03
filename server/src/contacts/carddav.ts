import { XMLParser } from 'fast-xml-parser';
import { config } from '../config.js';
import { upsertContacts } from '../store/db.js';
import type { Contact } from '../types.js';
import { normalizeTel } from './match.js';

const parser = new XMLParser({
  ignoreAttributes: false,
  removeNSPrefix: true,
  isArray: (tagName) => tagName === 'response',
});

function authHeader(): string {
  return 'Basic ' + Buffer.from(`${config.nextcloud.username}:${config.nextcloud.password}`).toString('base64');
}

async function dav(path: string, init: RequestInit = {}): Promise<Response> {
  const url = `${config.nextcloud.url}${path}`;
  return fetch(url, {
    ...init,
    headers: {
      Authorization: authHeader(),
      ...(init.headers as Record<string, string> | undefined),
    },
  });
}

async function discoverAddressBooks(): Promise<string[]> {
  if (config.nextcloud.addressbook) return [config.nextcloud.addressbook];

  const user = encodeURIComponent(config.nextcloud.username);
  const basePath = `/remote.php/dav/addressbooks/users/${user}/`;
  const res = await dav(basePath, {
    method: 'PROPFIND',
    headers: { Depth: '1', 'Content-Type': 'application/xml; charset=utf-8' },
    body: `<?xml version="1.0"?>
      <d:propfind xmlns:d="DAV:">
        <d:prop><d:resourcetype/><d:displayname/></d:prop>
      </d:propfind>`,
  });
  if (!res.ok) throw new Error(`CardDAV discovery failed: HTTP ${res.status}`);
  const xml = parser.parse(await res.text());
  const responses: unknown[] = xml.multistatus?.response ?? [];
  const books: string[] = [];
  for (const entry of responses) {
    const e = entry as Record<string, unknown>;
    const propstat = e.propstat as Record<string, unknown> | undefined;
    const prop = (propstat?.prop ?? {}) as Record<string, unknown>;
    const rt = prop.resourcetype as Record<string, unknown> | undefined;
    if (rt && 'addressbook' in rt) {
      const href = e.href as string | undefined;
      if (href) books.push(href.endsWith('/') ? href : href);
    }
  }
  if (books.length === 0) books.push(basePath);
  return books;
}

async function fetchVCards(addressBookHref: string): Promise<string[]> {
  const res = await dav(addressBookHref, {
    method: 'REPORT',
    headers: { Depth: '1', 'Content-Type': 'application/xml; charset=utf-8' },
    body: `<?xml version="1.0"?>
      <c:addressbook-query xmlns:d="DAV:" xmlns:c="urn:ietf:params:xml:ns:carddav">
        <d:prop><d:getetag/><c:address-data/></d:prop>
      </c:addressbook-query>`,
  });
  if (!res.ok) throw new Error(`CardDAV query failed: HTTP ${res.status} for ${addressBookHref}`);
  const xml = parser.parse(await res.text());
  const responses: unknown[] = xml.multistatus?.response ?? [];
  const cards: string[] = [];
  for (const entry of responses) {
    const e = entry as Record<string, unknown>;
    const propstat = e.propstat as Record<string, unknown> | undefined;
    const prop = (propstat?.prop ?? {}) as Record<string, unknown>;
    const data = prop['address-data'];
    if (typeof data === 'string') cards.push(data);
    else if (Array.isArray(data)) for (const d of data) if (typeof d === 'string') cards.push(d);
  }
  return cards;
}

/** Unfold RFC 6350 line continuations (lines starting with space/tab). */
function unfoldVcard(text: string): string {
  return text.replace(/\r?\n[ \t]/g, '');
}

export interface ParsedVCard {
  fn: string | null;
  tels: string[];
}

export function parseVCard(text: string): ParsedVCard | null {
  const block = text.includes('BEGIN:VCARD') ? text : text;
  if (!/BEGIN:VCARD/i.test(block)) return null;
  const lines = unfoldVcard(block).split(/\r?\n/);
  let fn: string | null = null;
  const tels: string[] = [];
  for (const line of lines) {
    if (/^FN:/i.test(line)) {
      fn = decodeVcardValue(line.slice(3));
    } else if (/^TEL/i.test(line)) {
      const value = line.slice(line.indexOf(':') + 1);
      if (value) tels.push(decodeVcardValue(value));
    }
  }
  if (!fn && tels.length === 0) return null;
  return { fn: fn ?? 'Unknown', tels };
}

function decodeVcardValue(value: string): string {
  if (value.includes(':')) {
    // param;value form already split — value here is post-colon
  }
  // Minimal CHARACT escaping not expected for FN/TEL in practice.
  return value.trim();
}

let lastStatus = 'idle';

export function getCarddavStatus(): string {
  return lastStatus;
}

export async function syncContacts(): Promise<number> {
  if (!config.nextcloud.url || !config.nextcloud.username || !config.nextcloud.password) {
    lastStatus = 'disabled';
    return 0;
  }
  try {
    lastStatus = 'syncing';
    const books = await discoverAddressBooks();
    const contacts: Contact[] = [];
    for (const book of books) {
      const cards = await fetchVCards(book);
      for (const card of cards) {
        const parsed = parseVCard(card);
        if (!parsed) continue;
        for (const rawTel of parsed.tels) {
          const tel = normalizeTel(rawTel);
          if (tel) contacts.push({ tel, name: parsed.fn ?? 'Unknown', rawTel });
        }
      }
    }
    const count = upsertContacts(contacts);
    lastStatus = `ok (${count} contacts, ${new Date().toLocaleTimeString()})`;
    console.log(`[carddav] synced ${count} contacts from ${books.length} address book(s)`);
    return count;
  } catch (err) {
    lastStatus = `error: ${(err as Error).message}`;
    console.error('[carddav] sync failed:', (err as Error).message);
    return 0;
  }
}
