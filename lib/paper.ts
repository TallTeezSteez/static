import type { Db, Deps, Pick } from './types';
import { jsonParam, kvGet, kvSet, safeText } from './db';
import { loadSettings } from './settings';
import { loadCandidates, selectPicks } from './picks';
import { feedTitle, parseFeed } from './rss';
import { getWeather, type Weather } from './weather';

export const SECTIONS: { id: string; name: string; topic?: string }[] = [
  { id: 'ai', name: 'AI', topic: 'ai' },
  { id: 'local', name: 'Local models' },
  { id: 'server', name: 'Home server' },
  { id: 'builds', name: 'GitHub & cool projects' },
  { id: 'hvac', name: 'HVAC trade', topic: 'shoptalk' },
  { id: 'hunting', name: 'Hunting', topic: 'outdoors' },
  { id: 'tech', name: 'Tech', topic: 'tech' },
  { id: 'pcgaming', name: 'PC gaming', topic: 'pcgaming' },
  { id: 'football', name: 'Football', topic: 'football' },
  { id: 'truecrime', name: 'True crime', topic: 'truecrime' },
];

/** Starter feeds. They show their health in Settings > Paper, where any of them can be swapped. */
export const DEFAULT_FEEDS: { url: string; title: string; section: string }[] = [
  { url: 'https://simonwillison.net/atom/everything/', title: 'Simon Willison', section: 'ai' },
  { url: 'https://www.theverge.com/rss/ai-artificial-intelligence/index.xml', title: 'The Verge AI', section: 'ai' },
  { url: 'https://arstechnica.com/ai/feed/', title: 'Ars Technica AI', section: 'ai' },
  { url: 'https://huggingface.co/blog/feed.xml', title: 'Hugging Face', section: 'local' },
  { url: 'https://ollama.com/blog/rss.xml', title: 'Ollama', section: 'local' },
  { url: 'https://www.reddit.com/r/LocalLLaMA/top/.rss?t=day', title: 'r/LocalLLaMA', section: 'local' },
  { url: 'https://selfh.st/rss/', title: 'selfh.st', section: 'server' },
  { url: 'https://www.servethehome.com/feed/', title: 'ServeTheHome', section: 'server' },
  { url: 'https://www.reddit.com/r/selfhosted/top/.rss?t=day', title: 'r/selfhosted', section: 'server' },
  { url: 'https://hnrss.org/show?points=100', title: 'Show HN', section: 'builds' },
  { url: 'https://mshibanami.github.io/GitHubTrendingRSS/daily/all.xml', title: 'GitHub Trending', section: 'builds' },
  { url: 'https://github.blog/feed/', title: 'GitHub Blog', section: 'builds' },
  { url: 'https://hvacrschool.com/feed/', title: 'HVAC School', section: 'hvac' },
  { url: 'https://www.achrnews.com/rss/articles', title: 'ACHR News', section: 'hvac' },
  { url: 'https://www.contractingbusiness.com/rss.xml', title: 'Contracting Business', section: 'hvac' },
  { url: 'https://www.outdoorlife.com/feed/', title: 'Outdoor Life', section: 'hunting' },
  { url: 'https://www.rokslide.com/feed/', title: 'Rokslide', section: 'hunting' },
  { url: 'https://www.fieldandstream.com/feed/', title: 'Field & Stream', section: 'hunting' },
  { url: 'https://arstechnica.com/feed/', title: 'Ars Technica', section: 'tech' },
  { url: 'https://www.theverge.com/rss/index.xml', title: 'The Verge', section: 'tech' },
  { url: 'https://www.pcgamer.com/rss/', title: 'PC Gamer', section: 'pcgaming' },
  { url: 'https://www.rockpapershotgun.com/feed', title: 'Rock Paper Shotgun', section: 'pcgaming' },
  { url: 'https://www.espn.com/espn/rss/nfl/news', title: 'ESPN NFL', section: 'football' },
  { url: 'https://profootballtalk.nbcsports.com/feed/', title: 'ProFootballTalk', section: 'football' },
  { url: 'https://lawandcrime.com/feed/', title: 'Law & Crime', section: 'truecrime' },
  { url: 'https://www.crimeonline.com/feed/', title: 'Crime Online', section: 'truecrime' },
];

