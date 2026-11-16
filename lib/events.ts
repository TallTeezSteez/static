import type { Db, Deps, Pick } from './types';
import { rowToCandidate, toPick } from './picks';
import { scoreVideo } from './score';

export type AppEvent = {
  type: 'up' | 'down' | 'unvote' | 'skip' | 'seen' | 'unseen' | 'progress' | 'later' | 'unlater' | 'hide_channel' | 'unhide_channel' | 'like_channel';
  videoId?: string;
  channelId?: string;
  seconds?: number;
};

const VIDEO_ID = /^[A-Za-z0-9_-]{11}$/;
const CHANNEL_ID = /^UC[A-Za-z0-9_-]{22}$/;

async function setState(db: Db, videoId: string, sets: string, params: unknown[], now: Date): Promise<void> {
  await db.query(`insert into vstate (video_id, updated_at) values ($1, $2) on conflict (video_id) do nothing`, [videoId, now]);
  await db.query(`update vstate set ${sets}, updated_at = $2 where video_id = $1`, [videoId, now, ...params]);
}

async function channelOf(db: Db, videoId: string): Promise<string | null> {
  const r = await db.query<{ channel_id: string }>('select channel_id from videos where id = $1', [videoId]);
  return r.rows[0]?.channel_id || null;
}

async function bumpRating(db: Db, channelId: string | null, by: number): Promise<void> {
  if (!channelId) return;
  await db.query('update channels set rating = least(5, greatest(-3, rating + $2)) where id = $1', [channelId, by]);
}

async function markSeen(db: Db, videoId: string, now: Date): Promise<void> {
  const r = await db.query(`insert into seen (video_id, at, source) values ($1, $2, 'app') on conflict (video_id) do nothing returning video_id`, [videoId, now]);
  if (r.rows.length === 0) return;
  // watching something makes its channel one he watches: it stops being "new to you"
  await db.query(
    `update channels set watch_count = watch_count + 1, recent_count = recent_count + 1, last_watched = $2
     where id = (select channel_id from videos where id = $1)`, [videoId, now]);
}

/** Records one thing Wyatt did. Returns false when the event doesn't make sense (bad id, unknown type). */
export async function applyEvent(deps: Deps, ev: AppEvent): Promise<boolean> {
  const { db } = deps;
  const now = deps.now();
  const vid = ev.videoId && VIDEO_ID.test(ev.videoId) ? ev.videoId : null;
  const chan = ev.channelId && CHANNEL_ID.test(ev.channelId) ? ev.channelId : null;

  switch (ev.type) {
    case 'up':
      if (!vid) return false;
      await setState(db, vid, 'vote = 1, skipped = false', [], now);
      await bumpRating(db, await channelOf(db, vid), 1);
      return true;
    case 'down':
      if (!vid) return false;
      await setState(db, vid, 'vote = -1, skipped = true, later = false', [], now);
      await bumpRating(db, await channelOf(db, vid), -1);
      return true;
    case 'unvote':
      if (!vid) return false;
      await setState(db, vid, 'vote = 0, skipped = false', [], now);
      return true;
    case 'skip':
      if (!vid) return false;
      await setState(db, vid, 'skipped = true', [], now);
      return true;
    case 'seen':
      if (!vid) return false;
      await markSeen(db, vid, now);
      await setState(db, vid, 'later = false', [], now);
      return true;
    case 'unseen':
      if (!vid) return false;
      await db.query('delete from seen where video_id = $1', [vid]);
      return true;
    case 'progress': {
      if (!vid || !Number.isFinite(ev.seconds)) return false;
      const seconds = Math.max(0, Math.round(ev.seconds!));
      await setState(db, vid, 'progress_s = $3', [seconds], now);
      const r = await db.query<{ duration_s: number }>('select duration_s from videos where id = $1', [vid]);
      const duration = Number(r.rows[0]?.duration_s || 0);
      if (duration > 0 && seconds >= duration * 0.8) { await markSeen(db, vid, now); await setState(db, vid, 'later = false', [], now); }
      return true;
    }
    case 'later':
    case 'unlater':
      if (!vid) return false;
      await setState(db, vid, 'later = $3', [ev.type === 'later'], now);
      return true;
    case 'hide_channel':
    case 'unhide_channel': {
      const id = chan || (vid ? await channelOf(db, vid) : null);
      if (!id) return false;
      await db.query(
        `insert into channels (id, hidden) values ($1, $2) on conflict (id) do update set hidden = $2`,
        [id, ev.type === 'hide_channel']);
      return true;
    }
    case 'like_channel': {
      const id = chan || (vid ? await channelOf(db, vid) : null);
      if (!id) return false;
      await bumpRating(db, id, 2);
      return true;
    }
    default:
      return false;
  }
}

const VIDEO_COLS = `v.id, v.title, v.channel_id, v.channel_title, v.duration_s, v.published_at, v.views, v.thumb, v.embeddable, v.topics,
  coalesce(c.subscribed, false) as subscribed, coalesce(c.watch_count, 0) as watch_count, coalesce(c.recent_count, 0) as recent_count,
  coalesce(c.rating, 0) as rating, coalesce(s.shown, 0) as shown, coalesce(s.vote, 0) as vote,
  coalesce(s.progress_s, 0) as progress_s, coalesce(s.later, false) as later`;

export type Library = {
  later: Pick[];
  continueWatching: Pick[];
  recent: Pick[];
  hiddenChannels: { id: string; title: string }[];
};

export async function getLibrary(deps: Deps): Promise<Library> {
  const { db } = deps;
  const now = deps.now();
  const from = `from videos v left join channels c on c.id = v.channel_id left join vstate s on s.video_id = v.id`;
  const rows = async (where: string, order: string) =>
    (await db.query<any>(`select ${VIDEO_COLS} ${from} ${where} order by ${order} limit 60`)).rows.map((x) => toPick(scoreVideo(rowToCandidate(x), now)));
  const hidden = await db.query<any>(`select id, title from channels where hidden order by title`);
  return {
    later: await rows('where s.later', 's.updated_at desc'),
    continueWatching: await rows(
      'where s.progress_s > 30 and not exists (select 1 from seen where seen.video_id = v.id)', 's.updated_at desc'),
    recent: await rows(
      `join seen on seen.video_id = v.id where seen.source = 'app'`, 'seen.at desc'),
    hiddenChannels: hidden.rows.map((x: any) => ({ id: x.id, title: x.title || x.id })),
  };
}
