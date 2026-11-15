import type { Deps, Show } from './types';
import { kvGet, kvSet } from './db';
import { loadSecrets, loadSettings } from './settings';
import { upsertVideos } from './gather';
import { liveStreams, twitchReady } from './twitch';
import { QuotaError, YouTube } from './youtube';

export type LiveItem = {
  platform: 'youtube' | 'twitch';
  id: string; // YouTube video id or Twitch login
  title: string;
  channel: string;
  viewers: number | null;
  thumb: string;
  startsAt: string | null;
  url: string;
  game?: string;
};

export type ShowSlot = {
  showId: string; name: string; platform: 'youtube' | 'twitch'; url: string;
  date: string; dayLabel: string; time: string; approx: boolean; startsAt: string; live: boolean;
};

export type LiveData = { youtube: LiveItem[]; twitch: LiveItem[]; upcoming: LiveItem[]; week: ShowSlot[]; notes: string[]; at: string };

const CACHE_MS = 5 * 60_000;
const MAX_LIVE_CHANNELS = 30;

/** How far a time zone is ahead of UTC at a given moment, in milliseconds. */
function tzOffsetMs(at: Date, tz: string): number {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: tz, hourCycle: 'h23', year: 'numeric', month: 'numeric', day: 'numeric', hour: 'numeric', minute: 'numeric', second: 'numeric',
  }).formatToParts(at);
  const n = (type: string) => Number(parts.find((p) => p.type === type)?.value);
  return Date.UTC(n('year'), n('month') - 1, n('day'), n('hour'), n('minute'), n('second')) - Math.floor(at.getTime() / 1000) * 1000;
}

/** The UTC moment of a wall-clock date and time in a time zone. */
export function zonedToUtc(date: string, time: string, tz: string): Date {
  const [y, m, d] = date.split('-').map(Number);
  const [hh, mm] = time.split(':').map(Number);
  const guess = Date.UTC(y, m - 1, d, hh, mm);
  return new Date(guess - tzOffsetMs(new Date(guess), tz));
}

function localDate(at: Date, tz: string): { date: string; weekday: number } {
  const shifted = new Date(at.getTime() + tzOffsetMs(at, tz));
  return { date: shifted.toISOString().slice(0, 10), weekday: shifted.getUTCDay() };
}

const DAY_NAMES = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

function showIsLive(show: Show, live: LiveItem[]): boolean {
  const match = show.match.toLowerCase();
  return live.some((l) => l.platform === show.platform && (show.platform === 'twitch' ? l.id === match : l.channel.toLowerCase().includes(match)));
}

/** The next seven days of regular shows, soonest first. Today's slots that ended over 4 hours ago are left out. */
export function weekSlots(shows: Show[], now: Date, tz: string, live: LiveItem[] = []): ShowSlot[] {
  const out: ShowSlot[] = [];
  for (let i = 0; i < 7; i++) {
    const day = localDate(new Date(now.getTime() + i * 86400_000), tz);
    for (const show of shows) {
      if (!show.days.includes(day.weekday)) continue;
      const startsAt = zonedToUtc(day.date, show.time, tz);
      const isLive = i === 0 && showIsLive(show, live);
      if (!isLive && startsAt.getTime() < now.getTime() - 4 * 3600_000) continue;
      out.push({
        showId: show.id, name: show.name, platform: show.platform, url: show.url, date: day.date,
        dayLabel: i === 0 ? 'Today' : i === 1 ? 'Tomorrow' : DAY_NAMES[day.weekday],
        time: show.time, approx: show.approx, startsAt: startsAt.toISOString(), live: isLive,
      });
    }
  }
  return out.sort((a, b) => a.startsAt.localeCompare(b.startsAt));
}

/** Makes sure each YouTube show's channel is in the channel list, so its streams get noticed. Looked up once per show. */
async function ensureShowChannels(deps: Deps, yt: YouTube, shows: Show[]): Promise<void> {
  const done = (await kvGet<string[]>(deps.db, 'shows:resolved')) || [];
  let changed = false;
  for (const show of shows) {
    if (show.platform !== 'youtube' || done.includes(show.id)) continue;
    const handle = /@[A-Za-z0-9._-]+/.exec(show.url)?.[0];
    if (handle) {
      const ch = await yt.resolveChannel(handle);
      if (ch) {
        await deps.db.query(
          `insert into channels (id, title, source, live_prone) values ($1, $2, 'default', true)
           on conflict (id) do update set live_prone = true`, [ch.id, ch.title]);
      }
    }
    done.push(show.id);
    changed = true;
  }
  if (changed) await kvSet(deps.db, 'shows:resolved', done);
}

