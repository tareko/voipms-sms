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
  send: (did: string, contact: string, message: string) =>
    postJson<{ ok: boolean; id: string }>('/send', { did, contact, message }),
  sendMedia: (did: string, contact: string, message: string, file: Blob, contentType: string) => {
    const fd = new FormData();
    fd.append('did', did);
    fd.append('contact', contact);
    fd.append('message', message);
    fd.append('media', file, contentType.startsWith('image/') ? 'photo' : 'attachment');
    return fetch(base + '/send-media', { method: 'POST', body: fd }).then(async (r) => {
      if (!r.ok) throw new Error(`${r.status} ${await r.text()}`);
      return (await r.json()) as { ok: boolean; id: string };
    });
  },
  react: (did: string, contact: string, messageId: string, emoji: string) =>
    postJson<{ ok: boolean; id: string }>('/react', { did, contact, messageId, emoji }),
  markRead: (did: string, contact: string) => postJson('/markread', { did, contact }),
  contacts: (q: string) => getJson<Contact[]>(`/contacts?q=${encodeURIComponent(q)}`),
  refreshContacts: () => postJson('/contacts/refresh', {}),
  poll: () => postJson('/poll', {}),
  applyWebhook: (did: string) => postJson('/webhook/apply', { did }),
};
