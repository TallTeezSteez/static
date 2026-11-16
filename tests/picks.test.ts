import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import type { Db, Deps, Video } from '@/lib/types';
import { upsertVideos } from '@/lib/gather';
import { DEFAULT_TOPICS } from '@/lib/topics';
import { pickSet, scoreVideo, type Candidate } from '@/lib/score';
import { call, chanId, closeDb, makeDeps, NOW, seededRng, signIn, testDb, vidId, video } from './helpers';

const LETTERS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';
const cand = (over: Partial<Candidate> & { id: string }): Candidate => ({
  title: 't', channelId: chanId('A'), channelTitle: 'A', durationS: 1500, publishedAt: new Date(NOW.getTime() - 86400_000).toISOString(),
  views: 10_000, thumb: '', embeddable: true, topics: [], subscribed: false, watchCount: 0, recentCount: 0, rating: 0, shown: 0, vote: 0,
  progressS: 0, later: false, ...over,
});

describe('scoring', () => {
  it('calls a channel new until he subscribes, watches or likes it', () => {
    expect(scoreVideo(cand({ id: 'a' }), NOW).isNew).toBe(true);
    expect(scoreVideo(cand({ id: 'a', subscribed: true }), NOW).isNew).toBe(false);
    expect(scoreVideo(cand({ id: 'a', watchCount: 1 }), NOW).isNew).toBe(false);
    expect(scoreVideo(cand({ id: 'a', rating: 1 }), NOW).isNew).toBe(false);
  });
  it('ranks fresher above older, and a passed-over video below an unseen one', () => {
    const fresh = scoreVideo(cand({ id: 'a' }), NOW).score;
    const old = scoreVideo(cand({ id: 'a', publishedAt: new Date(NOW.getTime() - 30 * 86400_000).toISOString() }), NOW).score;
    const passed = scoreVideo(cand({ id: 'a', shown: 3 }), NOW).score;
    expect(fresh).toBeGreaterThan(old);
    expect(fresh).toBeGreaterThan(passed);
  });
  it('ranks a channel he watches a lot above one he watched once', () => {
    const lots = scoreVideo(cand({ id: 'a', watchCount: 80, recentCount: 20 }), NOW);
    const once = scoreVideo(cand({ id: 'a', watchCount: 1 }), NOW);
    expect(lots.score).toBeGreaterThan(once.score);
    expect(lots.reason).toBe('You watch this channel a lot');
  });
  it('says why a pick is there', () => {
    expect(scoreVideo(cand({ id: 'a' }), NOW).reason).toBe('New to you');
    expect(scoreVideo(cand({ id: 'a', views: 5_000_000 }), NOW).reason).toBe('New to you · popular right now');
    expect(scoreVideo(cand({ id: 'a', subscribed: true }), NOW).reason).toBe('From your subscriptions');
    expect(scoreVideo(cand({ id: 'a', subscribed: true, progressS: 400 }), NOW).reason).toBe('You started this one');
  });
});

describe('choosing a set', () => {
  const pool = () => [
    ...Array.from({ length: 8 }, (_, i) => scoreVideo(cand({ id: `new${i}`, channelId: chanId(LETTERS[i]) }), NOW)),
    ...Array.from({ length: 8 }, (_, i) => scoreVideo(cand({ id: `known${i}`, channelId: chanId(LETTERS[10 + i]), subscribed: true }), NOW)),
  ];
  it('splits six seats three new and three known at a half-and-half mix', () => {
    const set = pickSet(pool(), { n: 6, mixNew: 0.5, rng: seededRng(3) });
    expect(set).toHaveLength(6);
    expect(set.filter((s) => s.isNew)).toHaveLength(3);
  });
  it('follows the slider to all-known and all-new', () => {
    expect(pickSet(pool(), { n: 6, mixNew: 0, rng: seededRng(3) }).every((s) => !s.isNew)).toBe(true);
    expect(pickSet(pool(), { n: 6, mixNew: 1, rng: seededRng(3) }).every((s) => s.isNew)).toBe(true);
  });
  it('fills with known channels when there are not enough new ones', () => {
    const p = pool().filter((s) => !s.isNew || s.id === 'new0');
    const set = pickSet(p, { n: 6, mixNew: 0.5, rng: seededRng(3) });
    expect(set).toHaveLength(6);
    expect(set.filter((s) => s.isNew)).toHaveLength(1);
  });
  it('never takes two videos from one channel', () => {
    const same = Array.from({ length: 10 }, (_, i) => scoreVideo(cand({ id: `v${i}`, subscribed: true }), NOW));
    expect(pickSet(same, { n: 6, mixNew: 0.5, rng: seededRng(3) })).toHaveLength(1);
  });
  it('gives a different set on a different roll', () => {
    const a = pickSet(pool(), { n: 6, mixNew: 0.5, rng: seededRng(1) }).map((s) => s.id).sort().join();
    const b = pickSet(pool(), { n: 6, mixNew: 0.5, rng: seededRng(99) }).map((s) => s.id).sort().join();
    expect(a).not.toBe(b);
  });
});