const FEED_STALE_MS = 3 * 3600_000;
const FEED_BATCH = 8;
const KEEP_DAYS = 14;

export async function seedFeeds(db: Db): Promise<void> {
  if (await kvGet(db, 'feeds:seeded')) return;
  await db.query(
    `insert into feeds (url, title, section) select x.url, x.title, x.section
     from jsonb_to_recordset($1::jsonb) as x(url text, title text, section text) on conflict (url) do nothing`,
    [jsonParam(DEFAULT_FEEDS)]);
  await kvSet(db, 'feeds:seeded', true);
}

export type FeedRow = { id: number; url: string; title: string; section: string; enabled: boolean; lastOk: string | null; lastError: string | null };

export async function listFeeds(db: Db): Promise<FeedRow[]> {
  await seedFeeds(db);
  const r = await db.query<any>('select * from feeds order by section, title');
  return r.rows.map((f) => ({
    id: f.id, url: f.url, title: f.title, section: f.section, enabled: f.enabled,
    lastOk: f.last_ok ? new Date(f.last_ok).toISOString() : null, lastError: f.last_error,
  }));
}

export async function addFeed(db: Db, url: string, section: string): Promise<boolean> {
  if (!/^https?:\/\/\S+$/.test(url) || !SECTIONS.some((s) => s.id === section)) return false;
  await db.query(`insert into feeds (url, section) values ($1, $2) on conflict (url) do update set section = $2, enabled = true`, [url.slice(0, 500), section]);
  return true;
}

export type RefreshResult = { checked: number; ok: number; failed: number; added: number };

/** Reads the feeds that are due. One feed failing is written on that feed and the rest carry on. */
export async function refreshFeeds(deps: Deps, opts: { force?: boolean } = {}): Promise<RefreshResult> {
  const { db } = deps;
  await seedFeeds(db);
  const now = deps.now();
  const due = await db.query<any>(
    `select id, url, title, section from feeds where enabled and ($1 or checked_at is null or checked_at < $2) order by id`,
    [!!opts.force, new Date(now.getTime() - FEED_STALE_MS)]);
  const result: RefreshResult = { checked: 0, ok: 0, failed: 0, added: 0 };
  for (let i = 0; i < due.rows.length; i += FEED_BATCH) {
    await Promise.all(due.rows.slice(i, i + FEED_BATCH).map(async (feed: any) => {
      result.checked += 1;
      try {
        const res = await deps.fetch(feed.url, {
          signal: AbortSignal.timeout(10_000),
          headers: { 'user-agent': 'Static/1.0 (personal feed reader)', accept: 'application/rss+xml, application/atom+xml, application/xml, text/xml, */*' },
        });
        if (!res.ok) throw new Error(`answered ${res.status}`);
        const xml = await res.text();
        const items = parseFeed(xml, feed.url).slice(0, 30);
        if (items.length === 0) throw new Error('no articles found');
        const source = safeText(feed.title || feedTitle(xml) || new URL(feed.url).hostname);
        const rows = items.map((it) => ({ ...it, url: it.url.slice(0, 1000), title: it.title.slice(0, 300) }));
        const ins = await db.query(
          `insert into articles (feed_id, url, title, summary, image, published_at, section, source)
           select $2, x.url, x.title, x.summary, x.image, coalesce(x."publishedAt", $5), $3, $4
           from jsonb_to_recordset($1::jsonb) as x(url text, title text, summary text, image text, "publishedAt" timestamptz)
           on conflict (url) do nothing returning id`,
          [jsonParam(rows), feed.id, feed.section, source, now]);
        result.added += ins.rows.length;
        result.ok += 1;
        await db.query(`update feeds set checked_at = $2, last_ok = $2, last_error = null, title = case when title = '' then $3 else title end where id = $1`, [feed.id, now, source]);
      } catch (e) {
        result.failed += 1;
        const msg = e instanceof Error ? (e.name === 'TimeoutError' ? 'took too long' : e.message) : String(e);
        await db.query(`update feeds set checked_at = $2, last_error = $3 where id = $1`, [feed.id, now, msg.slice(0, 200)]);
      }
    }));
  }
  await db.query(`delete from articles where not saved and coalesce(published_at, fetched_at) < $1`, [new Date(now.getTime() - KEEP_DAYS * 86400_000)]);
  return result;
}

