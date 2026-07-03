import { config } from '../config.js';
import type { Did } from '../types.js';

const API_BASE = 'https://voip.ms/api/v1/rest.php';

export class VoipMsError extends Error {
  code: string;
  constructor(code: string) {
    super(`voip.ms API error: ${code}`);
    this.code = code;
  }
}

interface SmsRow {
  id: string;
  date: string;
  type: string; // '0' sent, '1' received
  did: string;
  contact: string;
  message: string;
  carrier_status?: string;
  media?: string[];
}

export interface NormalizedSms {
  id: string;
  date: string;
  ts: number;
  type: 0 | 1;
  did: string;
  contact: string;
  contactRaw: string;
  message: string;
  carrierStatus: string;
}

async function call(method: string, params: Record<string, string | number | undefined> = {}) {
  if (!config.voipms.username || !config.voipms.password) {
    throw new VoipMsError('missing_credentials');
  }
  const url = new URL(API_BASE);
  url.searchParams.set('api_username', config.voipms.username);
  url.searchParams.set('api_password', config.voipms.password);
  url.searchParams.set('method', method);
  url.searchParams.set('content_type', 'json');
  for (const [k, v] of Object.entries(params)) {
    if (v !== undefined && v !== null && v !== '') url.searchParams.set(k, String(v));
  }
  const res = await fetch(url);
  let data: Record<string, unknown>;
  try {
    data = (await res.json()) as Record<string, unknown>;
  } catch {
    throw new VoipMsError(`http_${res.status}`);
  }
  if (data.status !== 'success') {
    throw new VoipMsError(String(data.status ?? 'unknown'));
  }
  return data;
}

/** voip.ms URL-encodes message bodies with '+' meaning space. */
function decodeMessage(raw: string): string {
  try {
    return decodeURIComponent(raw.replace(/\+/g, ' '));
  } catch {
    return raw;
  }
}

export function parseVoipDate(date: string): number {
  // 'YYYY-MM-DD HH:MM:SS' -> epoch ms (treated as local)
  const iso = date.replace(' ', 'T');
  const t = new Date(iso).getTime();
  return Number.isFinite(t) ? t : Date.now();
}

function normalize(row: SmsRow): NormalizedSms {
  return {
    id: String(row.id),
    date: row.date,
    ts: parseVoipDate(row.date),
    type: String(row.type) === '1' ? 1 : 0,
    did: row.did,
    contact: row.contact,
    contactRaw: row.contact,
    message: decodeMessage(row.message ?? ''),
    carrierStatus: row.carrier_status ?? '',
  };
}

export async function getDIDsInfo(): Promise<Did[]> {
  const data = await call('getDIDsInfo');
  const dids = (data.dids as Array<Record<string, string>> | undefined) ?? [];
  const all = dids
    .filter((d) => String(d.sms_available) === '1')
    .map((d) => ({ did: d.did, description: d.description ?? '' }));

  if (config.voipms.dids.length > 0) {
    const wanted = new Set(config.voipms.dids);
    return all.filter((d) => wanted.has(d.did));
  }
  return all;
}

export interface GetSmsParams {
  did?: string;
  from?: string; // YYYY-MM-DD
  to?: string;
  type?: 0 | 1;
  limit?: number;
  contact?: string;
}

export async function getSMS(params: GetSmsParams): Promise<NormalizedSms[]> {
  let data: Record<string, unknown>;
  try {
    data = await call('getSMS', {
      did: params.did,
      from: params.from,
      to: params.to,
      type: params.type,
      contact: params.contact,
      limit: params.limit,
      all_messages: 0,
    });
  } catch (e) {
    // 'no_sms' just means no messages matched the filter — not an error.
    if (e instanceof VoipMsError && e.code === 'no_sms') return [];
    throw e;
  }
  const rows = (data.sms as SmsRow[] | undefined) ?? [];
  return rows.map(normalize);
}

export async function sendSMS(did: string, dst: string, message: string): Promise<string> {
  const data = await call('sendSMS', { did, dst, message });
  return String((data as { sms?: string }).sms ?? '');
}

export async function setSmsCallback(
  did: string,
  callbackUrl: string,
  retry = true
): Promise<void> {
  await call('setSMS', {
    did,
    enable: 1,
    url_callback_enable: 1,
    url_callback: callbackUrl,
    url_callback_retry: retry ? 1 : 0,
  });
}
