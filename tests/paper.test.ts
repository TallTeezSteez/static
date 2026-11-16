import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import type { Db, Deps } from '@/lib/types';
import { parseFeed, toSummary } from '@/lib/rss';
import { DEFAULT_FEEDS, SECTIONS, buildEdition, refreshFeeds, spreadSources, type Article } from '@/lib/paper';
import { codeWords } from '@/lib/weather';
import { upsertVideos } from '@/lib/gather';
import { DEFAULT_TOPICS } from '@/lib/topics';
import { saveSecrets } from '@/lib/settings';
import { call, closeDb, fakeFetch, makeDeps, NOW, signIn, testDb, vidId, video } from './helpers';

const hoursAgo = (h: number) => new Date(NOW.getTime() - h * 3600_000);

const rss = (items: { title: string; link: string; hours: number; body?: string }[]) => `<?xml version="1.0"?>
<rss version="2.0" xmlns:media="http://search.yahoo.com/mrss/"><channel><title>Example &amp; Co</title>
${items.map((i) => `<item><title>${i.title}</title><link>${i.link}</link><pubDate>${hoursAgo(i.hours).toUTCString()}</pubDate>
<description><![CDATA[${i.body ?? '<p>Body <b>text</b> here.</p>'}]]></description></item>`).join('\n')}
</channel></rss>`;

const ATOM = `<?xml version="1.0" encoding="utf-8"?>
<feed xmlns="http://www.w3.org/2005/Atom" xmlns:media="http://search.yahoo.com/mrss/"><title>Atom Site</title>
<entry><title type="html">First &amp; foremost</title><link rel="alternate" href="/posts/1"/><link rel="edit" href="https://x/edit"/>
<updated>2026-11-15T10:00:00Z</updated><summary type="html">&lt;p&gt;Hello &lt;a href="x"&gt;there&lt;/a&gt;&lt;/p&gt;</summary>
<media:thumbnail url="https://img.example/1.jpg"/></entry>
<entry><title>No link entry</title><updated>2026-11-15T09:00:00Z</updated></entry>
</feed>`;

describe('reading feeds', () => {
  it('reads RSS: title, link, date, plain-text summary, first image', () => {
    const items = parseFeed(rss([
      { title: 'One', link: 'https://site.example/one', hours: 2, body: '<p>Hello&nbsp;<b>world</b></p><img src="/pic.png">' },
      { title: '', link: 'https://site.example/untitled', hours: 3 },
      { title: 'Script link', link: 'javascript:alert(1)', hours: 3 },
    ]), 'https://site.example/feed.xml');
    expect(items).toEqual([{
      url: 'https://site.example/one', title: 'One', summary: 'Hello world', image: 'https://site.example/pic.png', publishedAt: hoursAgo(2).toISOString().slice(0, 19) + '.000Z',
    }]);
  });

  it('reads Atom: picks the article link, resolves it against the feed, takes the thumbnail', () => {
    expect(parseFeed(ATOM, 'https://atom.example/feed')).toEqual([{
      url: 'https://atom.example/posts/1', title: 'First & foremost', summary: 'Hello there', image: 'https://img.example/1.jpg', publishedAt: '2026-11-15T10:00:00.000Z',
    }]);
  });

  it('gives nothing for something that is not a feed', () => {
    expect(parseFeed('<html><body>404</body></html>', 'https://x.example/')).toEqual([]);
    expect(parseFeed('', 'https://x.example/')).toEqual([]);
  });

  it('cuts long summaries at a word, at most 240 characters plus the ellipsis', () => {
    const s = toSummary('<p>' + 'word '.repeat(100) + '</p>');
    expect(s.length).toBeLessThanOrEqual(241);
    expect(s.endsWith('word…')).toBe(true);
    expect(toSummary('<script>evil()</script>Fine')).toBe('Fine');
  });
});

