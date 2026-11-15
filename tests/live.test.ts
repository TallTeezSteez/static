import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import type { Db, Show } from '@/lib/types';
import { getLive, weekSlots, zonedToUtc, type LiveItem } from '@/lib/live';
import { normalizeScoreboard, getNfl } from '@/lib/nfl';
import { saveSecrets } from '@/lib/settings';
import { cleanLogin } from '@/lib/twitch';
import { call, chanId, closeDb, fakeFetch, makeDeps, NOW, signIn, testDb } from './helpers';

const TZ = 'America/Denver';
const SHOWS: Show[] = [
  { id: 'mcafee', name: 'The Pat McAfee Show', platform: 'youtube', match: 'Pat McAfee', url: 'https://www.youtube.com/@ThePatMcAfeeShow/live', days: [1, 2, 3, 4, 5], time: '10:00', approx: true },
  { id: 'wan', name: 'The WAN Show', platform: 'youtube', match: 'Linus Tech Tips', url: 'https://www.youtube.com/@LinusTechTips/live', days: [5], time: '17:30', approx: true },
];

describe('the week of regular shows', () => {
  it('turns a Denver wall-clock time into the right UTC moment, in winter and summer', () => {
    expect(zonedToUtc('2026-11-16', '10:00', TZ).toISOString()).toBe('2026-11-16T17:00:00.000Z'); // MST, UTC-7
    expect(zonedToUtc('2026-07-06', '10:00', TZ).toISOString()).toBe('2026-07-06T16:00:00.000Z'); // MDT, UTC-6
  });

  it('lists the next seven days: five weekday shows and one Friday show, soonest first', () => {
    // NOW is Sunday Nov 15, 2026, 1:00 PM in Denver
    const slots = weekSlots(SHOWS, NOW, TZ);
    expect(slots.map((s) => `${s.dayLabel} ${s.showId}`)).toEqual([
      'Tomorrow mcafee', 'Tuesday mcafee', 'Wednesday mcafee', 'Thursday mcafee', 'Friday mcafee', 'Friday wan',
    ]);
    expect(slots[0].startsAt).toBe('2026-11-16T17:00:00.000Z');
    expect(slots[5].startsAt).toBe('2026-11-21T00:30:00.000Z');
    expect(slots.every((s) => !s.live)).toBe(true);
  });

  it('drops a slot from earlier today once it is long over, but keeps it while the show is live', () => {
    const mondayEvening = new Date('2026-11-17T01:00:00Z'); // Monday 6 PM Denver; McAfee started 8 hours ago
    expect(weekSlots(SHOWS, mondayEvening, TZ)[0].dayLabel).toBe('Tomorrow');
    const live: LiveItem[] = [{ platform: 'youtube', id: 'x', title: 'Live', channel: 'The Pat McAfee Show', viewers: 9, thumb: '', startsAt: null, url: '' }];
    const slots = weekSlots(SHOWS, mondayEvening, TZ, live);
    expect(slots[0]).toMatchObject({ dayLabel: 'Today', showId: 'mcafee', live: true });
  });
});

