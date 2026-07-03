import type { Message } from './types.js';

/**
 * iMessage tapback reactions arrive at plain-SMS endpoints (like voip.ms) as
 * fallback text. We parse those into emoji reactions and (when sending) emit
 * the same format — Google Messages interprets it as a native reaction; iOS
 * shows it as text (an unavoidable SMS limitation).
 */

/** verb (as it appears in the text) -> emoji */
export const VERB_TO_EMOJI: Record<string, string> = {
  loved: '❤️',
  liked: '👍',
  disliked: '👎',
  'laughed at': '😂',
  emphasized: '‼️',
  questioned: '❓',
};

/** emoji -> verb for sending */
export const EMOJI_TO_VERB: Record<string, string> = {
  '❤️': 'Loved',
  '👍': 'Liked',
  '👎': 'Disliked',
  '😂': 'Laughed at',
  '‼️': 'Emphasized',
  '❓': 'Questioned',
};

const VERBS = Object.keys(VERB_TO_EMOJI)
  .sort((a, b) => b.length - a.length)
  .join('|');

// "Liked «msg»", "Loved "msg"", "Laughed at msg", with optional quotes/«»/-.
const RE = new RegExp(`^(?:(${VERBS}))\\s*(?:[«""''\\-]\\s*)?([\\s\\S]+?)(?:\\s*[»""''])?$`, 'i');

export interface DetectedReaction {
  emoji: string;
  quoted: string; // the message text that was reacted to
}

/** Detect an iMessage-style reaction fallback message. */
export function detectReaction(text: string): DetectedReaction | null {
  if (!text) return null;
  const t = text.trim();
  if (t.length > 200) return null; // reactions are short; avoid false positives on long bodies
  const m = t.match(RE);
  if (!m) return null;
  const verb = m[1].toLowerCase();
  const emoji = VERB_TO_EMOJI[verb];
  if (!emoji) return null;
  const quoted = (m[2] ?? '').trim();
  if (quoted.length < 1) return null;
  return { emoji, quoted };
}

/** Build the fallback text to send a reaction to a given message body. */
export function buildReactionText(emoji: string, targetText: string): string | null {
  const verb = EMOJI_TO_VERB[emoji];
  if (!verb) return null;
  const max = 150 - (verb.length + 4); // reserve "Verb «»"
  let body = targetText.replace(/\s+/g, ' ').trim();
  if (body.length > max) body = body.slice(0, max - 1) + '…';
  return `${verb} «${body}»`;
}

function norm(s: string): string {
  return s.replace(/\s+/g, ' ').trim().toLowerCase();
}

/**
 * Find the best message to attach a reaction to, given the quoted text.
 * Scores by exact > prefix > substring; most recent wins ties. iOS truncates
 * long messages, so prefix/substring matches are essential.
 */
export function matchTarget(messages: Message[], quoted: string): Message | null {
  const q = norm(quoted);
  if (!q) return null;
  let best: { msg: Message; score: number } | null = null;
  // messages are oldest-first; iterate so later (more recent) entries win ties.
  for (const msg of messages) {
    const m = norm(msg.message);
    if (!m) continue;
    let score = 0;
    if (m === q) score = 100;
    else if (m.startsWith(q) || q.startsWith(m)) score = 60 + Math.min(m.length, q.length);
    else if (m.includes(q) || q.includes(m)) score = 30 + Math.min(m.length, q.length);
    if (score > 0 && (!best || score >= best.score)) best = { msg, score };
  }
  return best?.msg ?? null;
}