describe('weather words', () => {
  it('names the common codes', () => {
    expect([0, 2, 3, 61, 71, 95].map(codeWords)).toEqual(['Clear', 'Partly cloudy', 'Cloudy', 'Rain', 'Snow', 'Thunderstorms']);
  });
});

describe('the paper', () => {
  let db: Db; let deps: Deps;
  beforeEach(async () => { db = await testDb(); });
  afterAll(closeDb);

  const art = (over: Partial<Article>): Article => ({ id: 1, url: 'u', title: 't', summary: '', image: '', publishedAt: NOW.toISOString(), section: 'ai', source: 'A', saved: false, read: false, ...over });

  it('starts with a feed for every section', () => {
    for (const s of SECTIONS) expect(DEFAULT_FEEDS.some((f) => f.section === s.id)).toBe(true);
    expect(new Set(DEFAULT_FEEDS.map((f) => f.url)).size).toBe(DEFAULT_FEEDS.length);
    expect(DEFAULT_FEEDS.every((f) => f.url.startsWith('https://'))).toBe(true);
  });

  it('gives each source one article before any source gets a second', () => {
    const list = [
      art({ id: 1, source: 'Busy', publishedAt: hoursAgo(1).toISOString() }), art({ id: 2, source: 'Busy', publishedAt: hoursAgo(2).toISOString() }),
      art({ id: 3, source: 'Busy', publishedAt: hoursAgo(3).toISOString() }), art({ id: 4, source: 'Quiet', publishedAt: hoursAgo(20).toISOString() }),
    ];
    expect(spreadSources(list, 3).map((a) => a.id)).toEqual([1, 4, 2]);
  });

  const weatherRoute: [string, () => unknown] = ['open-meteo', () => ({ daily: {
    time: ['2026-11-15', '2026-11-16'], weather_code: [0, 71], temperature_2m_max: [48.4, 39.6], temperature_2m_min: [29.5, 25.1], precipitation_probability_max: [0, 70] } })];

  it('one broken feed is written on that feed and the others still come in', async () => {
    await db.query(`insert into kv (key, value) values ('feeds:seeded', 'true')`);
    await db.query(`insert into feeds (url, title, section) values ('https://good.example/feed', 'Good', 'ai'), ('https://bad.example/feed', 'Bad', 'ai'), ('https://empty.example/feed', 'Empty', 'tech')`);
    const f = fakeFetch([
      ['good.example', () => rss([{ title: 'Fresh AI news', link: 'https://good.example/a', hours: 2 }, { title: 'More AI news', link: 'https://good.example/b', hours: 5 }])],
      ['bad.example', () => new Response('gone', { status: 410 })],
      ['empty.example', () => '<html>not a feed</html>'],
    ]);
    deps = makeDeps(db, { fetch: f });
    expect(await refreshFeeds(deps)).toEqual({ checked: 3, ok: 1, failed: 2, added: 2 });
    const feeds = (await db.query('select title, last_error, last_ok from feeds order by title')).rows;
    expect(feeds.map((x: any) => [x.title, x.last_error])).toEqual([['Bad', 'answered 410'], ['Empty', 'no articles found'], ['Good', null]]);
    // nothing is due again for 3 hours; the same articles are not added twice when forced
    expect((await refreshFeeds(makeDeps(db, { fetch: f, now: () => new Date(NOW.getTime() + 3600_000) }))).checked).toBe(0);
    expect((await refreshFeeds(deps, { force: true })).added).toBe(0);
  });

  it('prints a section from the last 36 hours, and falls back to the week when it has been quiet', async () => {
    await db.query(`insert into kv (key, value) values ('feeds:seeded', 'true')`);
    await db.query(`insert into feeds (url, title, section) values ('https://ai.example/feed', 'AI Site', 'ai'), ('https://hunt.example/feed', 'Hunt Site', 'hunting')`);
    const f = fakeFetch([
      ['ai.example', () => rss([1, 2, 3, 100].map((h) => ({ title: `AI ${h}h`, link: `https://ai.example/${h}`, hours: h })))],
      ['hunt.example', () => rss([60, 90].map((h) => ({ title: `Hunt ${h}h`, link: `https://hunt.example/${h}`, hours: h })))],
      weatherRoute,
    ]);
    deps = makeDeps(db, { fetch: f });
    await refreshFeeds(deps);
    await upsertVideos(db, [video({ id: vidId(1), title: 'Claude agents tutorial' })], DEFAULT_TOPICS, 'uploads');
    const ed = await buildEdition(deps);
    const ai = ed.sections.find((s) => s.id === 'ai')!;
    expect(ai.articles.map((a) => a.title)).toEqual(['AI 1h', 'AI 2h', 'AI 3h']);
    expect(ai.videos.map((v) => v.id)).toEqual([vidId(1)]);
    expect(ed.sections.find((s) => s.id === 'hunting')!.articles.map((a) => a.title)).toEqual(['Hunt 60h', 'Hunt 90h']);
    expect(ed.sections.some((s) => s.id === 'football')).toBe(false);
    expect(ed.weather).toMatchObject({ place: 'Salt Lake City', days: [
      { label: 'Today', high: 48, low: 30, words: 'Clear', rainChance: 0 }, { label: 'Tomorrow', high: 40, low: 25, words: 'Snow', rainChance: 70 }] });
  });

  it('takes in an article whose summary was cut through an emoji', async () => {
    await db.query(`insert into kv (key, value) values ('feeds:seeded', 'true')`);
    await db.query(`insert into feeds (url, title, section) values ('https://ai.example/feed', 'AI Site', 'ai')`);
    // one long unbroken run with an emoji at character 200, which is exactly where the summary gets cut
    const f = fakeFetch([['ai.example', () => rss([{ title: 'Emoji story', link: 'https://ai.example/e', hours: 1, body: 'y'.repeat(199) + '\ud83e\udd8c' + 'z'.repeat(60) }])]]);
    expect(await refreshFeeds(makeDeps(db, { fetch: f }))).toEqual({ checked: 1, ok: 1, failed: 0, added: 1 });
  });

  it('still prints when the weather service is down', async () => {
    await db.query(`insert into kv (key, value) values ('feeds:seeded', 'true')`);
    const ed = await buildEdition(makeDeps(db));
    expect(ed.weather).toBeNull();
    expect(ed.sections).toEqual([]);
  });

  it('saves an article, and keeps saved ones past the 14-day clean-up', async () => {
    await db.query(`insert into kv (key, value) values ('feeds:seeded', 'true')`);
    await db.query(`insert into feeds (url, title, section) values ('https://ai.example/feed', 'AI Site', 'ai')`);
    const f = fakeFetch([['ai.example', () => rss([{ title: 'Keep me', link: 'https://ai.example/keep', hours: 1 }, { title: 'Drop me', link: 'https://ai.example/drop', hours: 1 }])], weatherRoute]);
    deps = makeDeps(db, { fetch: f });
    const cookie = await signIn(deps);
    await call(deps, 'POST', '/api/refresh', {}, cookie);
    const keep = (await db.query(`select id from articles where title = 'Keep me'`)).rows[0].id;
    await call(deps, 'POST', '/api/article', { id: keep, saved: true }, cookie);
    const muchLater = makeDeps(db, { fetch: fakeFetch([['ai.example', () => rss([{ title: 'New one', link: 'https://ai.example/new', hours: -24 * 20 }])], weatherRoute]), now: () => new Date(NOW.getTime() + 20 * 86400_000) });
    await refreshFeeds(muchLater, { force: true });
    expect((await db.query('select title from articles order by title')).rows.map((x: any) => x.title)).toEqual(['Keep me', 'New one']);
    const paper = (await call(muchLater, 'GET', '/api/paper', undefined, cookie)).body;
    expect(paper.saved.map((a: any) => a.title)).toEqual(['Keep me']);
  });

  it('adds, switches off and removes feeds', async () => {
    deps = makeDeps(db);
    const cookie = await signIn(deps);
    const before = (await call(deps, 'GET', '/api/feeds', undefined, cookie)).body.feeds;
    expect(before).toHaveLength(DEFAULT_FEEDS.length);
    expect((await call(deps, 'POST', '/api/feeds', { url: 'not a link', section: 'ai' }, cookie)).status).toBe(400);
    expect((await call(deps, 'POST', '/api/feeds', { url: 'https://new.example/rss', section: 'nosuch' }, cookie)).status).toBe(400);
    await call(deps, 'POST', '/api/feeds', { url: 'https://new.example/rss', section: 'tech' }, cookie);
    const added = (await call(deps, 'GET', '/api/feeds', undefined, cookie)).body.feeds.find((x: any) => x.url === 'https://new.example/rss');
    await call(deps, 'POST', '/api/feeds', { id: added.id, enabled: false }, cookie);
    expect((await db.query('select enabled from feeds where id = $1', [added.id])).rows[0].enabled).toBe(false);
    await call(deps, 'DELETE', `/api/feeds?id=${added.id}`, undefined, cookie);
    // deleting every default feed must not bring them back
    await db.query('delete from feeds');
    expect((await call(deps, 'GET', '/api/feeds', undefined, cookie)).body.feeds).toEqual([]);
  });
});