describe('live now', () => {
  let db: Db;
  beforeEach(async () => { db = await testDb(); });
  afterAll(closeDb);

  it('says what is not set up instead of failing', async () => {
    const data = await getLive(makeDeps(db));
    expect(data.notes).toEqual(['youtube-not-set-up', 'twitch-not-set-up']);
    expect(data.youtube).toEqual([]);
    expect(data.week.length).toBeGreaterThan(0);
  });

  const twitchFetch = () => fakeFetch([
    ['oauth2/token', () => ({ access_token: 'TOKEN1', expires_in: 3600 })],
    ['helix/streams', () => ({ data: [{ user_login: 'Shroud', user_name: 'shroud', title: 'ranked', game_name: 'Valorant', viewer_count: 100, started_at: '2026-11-15T19:00:00Z', thumbnail_url: 'https://t/{width}x{height}.jpg' }] })],
  ]);

  it('lists live Twitch channels and reuses the token until it runs out', async () => {
    await saveSecrets(db, { twitchId: 'id', twitchSecret: 'secret' });
    await db.query(`insert into twitch_channels (login) values ('shroud'), ('other')`);
    const f = twitchFetch();
    const first = await getLive(makeDeps(db, { fetch: f }), { force: true });
    expect(first.twitch).toEqual([expect.objectContaining({ platform: 'twitch', id: 'shroud', game: 'Valorant', viewers: 100, thumb: 'https://t/440x248.jpg', url: 'https://www.twitch.tv/shroud' })]);
    expect(first.notes).toEqual(['youtube-not-set-up']);
    await getLive(makeDeps(db, { fetch: f, now: () => new Date(NOW.getTime() + 20 * 60_000) }), { force: true });
    expect(f.calls.filter((u) => u.includes('oauth2/token'))).toHaveLength(1);
    await getLive(makeDeps(db, { fetch: f, now: () => new Date(NOW.getTime() + 2 * 3600_000) }), { force: true });
    expect(f.calls.filter((u) => u.includes('oauth2/token'))).toHaveLength(2);
  });

  it('answers from its 5-minute cache without calling out again', async () => {
    await saveSecrets(db, { twitchId: 'id', twitchSecret: 'secret' });
    await db.query(`insert into twitch_channels (login) values ('shroud')`);
    const f = twitchFetch();
    await getLive(makeDeps(db, { fetch: f }));
    const n = f.calls.length;
    await getLive(makeDeps(db, { fetch: f, now: () => new Date(NOW.getTime() + 4 * 60_000) }));
    expect(f.calls.length).toBe(n);
  });

  it('keeps the page alive when Twitch is down', async () => {
    await saveSecrets(db, { twitchId: 'id', twitchSecret: 'secret' });
    await db.query(`insert into twitch_channels (login) values ('shroud')`);
    const data = await getLive(makeDeps(db, { fetch: fakeFetch([['oauth2/token', () => new Response('no', { status: 500 })]]) }));
    expect(data.notes).toContain('twitch-unavailable');
  });

  it('finds live and upcoming YouTube streams on channels that stream', async () => {
    await saveSecrets(db, { youtubeKey: 'KEY' });
    await db.query(`insert into channels (id, title, live_prone, subscribed) values ($1, 'Streamer', true, true)`, [chanId('L')]);
    await db.query(`insert into kv (key, value) values ('shows:resolved', '["mcafee","wan"]')`);
    const item = (id: string, state: string, extra: any = {}) => ({
      id, snippet: { channelId: chanId('L'), channelTitle: 'Streamer', title: `Stream ${id}`, liveBroadcastContent: state, publishedAt: '2026-11-15T00:00:00Z' },
      contentDetails: { duration: 'P0D' }, statistics: {}, status: { embeddable: true }, liveStreamingDetails: extra,
    });
    const f = fakeFetch([
      ['playlistItems', () => ({ items: ['liveNOW0001', 'upcoming001', 'oldvideo001'].map((videoId) => ({ contentDetails: { videoId } })) })],
      ['/videos', () => ({ items: [
        item('liveNOW0001', 'live', { actualStartTime: '2026-11-15T19:00:00Z', concurrentViewers: '4321' }),
        item('upcoming001', 'upcoming', { scheduledStartTime: '2026-11-16T02:00:00Z' }),
        item('oldvideo001', 'none'),
      ] })],
    ]);
    const data = await getLive(makeDeps(db, { fetch: f }));
    expect(data.youtube).toEqual([expect.objectContaining({ id: 'liveNOW0001', channel: 'Streamer', viewers: 4321 })]);
    expect(data.upcoming.map((u) => u.id)).toEqual(['upcoming001']);
    expect(data.notes).toEqual(['twitch-not-set-up']);
  });

  it('adds and removes Twitch channels by name or link', async () => {
    expect(cleanLogin('https://www.twitch.tv/Shroud')).toBe('shroud');
    expect(cleanLogin('  summit1g ')).toBe('summit1g');
    expect(cleanLogin('no good!')).toBeNull();
    const deps = makeDeps(db);
    const cookie = await signIn(deps);
    await call(deps, 'POST', '/api/twitch/channels', { login: 'twitch.tv/Shroud' }, cookie);
    expect((await call(deps, 'GET', '/api/twitch/channels', undefined, cookie)).body.channels.map((c: any) => c.login)).toEqual(['shroud']);
    await call(deps, 'DELETE', '/api/twitch/channels?login=shroud', undefined, cookie);
    expect((await call(deps, 'GET', '/api/twitch/channels', undefined, cookie)).body.channels).toEqual([]);
    expect((await call(deps, 'GET', '/api/twitch/auth', undefined, cookie)).location).toBe('/?twitch=not-set-up');
  });
});

