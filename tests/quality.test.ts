import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import type { Db, Deps, Video } from '@/lib/types';
import { QuotaError, YouTube } from '@/lib/youtube';
import { SEARCH_DAILY_CAP, addStarterChannels, reclassifyCatalog, runGather, upsertVideos } from '@/lib/gather';
import { STARTER_CHANNELS } from '@/lib/starter';
import { DEFAULT_TOPICS } from '@/lib/topics';
import { DEFAULT_SETTINGS, saveSecrets } from '@/lib/settings';
import { isJunk } from '@/lib/quality';
import { pickSet, scoreVideo, type Candidate } from '@/lib/score';
import { call, chanId, closeDb, fakeFetch, makeDeps, NOW, seededRng, signIn, testDb, vidId, video } from './helpers';

const LETTERS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';
const idsFrom = (url: string) => new URL(url).searchParams.get('id')!.split(',');
const apiVideo = (id: string, over: any = {}) => ({
  id,
  snippet: { channelId: over.channelId || chanId('S'), channelTitle: over.channelTitle || 'Found Channel', title: over.title || `Solid documentary ${id}`,
    description: '', publishedAt: '2026-11-13T00:00:00Z', categoryId: '28', defaultAudioLanguage: over.lang, liveBroadcastContent: 'none', thumbnails: {} },
  contentDetails: { duration: over.duration || 'PT40M' },
  statistics: { viewCount: String(over.views ?? 80_000) },
  status: { embeddable: true, madeForKids: !!over.kids },
});
const newQuota = () => new Response(JSON.stringify({ error: { code: 429, status: 'RESOURCE_EXHAUSTED',
  message: "Quota exceeded for quota metric 'Search Queries' and limit 'Search Queries per day' of service 'youtube.googleapis.com'.",
  errors: [{ reason: 'rateLimitExceeded' }] } }), { status: 429 });

describe('YouTube client, second pass', () => {
  it("treats Google's 429 'Quota exceeded' answer as the daily limit", async () => {
    await expect(new YouTube('KEY', fakeFetch([['/search', newQuota]])).search('x')).rejects.toBeInstanceOf(QuotaError);
  });
  it('reads the made-for-kids flag and the spoken language', async () => {
    const f = fakeFetch([['/videos', () => ({ items: [apiVideo('a', { kids: true, lang: 'en-US' }), apiVideo('b')] })]]);
    const [a, b] = await new YouTube('KEY', f).videoDetails(['a', 'b']);
    expect([a.madeForKids, a.lang, b.madeForKids, b.lang]).toEqual([true, 'en-US', false, '']);
  });
});

describe('junk check', () => {
  const words = DEFAULT_SETTINGS.blockWords;
  const v = (over: Partial<Video>) => video({ id: 'x', views: 50_000, ...over });
  it('lets a normal English video through', () => {
    expect(isJunk(v({ title: 'How the Hoover Dam was built' }), words)).toBe(false);
    expect(isJunk(v({ title: 'Elk hunt', lang: 'en-GB' }), words)).toBe(false);
  });
  it('drops videos made for kids, in another language, or written in another alphabet', () => {
    expect(isJunk(v({ madeForKids: true }), words)).toBe(true);
    expect(isJunk(v({ lang: 'hi' }), words)).toBe(true);
    expect(isJunk(v({ title: 'Документальный фильм о войне' }), words)).toBe(true);
    expect(isJunk(v({ title: 'Café tour — Montréal’s best' }), words)).toBe(false);
  });
  it('drops titles with a blocked word, matching whole words only', () => {
    expect(isJunk(v({ title: 'Skibidi rizz compilation' }), words)).toBe(true);
    expect(isJunk(v({ title: 'I survived 100 DAYS in a bunker' }), words)).toBe(true);
    expect(isJunk(v({ title: 'The Challenger disaster explained' }), words)).toBe(false);
    expect(isJunk(v({ title: 'Anything', channelTitle: 'Daily Prank Crew' }), words)).toBe(true);
    expect(isJunk(v({ title: 'Skibidi rizz compilation' }), [])).toBe(false);
  });
});

