import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import type { Db, Deps } from '@/lib/types';
import { parseIsoDuration, formatDuration } from '@/lib/duration';
import { DEFAULT_TOPICS, classify } from '@/lib/topics';
import { QuotaError, YouTube } from '@/lib/youtube';
import { MAX_SEARCHES_PER_DAY, runGather, searchPlan } from '@/lib/gather';
import { saveSecrets } from '@/lib/settings';
import { chanId, closeDb, fakeFetch, makeDeps, NOW, testDb, vidId } from './helpers';

const apiVideo = (id: string, over: any = {}) => ({
  id,
  snippet: { channelId: over.channelId || chanId('A'), channelTitle: over.channelTitle || 'Chan A', title: over.title || `Video ${id}`,
    description: 'd', publishedAt: '2026-11-13T00:00:00Z', categoryId: '28', tags: ['one', 'two'], liveBroadcastContent: over.live || 'none',
    thumbnails: { medium: { url: `https://i.ytimg.com/vi/${id}/mqdefault.jpg` } } },
  contentDetails: { duration: over.duration || 'PT25M' },
  statistics: { viewCount: '1234' },
  status: { embeddable: over.embeddable ?? true },
});
const quotaResponse = () => new Response(JSON.stringify({ error: { code: 403, message: 'quota', errors: [{ reason: 'quotaExceeded' }] } }), { status: 403 });
const idsFrom = (url: string) => new URL(url).searchParams.get('id')!.split(',');

describe('durations', () => {
  it('turns ISO durations into seconds', () => {
    expect(parseIsoDuration('PT1H2M3S')).toBe(3723);
    expect(parseIsoDuration('P0D')).toBe(0);
    expect(parseIsoDuration('PT45S')).toBe(45);
    expect(parseIsoDuration('P1DT1M')).toBe(86460);
    expect(parseIsoDuration('garbage')).toBe(0);
    expect(parseIsoDuration(undefined)).toBe(0);
  });
  it('prints them the way a player does', () => {
    expect(formatDuration(3723)).toBe('1:02:03');
    expect(formatDuration(65)).toBe('1:05');
  });
});

describe('topics', () => {
  const base = { channelTitle: '', tags: '', description: '', categoryId: '', durationS: 1800 };
  it('matches whole words only', () => {
    expect(classify({ ...base, title: 'Building AI agents with Claude' }, DEFAULT_TOPICS)).toContain('ai');
    expect(classify({ ...base, title: 'Rain in Maine stays mainly' }, DEFAULT_TOPICS)).not.toContain('ai');
    expect(classify({ ...base, title: 'A cold case reopened' }, DEFAULT_TOPICS)).toContain('truecrime');
  });
  it('only calls something a long doc when it is 20 minutes or more', () => {
    expect(classify({ ...base, title: 'Full documentary: the canal', durationS: 3000 }, DEFAULT_TOPICS)).toContain('docs');
    expect(classify({ ...base, title: 'Full documentary: the canal', durationS: 600 }, DEFAULT_TOPICS)).not.toContain('docs');
  });
  it('uses the YouTube category for gaming', () => {
    expect(classify({ ...base, title: 'Untitled stream', categoryId: '20' }, DEFAULT_TOPICS)).toEqual(['pcgaming']);
  });
  it('finds words in the channel name and tags too', () => {
    expect(classify({ ...base, title: 'Episode 12', channelTitle: 'HVAC School' }, DEFAULT_TOPICS)).toContain('shoptalk');
    expect(classify({ ...base, title: 'Episode 12', tags: 'elk, backcountry' }, DEFAULT_TOPICS)).toContain('outdoors');
  });
});

