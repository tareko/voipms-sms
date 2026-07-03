import { useEffect, useRef, useState } from 'react';
import { useStore } from '../store';

const SMS_LIMIT = 160;
const MMS_LIMIT = 2048;
const MAX_BYTES = 1_100_000; // stay under voip.ms ~1.2MB/file cap

interface Attachment {
  blob: Blob;
  contentType: string;
  previewUrl: string;
  name: string;
  size: number;
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

/** Downscale + recompress an image so it fits under MAX_BYTES. */
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

export function Composer() {
  const selectedContact = useStore((s) => s.selectedContact);
  const sendMessage = useStore((s) => s.sendMessage);
  const sendMedia = useStore((s) => s.sendMedia);
  const [text, setText] = useState('');
  const [sending, setSending] = useState(false);
  const [attachment, setAttachment] = useState<Attachment | null>(null);
  const [prepError, setPrepError] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  useEffect(() => () => {
    if (attachment) URL.revokeObjectURL(attachment.previewUrl);
  }, [attachment]);

  const hasImage = Boolean(attachment);
  const mmsMode = hasImage || text.length > SMS_LIMIT;
  const limit = mmsMode ? MMS_LIMIT : SMS_LIMIT;
  const overLimit = text.length > limit;
  const trimmed = text.trim();
  const canSend = (trimmed || hasImage) && !overLimit && !sending;

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
    setSending(true);
    try {
      if (attachment) {
        await sendMedia(attachment.blob, attachment.contentType, trimmed);
        URL.revokeObjectURL(attachment.previewUrl);
        setAttachment(null);
        setText('');
      } else {
        await sendMessage(trimmed);
        setText('');
      }
    } finally {
      setSending(false);
    }
  }

  if (!selectedContact) return null;

  return (
    <div className="composer">
      <input
        ref={fileRef}
        type="file"
        accept="image/*"
        style={{ display: 'none' }}
        onChange={(e) => void onPickFile(e.target.files?.[0])}
      />
      <button
        className="attach-btn"
        title="Attach image"
        onClick={() => fileRef.current?.click()}
        disabled={sending}
      >
        ＋
      </button>

      <div className="composer-input-col">
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
          rows={1}
          placeholder={hasImage ? 'Add a caption (optional)…' : 'Type a message…'}
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey) {
              e.preventDefault();
              void submit();
            }
          }}
        />
      </div>

      <div className="composer-meta">
        <span className={`counter${overLimit ? ' over' : ''}`}>
          {text.length}/{limit}
          {mmsMode && <span className="mms-tag">MMS</span>}
        </span>
        <button className="send-btn" disabled={!canSend} onClick={() => void submit()}>
          {sending ? '…' : 'Send'}
        </button>
      </div>
    </div>
  );
}
