import { useEffect, useRef, useState } from 'react';
import { useStore } from '../store';
import { EmojiPicker } from './EmojiPicker';
import { searchEmojis } from '../emoji';

const SMS_LIMIT = 160;
const MMS_LIMIT = 2048;
const MAX_BYTES = 1_100_000;

interface Attachment {
  blob: Blob;
  contentType: string;
  previewUrl: string;
  name: string;
  size: number;
}

interface EmojiToken {
  start: number;
  query: string;
}

function loadImage(file: File): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = reject;
    img.src = url;
  });
}

function canvasToBlob(canvas: HTMLCanvasElement, type: string, quality?: number): Promise<Blob | null> {
  return new Promise((resolve) => canvas.toBlob(resolve, type, quality));
}

async function prepareImage(file: File): Promise<{ blob: Blob; contentType: string }> {
  if (file.size <= MAX_BYTES && (file.type === 'image/jpeg' || file.type === 'image/png')) {
    return { blob: file, contentType: file.type };
  }
  const img = await loadImage(file);
  const maxDim = 1600;
  const scale = Math.min(1, maxDim / Math.max(img.naturalWidth, img.naturalHeight));
  const w = Math.max(1, Math.round(img.naturalWidth * scale));
  const h = Math.max(1, Math.round(img.naturalHeight * scale));
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('cannot get canvas context');
  ctx.drawImage(img, 0, 0, w, h);
  for (const q of [0.85, 0.75, 0.6, 0.45, 0.3]) {
    const blob = await canvasToBlob(canvas, 'image/jpeg', q);
    if (blob && blob.size <= MAX_BYTES) return { blob, contentType: 'image/jpeg' };
  }
  const blob = await canvasToBlob(canvas, 'image/png');
  if (blob) return { blob, contentType: 'image/png' };
  throw new Error('could not encode image');
}

/** Find a `:shortcod` token immediately before the caret. */
function tokenAt(text: string, caret: number): EmojiToken | null {
  const before = text.slice(0, caret);
  const m = before.match(/(^|\s):([a-z0-9_+-]{1,20})$/i);
  if (!m || m.index === undefined) return null;
  return { start: m.index + m[1].length, query: m[2].toLowerCase() };
}