describe('YouTube client', () => {
  it('asks for a channel uploads playlist by swapping UC for UU', async () => {
    const f = fakeFetch([['playlistItems', () => ({ items: [{ contentDetails: { videoId: 'a' } }, { contentDetails: { videoId: 'b' } }] })]]);
    expect(await new YouTube('KEY', f).channelUploads(chanId('Z'))).toEqual(['a', 'b']);
    expect(f.calls[0]).toContain('playlistId=UU' + 'Z'.repeat(22));
    expect(f.calls[0]).toContain('key=KEY');
  });
  it('treats a missing uploads playlist as no videos', async () => {
    const f = fakeFetch([]);
    expect(await new YouTube('KEY', f).channelUploads(chanId('Z'))).toEqual([]);
  });
  it('fetches details 50 at a time', async () => {
    const f = fakeFetch([['/videos', (url) => ({ items: idsFrom(url).map((id) => apiVideo(id)) })]]);
    const ids = Array.from({ length: 120 }, (_, i) => vidId(i));
    const videos = await new YouTube('KEY', f).videoDetails(ids);
    expect(f.calls).toHaveLength(3);
    expect(videos).toHaveLength(120);
    expect(videos[0]).toMatchObject({ id: vidId(0), durationS: 1500, views: 1234, embeddable: true, liveState: 'none', tags: 'one, two' });
  });
  it('raises QuotaError when the daily limit is hit', async () => {
    const f = fakeFetch([['/videos', quotaResponse]]);
    await expect(new YouTube('KEY', f).videoDetails(['x'])).rejects.toBeInstanceOf(QuotaError);
  });
  it('finds a channel from a handle or a link', async () => {
    const f = fakeFetch([['/channels', () => ({ items: [{ id: chanId('Q'), snippet: { title: 'Q Channel' } }] })]]);
    const yt = new YouTube('KEY', f);
    expect(await yt.resolveChannel('https://www.youtube.com/@SomeHandle')).toEqual({ id: chanId('Q'), title: 'Q Channel' });
    expect(f.calls[0]).toContain('forHandle=%40SomeHandle');
    expect(await yt.resolveChannel('nothing useful')).toBeNull();
  });
});

