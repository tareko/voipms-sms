import type { Message } from '../types';
import { useStore } from '../store';

let permissionAsked = false;

export function requestNotificationPermission() {
  if (permissionAsked || typeof Notification === 'undefined') return;
  permissionAsked = true;
  if (Notification.permission === 'default') {
    void Notification.requestPermission();
  }
}

function displayName(msg: Message): string {
  const conv = useStore.getState().conversations.find((c) => c.contact === msg.contact);
  return conv?.name ?? msg.contactRaw;
}

/** Show a browser notification for an inbound message if the thread isn't focused. */
export function notifyNewMessage(msg: Message, selectedContact: string | null, _selectedDid: string | null) {
  if (typeof Notification === 'undefined') return;
  if (Notification.permission !== 'granted') return;
  const isFocusedThread =
    document.visibilityState === 'visible' && selectedContact === msg.contact;
  if (isFocusedThread) return;

  const n = new Notification(displayName(msg), {
    body: msg.message,
    tag: `voipms-${msg.did}-${msg.contact}`,
  });
  n.onclick = () => {
    window.focus();
    void useStore.getState().selectContact(msg.contact);
    n.close();
  };
  setTimeout(() => n.close(), 8000);
}
