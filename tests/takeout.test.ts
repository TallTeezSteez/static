import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import type { Db, Deps } from '@/lib/types';
import { parseSubscriptionsCsv, parseWatchHistoryHtml, parseWatchHistoryJson, summarizeHistory, videoIdFromUrl } from '@/lib/takeout';
import { call, chanId, closeDb, makeDeps, NOW, signIn, testDb } from './helpers';

const CH_A = chanId('A');
const CH_B = chanId('B');

const CSV = `Channel Id,Channel Url,Channel Title
${CH_A},http://www.youtube.com/channel/${CH_A},Plain Channel
${CH_B},http://www.youtube.com/channel/${CH_B},"Hunting, Fishing & ""More"""
not-a-channel,http://x,Broken Row
${CH_A},http://www.youtube.com/channel/${CH_A},Duplicate
`;

const JSON_EXPORT = JSON.stringify([
  { header: 'YouTube', title: 'Watched Elk hunt part 1', titleUrl: 'https://www.youtube.com/watch?v=AAAAAAAAAAA',
    subtitles: [{ name: 'Hunt Channel', url: `https://www.youtube.com/channel/${CH_A}` }], time: '2026-11-01T02:03:04.567Z', products: ['YouTube'] },
  { header: 'YouTube', title: 'Watched An advert', titleUrl: 'https://www.youtube.com/watch?v=ADADADADADA',
    subtitles: [{ name: 'Brand', url: `https://www.youtube.com/channel/${CH_B}` }], time: '2026-11-01T01:00:00Z',
    details: [{ name: 'From Google Ads' }] },
  { header: 'YouTube', title: 'Watched https://www.youtube.com/watch?v=REMOVED0001', titleUrl: 'https://www.youtube.com/watch?v=REMOVED0001', time: '2025-01-05T10:00:00Z' },
  { header: 'YouTube', title: 'Watched a video that has been removed', time: '2025-01-04T10:00:00Z' },
  { header: 'YouTube', title: 'Viewed a post', titleUrl: 'https://www.youtube.com/post/Ugkx123', time: '2025-01-03T10:00:00Z' },
  { header: 'YouTube', title: 'Watched Elk hunt part 1', titleUrl: 'https://www.youtube.com/watch?v=AAAAAAAAAAA',
    subtitles: [{ name: 'Hunt Channel', url: `https://www.youtube.com/channel/${CH_A}` }], time: '2025-02-01T00:00:00Z', products: ['YouTube'] },
  { header: 'YouTube Music', title: 'Watched A song', titleUrl: 'https://music.youtube.com/watch?v=MUSIC000001',
    subtitles: [{ name: 'Band', url: `https://www.youtube.com/channel/${CH_B}` }], time: '2026-10-20T00:00:00Z' },
]);

const cell = (inner: string, extra = '') =>
  `<div class="outer-cell mdl-cell mdl-cell--12-col mdl-shadow--2dp"><div class="mdl-grid"><div class="header-cell mdl-cell mdl-cell--12-col"><p class="mdl-typography--title">YouTube<br></p></div><div class="content-cell mdl-cell mdl-cell--6-col mdl-typography--body-1">${inner}</div><div class="content-cell mdl-cell mdl-cell--12-col mdl-typography--caption"><b>Products:</b><br>&emsp;YouTube<br>${extra}</div></div></div>`;

const HTML_EXPORT = `<html><body><div class="mdl-grid">` +
  cell(`Watched <a href="https://www.youtube.com/watch?v=AAAAAAAAAAA">Elk hunt part 1</a><br><a href="https://www.youtube.com/channel/${CH_A}">Hunt Channel</a><br>Oct 31, 2026, 8:03:04 PM MDT<br>`) +
  cell(`Watched <a href="https://www.youtube.com/watch?v=ADADADADADA">An advert</a><br><a href="https://www.youtube.com/channel/${CH_B}">Brand</a><br>Oct 31, 2026, 7:00:00 PM MDT<br>`, '<b>Details:</b><br>&emsp;From Google Ads<br>') +
  cell(`Watched <a href="https://www.youtube.com/watch?v=REMOVED0001">https://www.youtube.com/watch?v=REMOVED0001</a><br>Jan 5, 2025, 3:00:00 AM MST<br>`) +
  cell(`Watched a video that has been removed<br>Jan 4, 2025, 3:00:00 AM MST<br>`) +
  cell(`Watched <a href="https://www.youtube.com/watch?v=AAAAAAAAAAA">Elk hunt part 1</a><br><a href="https://www.youtube.com/channel/${CH_A}">Hunt Channel</a><br>Jan 31, 2025, 5:00:00 PM MST<br>`) +
  cell(`Watched <a href="https://music.youtube.com/watch?v=MUSIC000001">Tom &amp; Jerry&#39;s song</a><br><a href="https://www.youtube.com/channel/${CH_B}">Band</a><br>Oct 19, 2026, 6:00:00 PM MDT<br>`) +
  `</div></body></html>`;

