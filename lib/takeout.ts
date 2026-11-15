// Reads the files in a Google Takeout YouTube export. Runs in the browser (the export never leaves
// Wyatt's computer whole; only video ids and channel counts are sent to the server).

export type WatchEntry = { videoId: string; title: string; channelId?: string; channelTitle?: string; at: string };
export type HistorySummary = {
  seen: { id: string; at: string }[];
  channels: { id: string; title: string; count: number; recent: number; last: string }[];
};

const RECENT_DAYS = 180;

export function videoIdFromUrl(url: string): string | null {
  const m =
    /[?&]v=([A-Za-z0-9_-]{11})/.exec(url) ||
    /youtu\.be\/([A-Za-z0-9_-]{11})/.exec(url) ||
    /\/shorts\/([A-Za-z0-9_-]{11})/.exec(url);
  return m ? m[1] : null;
}

export function channelIdFromUrl(url: string): string | null {
  const m = /\/channel\/(UC[A-Za-z0-9_-]{22})/.exec(url);
  return m ? m[1] : null;
}

/** Splits one CSV line, honoring quotes ("a, b" stays one cell; "" inside quotes is one quote mark). */
function splitCsvLine(line: string): string[] {
  const out: string[] = [];
  let cur = '';
  let quoted = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (quoted) {
      if (c === '"' && line[i + 1] === '"') { cur += '"'; i++; }
      else if (c === '"') quoted = false;
      else cur += c;
    } else if (c === '"') quoted = true;
    else if (c === ',') { out.push(cur); cur = ''; }
    else cur += c;
  }
  out.push(cur);
  return out;
}

/** subscriptions.csv: "Channel Id,Channel Url,Channel Title". Column order is read from the header row. */
export function parseSubscriptionsCsv(text: string): { id: string; title: string }[] {
  const lines = text.replace(/^﻿/, '').split(/\r?\n/).filter((l) => l.trim() !== '');
  if (lines.length === 0) return [];
  const header = splitCsvLine(lines[0]).map((h) => h.trim().toLowerCase());
  let idCol = header.findIndex((h) => h.includes('id'));
  let titleCol = header.findIndex((h) => h.includes('title') || h.includes('name'));
  const hasHeader = idCol >= 0;
  if (!hasHeader) { idCol = 0; titleCol = 2; }
  const out: { id: string; title: string }[] = [];
  const seen = new Set<string>();
  for (const line of lines.slice(hasHeader ? 1 : 0)) {
    const cells = splitCsvLine(line);
    const id = (cells[idCol] || '').trim();
    if (!/^UC[A-Za-z0-9_-]{22}$/.test(id) || seen.has(id)) continue;
    seen.add(id);
    out.push({ id, title: (cells[titleCol] || '').trim() });
  }
  return out;
}

export function parseWatchHistoryJson(text: string): WatchEntry[] {
  let data: unknown;
  try { data = JSON.parse(text.replace(/^﻿/, '')); } catch { return []; }
  if (!Array.isArray(data)) return [];
  const out: WatchEntry[] = [];
  for (const e of data as any[]) {
    if (!e || typeof e.titleUrl !== 'string') continue;
    if (Array.isArray(e.details) && e.details.some((d: any) => d?.name === 'From Google Ads')) continue;
    const videoId = videoIdFromUrl(e.titleUrl);
    if (!videoId) continue;
    const sub = Array.isArray(e.subtitles) ? e.subtitles[0] : undefined;
    const at = typeof e.time === 'string' && !Number.isNaN(Date.parse(e.time)) ? new Date(e.time).toISOString() : '';
    if (!at) continue;
    const entry: WatchEntry = { videoId, title: String(e.title || '').replace(/^Watched\s+/, ''), at };
    const channelId = sub?.url ? channelIdFromUrl(String(sub.url)) : null;
    if (channelId) { entry.channelId = channelId; entry.channelTitle = String(sub.name || ''); }
    out.push(entry);
  }
  return out;
}

function decodeEntities(s: string): string {
  return s
    .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n)))
    .replace(/&#x([0-9a-f]+);/gi, (_, n) => String.fromCodePoint(parseInt(n, 16)))
    .replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>')
    .replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&');
}

/** "Nov 1, 2026, 7:03:04 PM MST" -> ISO. The zone letters are dropped; a day off either way doesn't matter here. */
function parseTakeoutDate(s: string): string {
  const cleaned = decodeEntities(s).replace(/[  ]/g, ' ').trim().replace(/\s+[A-Z]{2,5}$/, '');
  const t = Date.parse(cleaned);
  return Number.isNaN(t) ? '' : new Date(t).toISOString();
}

/** The same history when it was exported as HTML (the default if the format step is skipped). */
export function parseWatchHistoryHtml(html: string): WatchEntry[] {
  const out: WatchEntry[] = [];
  const blocks = html.split(/<div class="outer-cell/);
  const re = /Watched(?:&nbsp;|\s)*<a href="([^"]+)">([\s\S]*?)<\/a>(?:<br\s*\/?>\s*<a href="([^"]+)">([\s\S]*?)<\/a>)?<br\s*\/?>\s*([^<]+)/;
  for (const block of blocks) {
    if (block.includes('From Google Ads')) continue;
    const m = re.exec(block);
    if (!m) continue;
    const videoId = videoIdFromUrl(decodeEntities(m[1]));
    const at = parseTakeoutDate(m[5]);
    if (!videoId || !at) continue;
    const entry: WatchEntry = { videoId, title: decodeEntities(m[2]).trim(), at };
    const channelId = m[3] ? channelIdFromUrl(decodeEntities(m[3])) : null;
    if (channelId) { entry.channelId = channelId; entry.channelTitle = decodeEntities(m[4] || '').trim(); }
    out.push(entry);
  }
  return out;
}

/** Boils the history down to what the app keeps: which videos were seen, and how much each channel gets watched. */
export function summarizeHistory(entries: WatchEntry[], now: Date): HistorySummary {
  const seen = new Map<string, string>();
  const channels = new Map<string, { id: string; title: string; count: number; recent: number; last: string }>();
  const recentCutoff = now.getTime() - RECENT_DAYS * 86400_000;
  for (const e of entries) {
    const prev = seen.get(e.videoId);
    const firstTimeForVideo = prev === undefined;
    if (firstTimeForVideo || e.at > prev) seen.set(e.videoId, e.at);
    if (!e.channelId) continue;
    let c = channels.get(e.channelId);
    if (!c) { c = { id: e.channelId, title: e.channelTitle || '', count: 0, recent: 0, last: e.at }; channels.set(e.channelId, c); }
    c.count += 1;
    if (Date.parse(e.at) >= recentCutoff) c.recent += 1;
    if (e.at > c.last) { c.last = e.at; if (e.channelTitle) c.title = e.channelTitle; }
  }
  return {
    seen: [...seen].map(([id, at]) => ({ id, at })),
    channels: [...channels.values()].sort((a, b) => b.count - a.count),
  };
}