describe('gathering', () => {
  let db: Db; let deps: Deps;
  beforeEach(async () => { db = await testDb(); });
  afterAll(closeDb);

  const uploadsFetch = (perChannel = 2) => fakeFetch([
    ['playlistItems', (url) => {
      const letter = new URL(url).searchParams.get('playlistId')![2];
      return { items: Array.from({ length: perChannel }, (_, i) => ({ contentDetails: { videoId: `up${letter}${String(i).padStart(8, '0')}` } })) };
    }],
    ['/search', (url) => {
      const q = new URL(url).searchParams.get('q')!;
      return { items: [{ id: { videoId: `s${q.length.toString().padStart(2, '0')}${q.replace(/[^a-z]/g, '').slice(0, 8).padEnd(8, 'x')}` } }] };
    }],
    ['/videos', (url) => ({ items: idsFrom(url).map((id) => apiVideo(id, { channelId: id.startsWith('up') ? chanId(id[2]) : chanId('S'), channelTitle: 'Found Channel' })) })],
  ]);
  const addChannel = (letter: string, extra = 'subscribed = true') =>
    db.query(`insert into channels (id, title) values ($1, $2)`, [chanId(letter), `Chan ${letter}`]).then(() => db.query(`update channels set ${extra} where id = $1`, [chanId(letter)]));

  it('does nothing without a YouTube key', async () => {
    deps = makeDeps(db);
    expect(await runGather(deps)).toEqual({ skipped: ['no-key'] });
  });

  it('pulls uploads from followed channels and search results for topics', async () => {
    await saveSecrets(db, { youtubeKey: 'KEY' });
    await addChannel('A'); await addChannel('B');
    await addChannel('H', 'hidden = true, subscribed = true');
    const f = uploadsFetch();
    deps = makeDeps(db, { fetch: f });
    const r = await runGather(deps);
    expect(r.uploads).toEqual({ channels: 2, videos: 4 });
    expect(r.search!.queries).toBe(MAX_SEARCHES_PER_DAY);
    expect(f.calls.filter((u) => u.includes('/search')).length).toBe(MAX_SEARCHES_PER_DAY);
    expect(f.calls.some((u) => u.includes('playlistId=UUH'))).toBe(false);
    const found = await db.query(`select topics, source from videos where source = 'search' limit 1`);
    expect(found.rows[0].topics.length).toBeGreaterThan(0);
    expect((await db.query(`select source from channels where id = $1`, [chanId('S')])).rows[0].source).toBe('search');
  });

  it('skips a kind that ran recently, unless forced', async () => {
    await saveSecrets(db, { youtubeKey: 'KEY' });
    await addChannel('A');
    deps = makeDeps(db, { fetch: uploadsFetch() });
    await runGather(deps);
    const f2 = uploadsFetch();
    const again = await runGather(makeDeps(db, { fetch: f2, now: () => new Date(NOW.getTime() + 3600_000) }));
    expect(again.skipped).toEqual(['uploads-fresh', 'search-fresh']);
    expect(f2.calls).toHaveLength(0);
    const later = await runGather(makeDeps(db, { fetch: uploadsFetch(), now: () => new Date(NOW.getTime() + 4 * 3600_000) }));
    expect(later.skipped).toEqual(['search-fresh']);
    expect(later.uploads!.channels).toBe(1);
    const forced = await runGather(makeDeps(db, { fetch: uploadsFetch(), now: () => new Date(NOW.getTime() + 3600_000) }), { force: true });
    expect(forced.skipped).toEqual([]);
  });

  it('does not ask YouTube again about videos it already has', async () => {
    await saveSecrets(db, { youtubeKey: 'KEY' });
    await addChannel('A');
    await runGather(makeDeps(db, { fetch: uploadsFetch() }), { kinds: ['uploads'] });
    const f = uploadsFetch();
    await runGather(makeDeps(db, { fetch: f }), { kinds: ['uploads'], force: true });
    expect(f.calls.filter((u) => u.includes('/videos')).length).toBe(0);
  });

  it('never plans more than 24 searches and gets to every query over a few days', () => {
    const many = [{ ...DEFAULT_TOPICS[0], queries: Array.from({ length: 40 }, (_, i) => `q${i}`) }];
    const seen = new Set<string>();
    for (let d = 0; d < 5; d++) {
      const plan = searchPlan(many, new Date(NOW.getTime() + d * 86400_000));
      expect(plan).toHaveLength(24);
      plan.forEach((p) => seen.add(p.q));
    }
    expect(seen.size).toBe(40);
  });

  it('keeps what it fetched when the daily limit runs out part-way, and records the failed run', async () => {
    await saveSecrets(db, { youtubeKey: 'KEY' });
    for (const l of 'ABCDEFGHIJKLMNOPQRSTUVWXY') await addChannel(l); // 25 channels: two batches of uploads
    let detailCalls = 0;
    const f = fakeFetch([
      ['playlistItems', (url) => {
        const letter = new URL(url).searchParams.get('playlistId')![2];
        return { items: Array.from({ length: 3 }, (_, i) => ({ contentDetails: { videoId: `up${letter}${String(i).padStart(8, '0')}` } })) };
      }],
      ['/videos', (url) => (++detailCalls > 1 ? quotaResponse() : { items: idsFrom(url).map((id) => apiVideo(id, { channelId: chanId(id[2]) })) })],
      ['/search', () => { throw new Error('search must not run after the limit is hit'); }],
    ]);
    const r = await runGather(makeDeps(db, { fetch: f }));
    expect(r.error).toBe('YouTube daily limit reached');
    expect(r.uploads).toEqual({ channels: 25, videos: 50 });
    expect(r.search).toBeUndefined();
    expect(Number((await db.query('select count(*) as n from videos')).rows[0].n)).toBe(50);
    const log = await db.query('select kind, ok, detail from gather_log');
    expect(log.rows).toHaveLength(1);
    expect(log.rows[0]).toMatchObject({ kind: 'uploads', ok: false });
    expect(log.rows[0].detail.error).toBe('YouTube daily limit reached');
  });

  it('flags a channel that has a live stream', async () => {
    await saveSecrets(db, { youtubeKey: 'KEY' });
    await addChannel('A');
    const f = fakeFetch([
      ['playlistItems', () => ({ items: [{ contentDetails: { videoId: 'liveAAAAAAA' } }] })],
      ['/videos', (url) => ({ items: idsFrom(url).map((id) => apiVideo(id, { live: 'live', duration: 'P0D' })) })],
    ]);
    await runGather(makeDeps(db, { fetch: f }), { kinds: ['uploads'] });
    expect((await db.query('select live_prone from channels')).rows[0].live_prone).toBe(true);
  });
});
