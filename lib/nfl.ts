import type { Deps } from './types';
import { kvGet, kvSet } from './db';

export type Side = { abbr: string; name: string; score: number; logo: string; record: string };
export type Game = {
  id: string;
  state: 'pre' | 'in' | 'post';
  detail: string; // "Q3 4:12", "Final", "Sun 2:25 PM"
  clock: string;
  period: number;
  start: string;
  home: Side;
  away: Side;
  possession: 'home' | 'away' | null;
  redZone: boolean;
  downDistance: string;
  lastPlay: string;
  broadcast: string;
};

export type NflData = { ok: boolean; games: Game[]; fetchedAt: string; week?: string };

const ESPN = 'https://site.api.espn.com/apis/site/v2/sports/football/nfl/scoreboard';
const CACHE_MS = 20_000;

function side(c: any): Side {
  const t = c?.team || {};
  return {
    abbr: String(t.abbreviation || '?'),
    name: String(t.shortDisplayName || t.displayName || t.name || '?'),
    score: Number(c?.score || 0),
    logo: typeof t.logo === 'string' && t.logo.startsWith('https://') ? t.logo : '',
    record: String(c?.records?.[0]?.summary || ''),
  };
}

/** ESPN's scoreboard, boiled down. Anything that doesn't look like a game is skipped; garbage in gives []. */
export function normalizeScoreboard(json: any): Game[] {
  const events = Array.isArray(json?.events) ? json.events : [];
  const games: Game[] = [];
  for (const e of events) {
    const comp = e?.competitions?.[0];
    const competitors = Array.isArray(comp?.competitors) ? comp.competitors : [];
    const home = competitors.find((c: any) => c?.homeAway === 'home');
    const away = competitors.find((c: any) => c?.homeAway === 'away');
    if (!home || !away) continue;
    const status = comp.status || e.status || {};
    const rawState = status?.type?.state;
    const state: Game['state'] = rawState === 'in' || rawState === 'post' ? rawState : 'pre';
    const sit = comp.situation || {};
    const possession = !sit.possession ? null : String(sit.possession) === String(home.team?.id || home.id) ? 'home' : String(sit.possession) === String(away.team?.id || away.id) ? 'away' : null;
    games.push({
      id: String(e.id),
      state,
      detail: String(status?.type?.shortDetail || status?.type?.detail || ''),
      clock: String(status?.displayClock || ''),
      period: Number(status?.period || 0),
      start: String(e.date || comp.date || ''),
      home: side(home),
      away: side(away),
      possession: state === 'in' ? possession : null,
      redZone: state === 'in' && sit.isRedZone === true,
      downDistance: state === 'in' ? String(sit.downDistanceText || sit.shortDownDistanceText || '') : '',
      lastPlay: state === 'in' ? String(sit.lastPlay?.text || '') : '',
      broadcast: String(comp.broadcasts?.[0]?.names?.[0] || comp.broadcast || ''),
    });
  }
  const order = { in: 0, pre: 1, post: 2 } as const;
  return games.sort((a, b) => Number(b.redZone) - Number(a.redZone) || order[a.state] - order[b.state] || a.start.localeCompare(b.start));
}

/** Live scores. When ESPN is down or changes shape, the board gets ok=false and an empty list, never an error. */
export async function getNfl(deps: Deps): Promise<NflData> {
  const now = deps.now();
  const cached = await kvGet<NflData>(deps.db, 'nfl:cache');
  if (cached && now.getTime() - Date.parse(cached.fetchedAt) < CACHE_MS) return cached;
  let data: NflData;
  try {
    const res = await deps.fetch(ESPN, { signal: AbortSignal.timeout(8000) });
    if (!res.ok) throw new Error(`ESPN answered ${res.status}`);
    const json: any = await res.json();
    if (!Array.isArray(json?.events)) throw new Error('unexpected shape');
    data = { ok: true, games: normalizeScoreboard(json), fetchedAt: now.toISOString(), week: json?.week?.number ? `Week ${json.week.number}` : undefined };
  } catch {
    return { ok: false, games: [], fetchedAt: now.toISOString() }; // not cached: try again on the next poll
  }
  await kvSet(deps.db, 'nfl:cache', data);
  return data;
}
