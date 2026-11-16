import type { Db, Deps, Topic, Video } from './types';
import { jsonParam, kvGet, kvSet } from './db';
import { loadSecrets, loadSettings } from './settings';
import { classify } from './topics';
import { QuotaError, YouTube } from './youtube';

export const UPLOADS_STALE_MS = 3 * 3600_000;
export const SEARCH_STALE_MS = 20 * 3600_000;
export const MAX_SEARCHES_PER_DAY = 24;
const MAX_CHANNELS = 400;
const CHANNEL_BATCH = 20;
const SEARCH_WINDOW_DAYS = 21;

export type GatherResult = {
  uploads?: { channels: number; videos: number };
  search?: { queries: number; videos: number };
  skipped: string[];
  error?: string;
};

type Stamp = { at: string };

/** Saves videos into the catalog. Topics are added to, never taken away, so a search topic sticks. */
export async function upsertVideos(db: Db, videos: Video[], topics: Topic[], source: 'uploads' | 'search', extraTopic?: Map<string, string>): Promise<void> {
  for (let i = 0; i < videos.length; i += 300) {
    const rows = videos.slice(i, i + 300).map((v) => {
      const t = new Set(classify(v, topics));
      const extra = extraTopic?.get(v.id);
      if (extra) t.add(extra);
      return {
        id: v.id, channel_id: v.channelId, channel_title: v.channelTitle, title: v.title, description: v.description,
        published_at: v.publishedAt, duration_s: v.durationS, views: v.views, category_id: v.categoryId, tags: v.tags,
        embeddable: v.embeddable, live_state: v.liveState, scheduled_start: v.scheduledStart, topics: [...t], source, thumb: v.thumb,
      };
    });
    await db.query(
      `insert into videos (id, channel_id, channel_title, title, description, published_at, duration_s, views, category_id, tags,
                           embeddable, live_state, scheduled_start, topics, source, thumb, fetched_at)
       select x.id, x.channel_id, x.channel_title, x.title, x.description, x.published_at, x.duration_s, x.views, x.category_id, x.tags,
              x.embeddable, x.live_state, x.scheduled_start, x.topics, x.source, x.thumb, now()
       from jsonb_to_recordset($1::jsonb) as x(id text, channel_id text, channel_title text, title text, description text,
              published_at timestamptz, duration_s int, views bigint, category_id text, tags text, embeddable boolean,
              live_state text, scheduled_start timestamptz, topics text[], source text, thumb text)
       on conflict (id) do update set
         title = excluded.title, channel_title = excluded.channel_title, description = excluded.description,
         duration_s = excluded.duration_s, views = excluded.views, embeddable = excluded.embeddable,
         live_state = excluded.live_state, scheduled_start = excluded.scheduled_start, thumb = excluded.thumb,
         topics = (select coalesce(array_agg(distinct t), '{}') from unnest(videos.topics || excluded.topics) as t),
         fetched_at = now()`,
      [jsonParam(rows)],
    );
  }
}

async function unknownIds(db: Db, ids: string[]): Promise<string[]> {
  if (ids.length === 0) return [];
  const r = await db.query<{ id: string }>(`select id from videos where id = any($1) and live_state = 'none'`, [ids]);
  const known = new Set(r.rows.map((x) => x.id));
  return ids.filter((id) => !known.has(id));
}

async function gatherUploads(deps: Deps, yt: YouTube, topics: Topic[]): Promise<{ channels: number; videos: number; error?: string }> {
  const { db } = deps;
  const chans = await db.query<{ id: string }>(
    `select id from channels
     where not hidden and rating > -3
       and (subscribed or watch_count > 0 or rating > 0 or source in ('manual', 'default'))
     order by subscribed desc, recent_count desc, rating desc, watch_count desc, id
     limit ${MAX_CHANNELS}`,
  );
  const ids: string[] = [];
  let done = 0;
  let error: string | undefined;
  for (let i = 0; i < chans.rows.length && !error; i += CHANNEL_BATCH) {
    const batch = chans.rows.slice(i, i + CHANNEL_BATCH);
    const results = await Promise.allSettled(batch.map((c) => yt.channelUploads(c.id)));
    const ok: string[] = [];
    results.forEach((r, j) => {
      if (r.status === 'fulfilled') { ids.push(...r.value); ok.push(batch[j].id); }
      else if (r.reason instanceof QuotaError) error = r.reason.message;
      // any other failure is one channel's problem: skip it this round
    });
    done += ok.length;
    if (ok.length) await db.query('update channels set uploads_checked_at = $2 where id = any($1)', [ok, deps.now()]);
  }
  let saved = 0;
  try {
    const fresh = await unknownIds(db, [...new Set(ids)]);
    for (let i = 0; i < fresh.length; i += 50) {
      const videos = await yt.videoDetails(fresh.slice(i, i + 50));
      await upsertVideos(db, videos, topics, 'uploads');
      saved += videos.length;
    }
  } catch (e) {
    if (!(e instanceof QuotaError)) throw e;
    error = e.message;
  }
  await db.query(`update channels c set live_prone = true where not live_prone and exists
                  (select 1 from videos v where v.channel_id = c.id and v.live_state <> 'none')`);
  return { channels: done, videos: saved, error };
}

/** Today's search list: every topic's queries in one line, starting at a spot that moves each day. */
export function searchPlan(topics: Topic[], now: Date): { topic: Topic; q: string }[] {
  const all = topics.flatMap((topic) => topic.queries.map((q) => ({ topic, q })));
  if (all.length <= MAX_SEARCHES_PER_DAY) return all;
  const day = Math.floor(now.getTime() / 86400_000);
  const start = (day * MAX_SEARCHES_PER_DAY) % all.length;
  return Array.from({ length: MAX_SEARCHES_PER_DAY }, (_, i) => all[(start + i) % all.length]);
}