describe('the daily job', () => {
  let db: Db;
  beforeEach(async () => { db = await testDb(); await db.query(`insert into kv (key, value) values ('feeds:seeded', 'true')`); });
  afterAll(closeDb);

  it('only runs for Vercel when a secret is set', async () => {
    const deps = makeDeps(db, { env: { CRON_SECRET: 's3cret' } });
    expect((await call(deps, 'GET', '/api/cron')).status).toBe(401);
    const res = await (await import('@/lib/api')).handle(new Request('http://localhost/api/cron', { headers: { authorization: 'Bearer s3cret' } }), deps);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ gather: { skipped: ['no-key'] }, feeds: { checked: 0, ok: 0, failed: 0, added: 0 } });
  });

  it('without a secret, runs at most once an hour', async () => {
    const deps = makeDeps(db);
    expect((await call(deps, 'GET', '/api/cron')).body.gather).toBeDefined();
    expect((await call(deps, 'GET', '/api/cron')).body).toEqual({ skipped: 'ran-recently' });
  });

  it('lets the page refresh videos and the paper separately', async () => {
    const deps = makeDeps(db);
    const cookie = await signIn(deps);
    expect((await call(deps, 'POST', '/api/refresh', { only: 'videos' }, cookie)).body).toEqual({ gather: { skipped: ['no-key'] } });
    expect((await call(deps, 'POST', '/api/refresh', { only: 'paper' }, cookie)).body).toEqual({ feeds: { checked: 0, ok: 0, failed: 0, added: 0 } });
    expect(Object.keys((await call(deps, 'POST', '/api/refresh', {}, cookie)).body).sort()).toEqual(['feeds', 'gather']);
  });

  it('clears out old untouched videos but keeps anything he saved', async () => {
    await saveSecrets(db, {});
    const old = new Date(NOW.getTime() - 90 * 86400_000).toISOString();
    await upsertVideos(db, [video({ id: vidId(1), publishedAt: old }), video({ id: vidId(2), publishedAt: old }), video({ id: vidId(3) })], DEFAULT_TOPICS, 'uploads');
    await db.query(`insert into vstate (video_id, later) values ($1, true)`, [vidId(2)]);
    await call(makeDeps(db), 'GET', '/api/cron');
    expect((await db.query('select id from videos order by id')).rows.map((x: any) => x.id)).toEqual([vidId(2), vidId(3)]);
  });
});
