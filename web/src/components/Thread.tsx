import { useEffect, useMemo, useRef, useState } from 'react';
import { useStore } from '../store';
import { Avatar } from './Avatar';
import { MessageStatus } from './MessageStatus';
import type { Message } from '../types';

const REACT_EMOJIS = ['❤️', '👍', '👎', '😂', '‼️', '❓'];

export function Thread() {
  const selectedDid = useStore((s) => s.selectedDid);
  const selectedContact = useStore((s) => s.selectedContact);
  const conversations = useStore((s) => s.conversations);
  const messages = useStore((s) => s.messages);
  const retryText = useStore((s) => s.retryText);
  const reactMessage = useStore((s) => s.reactMessage);

  const name = useMemo(() => {
    const c = conversations.find((x) => x.contact === selectedContact);
    return c?.name ?? c?.contactRaw ?? selectedContact ?? '';
  }, [conversations, selectedContact]);

  const scrollRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = scrollRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [messages]);

  const contactNum = formatDid(selectedContact);

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
          <div className="thread-name">{name || contactNum}</div>
          <div className="thread-sub">
            {name ? `${contactNum} · ` : ''}via {formatDid(selectedDid)}
          </div>
        </div>
      </div>

      <div className="thread-scroll" ref={scrollRef}>
        <div className="thread-day">End-to-end via voip.ms</div>
        {messages.map((m) => (
          <Bubble
            key={m.id}
            msg={m}
            onReact={(emoji) => void reactMessage(m.id, emoji)}
            onRetry={(msg) => void retryText(msg.id, msg.message)}
          />
        ))}
      </div>
    </div>
  );
}

function Bubble({
  msg,
  onReact,
  onRetry,
}: {
  msg: Message;
  onReact: (emoji: string) => void;
  onRetry: (msg: Message) => void;
}) {
  const [hover, setHover] = useState(false);
  const [picker, setPicker] = useState(false);
  const images = msg.media?.filter((x) => x.contentType.startsWith('image/')) ?? [];
  const caption = msg.message;
  const incoming = msg.type === 1;

  return (
    <div
      className={`bubble-row ${incoming ? 'in' : 'out'}`}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
    >
      {picker && (
        <>
          <div className="react-backdrop" onClick={() => setPicker(false)} />
          <div className={`react-bar ${incoming ? 'in' : 'out'}`}>
            {REACT_EMOJIS.map((e) => (
              <button
                key={e}
                className="react-bar-emoji"
                title={e}
                onClick={() => {
                  onReact(e);
                  setPicker(false);
                }}
              >
                {e}
              </button>
            ))}
          </div>
        </>
      )}

      <div className={`bubble-wrap ${incoming ? 'in' : 'out'}`}>
        {hover && !picker && (
          <button
            className="react-trigger"
            title="React"
            onClick={() => setPicker(true)}
          >
            😀
          </button>
        )}
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
            <span className="bubble-time">{formatTime(msg.ts)}</span>
            <MessageStatus msg={msg} onRetry={onRetry} />
          </span>
        </div>
        {msg.reactions && msg.reactions.length > 0 && (
          <div className={`reactions ${incoming ? 'in' : 'out'}`}>
            {dedupeReactions(msg.reactions).map((r, i) => (
              <span key={i} className="reaction-badge" title={r.from === 'me' ? 'You reacted' : 'Reaction'}>
                {r.emoji}
              </span>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function dedupeReactions(reactions: { emoji: string; from?: string }[]) {
  // collapse duplicates to one badge per emoji
  const seen = new Set<string>();
  const out: { emoji: string; from?: string }[] = [];
  for (const r of reactions) {
    if (seen.has(r.emoji)) continue;
    seen.add(r.emoji);
    out.push(r);
  }
  return out;
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
