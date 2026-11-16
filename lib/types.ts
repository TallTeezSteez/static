export type Db = { query<T = any>(text: string, params?: unknown[]): Promise<{ rows: T[] }> };
export type Fetch = typeof fetch;

export type Deps = {
  db: Db;
  fetch: Fetch;
  now: () => Date;
  rng: () => number;
  env: Record<string, string | undefined>;
};

export type Topic = {
  id: string;
  name: string;
  keywords: string[];
  queries: string[];
  minMinutes: number;
  categoryIds?: string[];
};

export type Video = {
  id: string;
  channelId: string;
  channelTitle: string;
  title: string;
  description: string;
  publishedAt: string | null;
  durationS: number;
  views: number;
  categoryId: string;
  tags: string;
  embeddable: boolean;
  liveState: 'none' | 'live' | 'upcoming';
  scheduledStart: string | null;
  liveViewers: number | null;
  madeForKids: boolean;
  lang: string; // spoken language as YouTube reports it ("en", "en-US", "hi"), or '' when it doesn't say
  thumb: string;
};

export type Pick = {
  id: string;
  title: string;
  channelId: string;
  channelTitle: string;
  durationS: number;
  publishedAt: string | null;
  views: number;
  thumb: string;
  embeddable: boolean;
  topics: string[];
  isNew: boolean;
  reason: string;
  progressS: number;
  later: boolean;
};

export type TimeBucket = 'short' | 'hour' | 'long';

export type Show = {
  id: string;
  name: string;
  platform: 'youtube' | 'twitch';
  match: string; // text found in the channel name (YouTube) or the Twitch login
  url: string;
  days: number[]; // 0 = Sunday
  time: string; // HH:MM in settings.tz
  approx: boolean;
};

export type Settings = {
  mixNew: number;
  theme: string;
  clean: boolean;
  autoplay: boolean;
  tz: string;
  location: { name: string; lat: number; lon: number };
  topics: Topic[];
  shows: Show[];
  nflLink: string;
  blockWords: string[]; // a video with one of these in its title or channel name is never offered
};

export type Secrets = {
  youtubeKey?: string;
  twitchId?: string;
  twitchSecret?: string;
  twitchToken?: string;
  twitchTokenExpires?: number;
};