describe('searches, second pass', () => {
  let db: Db;
  beforeEach(async () => { db = await testDb(); await saveSecrets(db, { youtubeKey: 'KEY' }); await db.query(`insert into kv (key, value) values ('starter:done', 'true')`); });
  afterAll(closeDb);

  const searchFetch = (opts: { failAfter?: number; fail?: () => Response; details?: (id: string) => any } = {}) => {
    let n = 0;
    return fakeFetch([
      ['/search', () => (opts.failAfter !== undefined && ++n > opts.failAfter ? opts.fail!() : { items: [{ id: { videoId: `found${String(n || ++n).padStart(6, '0')}` } }] })],
      ['/videos', (url) => ({ items: idsFrom(url).map((id) => (opts.details ? opts.details(id) : apiVideo(id))) })],
    ]);
  };
  const countSearches = (f: { calls: string[] }) => f.calls.filter((u) => u.includes('/search')).length;

  it('keeps what the first searches found when a later one fails', async () => {
    for (const fail of [newQuota, () => new Response('boom', { status: 500 })]) {
      await db.query('truncate videos, gather_log'); await db.query(`delete from kv where key like 'search:%' or key like 'gather:%'`);
      const r = await runGather(makeDeps(db, { fetch: searchFetch({ failAfter: 8, fail }) }), { kinds: ['search'], force: true });
      expect(r.error).toBeTruthy();
      expect(r.search!.videos).toBeGreaterThan(0);
      expect(Number((await db.query('select count(*) as n from videos')).rows[0].n)).toBe(r.search!.videos);
    }
  });

  it(`never makes more than ${SEARCH_DAILY_CAP} searches in a day, however often it is forced`, async () => {
    const f = searchFetch();
    const run = (at: Date) => runGather(makeDeps(db, { fetch: f, now: () => at }), { kinds: ['search'], force: true });
    for (let i = 0; i < 3; i++) expect((await run(new Date(NOW.getTime() + i * 60_000))).search!.queries).toBe(24);
    const fourth = await run(new Date(NOW.getTime() + 10 * 60_000));
    expect(fourth.skipped).toContain('search-limit');
    expect(countSearches(f)).toBe(SEARCH_DAILY_CAP);
    // the count starts over when the day turns in California, which is when YouTube resets it
    const nextDay = await run(new Date(NOW.getTime() + 26 * 3600_000));
    expect(nextDay.search!.queries).toBe(24);
  });

  it('stops searching for the day once YouTube says the limit is hit', async () => {
    const first = await runGather(makeDeps(db, { fetch: searchFetch({ failAfter: 0, fail: newQuota }) }), { kinds: ['search'], force: true });
    expect(first.error).toBe('YouTube daily limit reached');
    const f = searchFetch();
    const second = await runGather(makeDeps(db, { fetch: f, now: () => new Date(NOW.getTime() + 60_000) }), { kinds: ['search'], force: true });
    expect(second.skipped).toContain('search-limit');
    expect(countSearches(f)).toBe(0);
  });

  it('does not keep search results that are junk', async () => {
    const kinds: Record<string, any> = {
      found000001: { title: 'Solid cold case documentary' },
      found000002: { lang: 'hi', title: 'Another one' },
      found000003: { kids: true },
      found000004: { views: 300 },
      found000005: { title: 'Skibidi brainrot marathon' },
      found000006: { duration: 'PT50S' },
    };
    let n = 0;
    const f = fakeFetch([
      ['/search', () => ({ items: ++n === 1 ? Object.keys(kinds).map((videoId) => ({ id: { videoId } })) : [] })],
      ['/videos', (url) => ({ items: idsFrom(url).map((id) => apiVideo(id, kinds[id])) })],
    ]);
    const r = await runGather(makeDeps(db, { fetch: f }), { kinds: ['search'], force: true });
    expect(r.search!.videos).toBe(1);
    expect((await db.query('select id from videos')).rows).toEqual([{ id: 'found000001' }]);
  });
});

