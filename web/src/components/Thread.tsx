import { useEffect, useMemo, useRef } from 'react';
import { useStore } from '../store';
import { Avatar } from './Avatar';
import { MessageStatus } from './MessageStatus';

export function Thread() {
  const selectedDid = useStore((s) => s.selectedDid);
  const selectedContact = useStore((s) => s.selectedContact);
  const conversations = useStore((s) => s.conversations);
  const messages = useStore((s) => s.messages);
  const retryText = useStore((s) => s.retryText);

  const name = useMemo(() => {
    const c = conversations.find((x) => x.contact === selectedContact);
    return c?.name ?? c?.contactRaw ?? selectedContact ?? '';
  }, [conversations, selectedContact]);

  const scrollRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = scrollRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [messages]);

  if (!selectedContact) {
    return (
      <div className="thread empty">
        <div className="thread-empty-card">
          <h2>voip.ms SMS</h2>
          <p>Select a conversation on the left, or search a contact to start a new chat.</p>
        </div>
      </div>
    );
  }

  return (
    <div className="thread">
      <div className="thread-header">
        <Avatar name={name || selectedContact} size={36} />
        <div className="thread-header-name">
          <div className="thread-name">{name || selectedContact}</div>
          <div className="thread-sub">{formatDid(selectedDid)}</div>
        </div>
      </div>

      <div className="thread-scroll" ref={scrollRef}>
        <div className="thread-day">End-to-end via voip.ms</div>
        {messages.map((m) => {
          const images = m.media?.filter((x) => x.contentType.startsWith('image/')) ?? [];
          const caption = m.message;
          return (
            <div key={m.id} className={`bubble-row ${m.type === 1 ? 'in' : 'out'}`}>
              <div className={`bubble${images.length ? ' has-media' : ''}`}>
                {images.length > 0 && (
                  <div className="bubble-media">
                    {images.map((img, i) => (
                      <a key={i} href={img.url} target="_blank" rel="noreferrer">
                        <img src={img.url} alt="" loading="lazy" />
                      </a>
                    ))}
                  </div>
                )}
                {caption && <span className="bubble-text">{caption}</span>}
                <span className="bubble-meta">
                  <span className="bubble-time">{formatTime(m.ts)}</span>
                  <MessageStatus msg={m} onRetry={(msg) => void retryText(msg.id, msg.message)} />
                </span>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function formatDid(d: string | null): string {
  if (!d) return '';
  const digits = d.replace(/\D/g, '').slice(-10);
  if (digits.length === 10) return `(${digits.slice(0, 3)}) ${digits.slice(3, 6)}-${digits.slice(6)}`;
  return d;
}

export function formatTime(ts: number): string {
  const d = new Date(ts);
  const now = new Date();
  const sameDay = d.toDateString() === now.toDateString();
  const time = d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
  if (sameDay) return time;
  return `${d.toLocaleDateString([], { month: 'short', day: 'numeric' })} ${time}`;
}