const team = (id: string, abbr: string, name: string, homeAway: string, score: string, record: string) => ({
  id, homeAway, score, records: [{ summary: record }],
  team: { id, abbreviation: abbr, shortDisplayName: name, displayName: name, logo: `https://a.espncdn.com/i/teamlogos/nfl/500/${abbr.toLowerCase()}.png` },
});
const SCOREBOARD = {
  week: { number: 11 },
  events: [
    { id: '1', date: '2026-11-16T01:20Z', competitions: [{ competitors: [team('10', 'DAL', 'Cowboys', 'home', '0', '5-4'), team('11', 'PHI', 'Eagles', 'away', '0', '7-2')],
      status: { displayClock: '0:00', period: 0, type: { state: 'pre', shortDetail: '11/15 - 8:20 PM EST' } }, broadcasts: [{ names: ['NBC'] }] }] },
    { id: '2', date: '2026-11-15T21:25Z', competitions: [{ competitors: [team('20', 'DEN', 'Broncos', 'home', '17', '6-3'), team('21', 'KC', 'Chiefs', 'away', '20', '8-1')],
      status: { displayClock: '4:12', period: 3, type: { state: 'in', shortDetail: '4:12 - 3rd' } },
      situation: { possession: '21', isRedZone: true, downDistanceText: '2nd & Goal at DEN 6', lastPlay: { text: 'Pass complete for 14 yards' } },
      broadcasts: [{ names: ['CBS'] }] }] },
    { id: '3', date: '2026-11-15T18:00Z', competitions: [{ competitors: [team('30', 'BUF', 'Bills', 'home', '31', '7-3'), team('31', 'MIA', 'Dolphins', 'away', '10', '3-7')],
      status: { displayClock: '0:00', period: 4, type: { state: 'post', shortDetail: 'Final' } }, situation: { possession: '30', isRedZone: true } }] },
    { id: '4', date: '2026-11-15T21:25Z', competitions: [{ competitors: [team('40', 'SEA', 'Seahawks', 'home', '3', '5-4'), team('41', 'SF', '49ers', 'away', '7', '6-3')],
      status: { displayClock: '9:00', period: 2, type: { state: 'in', shortDetail: '9:00 - 2nd' } }, situation: { possession: '40', isRedZone: false, downDistanceText: '1st & 10 at SEA 25' } }] },
    { id: 'broken', competitions: [{ competitors: [] }] },
  ],
};

describe('football board', () => {
  let db: Db;
  beforeEach(async () => { db = await testDb(); });
  afterAll(closeDb);

  it('boils the scoreboard down, red-zone games first, then live, upcoming, finished', () => {
    const games = normalizeScoreboard(SCOREBOARD);
    expect(games.map((g) => g.id)).toEqual(['2', '4', '1', '3']);
    expect(games[0]).toMatchObject({
      state: 'in', detail: '4:12 - 3rd', clock: '4:12', period: 3, possession: 'away', redZone: true,
      downDistance: '2nd & Goal at DEN 6', lastPlay: 'Pass complete for 14 yards', broadcast: 'CBS',
      home: { abbr: 'DEN', name: 'Broncos', score: 17, record: '6-3' }, away: { abbr: 'KC', name: 'Chiefs', score: 20, record: '8-1' },
    });
    expect(games[1]).toMatchObject({ possession: 'home', redZone: false });
  });

  it('never shows a red zone or the ball on a game that is over or has not started', () => {
    const final = normalizeScoreboard(SCOREBOARD).find((g) => g.id === '3')!;
    expect(final).toMatchObject({ state: 'post', redZone: false, possession: null });
  });

  it('gives an empty list for garbage', () => {
    expect(normalizeScoreboard(null)).toEqual([]);
    expect(normalizeScoreboard({ events: 'nope' })).toEqual([]);
    expect(normalizeScoreboard({ events: [null, 5, {}] })).toEqual([]);
  });

  it('serves scores, and says so plainly when ESPN is down or changes shape', async () => {
    const good = await getNfl(makeDeps(db, { fetch: fakeFetch([['espn.com', () => SCOREBOARD]]) }));
    expect(good).toMatchObject({ ok: true, week: 'Week 11' });
    expect(good.games).toHaveLength(4);

    const later = () => new Date(NOW.getTime() + 60_000);
    const down = await getNfl(makeDeps(db, { now: later, fetch: fakeFetch([['espn.com', () => new Response('oops', { status: 503 })]]) }));
    expect(down).toMatchObject({ ok: false, games: [] });
    const changed = await getNfl(makeDeps(db, { now: later, fetch: fakeFetch([['espn.com', () => ({ sports: [] })]]) }));
    expect(changed).toMatchObject({ ok: false, games: [] });
    const notJson = await getNfl(makeDeps(db, { now: later, fetch: fakeFetch([['espn.com', () => '<html>']]) }));
    expect(notJson).toMatchObject({ ok: false, games: [] });
    const unreachable = await getNfl(makeDeps(db, { now: later }));
    expect(unreachable).toMatchObject({ ok: false, games: [] });
  });

  it('reuses scores for 20 seconds', async () => {
    const f = fakeFetch([['espn.com', () => SCOREBOARD]]);
    await getNfl(makeDeps(db, { fetch: f }));
    await getNfl(makeDeps(db, { fetch: f, now: () => new Date(NOW.getTime() + 10_000) }));
    expect(f.calls).toHaveLength(1);
    await getNfl(makeDeps(db, { fetch: f, now: () => new Date(NOW.getTime() + 25_000) }));
    expect(f.calls).toHaveLength(2);
  });
});
