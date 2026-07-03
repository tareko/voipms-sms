export type Direction = 0 | 1; // 0 = sent, 1 = received

export interface MediaRef {
  url: string; // local serving path, e.g. /api/media/<file>
  contentType: string;
}

export interface Message {
  id: string;
  date: string; // 'YYYY-MM-DD HH:MM:SS' (voip.ms format)
  ts: number; // epoch ms
  type: Direction;
  did: string; // normalized E.164
  contact: string; // normalized E.164
  contactRaw: string; // as reported by voip.ms
  message: string;
  carrierStatus: string;
  read: number; // 0/1 (local only)
  media?: MediaRef[]; // MMS attachments (cached locally)
}

export interface Conversation {
  did: string;
  contact: string;
  contactRaw: string;
  name: string | null;
  lastMessage: Message;
  unread: number;
  ts: number;
}

export interface Contact {
  tel: string; // normalized E.164
  name: string;
  rawTel: string;
}

export interface Did {
  did: string;
  description: string;
}

export type SseEvent =
  | { type: 'message'; data: Message }
  | { type: 'conversation-updated'; data: Conversation }
  | { type: 'contacts-refreshed'; data: { count: number } }
  | { type: 'dids'; data: Did[] }
  | { type: 'status'; data: { poller: string; carddav: string } };
