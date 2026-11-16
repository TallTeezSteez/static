import type { Db, Secrets, Settings, Show, Topic } from './types';
import { kvGet, kvSet } from './db';
import { DEFAULT_TOPICS } from './topics';
import { DEFAULT_BLOCK_WORDS } from './quality';

export const DEFAULT_SHOWS: Show[] = [
  {
    id: 'mcafee', name: 'The Pat McAfee Show', platform: 'youtube', match: 'Pat McAfee',
    url: 'https://www.youtube.com/@ThePatMcAfeeShow/live', days: [1, 2, 3, 4, 5], time: '10:00', approx: true,
  },
  {
    id: 'wan', name: 'The WAN Show', platform: 'youtube', match: 'Linus Tech Tips',
    url: 'https://www.youtube.com/@LinusTechTips/live', days: [5], time: '17:30', approx: true,
  },
];

export const DEFAULT_SETTINGS: Settings = {
  mixNew: 0.5,
  theme: 'mocha',
  clean: false,
  autoplay: true,
  tz: 'America/Denver',
  location: { name: 'Salt Lake City', lat: 40.76, lon: -111.89 },
  topics: DEFAULT_TOPICS,
  shows: DEFAULT_SHOWS,
  nflLink: 'https://www.youtube.com/results?search_query=NFL+Sunday+Ticket',
  blockWords: DEFAULT_BLOCK_WORDS,
};

const str = (v: unknown, max = 200): string | null => (typeof v === 'string' ? v.slice(0, max) : null);
const strList = (v: unknown, maxItems: number, maxLen: number): string[] =>
  Array.isArray(v) ? v.map((x) => str(x, maxLen)).filter((x): x is string => !!x && x.trim() !== '').map((x) => x.trim()).slice(0, maxItems) : [];

function cleanTopic(t: any): Topic | null {
  const id = str(t?.id, 30)?.toLowerCase().replace(/[^a-z0-9]/g, '');
  const name = str(t?.name, 40)?.trim();
  if (!id || !name) return null;
  const min = Number(t.minMinutes);
  const topic: Topic = {
    id, name,
    keywords: strList(t.keywords, 40, 60),
    queries: strList(t.queries, 6, 80),
    minMinutes: Number.isFinite(min) ? Math.min(180, Math.max(3, Math.round(min))) : 8,
  };
  const cats = strList(t.categoryIds, 5, 4);
  if (cats.length) topic.categoryIds = cats;
  return topic;
}

function cleanShow(s: any): Show | null {
  const name = str(s?.name, 60)?.trim();
  const time = str(s?.time, 5);
  if (!name || !time || !/^\d{2}:\d{2}$/.test(time)) return null;
  const days = Array.isArray(s.days) ? [...new Set(s.days.map(Number).filter((d: number) => d >= 0 && d <= 6))] as number[] : [];
  return {
    id: str(s.id, 30) || name.toLowerCase().replace(/[^a-z0-9]/g, '').slice(0, 30),
    name,
    platform: s.platform === 'twitch' ? 'twitch' : 'youtube',
    match: str(s.match, 60) || name,
    url: /^https:\/\//.test(String(s.url)) ? String(s.url).slice(0, 300) : '',
    days,
    time,
    approx: !!s.approx,
  };
}

/** Keeps only known settings, with every value forced into its allowed range. */
export function mergeSettings(current: Settings, patch: any): Settings {
  const next: Settings = { ...current };
  if (!patch || typeof patch !== 'object') return next;
  if (patch.mixNew !== undefined && Number.isFinite(Number(patch.mixNew))) next.mixNew = Math.min(1, Math.max(0, Number(patch.mixNew)));
  if (str(patch.theme, 30)) next.theme = str(patch.theme, 30)!.replace(/[^a-z0-9-]/gi, '');
  if (typeof patch.clean === 'boolean') next.clean = patch.clean;
  if (typeof patch.autoplay === 'boolean') next.autoplay = patch.autoplay;
  if (str(patch.tz, 60)) next.tz = str(patch.tz, 60)!;
  if (str(patch.nflLink, 300) && /^https:\/\//.test(patch.nflLink)) next.nflLink = str(patch.nflLink, 300)!;
  if (patch.location && Number.isFinite(Number(patch.location.lat)) && Number.isFinite(Number(patch.location.lon))) {
    next.location = {
      name: str(patch.location.name, 60) || current.location.name,
      lat: Math.min(90, Math.max(-90, Number(patch.location.lat))),
      lon: Math.min(180, Math.max(-180, Number(patch.location.lon))),
    };
  }
  if (Array.isArray(patch.topics)) {
    const topics = patch.topics.map(cleanTopic).filter((t: Topic | null): t is Topic => !!t).slice(0, 20);
    if (topics.length) next.topics = topics;
  }
  if (Array.isArray(patch.blockWords)) next.blockWords = [...new Set(strList(patch.blockWords, 300, 1000).map((w) => w.toLowerCase()).filter((w) => w.length <= 60))];
  if (Array.isArray(patch.shows)) next.shows = patch.shows.map(cleanShow).filter((s: Show | null): s is Show => !!s).slice(0, 40);
  return next;
}

export async function loadSettings(db: Db): Promise<Settings> {
  const saved = await kvGet<Partial<Settings>>(db, 'settings');
  return mergeSettings(DEFAULT_SETTINGS, saved || {});
}

export async function saveSettings(db: Db, patch: unknown): Promise<Settings> {
  const next = mergeSettings(await loadSettings(db), patch);
  await kvSet(db, 'settings', next);
  return next;
}

export async function loadSecrets(db: Db): Promise<Secrets> {
  return (await kvGet<Secrets>(db, 'secrets')) || {};
}

/** Saves keys. An empty string clears a key; a missing one leaves it alone. */
export async function saveSecrets(db: Db, patch: any): Promise<Secrets> {
  const cur = await loadSecrets(db);
  const next: Secrets = { ...cur };
  for (const k of ['youtubeKey', 'twitchId', 'twitchSecret'] as const) {
    if (typeof patch?.[k] === 'string') {
      const v = patch[k].trim().slice(0, 200);
      if (v) next[k] = v;
      else delete next[k];
    }
  }
  if (next.twitchId !== cur.twitchId || next.twitchSecret !== cur.twitchSecret) {
    delete next.twitchToken;
    delete next.twitchTokenExpires;
  }
  await kvSet(db, 'secrets', next);
  return next;
}

export function secretFlags(s: Secrets): { youtubeKey: boolean; twitch: boolean } {
  return { youtubeKey: !!s.youtubeKey, twitch: !!(s.twitchId && s.twitchSecret) };
}
