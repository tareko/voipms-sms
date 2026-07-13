import { useEffect, useRef } from 'react';
import { useStore } from '../store';
import { notifyNewMessage } from './useNotifications';
import type { SseEvent } from '../types';

export function useSSE() {
  // Subscribe to store values so this component re-renders (and refs update).
  const onMessage = useStore((s) => s.onMessage);
  const onMessageUpdated = useStore((s) => s.onMessageUpdated);
  const setDids = useStore((s) => s.setDids);
  const patchStatus = useStore((s) => s.patchStatus);
  const refreshConversations = useStore((s) => s.refreshConversations);
  const refreshMessages = useStore((s) => s.refreshMessages);
  const selectedContact = useStore((s) => s.selectedContact);
  const selectedDid = useStore((s) => s.selectedDid);

  // Refs updated every render — avoids stale closures inside EventSource
  // callbacks and the 30s interval (which runs once but needs fresh handlers).
  const handlers = useRef({
    onMessage, onMessageUpdated, setDids, patchStatus,
    refreshConversations, refreshMessages, selectedContact, selectedDid,
  });
  handlers.current = {
    onMessage, onMessageUpdated, setDids, patchStatus,
    refreshConversations, refreshMessages, selectedContact, selectedDid,
  };

  const esRef = useRef<EventSource | null>(null);

  useEffect(() => {
    const createES = () => {
      if (esRef.current) esRef.current.close();
      useStore.setState({ sseStatus: 'connecting' });
      const es = new EventSource('/events');
      esRef.current = es;

      es.onopen = () => {
        useStore.setState({ sseStatus: 'connected' });
        const h = handlers.current;
        void h.refreshConversations();
        void h.refreshMessages();
      };

      es.onmessage = (ev) => {
        if (!ev.data) return;
        let event: SseEvent;
        try {
          event = JSON.parse(ev.data) as SseEvent;
        } catch {
          return;
        }
        const h = handlers.current;
        switch (event.type) {
          case 'message':
            void h.onMessage(event.data);
            if (event.data.type === 1) {
              notifyNewMessage(event.data, h.selectedContact, h.selectedDid);
            }
            break;
          case 'message-updated':
            h.onMessageUpdated(event.data);
            break;
          case 'dids':
            h.setDids(event.data);
            break;
          case 'status':
            h.patchStatus(event.data);
            break;
          case 'contacts-refreshed':
            void h.refreshConversations();
            break;
        }
      };

      es.onerror = () => {
        useStore.setState({ sseStatus: 'connecting' });
      };
    };

    createES();

    // 30s safety net: force-reconnect dead EventSource + refresh data as a
    // fallback for any events missed while SSE was down.
    const interval = setInterval(() => {
      const es = esRef.current;
      if (!es || es.readyState === EventSource.CLOSED) {
        createES();
        return;
      }
      const h = handlers.current;
      void h.refreshConversations();
      if (useStore.getState().selectedContact) void h.refreshMessages();
    }, 30000);

    return () => {
      clearInterval(interval);
      if (esRef.current) esRef.current.close();
    };
  }, []); // run once — handlers via ref stay fresh
}