describe('starter channels', () => {
  let db: Db; let deps: Deps;
  beforeEach(async () => { db = await testDb(); await saveSecrets(db, { youtubeKey: 'KEY' }); });
  afterAll(closeDb);

  it('ships a real list: every topic has some, handles are clean, none twice', () => {
    for (const t of DEFAULT_TOPICS) expect(STARTER_CHANNELS.filter((s) => s.topic === t.id).length).toBeGreaterThanOrEqual(8);
    expect(STARTER_CHANNELS.every((s) => /^[A-Za-z0-9._-]{3,30}$/.test(s.handle))).toBe(true);
    expect(new Set(STARTER_CHANNELS.map((s) => s.handle.toLowerCase())).size).toBe(STARTER_CHANNELS.length);
    expect(STARTER_CHANNELS.length).toBeGreaterThan(120);
  });

  it('looks each one up once, files it under its topic, and skips handles that do not exist', async () => {
    const list = [{ handle: 'GoodDocs', topic: 'docs' }, { handle: 'GoneChannel', topic: 'tech' }, { handle: 'CrimeShow', topic: 'truecrime' }];
    const f = fakeFetch([['/channels', (url) => {
      const h = new URL(url).searchParams.get('forHandle');
      if (h === '@GoneChannel') return { items: [] };
      return { items: [{ id: chanId(h === '@GoodDocs' ? 'D' : 'C'), snippet: { title: h!.slice(1) } }] };
    }]]);
    deps = makeDeps(db, { fetch: f });
    expect(await addStarterChannels(deps, new YouTube('KEY', f), list)).toBe(2);
    expect((await db.query('select id, title, source, topic from channels order by id')).rows).toEqual([
      { id: chanId('C'), title: 'CrimeShow', source: 'default', topic: 'truecrime' },
      { id: chanId('D'), title: 'GoodDocs', source: 'default', topic: 'docs' },
    ]);
    expect(await addStarterChannels(deps, new YouTube('KEY', f), list)).toBe(0);
    expect(f.calls).toHaveLength(3);
  });

  it('does not un-hide or re-file a channel he already has', async () => {
    await db.query(`insert into channels (id, title, source, subscribed, hidden) values ($1, 'Mine', 'sub', true, true)`, [chanId('D')]);
    const f = fakeFetch([['/channels', () => ({ items: [{ id: chanId('D'), snippet: { title: 'GoodDocs' } }] })]]);
    await addStarterChannels(makeDeps(db, { fetch: f }), new YouTube('KEY', f), [{ handle: 'GoodDocs', topic: 'docs' }]);
    expect((await db.query('select title, source, hidden, topic from channels')).rows).toEqual([{ title: 'Mine', source: 'sub', hidden: true, topic: 'docs' }]);
  });

  it("puts a starter channel's videos on its shelf even when the title has none of the shelf's words", async () => {
    await db.query(`insert into channels (id, title, source, topic) values ($1, 'GoodDocs', 'default', 'docs')`, [chanId('D')]);
    await upsertVideos(db, [video({ id: vidId(1), channelId: chanId('D'), title: 'Inside the port that never sleeps', durationS: 3000 })], DEFAULT_TOPICS, 'uploads');
    expect((await db.query('select topics from videos')).rows[0].topics).toContain('docs');
    const cookie = await signIn(makeDeps(db));
    const shelf = (await call(makeDeps(db), 'GET', '/api/picks?shelf=docs', undefined, cookie)).body.picks;
    expect(shelf.map((p: any) => p.id)).toEqual([vidId(1)]);
  });

  it('a full update pulls starter channels in and reads their uploads', async () => {
    const f = fakeFetch([
      ['/channels', (url) => (new URL(url).searchParams.get('forHandle') === `@${STARTER_CHANNELS[0].handle}` ? { items: [{ id: chanId('Q'), snippet: { title: 'First Starter' } }] } : { items: [] })],
      ['playlistItems', () => ({ items: [{ contentDetails: { videoId: 'starterAAAA' } }] })],
      ['/videos', (url) => ({ items: idsFrom(url).map((id) => apiVideo(id, { channelId: chanId('Q') })) })],
    ]);
    const r = await runGather(makeDeps(db, { fetch: f }), { kinds: ['uploads'] });
    expect(r.uploads).toEqual({ channels: 1, videos: 1 });
    expect(f.calls.filter((u) => u.includes('forHandle')).length).toBe(STARTER_CHANNELS.length);
  });
});