async function gatherSearch(deps: Deps, yt: YouTube, topics: Topic[]): Promise<{ queries: number; videos: number; error?: string }> {
  const { db } = deps;
  const now = deps.now();
  const after = new Date(now.getTime() - SEARCH_WINDOW_DAYS * 86400_000);
  const found = new Map<string, string>();
  let queries = 0;
  let saved = 0;
  let error: string | undefined;
  try {
    const plan = searchPlan(topics, now);
    for (let i = 0; i < plan.length; i += 4) { // four at a time keeps the whole run well inside a minute
      const chunk = plan.slice(i, i + 4);
      const results = await Promise.allSettled(chunk.map(({ topic, q }) =>
        yt.search(q, { publishedAfter: after, duration: topic.minMinutes >= 20 ? 'long' : 'medium' })));
      let failure: unknown;
      results.forEach((r, j) => {
        if (r.status === 'rejected') { failure = failure || r.reason; return; }
        queries += 1;
        for (const id of r.value) if (!found.has(id)) found.set(id, chunk[j].topic.id);
      });
      if (failure) throw failure;
    }
  } catch (e) {
    if (!(e instanceof QuotaError)) throw e;
    error = e.message;
  }
  try {
    const fresh = await unknownIds(db, [...found.keys()]);
    for (let i = 0; i < fresh.length; i += 50) {
      const videos = await yt.videoDetails(fresh.slice(i, i + 50));
      await upsertVideos(db, videos, topics, 'search', found);
      saved += videos.length;
      const chans = [...new Map(videos.map((v) => [v.channelId, v.channelTitle])).entries()].filter(([id]) => id);
      if (chans.length) {
        await db.query(
          `insert into channels (id, title, source) select x.id, x.title, 'search'
           from jsonb_to_recordset($1::jsonb) as x(id text, title text) on conflict (id) do nothing`,
          [jsonParam(chans.map(([id, title]) => ({ id, title })))],
        );
      }
    }
    // a search hit on a video already in the catalog still gets the search's topic
    const knownHits = [...found.entries()].filter(([id]) => !fresh.includes(id));
    if (knownHits.length) {
      await db.query(
        `update videos v set topics = (select coalesce(array_agg(distinct t), '{}') from unnest(v.topics || array[x.topic]) as t)
         from jsonb_to_recordset($1::jsonb) as x(id text, topic text) where v.id = x.id`,
        [jsonParam(knownHits.map(([id, topic]) => ({ id, topic })))],
      );
    }
  } catch (e) {
    if (!(e instanceof QuotaError)) throw e;
    error = e.message;
  }
  return { queries, videos: saved, error };
}

async function isStale(db: Db, key: string, maxAgeMs: number, now: Date): Promise<boolean> {
  const stamp = await kvGet<Stamp>(db, key);
  return !stamp || now.getTime() - Date.parse(stamp.at) >= maxAgeMs;
}

/** Pulls new videos into the catalog. Without `force` each kind only runs when its last run is old enough. */
export async function runGather(deps: Deps, opts: { force?: boolean; kinds?: ('uploads' | 'search')[] } = {}): Promise<GatherResult> {
  const { db } = deps;
  const kinds = opts.kinds ?? ['uploads', 'search'];
  const result: GatherResult = { skipped: [] };
  const secrets = await loadSecrets(db);
  if (!secrets.youtubeKey) return { skipped: ['no-key'] };
  const yt = new YouTube(secrets.youtubeKey, deps.fetch);
  const { topics } = await loadSettings(db);

  const jobs: ['uploads' | 'search', string, number][] = [
    ['uploads', 'gather:uploads', UPLOADS_STALE_MS],
    ['search', 'gather:search', SEARCH_STALE_MS],
  ];
  for (const [kind, key, maxAge] of jobs) {
    if (!kinds.includes(kind)) continue;
    const started = deps.now();
    if (!opts.force && !(await isStale(db, key, maxAge, started))) { result.skipped.push(`${kind}-fresh`); continue; }
    let detail: any;
    let error: string | undefined;
    try {
      if (kind === 'uploads') { const r = await gatherUploads(deps, yt, topics); result.uploads = { channels: r.channels, videos: r.videos }; detail = result.uploads; error = r.error; }
      else { const r = await gatherSearch(deps, yt, topics); result.search = { queries: r.queries, videos: r.videos }; detail = result.search; error = r.error; }
    } catch (e) {
      error = e instanceof Error ? e.message : String(e);
    }
    await kvSet(db, key, { at: started.toISOString() });
    await db.query('insert into gather_log (kind, started_at, finished_at, ok, detail) values ($1, $2, $3, $4, $5::jsonb)',
      [kind, started, deps.now(), !error, jsonParam({ ...(detail || {}), error, calls: yt.calls })]);
    if (error) { result.error = error; break; } // out of quota: the next kind would fail too
  }
  return result;
}

/** Drops old catalog videos nobody touched, so the pool stays fresh and the free database stays small. */
export async function pruneCatalog(db: Db, now: Date): Promise<void> {
  const cutoff = new Date(now.getTime() - 60 * 86400_000);
  await db.query(
    `delete from videos v where coalesce(v.published_at, v.fetched_at) < $1 and v.live_state = 'none'
       and not exists (select 1 from vstate s where s.video_id = v.id and (s.later or s.progress_s > 0 or s.vote <> 0))`,
    [cutoff],
  );
  await db.query('delete from vstate s where not exists (select 1 from videos v where v.id = s.video_id)');
  await db.query(`delete from gather_log where started_at < $1`, [cutoff]);
}
