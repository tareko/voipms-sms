import { create } from 'zustand';
import { api } from './api';
import type { AppStatus, Conversation, Did, Message } from './types';

interface StoreState {
  status: AppStatus | null;
  dids: Did[];
  selectedDid: string | null;

  conversations: Conversation[];
  selectedContact: string | null;
  messages: Message[];

  loading: boolean;
  error: string | null;

  init: () => Promise<void>;
  selectDid: (did: string) => Promise<void>;
  selectContact: (contact: string) => Promise<void>;
  refreshConversations: () => Promise<void>;
  refreshMessages: () => Promise<void>;
  sendMessage: (text: string) => Promise<void>;
  sendMedia: (file: Blob, contentType: string, text: string, previewUrl?: string) => Promise<void>;
  retryText: (id: string, text: string) => Promise<void>;
  reactMessage: (messageId: string, emoji: string) => Promise<void>;
  markRead: (contact: string) => Promise<void>;
  setStatus: (s: AppStatus) => void;
  patchStatus: (p: { poller?: string; carddav?: string }) => void;
  setDids: (d: Did[]) => void;
  onMessage: (msg: Message) => Promise<void>;
  onMessageUpdated: (msg: Message) => void;
}

export const useStore = create<StoreState>((set, get) => ({
  status: null,
  dids: [],
  selectedDid: null,
  conversations: [],
  selectedContact: null,
  messages: [],
  loading: false,
  error: null,

  init: async () => {
    set({ loading: true, error: null });
    try {
      const status = await api.status();
      const dids = status.dids?.length ? status.dids : await api.dids();
      const selectedDid = get().selectedDid ?? dids[0]?.did ?? null;
      set({ status, dids, selectedDid, loading: false });
      if (selectedDid) await get().refreshConversations();
    } catch (e) {
      set({ loading: false, error: (e as Error).message });
    }
  },

  selectDid: async (did: string) => {
    set({ selectedDid: did, selectedContact: null, messages: [], conversations: [] });
    await get().refreshConversations();
  },

  selectContact: async (contact: string) => {
    set({ selectedContact: contact });
    await get().refreshMessages();
    await get().markRead(contact);
  },

  refreshConversations: async () => {
    const did = get().selectedDid;
    if (!did) return;
    try {
      const conversations = await api.conversations(did);
      set({ conversations });
    } catch (e) {
      set({ error: (e as Error).message });
    }
  },

  refreshMessages: async () => {
    const { selectedDid, selectedContact, messages } = get();
    if (!selectedDid || !selectedContact) return;
    try {
      const server = await api.messages(selectedDid, selectedContact);
      const serverIds = new Set(server.map((m) => m.id));
      const mapped: Message[] = server.map((m) =>
        m.type === 0 ? ({ ...m, status: 'sent' } as Message) : m
      );
      // preserve any in-flight optimistic sends not yet on the server
      const inflight = messages.filter(
        (m) => (m.status === 'sending' || m.status === 'failed') && !serverIds.has(m.id)
      );
      const merged = [...mapped, ...inflight].sort((a, b) => a.ts - b.ts);
      set({ messages: merged });
    } catch (e) {
      set({ error: (e as Error).message });
    }
  },

  sendMessage: async (text: string) => {
    const { selectedDid, selectedContact, messages, conversations } = get();
    const body = text.trim();
    if (!selectedDid || !selectedContact || !body) return;
    const now = Date.now();
    const optId = `opt-${now}-${Math.random().toString(36).slice(2, 6)}`;
    const contactRaw =
      conversations.find((c) => c.contact === selectedContact)?.contactRaw ?? selectedContact;
    const opt = {
      id: optId,
      date: clientDate(now),
      ts: now,
      type: 0 as const,
      did: selectedDid,
      contact: selectedContact,
      contactRaw,
      message: body,
      carrierStatus: '',
      read: 0,
      status: 'sending' as const,
    };
    set({ messages: [...messages, opt] });
    bumpConversation(selectedContact, opt, set);
    try {
      const res = await api.send(selectedDid, selectedContact, body);
      patchMessage(set, optId, { id: res.id || optId, status: 'sent' });
    } catch (e) {
      patchMessage(set, optId, { status: 'failed' });
      set({ error: (e as Error).message });
    }
    void get().refreshConversations();
  },

  sendMedia: async (file: Blob, contentType: string, text: string, previewUrl?: string) => {
    const { selectedDid, selectedContact, messages, conversations } = get();
    const body = text.trim();
    if (!selectedDid || !selectedContact) return;
    const now = Date.now();
    const optId = `opt-mms-${now}-${Math.random().toString(36).slice(2, 6)}`;
    const contactRaw =
      conversations.find((c) => c.contact === selectedContact)?.contactRaw ?? selectedContact;
    const opt = {
      id: optId,
      date: clientDate(now),
      ts: now,
      type: 0 as const,
      did: selectedDid,
      contact: selectedContact,
      contactRaw,
      message: body,
      carrierStatus: '',
      read: 0,
      status: 'sending' as const,
      media: previewUrl ? [{ url: previewUrl, contentType }] : undefined,
    };
    set({ messages: [...messages, opt] });
    bumpConversation(selectedContact, opt, set);
    try {
      const res = await api.sendMedia(selectedDid, selectedContact, body, file, contentType);
      patchMessage(set, optId, { id: res.id || optId, status: 'sent' });
    } catch (e) {
      patchMessage(set, optId, { status: 'failed' });
      set({ error: (e as Error).message });
    }
    void get().refreshConversations();
  },

  retryText: async (id: string, text: string) => {
    patchMessage(set, id, { status: 'sending' });
    const { selectedDid, selectedContact } = get();
    if (!selectedDid || !selectedContact) return;
    try {
      const res = await api.send(selectedDid, selectedContact, text);
      patchMessage(set, id, { id: res.id || id, status: 'sent' });
    } catch (e) {
      patchMessage(set, id, { status: 'failed' });
      set({ error: (e as Error).message });
    }
    void get().refreshConversations();
  },

  reactMessage: async (messageId: string, emoji: string) => {
    const { selectedDid, selectedContact, messages } = get();
    if (!selectedDid || !selectedContact) return;
    const next = messages.map((m) =>
      m.id === messageId
        ? {
            ...m,
            reactions: setMyReaction(m.reactions, emoji),
          }
        : m
    );
    set({ messages: next });
    try {
      await api.react(selectedDid, selectedContact, messageId, emoji);
      // server broadcasts message-updated to reconcile
    } catch (e) {
      set({
        messages: get().messages.map((m) =>
          m.id === messageId
            ? { ...m, reactions: (m.reactions ?? []).filter((r) => r.from !== 'me') }
            : m
        ),
        error: (e as Error).message,
      });
    }
  },

  markRead: async (contact: string) => {
    const did = get().selectedDid;
    if (!did) return;
    set((s) => ({
      conversations: s.conversations.map((c) =>
        c.contact === contact ? { ...c, unread: 0 } : c
      ),
    }));
    try {
      await api.markRead(did, contact);
    } catch {
      /* non-fatal */
    }
  },

  setStatus: (s) => set({ status: s }),
  patchStatus: (p) => set((s) => (s.status ? { ...s, status: { ...s.status, ...p } } : s)),
  setDids: (d) => {
    set({ dids: d });
    if (!get().selectedDid && d.length) {
      void get().selectDid(d[0].did);
    }
  },

  onMessage: async (msg) => {
    const { selectedDid, selectedContact, messages } = get();
    if (msg.did !== selectedDid) {
      await get().refreshConversations();
      return;
    }

    if (msg.contact === selectedContact) {
      const byId = messages.findIndex((m) => m.id === msg.id);
      if (byId >= 0) {
        const next = [...messages];
        next[byId] = {
          ...next[byId],
          ...msg,
          status: (msg.type === 0 ? 'sent' : next[byId].status) as Message['status'],
        };
        set({ messages: next });
      } else if (msg.type === 0) {
        // Merge an echoed sent message into its optimistic placeholder.
        const ph = messages.findIndex(
          (m) =>
            m.type === 0 &&
            m.message === msg.message &&
            (m.status === 'sending' || m.status === 'sent') &&
            Math.abs(m.ts - msg.ts) < 60000
        );
        if (ph >= 0) {
          const next = [...messages];
          next[ph] = { ...next[ph], ...msg, status: 'sent' as const };
          set({ messages: next });
        } else {
          set({
            messages: [...messages, { ...msg, status: 'sent' as const }].sort(
              (a, b) => a.ts - b.ts
            ),
          });
        }
      } else {
        const next = [...messages, msg].sort((a, b) => a.ts - b.ts);
        set({ messages: next });
        if (document.visibilityState === 'visible') {
          await get().markRead(msg.contact);
        }
      }
    }
    await get().refreshConversations();
  },

  onMessageUpdated: (msg) => {
    const { selectedDid, selectedContact, messages } = get();
    if (msg.did !== selectedDid) {
      void get().refreshConversations();
      return;
    }
    if (msg.contact === selectedContact) {
      const idx = messages.findIndex((m) => m.id === msg.id);
      if (idx >= 0) {
        const next = [...messages];
        // keep client-only status from the existing bubble
        next[idx] = { ...msg, status: messages[idx].status };
        set({ messages: next });
      }
    }
    void get().refreshConversations();
  },
}));

// ---------- helpers ----------

function setMyReaction(reactions: Message['reactions'], emoji: string) {
  const others = (reactions ?? []).filter((r) => r.from !== 'me');
  return [...others, { emoji, from: 'me' }];
}

function clientDate(ts: number): string {
  const d = new Date(ts);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
}

type SetFn = (
  partial: StoreState | ((s: StoreState) => Partial<StoreState> | StoreState)
) => void;

function patchMessage(
  set: SetFn,
  id: string,
  patch: Partial<Message>
): void {
  set((s) => ({ messages: s.messages.map((m) => (m.id === id ? { ...m, ...patch } : m)) }));
}

function bumpConversation(
  contact: string,
  msg: Message,
  set: SetFn
): void {
  set((s) => ({
    conversations: s.conversations
      .map((c) => (c.contact === contact ? { ...c, lastMessage: msg, ts: msg.ts } : c))
      .sort((a, b) => b.ts - a.ts),
  }));
}
