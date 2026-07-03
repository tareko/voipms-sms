import type { AppStatus, Contact, Conversation, Did, Message } from './types';

const base = '/api';

async function getJson<T>(path: string): Promise<T> {
  const res = await fetch(base + path);
  if (!res.ok) throw new Error(`${res.status} ${await res.text()}`);
  return (await res.json()) as T;
}

async function postJson<T>(path: string, body?: unknown): Promise<T> {
  const res = await fetch(base + path, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: body ? JSON.stringify(body) : undefined,
  });
  if (!res.ok) throw new Error(`${res.status} ${await res.text()}`);
  return (await res.json()) as T;
}

export const api = {
  status: () => getJson<AppStatus>('/status'),
  dids: () => getJson<Did[]>('/dids'),
  conversations: (did: string) => getJson<Conversation[]>(`/conversations?did=${encodeURIComponent(did)}`),
  messages: (did: string, contact: string) =>
    getJson<Message[]>(`/messages?did=${encodeURIComponent(did)}&contact=${encodeURIComponent(contact)}`),
  send: (did: string, contact: string, message: string) => postJson('/send', { did, contact, message }),
  markRead: (did: string, contact: string) => postJson('/markread', { did, contact }),
  contacts: (q: string) => getJson<Contact[]>(`/contacts?q=${encodeURIComponent(q)}`),
  refreshContacts: () => postJson('/contacts/refresh', {}),
  poll: () => postJson('/poll', {}),
  applyWebhook: (did: string) => postJson('/webhook/apply', { did }),
};