describe('more on screen, less junk', () => {
  let db: Db; let deps: Deps; let cookie: string;
  beforeEach(async () => { db = await testDb(); deps = makeDeps(db); cookie = await signIn(deps); });
  afterAll(closeDb);
  const cand = (over: Partial<Candidate> & { id: string }): Candidate => ({
    title: 't', channelId: chanId('A'), channelTitle: 'A', durationS: 1500, publishedAt: new Date(NOW.getTime() - 86400_000).toISOString(),
    views: 10_000, thumb: '', embeddable: true, topics: [], subscribed: true, watchCount: 0, recentCount: 0, rating: 0, shown: 0, vote: 0,
    progressS: 0, later: false, ...over,
  });

  it('allows a set number of videos per channel when asked', () => {
    const pool = Array.from({ length: 9 }, (_, i) => scoreVideo(cand({ id: `v${i}`, channelId: chanId(LETTERS[i % 3]) }), NOW));
    expect(pickSet(pool, { n: 9, mixNew: 0, rng: seededRng(2) })).toHaveLength(3);
    const two = pickSet(pool, { n: 9, mixNew: 0, rng: seededRng(2), maxPerChannel: 2 });
    expect(two).toHaveLength(6);
    for (const l of 'ABC') expect(two.filter((s) => s.channelId === chanId(l))).toHaveLength(2);
  });

  it('fills the Watch screen: 12 for tonight and up to 20 on a shelf', async () => {
    const videos = Array.from({ length: 120 }, (_, i) => video({ id: vidId(i), channelId: chanId(LETTERS[i % 26]), channelTitle: `Chan ${LETTERS[i % 26]}`, title: `True crime case file ${i}` }));
    await upsertVideos(db, videos, DEFAULT_TOPICS, 'uploads');
    const home = (await call(deps, 'GET', '/api/home', undefined, cookie)).body;
    expect(home.tonight).toHaveLength(12);
    expect(home.shelves.find((s: any) => s.id === 'truecrime').picks).toHaveLength(20);
    const browse = (await call(deps, 'GET', '/api/picks?n=48', undefined, cookie)).body;
    expect(browse.picks).toHaveLength(48);
  });

  it('leaves out anything over four hours: those are all-day stream replays', async () => {
    await upsertVideos(db, [
      video({ id: vidId(1), title: 'LIVE: day 4 of the trial', durationS: 5 * 3600 }),
      video({ id: vidId(2), channelId: chanId('B'), title: 'A long documentary', durationS: 3 * 3600 }),
    ], DEFAULT_TOPICS, 'uploads');
    const all = (await call(deps, 'GET', '/api/picks?n=10', undefined, cookie)).body.picks.map((p: any) => p.id);
    expect(all).toEqual([vidId(2)]);
    const long = (await call(deps, 'GET', '/api/picks?n=10&time=long', undefined, cookie)).body.picks.map((p: any) => p.id);
    expect(long).toEqual([vidId(2)]);
  });

  it('blocks watch-along streams by default', () => {
    for (const title of ['Steelers vs Bengals Live Play by Play & Reaction', 'Super Bowl watch party', 'Friday night livestream'])
      expect(isJunk(video({ id: 'x', title }), DEFAULT_SETTINGS.blockWords)).toBe(true);
    expect(isJunk(video({ id: 'x', title: 'Live PD: Police Patrol' }), DEFAULT_SETTINGS.blockWords)).toBe(false);
  });

  it('re-files the whole catalog when the filing rules change, once', async () => {
    await db.query(`insert into channels (id, title, source, topic) values ($1, 'Chan D', 'default', 'docs')`, [chanId('D')]);
    await upsertVideos(db, [
      video({ id: vidId(1), title: 'A spy tells her story' }),
      video({ id: vidId(2), channelId: chanId('B'), title: 'Building AI agents' }),
      video({ id: vidId(3), channelId: chanId('C'), title: 'Found by a true crime search' }),
      video({ id: vidId(4), channelId: chanId('D'), title: 'Inside the port', durationS: 3000 }),
    ], DEFAULT_TOPICS, 'uploads');
    // as the old, looser rules left them
    await db.query(`update videos set topics = '{ai,business}' where id = $1`, [vidId(1)]);
    await db.query(`update videos set topics = '{tech}' where id = $1`, [vidId(2)]);
    await db.query(`update videos set topics = '{truecrime,docs}', source = 'search' where id = $1`, [vidId(3)]);
    await db.query(`update videos set topics = '{}' where id = $1`, [vidId(4)]);
    await saveSecrets(db, { youtubeKey: 'KEY' });
    await db.query(`insert into kv (key, value) values ('gather:uploads', $1), ('gather:search', $1)`, [JSON.stringify({ at: NOW.toISOString() })]);
    await runGather(deps);
    const topics = Object.fromEntries((await db.query('select id, topics from videos')).rows.map((r: any) => [r.id, [...r.topics].sort()]));
    expect(topics).toEqual({ [vidId(1)]: [], [vidId(2)]: ['ai'], [vidId(3)]: ['docs', 'truecrime'], [vidId(4)]: ['docs'] });
    // a second run leaves hand-made changes alone
    await db.query(`update videos set topics = '{tech}' where id = $1`, [vidId(1)]);
    await runGather(deps);
    expect((await db.query('select topics from videos where id = $1', [vidId(1)])).rows[0].topics).toEqual(['tech']);
    expect(typeof reclassifyCatalog).toBe('function');
  });

  it('never offers junk, and the blocked-word list can be changed in Settings', async () => {
    await upsertVideos(db, [
      video({ id: vidId(1), title: 'How bridges are built' }),
      video({ id: vidId(2), channelId: chanId('B'), title: 'Skibidi rizz compilation' }),
      video({ id: vidId(3), channelId: chanId('C'), title: 'Cartoon songs', madeForKids: true }),
      video({ id: vidId(4), channelId: chanId('D'), title: 'Fine title', lang: 'es' }),
    ], DEFAULT_TOPICS, 'uploads');
    const ids = async () => (await call(deps, 'GET', '/api/picks?n=10', undefined, cookie)).body.picks.map((p: any) => p.id).sort();
    expect(await ids()).toEqual([vidId(1)]);
    const saved = await call(deps, 'PUT', '/api/settings', { settings: { blockWords: ['Bridges ', '', 'x'.repeat(90)] } }, cookie);
    expect(saved.body.settings.blockWords).toEqual(['bridges']);
    expect(await ids()).toEqual([vidId(2)]);
  });
});
