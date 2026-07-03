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
  markRead: (contact: string) => Promise<void>;
  setStatus: (s: AppStatus) => void;
  patchStatus: (p: { poller?: string; carddav?: string }) => void;
  setDids: (d: Did[]) => void;
  onMessage: (msg: Message) => Promise<void>;
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
    const { selectedDid, selectedContact } = get();
    if (!selectedDid || !selectedContact) return;
    try {
      const messages = await api.messages(selectedDid, selectedContact);
      set({ messages });
    } catch (e) {
      set({ error: (e as Error).message });
    }
  },

  sendMessage: async (text: string) => {
    const { selectedDid, selectedContact } = get();
    if (!selectedDid || !selectedContact || !text.trim()) return;
    try {
      await api.send(selectedDid, selectedContact, text.trim());
      // The sent message comes back via SSE; also refresh as a safety net.
      await get().refreshMessages();
      await get().refreshConversations();
    } catch (e) {
      set({ error: (e as Error).message });
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
    if (msg.did !== selectedDid) return;

    if (msg.contact === selectedContact) {
      if (!messages.some((m) => m.id === msg.id)) {
        const next = [...messages, msg].sort((a, b) => a.ts - b.ts);
        set({ messages: next });
        if (msg.type === 1 && document.visibilityState === 'visible') {
          await get().markRead(msg.contact);
        }
      }
    }
    await get().refreshConversations();
  },
}));
