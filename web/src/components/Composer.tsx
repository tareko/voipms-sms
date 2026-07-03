import { useState } from 'react';
import { useStore } from '../store';

export function Composer() {
  const selectedContact = useStore((s) => s.selectedContact);
  const sendMessage = useStore((s) => s.sendMessage);
  const [text, setText] = useState('');
  const [sending, setSending] = useState(false);

  const trimmed = text.trim();
  const overLimit = text.length > 160;

  async function submit() {
    if (!trimmed || overLimit || sending) return;
    setSending(true);
    try {
      await sendMessage(trimmed);
      setText('');
    } finally {
      setSending(false);
    }
  }

  if (!selectedContact) return null;

  return (
    <div className="composer">
      <textarea
        rows={1}
        placeholder="Type a message…"
        value={text}
        onChange={(e) => setText(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter' && !e.shiftKey) {
            e.preventDefault();
            void submit();
          }
        }}
      />
      <div className="composer-meta">
        <span className={`counter${overLimit ? ' over' : ''}`}>{text.length}/160</span>
        <button
          className="send-btn"
          disabled={!trimmed || overLimit || sending}
          onClick={() => void submit()}
        >
          {sending ? '…' : 'Send'}
        </button>
      </div>
    </div>
  );
}
