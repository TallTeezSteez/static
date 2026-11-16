import type { Db, Deps, Pick, Settings, TimeBucket } from './types';
import { loadSettings } from './settings';
import { pickSet, scoreVideo, type Candidate, type Scored } from './score';
import { MIN_SECONDS, isJunk } from './quality';

export { MIN_SECONDS };
const SHOWN_LIMIT = 5; // shown this many times without a click: stop offering it (unless the pool runs dry)

const TIME_RANGES: Record<TimeBucket, [number, number]> = {
  short: [10 * 60, 30 * 60],
  hour: [30 * 60, 80 * 60],
  long: [80 * 60, Infinity],
};

export type PickQuery = { shelf?: string; time?: TimeBucket; n?: number; exclude?: string[]; count?: boolean };

/** Every video that may be offered at all: long enough, not seen, not turned down, channel not hidden, not junk. */
export async function loadCandidates(db: Db, blockWords: string[]): Promise<Candidate[]> {
  const r = await db.query<any>(
    `select v.id, v.title, v.channel_id, v.channel_title, v.duration_s, v.published_at, v.views, v.thumb, v.embeddable, v.topics,
            v.made_for_kids, v.lang,
            coalesce(c.subscribed, false) as subscribed, coalesce(c.watch_count, 0) as watch_count,
            coalesce(c.recent_count, 0) as recent_count, coalesce(c.rating, 0) as rating,
            coalesce(s.shown, 0) as shown, coalesce(s.vote, 0) as vote, coalesce(s.progress_s, 0) as progress_s,
            coalesce(s.later, false) as later
     from videos v
     left join channels c on c.id = v.channel_id
     left join vstate s on s.video_id = v.id
     where v.duration_s >= ${MIN_SECONDS} and v.live_state = 'none'
       and not exists (select 1 from seen where seen.video_id = v.id)
       and coalesce(s.skipped, false) = false and coalesce(s.vote, 0) >= 0
       and coalesce(c.hidden, false) = false
     order by v.published_at desc nulls last
     limit 6000`,
  );
  return r.rows
    .filter((x) => !isJunk({ title: x.title, channelTitle: x.channel_title, madeForKids: x.made_for_kids, lang: x.lang }, blockWords))
    .map(rowToCandidate);
}

export function rowToCandidate(x: any): Candidate {
  return {
    id: x.id, title: x.title, channelId: x.channel_id, channelTitle: x.channel_title, durationS: Number(x.duration_s),
    publishedAt: x.published_at ? new Date(x.published_at).toISOString() : null, views: Number(x.views), thumb: x.thumb,
    embeddable: x.embeddable, topics: x.topics || [], subscribed: x.subscribed, watchCount: Number(x.watch_count),
    recentCount: Number(x.recent_count), rating: Number(x.rating), shown: Number(x.shown), vote: Number(x.vote),
    progressS: Number(x.progress_s), later: x.later,
  };
}

export function toPick(s: Scored): Pick {
  return {
    id: s.id, title: s.title, channelId: s.channelId, channelTitle: s.channelTitle, durationS: s.durationS,
    publishedAt: s.publishedAt, views: s.views, thumb: s.thumb, embeddable: s.embeddable, topics: s.topics,
    isNew: s.isNew, reason: s.reason, progressS: s.progressS, later: s.later,
  };
}

function fitsShelf(c: Candidate, shelf: string | undefined, settings: Settings): boolean {
  if (!shelf) return true;
  if (shelf === 'regulars') return c.subscribed || c.watchCount > 0 || c.rating > 0;
  const topic = settings.topics.find((t) => t.id === shelf);
  if (!topic) return false;
  return c.topics.includes(shelf) && c.durationS >= topic.minMinutes * 60;
}

