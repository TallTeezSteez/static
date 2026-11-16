// The browser's side of the API: small typed wrappers around fetch.
import type { Pick, Settings } from '@/lib/types';
export type { Pick, Settings, Topic, Show, TimeBucket } from '@/lib/types';
export type { Home } from '@/lib/picks';
export type { Library } from '@/lib/events';
export type { LiveData, LiveItem, ShowSlot } from '@/lib/live';
export type { Game, NflData } from '@/lib/nfl';
export type { Edition, Article, FeedRow } from '@/lib/paper';

export class ApiError extends Error {
  status: number;
  constructor(status: number, message: string) { super(message); this.status = status; }
}

export async function api<T = any>(method: string, path: string, body?: unknown): Promise<T> {
  const res = await fetch(path, {
    method,
    headers: body === undefined ? undefined : { 'content-type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
    credentials: 'same-origin',
  });
  let data: any = null;
  try { data = await res.json(); } catch { /* empty body */ }
  if (!res.ok) {
    if (res.status === 401 && path !== '/api/login') window.dispatchEvent(new Event('static:signed-out'));
    throw new ApiError(res.status, data?.error || `The server answered ${res.status}.`);
  }
  return data as T;
}

export const get = <T = any>(path: string) => api<T>('GET', path);
export const post = <T = any>(path: string, body: unknown = {}) => api<T>('POST', path, body);

/** Fire-and-forget: thumbs, progress and the like must never interrupt watching. */
export function sendEvent(ev: { type: string; videoId?: string; channelId?: string; seconds?: number }): void {
  post('/api/event', ev).catch(() => undefined);
}

export type SettingsBundle = { settings: Settings; has: { youtubeKey: boolean; twitch: boolean }; sections: { id: string; name: string }[] };

export function ago(iso: string | null, now = Date.now()): string {
  if (!iso) return '';
  const mins = Math.max(0, Math.round((now - Date.parse(iso)) / 60000));
  if (mins < 60) return `${Math.max(1, mins)} min ago`;
  const hours = Math.round(mins / 60);
  if (hours < 24) return `${hours} hr ago`;
  const days = Math.round(hours / 24);
  if (days < 14) return `${days} day${days === 1 ? '' : 's'} ago`;
  if (days < 60) return `${Math.round(days / 7)} wk ago`;
  return `${Math.round(days / 30)} mo ago`;
}

export function compact(n: number | null | undefined): string {
  if (n === null || n === undefined) return '';
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(n >= 10_000_000 ? 0 : 1)}M`;
  if (n >= 1_000) return `${Math.round(n / 1_000)}K`;
  return String(n);
}

export const watchUrl = (p: Pick | { id: string }) => `https://www.youtube.com/watch?v=${p.id}`;