export function Composer() {
  const selectedContact = useStore((s) => s.selectedContact);
  const sendMessage = useStore((s) => s.sendMessage);
  const sendMedia = useStore((s) => s.sendMedia);
  const [text, setText] = useState('');
  const [attachment, setAttachment] = useState<Attachment | null>(null);
  const [prepError, setPrepError] = useState<string | null>(null);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [token, setToken] = useState<EmojiToken | null>(null);
  const [selIdx, setSelIdx] = useState(0);
  const fileRef = useRef<HTMLInputElement>(null);
  const taRef = useRef<HTMLTextAreaElement>(null);

  const suggestions = token ? searchEmojis(token.query, 8) : [];
  const showSuggest = suggestions.length > 0;

  useEffect(() => () => {
    if (attachment) URL.revokeObjectURL(attachment.previewUrl);
  }, [attachment]);

  const hasImage = Boolean(attachment);
  const mmsMode = hasImage || text.length > SMS_LIMIT;
  const limit = mmsMode ? MMS_LIMIT : SMS_LIMIT;
  const overLimit = text.length > limit;
  const trimmed = text.trim();
  const canSend = (trimmed || hasImage) && !overLimit;

  function recomputeToken(value: string) {
    const ta = taRef.current;
    const caret = ta?.selectionStart ?? value.length;
    setToken(tokenAt(value, caret));
    setSelIdx(0);
  }

  function replaceRange(start: number, end: number, insert: string) {
    const ta = taRef.current;
    const next = text.slice(0, start) + insert + text.slice(end);
    setText(next);
    const pos = start + insert.length;
    setToken(null);
    requestAnimationFrame(() => {
      if (ta) {
        ta.selectionStart = ta.selectionEnd = pos;
        ta.focus();
      }
    });
  }

  function insertAtCursor(char: string) {
    const ta = taRef.current;
    const caret = ta?.selectionStart ?? text.length;
    replaceRange(caret, caret, char);
  }

  function acceptSuggestion(idx: number) {
    const e = suggestions[idx];
    if (!e || !token) return;
    const ta = taRef.current;
    const caret = ta?.selectionStart ?? text.length;
    replaceRange(token.start, caret, e.char);
  }

  async function onPickFile(file: File | undefined) {
    setPrepError(null);
    if (!file) return;
    if (!file.type.startsWith('image/')) {
      setPrepError('Only image attachments are supported.');
      return;
    }
    try {
      const { blob, contentType } = await prepareImage(file);
      if (attachment) URL.revokeObjectURL(attachment.previewUrl);
      setAttachment({
        blob,
        contentType,
        name: file.name,
        size: blob.size,
        previewUrl: URL.createObjectURL(blob),
      });
    } catch (e) {
      setPrepError((e as Error).message || 'Could not prepare image');
    }
  }

  async function submit() {
    if (!canSend) return;
    const body = trimmed;
    if (attachment) {
      const att = attachment;
      setAttachment(null);
      setText('');
      setPrepError(null);
      await sendMedia(att.blob, att.contentType, body, att.previewUrl);
    } else {
      setText('');
      setPrepError(null);
      await sendMessage(body);
    }
  }

  function onKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (showSuggest) {
      if (e.key === 'ArrowDown') {
        e.preventDefault();
        setSelIdx((i) => (i + 1) % suggestions.length);
        return;
      }
      if (e.key === 'ArrowUp') {
        e.preventDefault();
        setSelIdx((i) => (i - 1 + suggestions.length) % suggestions.length);
        return;
      }
      if (e.key === 'Enter' || e.key === 'Tab') {
        e.preventDefault();
        acceptSuggestion(selIdx);
        return;
      }
      if (e.key === 'Escape') {
        e.preventDefault();
        setToken(null);
        return;
      }
    }
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      void submit();
    }
  }

  if (!selectedContact) return null;

  return (
    <div className="composer">
      <div className="composer-btn-col">
        <button
          className="tool-btn"
          title="Emoji"
          onClick={() => setPickerOpen((v) => !v)}
        >
          😀
        </button>
        <input
          ref={fileRef}
          type="file"
          accept="image/*"
          style={{ display: 'none' }}
          onChange={(e) => void onPickFile(e.target.files?.[0])}
        />
        <button
          className="tool-btn"
          title="Attach image"
          onClick={() => fileRef.current?.click()}
        >
          ＋
        </button>
        {pickerOpen && (
          <EmojiPicker
            onPick={(char) => {
              insertAtCursor(char);
              taRef.current?.focus();
            }}
            onClose={() => setPickerOpen(false)}
          />
        )}
      </div>

      <div className="composer-input-col">
        {showSuggest && (
          <div className="emoji-suggest">
            {suggestions.map((s, i) => (
              <button
                key={s.char + (s.shortcodes[0] ?? '')}
                className={`emoji-suggest-row${i === selIdx ? ' active' : ''}`}
                onMouseDown={(e) => {
                  e.preventDefault();
                  acceptSuggestion(i);
                }}
                onMouseEnter={() => setSelIdx(i)}
              >
                <span className="emoji-suggest-char">{s.char}</span>
                <span className="emoji-suggest-code">:{s.shortcodes[0]}</span>
              </button>
            ))}
          </div>
        )}
        {attachment && (
          <div className="attach-preview">
            <img src={attachment.previewUrl} alt={attachment.name} />
            <div className="attach-info">
              <span className="attach-name">{attachment.name}</span>
              <span className="attach-size">{Math.round(attachment.size / 1024)} KB</span>
            </div>
            <button
              className="attach-remove"
              title="Remove"
              onClick={() => {
                URL.revokeObjectURL(attachment.previewUrl);
                setAttachment(null);
              }}
            >
              ✕
            </button>
          </div>
        )}
        {prepError && <div className="attach-error">{prepError}</div>}
        <textarea
          ref={taRef}
          rows={1}
          placeholder={hasImage ? 'Add a caption (optional)…' : 'Type a message…'}
          value={text}
          onChange={(e) => {
            setText(e.target.value);
            recomputeToken(e.target.value);
          }}
          onKeyUp={() => recomputeToken(text)}
          onClick={() => recomputeToken(text)}
          onBlur={() => setTimeout(() => setToken(null), 150)}
          onKeyDown={onKeyDown}
        />
      </div>

      <div className="composer-meta">
        <span className={`counter${overLimit ? ' over' : ''}`}>
          {text.length}/{limit}
          {mmsMode && <span className="mms-tag">MMS</span>}
        </span>
        <button className="send-btn" disabled={!canSend} onClick={() => void submit()}>
          Send
        </button>
      </div>
    </div>
  );
}