describe('picks from the catalog', () => {
  let db: Db; let deps: Deps; let cookie: string;
  beforeEach(async () => { db = await testDb(); deps = makeDeps(db); cookie = await signIn(deps); });
  afterAll(closeDb);

  const seed = async (videos: Video[], subscribedLetters = '') => {
    await upsertVideos(db, videos, DEFAULT_TOPICS, 'uploads');
    for (const l of subscribedLetters) await db.query(`insert into channels (id, title, subscribed) values ($1, $2, true) on conflict (id) do update set subscribed = true`, [chanId(l), `Chan ${l}`]);
  };
  const spread = (n: number, over: (i: number) => Partial<Video> = () => ({})) =>
    Array.from({ length: n }, (_, i) => video({ id: vidId(i), channelId: chanId(LETTERS[i % 26]), channelTitle: `Chan ${LETTERS[i % 26]}`, title: `Plain video ${i}`, ...over(i) }));
  const picks = async (qs = '') => (await call(deps, 'GET', `/api/picks${qs}`, undefined, cookie)).body;

  it('never picks a Short', async () => {
    await seed([video({ id: vidId(1), durationS: 179 }), video({ id: vidId(2), channelId: chanId('B'), durationS: 180 })]);
    expect((await picks()).picks.map((p: any) => p.id)).toEqual([vidId(2)]);
  });

  it('never picks a video he has seen, including ones from the import', async () => {
    await seed(spread(3));
    await db.query(`insert into seen (video_id, source) values ($1, 'import')`, [vidId(0)]);
    await call(deps, 'POST', '/api/event', { type: 'seen', videoId: vidId(1) }, cookie);
    expect((await picks()).picks.map((p: any) => p.id)).toEqual([vidId(2)]);
  });

  it('drops a thumbed-down video and everything from a hidden channel', async () => {
    await seed([...spread(3), video({ id: vidId(50), channelId: chanId('A'), title: 'Second from A' })]);
    await call(deps, 'POST', '/api/event', { type: 'down', videoId: vidId(1) }, cookie);
    await call(deps, 'POST', '/api/event', { type: 'hide_channel', videoId: vidId(0) }, cookie);
    expect((await picks('?n=10')).picks.map((p: any) => p.id)).toEqual([vidId(2)]);
    await call(deps, 'POST', '/api/event', { type: 'unhide_channel', channelId: chanId('A') }, cookie);
    expect((await picks('?n=10')).picks).toHaveLength(2);
  });

  it('leaves out live streams and upcoming premieres', async () => {
    await seed([video({ id: vidId(1), liveState: 'live' }), video({ id: vidId(2), channelId: chanId('B') })]);
    expect((await picks()).picks.map((p: any) => p.id)).toEqual([vidId(2)]);
  });

  it('honors the exclude list so a reroll shows new things', async () => {
    await seed(spread(12));
    const first = (await picks()).picks.map((p: any) => p.id);
    const second = (await picks(`?exclude=${first.join(',')}`)).picks.map((p: any) => p.id);
    expect(first).toHaveLength(6);
    expect(second).toHaveLength(6);
    expect(second.filter((id: string) => first.includes(id))).toEqual([]);
  });

  it('returns what is left, marked exhausted, when the pool is smaller than asked', async () => {
    await seed(spread(4));
    const r = await picks();
    expect(r.picks).toHaveLength(4);
    expect(r.exhausted).toBe(true);
    const none = await picks(`?exclude=${r.picks.map((p: any) => p.id).join(',')}`);
    expect(none).toEqual({ picks: [], exhausted: true });
  });

  it('stops offering a video passed over five times while there are others, and brings it back when the pool runs dry', async () => {
    await seed(spread(8));
    await db.query(`insert into vstate (video_id, shown) values ($1, 5)`, [vidId(0)]);
    expect((await picks()).picks.map((p: any) => p.id)).not.toContain(vidId(0));
    await db.query(`update vstate set shown = 9`);
    expect((await picks('?n=8')).picks).toHaveLength(8);
  });

  it('carries the cannot-embed flag through so the app can offer "Open on YouTube"', async () => {
    await seed([video({ id: vidId(1), embeddable: false })]);
    expect((await picks()).picks[0]).toMatchObject({ id: vidId(1), embeddable: false });
  });

  it('filters a shelf by topic and by the topic minimum length', async () => {
    await seed([
      video({ id: vidId(1), title: 'Cold case solved after 30 years', durationS: 2400 }),
      video({ id: vidId(2), channelId: chanId('B'), title: 'Cold case in brief', durationS: 300 }),
      video({ id: vidId(3), channelId: chanId('C'), title: 'GPU benchmark roundup', durationS: 2400 }),
    ]);
    expect((await picks('?shelf=truecrime')).picks.map((p: any) => p.id)).toEqual([vidId(1)]);
    expect((await picks('?shelf=nosuchshelf')).picks).toEqual([]);
  });

  it('filters by how much time he has', async () => {
    await seed([
      video({ id: vidId(1), durationS: 20 * 60 }),
      video({ id: vidId(2), channelId: chanId('B'), durationS: 50 * 60 }),
      video({ id: vidId(3), channelId: chanId('C'), durationS: 100 * 60 }),
    ]);
    expect((await picks('?time=short')).picks.map((p: any) => p.id)).toEqual([vidId(1)]);
    expect((await picks('?time=hour')).picks.map((p: any) => p.id)).toEqual([vidId(2)]);
    expect((await picks('?time=long')).picks.map((p: any) => p.id)).toEqual([vidId(3)]);
  });

  it('keeps "Your regulars" to channels he already watches', async () => {
    await seed(spread(6), 'AB');
    const ids = (await picks('?shelf=regulars&n=10')).picks.map((p: any) => p.id).sort();
    expect(ids).toEqual([vidId(0), vidId(1)]);
  });

  it('builds the home screen: a dozen for tonight, shelves with no repeats of tonight', async () => {
    await seed(spread(160, (i) => ({ title: i % 2 ? `True crime case ${i}` : `AI agents build ${i}` })), 'ABCDEFGH');
    const home = (await call(deps, 'GET', '/api/home', undefined, cookie)).body;
    expect(home.tonight).toHaveLength(12);
    expect(home.counts).toEqual({ catalog: 160, channels: 8, seen: 0 });
    const tonightIds = home.tonight.map((p: any) => p.id);
    const shelfIds = home.shelves.flatMap((s: any) => s.picks.map((p: any) => p.id));
    expect(shelfIds.filter((id: string) => tonightIds.includes(id))).toEqual([]);
    expect(new Set(shelfIds).size).toBe(shelfIds.length);
    expect(home.shelves.map((s: any) => s.id)).toEqual(expect.arrayContaining(['truecrime', 'ai', 'regulars']));
    expect(home.hasKey).toBe(false);
  });
});

