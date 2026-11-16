import type { Fetch, Video } from './types';
import { parseIsoDuration } from './duration';

const API = 'https://www.googleapis.com/youtube/v3';

/** YouTube said today's free allowance is used up. Whatever was fetched before this is kept. */
export class QuotaError extends Error {
  constructor() { super('YouTube daily limit reached'); this.name = 'QuotaError'; }
}
export class YouTubeError extends Error {
  status: number;
  constructor(status: number, message: string) { super(message); this.name = 'YouTubeError'; this.status = status; }
}

export type SearchOpts = { publishedAfter?: Date; duration?: 'long' | 'medium' | 'any'; order?: 'viewCount' | 'date' | 'relevance'; max?: number };

export class YouTube {
  calls = 0;
  constructor(private key: string, private fetchImpl: Fetch) {}

  private async get(path: string, params: Record<string, string>): Promise<any> {
    const qs = new URLSearchParams({ ...params, key: this.key });
    this.calls += 1;
    const res = await this.fetchImpl(`${API}/${path}?${qs}`);
    if (res.ok) return res.json();
    let body: any = null;
    try { body = await res.json(); } catch { /* not JSON */ }
    const reason: string = body?.error?.errors?.[0]?.reason || '';
    // Google reports a used-up allowance two ways: the old 403 "quotaExceeded" and the newer 429 "Quota exceeded for…".
    const message: string = body?.error?.message || '';
    if ((res.status === 403 || res.status === 429) && (/quota|rateLimit/i.test(reason) || /quota/i.test(message))) throw new QuotaError();
    throw new YouTubeError(res.status, body?.error?.message || `YouTube answered ${res.status}`);
  }

  /** Newest video ids on a channel. Every channel has an uploads playlist: its id with "UC" swapped for "UU". */
  async channelUploads(channelId: string, max = 12): Promise<string[]> {
    try {
      const data = await this.get('playlistItems', {
        part: 'contentDetails', playlistId: 'UU' + channelId.slice(2), maxResults: String(max),
      });
      return (data.items || []).map((i: any) => i?.contentDetails?.videoId).filter(Boolean);
    } catch (e) {
      if (e instanceof YouTubeError && e.status === 404) return []; // channel gone or has no uploads
      throw e;
    }
  }

  async videoDetails(ids: string[]): Promise<Video[]> {
    const out: Video[] = [];
    for (let i = 0; i < ids.length; i += 50) {
      const data = await this.get('videos', {
        part: 'snippet,contentDetails,statistics,status,liveStreamingDetails',
        id: ids.slice(i, i + 50).join(','), maxResults: '50',
      });
      for (const it of data.items || []) out.push(toVideo(it));
    }
    return out;
  }

  async search(q: string, opts: SearchOpts = {}): Promise<string[]> {
    const params: Record<string, string> = {
      part: 'id', type: 'video', q, maxResults: String(opts.max ?? 25), order: opts.order ?? 'viewCount',
      relevanceLanguage: 'en', regionCode: 'US', videoEmbeddable: 'true',
    };
    if (opts.publishedAfter) params.publishedAfter = opts.publishedAfter.toISOString();
    if (opts.duration && opts.duration !== 'any') params.videoDuration = opts.duration;
    const data = await this.get('search', params);
    return (data.items || []).map((i: any) => i?.id?.videoId).filter(Boolean);
  }

  /** Finds a channel from what a person would paste: a channel id, an @handle, or a channel link. */
  async resolveChannel(input: string): Promise<{ id: string; title: string } | null> {
    const text = input.trim();
    const id = /(UC[A-Za-z0-9_-]{22})/.exec(text)?.[1];
    const handle = /@([A-Za-z0-9._-]{3,30})/.exec(text)?.[1];
    if (!id && !handle) return null;
    const data = await this.get('channels', id ? { part: 'snippet', id } : { part: 'snippet', forHandle: '@' + handle });
    const it = data.items?.[0];
    return it ? { id: it.id, title: it.snippet?.title || '' } : null;
  }
}

function toVideo(it: any): Video {
  const sn = it.snippet || {};
  const live = it.liveStreamingDetails || {};
  const thumbs = sn.thumbnails || {};
  const liveState = sn.liveBroadcastContent === 'live' || sn.liveBroadcastContent === 'upcoming' ? sn.liveBroadcastContent : 'none';
  return {
    id: it.id,
    channelId: sn.channelId || '',
    channelTitle: sn.channelTitle || '',
    title: sn.title || '',
    description: String(sn.description || '').slice(0, 600),
    publishedAt: sn.publishedAt || null,
    durationS: parseIsoDuration(it.contentDetails?.duration),
    views: Number(it.statistics?.viewCount || 0),
    categoryId: String(sn.categoryId || ''),
    tags: Array.isArray(sn.tags) ? sn.tags.slice(0, 25).join(', ').slice(0, 500) : '',
    embeddable: it.status?.embeddable !== false,
    liveState,
    scheduledStart: live.scheduledStartTime || live.actualStartTime || null,
    liveViewers: live.concurrentViewers !== undefined ? Number(live.concurrentViewers) : null,
    madeForKids: it.status?.madeForKids === true,
    lang: String(sn.defaultAudioLanguage || sn.defaultLanguage || ''),
    thumb: (thumbs.medium || thumbs.high || thumbs.default || {}).url || `https://i.ytimg.com/vi/${it.id}/mqdefault.jpg`,
  };
}
