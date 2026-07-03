import { useEffect, useMemo, useState } from 'react';
import { api } from '../api';
import { useStore } from '../store';
import type { Contact } from '../types';
import { Avatar } from './Avatar';
import { formatTime } from './Thread';

export function ContactList() {
  const conversations = useStore((s) => s.conversations);
  const selectedContact = useStore((s) => s.selectedContact);
  const selectContact = useStore((s) => s.selectContact);
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<Contact[]>([]);

  useEffect(() => {
    const q = query.trim();
    if (!q) {
      setResults([]);
      return;
    }
    let active = true;
    const t = setTimeout(async () => {
      try {
        const r = await api.contacts(q);
        if (active) setResults(r);
      } catch {
        /* ignore */
      }
    }, 200);
    return () => {
      active = false;
      clearTimeout(t);
    };
  }, [query]);

  const filteredConversations = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return conversations;
    return conversations.filter(
      (c) =>
        (c.name?.toLowerCase().includes(q)) ||
        c.contactRaw.includes(q) ||
        c.contact.includes(q)
    );
  }, [conversations, query]);

  const showingSearch = query.trim().length > 0;

  return (
    <div className="contact-list">
      <div className="search-bar">
        <input
          type="search"
          placeholder="Search contacts or start a new chat"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
      </div>

      <div className="contact-list-scroll">
        {showingSearch
          ? results.map((c) => (
              <ContactRow
                key={c.tel}
                name={c.name}
                subtitle={c.rawTel || c.tel}
                unread={0}
                active={selectedContact === c.tel}
                onClick={() => void selectContact(c.tel)}
              />
            ))
          : filteredConversations.map((c) => (
              <ContactRow
                key={c.contact}
                name={c.name ?? c.contactRaw}
                subtitle={c.lastMessage.message}
                ts={c.lastMessage.ts}
                unread={c.unread}
                active={selectedContact === c.contact}
                onClick={() => void selectContact(c.contact)}
              />
            ))}

        {showingSearch && results.length === 0 && (
          <div className="empty-hint">
            No contact matches “{query}”. Enter a phone number to start a new chat.
          </div>
        )}
        {!showingSearch && conversations.length === 0 && (
          <div className="empty-hint">No conversations yet. Search a contact to start one.</div>
        )}
      </div>
    </div>
  );
}

function ContactRow({
  name,
  subtitle,
  ts,
  unread,
  active,
  onClick,
}: {
  name: string;
  subtitle: string;
  ts?: number;
  unread: number;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button className={`contact-row${active ? ' active' : ''}`} onClick={onClick}>
      <Avatar name={name} />
      <div className="contact-row-main">
        <div className="contact-row-top">
          <span className="contact-name">{name}</span>
          {ts ? <span className="contact-time">{formatTime(ts)}</span> : null}
        </div>
        <div className="contact-row-bottom">
          <span className="contact-preview">{subtitle}</span>
          {unread > 0 ? <span className="unread-badge">{unread}</span> : null}
        </div>
      </div>
    </button>
  );
}