describe('what he does with a video', () => {
  let db: Db; let deps: Deps; let cookie: string;
  beforeEach(async () => {
    db = await testDb(); deps = makeDeps(db); cookie = await signIn(deps);
    await upsertVideos(db, [video({ id: vidId(1), durationS: 1000 }), video({ id: vidId(2), channelId: chanId('B'), channelTitle: 'Chan B' })], DEFAULT_TOPICS, 'search');
    await db.query(`insert into channels (id, title, source) values ($1, 'Chan A', 'search'), ($2, 'Chan B', 'search')`, [chanId('A'), chanId('B')]);
  });
  afterAll(closeDb);
  const ev = (body: any) => call(deps, 'POST', '/api/event', body, cookie);
  const chan = async (l: string) => (await db.query('select rating, watch_count, hidden from channels where id = $1', [chanId(l)])).rows[0];

  it('a thumbs-up makes the channel one he likes', async () => {
    await ev({ type: 'up', videoId: vidId(1) });
    expect((await chan('A')).rating).toBe(1);
    const p = (await call(deps, 'GET', '/api/picks', undefined, cookie)).body.picks.find((x: any) => x.id === vidId(1));
    expect(p).toMatchObject({ isNew: false, reason: 'From a channel you liked' });
  });

  it('watching 80% marks it seen and makes the channel one he watches', async () => {
    await ev({ type: 'progress', videoId: vidId(1), seconds: 500 });
    expect((await db.query('select count(*) as n from seen')).rows[0].n).toBe('0');
    await ev({ type: 'progress', videoId: vidId(1), seconds: 800 });
    await ev({ type: 'progress', videoId: vidId(1), seconds: 900 });
    expect((await db.query('select count(*) as n from seen')).rows[0].n).toBe('1');
    expect((await chan('A')).watch_count).toBe(1);
  });

  it('keeps Watch Later, Continue watching and Recently watched', async () => {
    await ev({ type: 'later', videoId: vidId(1) });
    await ev({ type: 'progress', videoId: vidId(2), seconds: 120 });
    let lib = (await call(deps, 'GET', '/api/library', undefined, cookie)).body;
    expect(lib.later.map((p: any) => p.id)).toEqual([vidId(1)]);
    expect(lib.continueWatching.map((p: any) => [p.id, p.progressS])).toEqual([[vidId(2), 120]]);
    await ev({ type: 'seen', videoId: vidId(1) });
    await ev({ type: 'hide_channel', channelId: chanId('B') });
    lib = (await call(deps, 'GET', '/api/library', undefined, cookie)).body;
    expect(lib.later).toEqual([]);
    expect(lib.recent.map((p: any) => p.id)).toEqual([vidId(1)]);
    expect(lib.hiddenChannels).toEqual([{ id: chanId('B'), title: 'Chan B' }]);
  });

  it('turns away events that make no sense', async () => {
    expect((await ev({ type: 'up', videoId: 'bad id' })).status).toBe(400);
    expect((await ev({ type: 'explode', videoId: vidId(1) })).status).toBe(400);
    expect((await ev({ type: 'progress', videoId: vidId(1) })).status).toBe(400);
    expect((await ev({ type: 'hide_channel' })).status).toBe(400);
  });
});