/** Chooses from candidates already in memory. Returns fewer than asked, with exhausted=true, when the pool runs dry. */
export function selectPicks(all: Candidate[], q: PickQuery, settings: Settings, now: Date, rng: () => number): { picks: Pick[]; exhausted: boolean } {
  const n = Math.min(60, Math.max(1, q.n ?? 6));
  const exclude = new Set(q.exclude || []);
  const range = q.time ? TIME_RANGES[q.time] : null;
  const pool = all.filter((c) =>
    !exclude.has(c.id) && fitsShelf(c, q.shelf, settings) && (!range || (c.durationS >= range[0] && c.durationS < range[1])));
  // A dozen or fewer: one per channel and a spread of topics. A long list: let good channels show up two or three times.
  const big = n > 12;
  const opts = {
    n, mixNew: q.shelf === 'regulars' ? 0 : settings.mixNew, rng,
    maxPerTopic: q.shelf ? undefined : big ? Math.ceil(n / 3) : 3,
    maxPerChannel: big ? (q.shelf ? 2 : 3) : 1,
  };

  let chosen = pickSet(pool.filter((c) => c.shown < SHOWN_LIMIT).map((c) => scoreVideo(c, now)), opts);
  if (chosen.length < n) chosen = pickSet(pool.map((c) => scoreVideo(c, now)), opts); // dry: bring back the passed-over ones
  return { picks: chosen.map(toPick), exhausted: chosen.length < n };
}

async function markShown(db: Db, ids: string[], now: Date): Promise<void> {
  if (ids.length === 0) return;
  await db.query(
    `insert into vstate (video_id, shown, last_shown, updated_at) select unnest($1::text[]), 1, $2, $2
     on conflict (video_id) do update set shown = vstate.shown + 1, last_shown = $2`,
    [ids, now],
  );
}

export async function getPicks(deps: Deps, q: PickQuery): Promise<{ picks: Pick[]; exhausted: boolean }> {
  const settings = await loadSettings(deps.db);
  const result = selectPicks(await loadCandidates(deps.db, settings.blockWords), q, settings, deps.now(), deps.rng);
  if (q.count !== false) await markShown(deps.db, result.picks.map((p) => p.id), deps.now());
  return result;
}

export type Home = {
  tonight: Pick[];
  shelves: { id: string; name: string; picks: Pick[] }[];
  counts: { catalog: number; channels: number; seen: number };
  lastGather: string | null;
  hasKey: boolean;
};

export const TONIGHT_COUNT = 12;
export const SHELF_COUNT = 20;

/** The whole Watch screen in one go: tonight's dozen, then a row of up to 20 per shelf that has anything in it. */
export async function getHome(deps: Deps, hasKey: boolean): Promise<Home> {
  const { db } = deps;
  const settings = await loadSettings(db);
  const all = await loadCandidates(db, settings.blockWords);
  const now = deps.now();
  const tonight = selectPicks(all, { n: TONIGHT_COUNT }, settings, now, deps.rng).picks;
  await markShown(db, tonight.map((p) => p.id), now);
  const onScreen = new Set(tonight.map((p) => p.id));
  const shelves: Home['shelves'] = [];
  const defs = [...settings.topics.map((t) => ({ id: t.id, name: t.name })), { id: 'regulars', name: 'Your regulars' }];
  for (const def of defs) {
    const picks = selectPicks(all, { shelf: def.id, n: SHELF_COUNT, exclude: [...onScreen] }, settings, now, deps.rng).picks;
    if (picks.length === 0) continue;
    for (const p of picks) onScreen.add(p.id);
    shelves.push({ ...def, picks });
  }
  const counts = await db.query<any>(
    `select (select count(*) from videos) as catalog, (select count(*) from channels where not hidden) as channels,
            (select count(*) from seen) as seen`);
  const last = await db.query<any>(`select max(finished_at) as at from gather_log where ok`);
  return {
    tonight, shelves,
    counts: { catalog: Number(counts.rows[0].catalog), channels: Number(counts.rows[0].channels), seen: Number(counts.rows[0].seen) },
    lastGather: last.rows[0]?.at ? new Date(last.rows[0].at).toISOString() : null,
    hasKey,
  };
}
