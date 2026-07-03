import { useEffect, useRef } from 'react';
import { useStore } from '../store';
import { notifyNewMessage } from './useNotifications';
import type { SseEvent } from '../types';

export function useSSE() {
  const onMessage = useStore((s) => s.onMessage);
  const onMessageUpdated = useStore((s) => s.onMessageUpdated);
  const setDids = useStore((s) => s.setDids);
  const patchStatus = useStore((s) => s.patchStatus);
  const refreshConversations = useStore((s) => s.refreshConversations);
  const refreshMessages = useStore((s) => s.refreshMessages);
  const selectedContact = useStore((s) => s.selectedContact);
  const selectedDid = useStore((s) => s.selectedDid);
  const ref = useRef<EventSource | null>(null);
  const selContactRef = useRef(selectedContact);
  const selDidRef = useRef(selectedDid);
  selContactRef.current = selectedContact;
  selDidRef.current = selectedDid;

  useEffect(() => {
    const es = new EventSource('/events');
    ref.current = es;

    es.onopen = () => {
      void refreshConversations();
      void refreshMessages();
    };
    es.onmessage = (ev) => {
      if (!ev.data) return;
      let event: SseEvent;
      try {
        event = JSON.parse(ev.data) as SseEvent;
      } catch {
        return;
      }
      switch (event.type) {
        case 'message':
          void onMessage(event.data);
          if (event.data.type === 1) {
            notifyNewMessage(event.data, selContactRef.current, selDidRef.current);
          }
          break;
        case 'message-updated':
          onMessageUpdated(event.data);
          break;
        case 'dids':
          setDids(event.data);
          break;
        case 'status':
          patchStatus(event.data);
          break;
        case 'contacts-refreshed':
          void refreshConversations();
          break;
      }
    };

    return () => es.close();
  }, [onMessage, onMessageUpdated, setDids, patchStatus, refreshConversations, refreshMessages]);
}