async function youtubeLive(deps: Deps, yt: YouTube, shows: Show[]): Promise<{ live: LiveItem[]; upcoming: LiveItem[] }> {
  const { db } = deps;
  const settings = await loadSettings(db);
  await ensureShowChannels(deps, yt, shows);
  const chans = await db.query<{ id: string }>(
    `select id from channels where live_prone and not hidden order by (source = 'default') desc, recent_count desc, watch_count desc limit ${MAX_LIVE_CHANNELS}`);
  const lists = await Promise.allSettled(chans.rows.map((c) => yt.channelUploads(c.id, 5)));
  const ids = new Set<string>();
  for (const l of lists) {
    if (l.status === 'fulfilled') l.value.forEach((id) => ids.add(id));
    else if (l.reason instanceof QuotaError) throw l.reason;
  }
  const flagged = await db.query<{ id: string }>(`select id from videos where live_state <> 'none' order by fetched_at desc limit 60`);
  flagged.rows.forEach((r) => ids.add(r.id));
  const videos = await yt.videoDetails([...ids].slice(0, 150));
  await upsertVideos(db, videos, settings.topics, 'uploads');
  // a stream that ended and was removed no longer comes back from YouTube: clear its flag
  const returned = new Set(videos.map((v) => v.id));
  const gone = flagged.rows.map((r) => r.id).filter((id) => !returned.has(id));
  if (gone.length) await db.query(`update videos set live_state = 'none' where id = any($1)`, [gone]);

  const toItem = (v: (typeof videos)[number]): LiveItem => ({
    platform: 'youtube', id: v.id, title: v.title, channel: v.channelTitle, viewers: v.liveViewers, thumb: v.thumb,
    startsAt: v.scheduledStart, url: `https://www.youtube.com/watch?v=${v.id}`,
  });
  const now = deps.now().getTime();
  return {
    live: videos.filter((v) => v.liveState === 'live').map(toItem).sort((a, b) => (b.viewers || 0) - (a.viewers || 0)),
    upcoming: videos
      .filter((v) => v.liveState === 'upcoming' && v.scheduledStart && Date.parse(v.scheduledStart) > now - 3600_000 && Date.parse(v.scheduledStart) < now + 7 * 86400_000)
      .map(toItem).sort((a, b) => String(a.startsAt).localeCompare(String(b.startsAt))),
  };
}

/** Who's live now, what's scheduled, and the week of regular shows. Each source can fail on its own. */
export async function getLive(deps: Deps, opts: { force?: boolean } = {}): Promise<LiveData> {
  const { db } = deps;
  const now = deps.now();
  const cached = await kvGet<LiveData>(db, 'live:cache');
  if (!opts.force && cached && now.getTime() - Date.parse(cached.at) < CACHE_MS) return cached;

  const settings = await loadSettings(db);
  const secrets = await loadSecrets(db);
  const notes: string[] = [];
  let youtube: LiveItem[] = [];
  let upcoming: LiveItem[] = [];
  let twitch: LiveItem[] = [];

  if (!secrets.youtubeKey) notes.push('youtube-not-set-up');
  else {
    try { ({ live: youtube, upcoming } = await youtubeLive(deps, new YouTube(secrets.youtubeKey, deps.fetch), settings.shows)); }
    catch (e) { notes.push(e instanceof QuotaError ? 'youtube-quota' : 'youtube-unavailable'); }
  }
  if (!twitchReady(secrets)) notes.push('twitch-not-set-up');
  else {
    try {
      twitch = (await liveStreams(deps)).map((s) => ({
        platform: 'twitch' as const, id: s.login, title: s.title, channel: s.name, viewers: s.viewers, thumb: s.thumb,
        startsAt: s.startedAt || null, url: `https://www.twitch.tv/${s.login}`, game: s.game,
      }));
    } catch { notes.push('twitch-unavailable'); }
  }
  const data: LiveData = {
    youtube, twitch, upcoming, notes, at: now.toISOString(),
    week: weekSlots(settings.shows, now, settings.tz, [...youtube, ...twitch]),
  };
  await kvSet(db, 'live:cache', data);
  return data;
}
