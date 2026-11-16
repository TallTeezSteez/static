import { randomBytes } from 'node:crypto';
import type { Db, Deps, Secrets } from './types';
import { jsonParam, kvGet, kvSet } from './db';
import { loadSecrets } from './settings';

export type TwitchStream = { login: string; name: string; title: string; game: string; viewers: number; startedAt: string; thumb: string };

const HELIX = 'https://api.twitch.tv/helix';
const TOKEN_URL = 'https://id.twitch.tv/oauth2/token';

export function twitchReady(s: Secrets): boolean {
  return !!(s.twitchId && s.twitchSecret);
}

/** An app token for reading public Twitch data. Reused until a minute before it runs out. */
export async function appToken(deps: Deps): Promise<string> {
  const secrets = await loadSecrets(deps.db);
  if (!twitchReady(secrets)) throw new Error('twitch-not-set-up');
  const nowMs = deps.now().getTime();
  if (secrets.twitchToken && (secrets.twitchTokenExpires || 0) > nowMs + 60_000) return secrets.twitchToken;
  const res = await deps.fetch(TOKEN_URL, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ client_id: secrets.twitchId!, client_secret: secrets.twitchSecret!, grant_type: 'client_credentials' }),
  });
  if (!res.ok) throw new Error(`Twitch refused the keys (${res.status})`);
  const data: any = await res.json();
  const next: Secrets = { ...secrets, twitchToken: data.access_token, twitchTokenExpires: nowMs + Number(data.expires_in || 0) * 1000 };
  await kvSet(deps.db, 'secrets', next);
  return data.access_token;
}

export async function listTwitchChannels(db: Db): Promise<{ login: string; displayName: string; source: string }[]> {
  const r = await db.query<any>('select login, display_name, source from twitch_channels order by login');
  return r.rows.map((x) => ({ login: x.login, displayName: x.display_name || x.login, source: x.source }));
}

export function cleanLogin(input: string): string | null {
  const m = /(?:twitch\.tv\/)?@?([A-Za-z0-9_]{3,25})\/?$/.exec(input.trim());
  return m ? m[1].toLowerCase() : null;
}

/** Who is live right now out of the saved Twitch channels. */
export async function liveStreams(deps: Deps): Promise<TwitchStream[]> {
  const logins = (await listTwitchChannels(deps.db)).map((c) => c.login).slice(0, 300);
  if (logins.length === 0) return [];
  const token = await appToken(deps);
  const { twitchId } = await loadSecrets(deps.db);
  const out: TwitchStream[] = [];
  for (let i = 0; i < logins.length; i += 100) {
    const qs = new URLSearchParams();
    for (const l of logins.slice(i, i + 100)) qs.append('user_login', l);
    qs.set('first', '100');
    const res = await deps.fetch(`${HELIX}/streams?${qs}`, { headers: { 'client-id': twitchId!, authorization: `Bearer ${token}` } });
    if (!res.ok) throw new Error(`Twitch answered ${res.status}`);
    const data: any = await res.json();
    for (const s of data.data || []) {
      out.push({
        login: String(s.user_login || '').toLowerCase(), name: s.user_name || s.user_login, title: s.title || '', game: s.game_name || '',
        viewers: Number(s.viewer_count || 0), startedAt: s.started_at || '',
        thumb: String(s.thumbnail_url || '').replace('{width}', '440').replace('{height}', '248'),
      });
    }
  }
  return out.sort((a, b) => b.viewers - a.viewers);
}

/** Step 1 of pulling in follows: the Twitch page that asks Wyatt to allow it. */
export async function followsAuthUrl(deps: Deps, origin: string): Promise<string> {
  const secrets = await loadSecrets(deps.db);
  if (!twitchReady(secrets)) throw new Error('twitch-not-set-up');
  const state = randomBytes(16).toString('hex');
  await kvSet(deps.db, 'twitch:state', { state, at: deps.now().toISOString() });
  const qs = new URLSearchParams({
    response_type: 'code', client_id: secrets.twitchId!, redirect_uri: `${origin}/api/twitch/callback`,
    scope: 'user:read:follows', state,
  });
  return `https://id.twitch.tv/oauth2/authorize?${qs}`;
}

/** Step 2: Twitch sends him back with a code; trade it for his follow list and save the channels. */
export async function importFollows(deps: Deps, origin: string, code: string, state: string): Promise<number> {
  const saved = await kvGet<{ state: string }>(deps.db, 'twitch:state');
  if (!saved || saved.state !== state) throw new Error('That Twitch link expired. Try again from Settings.');
  await deps.db.query(`delete from kv where key = 'twitch:state'`);
  const secrets = await loadSecrets(deps.db);
  const tokenRes = await deps.fetch(TOKEN_URL, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: secrets.twitchId!, client_secret: secrets.twitchSecret!, code, grant_type: 'authorization_code',
      redirect_uri: `${origin}/api/twitch/callback`,
    }),
  });
  if (!tokenRes.ok) throw new Error(`Twitch refused the sign-in (${tokenRes.status})`);
  const token = ((await tokenRes.json()) as any).access_token;
  const headers = { 'client-id': secrets.twitchId!, authorization: `Bearer ${token}` };
  const me: any = await (await deps.fetch(`${HELIX}/users`, { headers })).json();
  const userId = me?.data?.[0]?.id;
  if (!userId) throw new Error('Twitch did not say who signed in.');
  const follows: { login: string; name: string }[] = [];
  let cursor = '';
  for (let page = 0; page < 10; page++) {
    const qs = new URLSearchParams({ user_id: userId, first: '100' });
    if (cursor) qs.set('after', cursor);
    const data: any = await (await deps.fetch(`${HELIX}/channels/followed?${qs}`, { headers })).json();
    for (const f of data.data || []) follows.push({ login: String(f.broadcaster_login).toLowerCase(), name: f.broadcaster_name || f.broadcaster_login });
    cursor = data.pagination?.cursor || '';
    if (!cursor) break;
  }
  if (follows.length) {
    await deps.db.query(
      `insert into twitch_channels (login, display_name, source) select x.login, x.name, 'follows'
       from jsonb_to_recordset($1::jsonb) as x(login text, name text) on conflict (login) do nothing`,
      [jsonParam(follows)]);
  }
  return follows.length;
}