describe('reading the YouTube export', () => {
  it('pulls video ids out of the link shapes YouTube uses', () => {
    expect(videoIdFromUrl('https://www.youtube.com/watch?v=AAAAAAAAAAA&t=10s')).toBe('AAAAAAAAAAA');
    expect(videoIdFromUrl('https://youtu.be/BBBBBBBBBBB')).toBe('BBBBBBBBBBB');
    expect(videoIdFromUrl('https://www.youtube.com/post/Ugkx123')).toBeNull();
  });

  it('reads subscriptions, including a quoted title with a comma, and skips broken and repeated rows', () => {
    expect(parseSubscriptionsCsv(CSV)).toEqual([
      { id: CH_A, title: 'Plain Channel' },
      { id: CH_B, title: 'Hunting, Fishing & "More"' },
    ]);
    expect(parseSubscriptionsCsv('')).toEqual([]);
  });

  it('reads watch history JSON and leaves out ads, posts and entries with no link', () => {
    const entries = parseWatchHistoryJson(JSON_EXPORT);
    expect(entries.map((e) => e.videoId)).toEqual(['AAAAAAAAAAA', 'REMOVED0001', 'AAAAAAAAAAA', 'MUSIC000001']);
    expect(entries[0]).toEqual({ videoId: 'AAAAAAAAAAA', title: 'Elk hunt part 1', channelId: CH_A, channelTitle: 'Hunt Channel', at: '2026-11-01T02:03:04.567Z' });
    expect(entries[1].channelId).toBeUndefined();
    expect(parseWatchHistoryJson('not json')).toEqual([]);
    expect(parseWatchHistoryJson('{"a":1}')).toEqual([]);
  });

  it('reads the same history when it was exported as HTML', () => {
    const fromHtml = parseWatchHistoryHtml(HTML_EXPORT);
    const fromJson = parseWatchHistoryJson(JSON_EXPORT);
    expect(fromHtml.map((e) => [e.videoId, e.channelId])).toEqual(fromJson.map((e) => [e.videoId, e.channelId]));
    expect(fromHtml[3].title).toBe("Tom & Jerry's song");
    expect(fromHtml[0].at.slice(0, 4)).toBe('2026');
    expect(parseWatchHistoryHtml('<html></html>')).toEqual([]);
  });

  it('counts watches per channel and keeps each video once with its latest date', () => {
    const s = summarizeHistory(parseWatchHistoryJson(JSON_EXPORT), NOW);
    expect(s.seen).toHaveLength(3);
    expect(s.seen.find((x) => x.id === 'AAAAAAAAAAA')!.at).toBe('2026-11-01T02:03:04.567Z');
    expect(s.channels).toEqual([
      { id: CH_A, title: 'Hunt Channel', count: 2, recent: 1, last: '2026-11-01T02:03:04.567Z' },
      { id: CH_B, title: 'Band', count: 1, recent: 1, last: '2026-10-20T00:00:00.000Z' },
    ]);
  });
});

describe('importing into the app', () => {
  let db: Db; let deps: Deps; let cookie: string;
  beforeEach(async () => { db = await testDb(); deps = makeDeps(db); cookie = await signIn(deps); });
  afterAll(closeDb);

  const payload = () => {
    const s = summarizeHistory(parseWatchHistoryJson(JSON_EXPORT), NOW);
    return { subscriptions: parseSubscriptionsCsv(CSV), channels: s.channels, seen: s.seen, done: true };
  };
  const snapshot = async () => ({
    channels: (await db.query('select id, title, subscribed, watch_count, recent_count from channels order by id')).rows,
    seen: (await db.query('select video_id, source from seen order by video_id')).rows,
  });

  it('saves subscriptions, watch counts and seen videos', async () => {
    const r = await call(deps, 'POST', '/api/import', payload(), cookie);
    expect(r.body.counts).toEqual({ subscriptions: 2, channels: 2, seen: 3 });
    const snap = await snapshot();
    expect(snap.channels).toEqual([
      { id: CH_A, title: 'Plain Channel', subscribed: true, watch_count: 2, recent_count: 1 },
      { id: CH_B, title: 'Hunting, Fishing & "More"', subscribed: true, watch_count: 1, recent_count: 1 },
    ]);
    expect(snap.seen.map((x: any) => x.video_id)).toEqual(['AAAAAAAAAAA', 'MUSIC000001', 'REMOVED0001']);
  });

  it('changes nothing when the same export is imported twice', async () => {
    await call(deps, 'POST', '/api/import', payload(), cookie);
    const first = await snapshot();
    await call(deps, 'POST', '/api/import', payload(), cookie);
    expect(await snapshot()).toEqual(first);
  });

  it('ignores rows with bad ids instead of failing', async () => {
    const r = await call(deps, 'POST', '/api/import', { subscriptions: [{ id: 'nope' }, null], seen: [{ id: 'short' }, 5], channels: 'x' }, cookie);
    expect(r.status).toBe(200);
    expect(r.body.counts).toEqual({ subscriptions: 0, channels: 0, seen: 0 });
  });
});
