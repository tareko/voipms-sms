export type Direction = 0 | 1; // 0 = sent, 1 = received

export interface MediaRef {
  url: string;
  contentType: string;
}

export interface Message {
  id: string;
  date: string;
  ts: number;
  type: Direction;
  did: string;
  contact: string;
  contactRaw: string;
  message: string;
  carrierStatus: string;
  read: number;
  media?: MediaRef[];
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
  tel: string;
  name: string;
  rawTel: string;
}

export interface Did {
  did: string;
  description: string;
}

export interface AppStatus {
  poller: string;
  carddav: string;
  webhook: { configured: boolean; publicUrl: string };
  dids: Did[];
}

export type SseEvent =
  | { type: 'message'; data: Message }
  | { type: 'contacts-refreshed'; data: { count: number } }
  | { type: 'dids'; data: Did[] }
  | { type: 'status'; data: { poller: string; carddav: string } };