export type Article = { id: number; url: string; title: string; summary: string; image: string; publishedAt: string | null; section: string; source: string; saved: boolean; read: boolean };
export type Edition = {
  date: string;
  weather: Weather | null;
  sections: { id: string; name: string; articles: Article[]; videos: Pick[] }[];
  saved: Article[];
  feedProblems: number;
};

function toArticle(a: any): Article {
  return {
    id: a.id, url: a.url, title: a.title, summary: a.summary, image: a.image,
    publishedAt: a.published_at ? new Date(a.published_at).toISOString() : null,
    section: a.section, source: a.source, saved: a.saved, read: a.read,
  };
}

/** Newest first, but one article per source before any source gets a second, so one busy site can't fill a section. */
export function spreadSources(articles: Article[], max: number): Article[] {
  const bySource = new Map<string, Article[]>();
  for (const a of articles) { if (!bySource.has(a.source)) bySource.set(a.source, []); bySource.get(a.source)!.push(a); }
  const out: Article[] = [];
  for (let round = 0; out.length < max; round++) {
    const row = [...bySource.values()].map((list) => list[round]).filter(Boolean);
    if (row.length === 0) break;
    row.sort((a, b) => String(b.publishedAt).localeCompare(String(a.publishedAt)));
    out.push(...row.slice(0, max - out.length));
  }
  return out;
}

/** Today's paper: each section's newest articles (last 36 hours, or the last week when it's been quiet) plus two videos. */
export async function buildEdition(deps: Deps): Promise<Edition> {
  const { db } = deps;
  const now = deps.now();
  const settings = await loadSettings(db);
  const recent = await db.query<any>(
    `select * from articles where coalesce(published_at, fetched_at) > $1 order by coalesce(published_at, fetched_at) desc limit 1500`,
    [new Date(now.getTime() - 7 * 86400_000)]);
  const all = recent.rows.map(toArticle);
  const dayAndHalf = now.getTime() - 36 * 3600_000;
  const candidates = await loadCandidates(db);
  const used = new Set<string>();
  const sections: Edition['sections'] = [];
  for (const sec of SECTIONS) {
    const mine = all.filter((a) => a.section === sec.id);
    const fresh = mine.filter((a) => a.publishedAt && Date.parse(a.publishedAt) > dayAndHalf);
    const articles = spreadSources(fresh.length >= 3 ? fresh : mine, 6);
    let videos: Pick[] = [];
    if (sec.topic) {
      videos = selectPicks(candidates, { shelf: sec.topic, n: 2, exclude: [...used] }, settings, now, deps.rng).picks;
      videos.forEach((v) => used.add(v.id));
    }
    if (articles.length || videos.length) sections.push({ id: sec.id, name: sec.name, articles, videos });
  }
  const saved = await db.query<any>('select * from articles where saved order by fetched_at desc limit 100');
  const problems = await db.query<any>('select count(*) as n from feeds where enabled and last_error is not null');
  return {
    date: now.toISOString(),
    weather: await getWeather(deps, settings.location),
    sections,
    saved: saved.rows.map(toArticle),
    feedProblems: Number(problems.rows[0].n),
  };
}
