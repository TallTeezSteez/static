export const TABLES = [
  'kv', 'sessions', 'channels', 'videos', 'seen', 'vstate', 'twitch_channels', 'feeds', 'articles', 'gather_log',
];

export const SCHEMA = `
create table if not exists kv (
  key text primary key, value jsonb not null, updated_at timestamptz not null default now());
create table if not exists sessions (
  token text primary key, created_at timestamptz not null, expires_at timestamptz not null);
create table if not exists channels (
  id text primary key, title text not null default '', source text not null default 'manual',
  subscribed boolean not null default false, watch_count int not null default 0, recent_count int not null default 0,
  last_watched timestamptz, rating int not null default 0, hidden boolean not null default false, live_prone boolean not null default false,
  uploads_checked_at timestamptz, created_at timestamptz not null default now());
create table if not exists videos (
  id text primary key, channel_id text not null, channel_title text not null default '', title text not null default '',
  description text not null default '', published_at timestamptz, duration_s int not null default 0,
  views bigint not null default 0, category_id text not null default '', tags text not null default '',
  embeddable boolean not null default true, live_state text not null default 'none', scheduled_start timestamptz,
  topics text[] not null default '{}', source text not null default 'uploads', thumb text not null default '',
  fetched_at timestamptz not null default now());
create index if not exists videos_channel on videos(channel_id);
create index if not exists videos_published on videos(published_at desc);
create table if not exists seen (
  video_id text primary key, at timestamptz not null default now(), source text not null default 'app');
create table if not exists vstate (
  video_id text primary key, vote int not null default 0, later boolean not null default false,
  progress_s int not null default 0, shown int not null default 0, last_shown timestamptz,
  skipped boolean not null default false, updated_at timestamptz not null default now());
create table if not exists twitch_channels (
  login text primary key, display_name text not null default '', source text not null default 'manual',
  added_at timestamptz not null default now());
create table if not exists feeds (
  id serial primary key, url text unique not null, title text not null default '', section text not null,
  enabled boolean not null default true, checked_at timestamptz, last_ok timestamptz, last_error text);
create table if not exists articles (
  id serial primary key, feed_id int not null, url text unique not null, title text not null,
  summary text not null default '', image text not null default '', published_at timestamptz,
  section text not null, source text not null default '', saved boolean not null default false,
  read boolean not null default false, fetched_at timestamptz not null default now());
create index if not exists articles_pub on articles(published_at desc);
alter table videos add column if not exists made_for_kids boolean not null default false;
alter table videos add column if not exists lang text not null default '';
alter table channels add column if not exists topic text;
create table if not exists gather_log (
  id serial primary key, kind text not null, started_at timestamptz not null, finished_at timestamptz,
  ok boolean, detail jsonb);
`;
