import type { Deps, TimeBucket } from './types';
import { COOKIE, checkPassword, checkSession, createSession, dropSession, hasPassword, readCookie, sessionCookie, setPassword } from './auth';
import { kvGet, kvSet } from './db';
import { applyEvent, getLibrary } from './events';
import { pruneCatalog, runGather } from './gather';
import { getLive } from './live';
import { getNfl } from './nfl';
import { SECTIONS, addFeed, buildEdition, listFeeds, refreshFeeds } from './paper';
import { getHome, getPicks } from './picks';
import { loadSecrets, loadSettings, saveSecrets, saveSettings, secretFlags } from './settings';
import { cleanLogin, followsAuthUrl, importFollows, listTwitchChannels } from './twitch';
import { QuotaError, YouTube } from './youtube';

type Ctx = Deps & { req: Request; url: URL; body: any; token: string | undefined; secure: boolean; origin: string };
type Handler = (c: Ctx) => Promise<Response> | Response;

export function json(data: unknown, status = 200, headers: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(data), { status, headers: { 'content-type': 'application/json', 'cache-control': 'no-store', ...headers } });
}
const bad = (message: string, status = 400) => json({ error: message }, status);
const redirect = (to: string) => new Response(null, { status: 302, headers: { location: to } });

const MAX_LOGIN_FAILS = 10;
const LOCK_MS = 15 * 60_000;

const PUBLIC: Record<string, Handler> = {
  'GET /api/status': async (c) => json({ db: true, setup: await hasPassword(c.db), authed: await checkSession(c.db, c.token, c.now()) }),

  'POST /api/setup': async (c) => {
    if (await hasPassword(c.db)) return bad('A password is already set.', 409);
    const pw = typeof c.body?.password === 'string' ? c.body.password : '';
    if (pw.length < 8) return bad('Use at least 8 characters.');
    await setPassword(c.db, pw);
    return json({ ok: true }, 200, { 'set-cookie': sessionCookie(await createSession(c.db, c.now()), c.secure) });
  },

  'POST /api/login': async (c) => {
    const nowMs = c.now().getTime();
    const fails = (await kvGet<{ n: number; at: number }>(c.db, 'login:fails')) || { n: 0, at: 0 };
    if (fails.n >= MAX_LOGIN_FAILS && nowMs - fails.at < LOCK_MS) return bad('Too many wrong tries. Wait 15 minutes.', 429);
    if (!(await checkPassword(c.db, String(c.body?.password || '')))) {
      await kvSet(c.db, 'login:fails', { n: nowMs - fails.at < LOCK_MS ? fails.n + 1 : 1, at: nowMs });
      return bad('Wrong password.', 401);
    }
    if (fails.n) await kvSet(c.db, 'login:fails', { n: 0, at: 0 });
    return json({ ok: true }, 200, { 'set-cookie': sessionCookie(await createSession(c.db, c.now()), c.secure) });
  },

  'POST /api/logout': async (c) => {
    await dropSession(c.db, c.token);
    return json({ ok: true }, 200, { 'set-cookie': sessionCookie('', c.secure) });
  },

  // The once-a-day job Vercel calls. With CRON_SECRET set, only Vercel can run it.
  'GET /api/cron': async (c) => {
    const secret = c.env.CRON_SECRET;
    if (secret && c.req.headers.get('authorization') !== `Bearer ${secret}`) return bad('Not allowed.', 401);
    if (!secret) {
      const last = await kvGet<{ at: string }>(c.db, 'cron:last');
      if (last && c.now().getTime() - Date.parse(last.at) < 3600_000) return json({ skipped: 'ran-recently' });
    }
    await kvSet(c.db, 'cron:last', { at: c.now().toISOString() });
    const gather = await runGather(c, { force: true });
    const feeds = await refreshFeeds(c, { force: true });
    await pruneCatalog(c.db, c.now());
    return json({ gather, feeds });
  },
};

const PRIVATE: Record<string, Handler> = {
  'GET /api/settings': async (c) => json({ settings: await loadSettings(c.db), has: secretFlags(await loadSecrets(c.db)), sections: SECTIONS }),

  'PUT /api/settings': async (c) => {
    const settings = c.body?.settings ? await saveSettings(c.db, c.body.settings) : await loadSettings(c.db);
    const secrets = c.body?.secrets ? await saveSecrets(c.db, c.body.secrets) : await loadSecrets(c.db);
    return json({ settings, has: secretFlags(secrets) });
  },

  // One cheap call to YouTube, so Settings can say right away whether a pasted key works.
  'POST /api/test-key': async (c) => {
    const { youtubeKey } = await loadSecrets(c.db);
    if (!youtubeKey) return json({ ok: false, message: 'No key saved yet.' });
    try {
      const found = await new YouTube(youtubeKey, c.fetch).resolveChannel('UC_x5XG1OV2P6uZZ5FSM9Ttw');
      return json({ ok: !!found, message: found ? 'Key works.' : 'YouTube answered, but not as expected.' });
    } catch (e) {
      return json({ ok: false, message: e instanceof QuotaError ? "Key works, but today's free limit is used up." : `YouTube said: ${(e as Error).message}` });
    }
  },

  'POST /api/import': async (c) => {
    const b = c.body || {};
    const counts = { subscriptions: 0, channels: 0, seen: 0 };
    const idOk = (id: unknown) => typeof id === 'string' && /^UC[A-Za-z0-9_-]{22}$/.test(id);
    if (Array.isArray(b.subscriptions)) {
      const rows = b.subscriptions.filter((s: any) => idOk(s?.id)).slice(0, 5000).map((s: any) => ({ id: s.id, title: String(s.title || '').slice(0, 200) }));
      if (rows.length) {
        await c.db.query(
          `insert into channels (id, title, source, subscribed) select x.id, x.title, 'sub', true
           from jsonb_to_recordset($1::jsonb) as x(id text, title text)
           on conflict (id) do update set subscribed = true, title = case when excluded.title <> '' then excluded.title else channels.title end`,
          [JSON.stringify(rows)]);
      }
      counts.subscriptions = rows.length;
    }
    if (Array.isArray(b.channels)) {
      const rows = b.channels.filter((s: any) => idOk(s?.id)).slice(0, 5000).map((s: any) => ({
        id: s.id, title: String(s.title || '').slice(0, 200), count: Math.max(0, Math.round(Number(s.count) || 0)),
        recent: Math.max(0, Math.round(Number(s.recent) || 0)), last: Number.isNaN(Date.parse(s.last)) ? null : s.last,
      }));
      if (rows.length) {
        // counts are set, not added, so importing the same export twice changes nothing
        await c.db.query(
          `insert into channels (id, title, source, watch_count, recent_count, last_watched)
           select x.id, x.title, 'history', x.count, x.recent, x.last
           from jsonb_to_recordset($1::jsonb) as x(id text, title text, count int, recent int, last timestamptz)
           on conflict (id) do update set
             watch_count = greatest(channels.watch_count, excluded.watch_count),
             recent_count = greatest(channels.recent_count, excluded.recent_count),
             last_watched = greatest(channels.last_watched, excluded.last_watched),
             title = case when channels.title = '' then excluded.title else channels.title end`,
          [JSON.stringify(rows)]);
      }
      counts.channels = rows.length;
    }
    if (Array.isArray(b.seen)) {
      const rows = b.seen.filter((s: any) => typeof s?.id === 'string' && /^[A-Za-z0-9_-]{11}$/.test(s.id)).slice(0, 5000)
        .map((s: any) => ({ id: s.id, at: Number.isNaN(Date.parse(s.at)) ? c.now().toISOString() : s.at }));
      if (rows.length) {
        await c.db.query(
          `insert into seen (video_id, at, source) select x.id, x.at, 'import'
           from jsonb_to_recordset($1::jsonb) as x(id text, at timestamptz) on conflict (video_id) do nothing`,
          [JSON.stringify(rows)]);
      }
      counts.seen = rows.length;
    }
    if (b.done) await kvSet(c.db, 'import:last', { at: c.now().toISOString() });
    return json({ ok: true, counts });
  },

  'GET /api/home': async (c) => json(await getHome(c, !!(await loadSecrets(c.db)).youtubeKey)),

  'GET /api/picks': async (c) => {
    const p = c.url.searchParams;
    const time = p.get('time');
    return json(await getPicks(c, {
      shelf: p.get('shelf') || undefined,
      time: time === 'short' || time === 'hour' || time === 'long' ? (time as TimeBucket) : undefined,
      n: p.get('n') ? Number(p.get('n')) : undefined,
      exclude: (p.get('exclude') || '').split(',').filter(Boolean).slice(0, 400),
    }));
  },

  'POST /api/event': async (c) => ((await applyEvent(c, c.body || {})) ? json({ ok: true }) : bad('That did not make sense.')),

  'GET /api/library': async (c) => json(await getLibrary(c)),

  'GET /api/channels': async (c) => {
    const r = await c.db.query<any>(
      `select id, title, source, subscribed, watch_count, recent_count, rating, hidden from channels
       where subscribed or watch_count > 0 or rating <> 0 or hidden or source in ('manual', 'default')
       order by hidden, recent_count desc, watch_count desc, title limit 500`);
    const total = await c.db.query<any>('select count(*) as n from channels');
    return json({ channels: r.rows, total: Number(total.rows[0].n) });
  },

  'POST /api/channels': async (c) => {
    const { youtubeKey } = await loadSecrets(c.db);
    if (!youtubeKey) return bad('Add your YouTube key first (Settings > Sources).');
    let found: { id: string; title: string } | null;
    try { found = await new YouTube(youtubeKey, c.fetch).resolveChannel(String(c.body?.input || '')); }
    catch (e) { return bad(e instanceof QuotaError ? "Today's free YouTube limit is used up. Try tomorrow." : 'YouTube could not look that up.', 502); }
    if (!found) return bad("Couldn't find that channel. Paste its link or @handle.", 404);
    await c.db.query(
      `insert into channels (id, title, source, rating) values ($1, $2, 'manual', 1)
       on conflict (id) do update set hidden = false, rating = greatest(channels.rating, 1), title = excluded.title`,
      [found.id, found.title]);
    return json({ ok: true, channel: found });
  },

  'POST /api/refresh': async (c) => {
    const force = !!c.body?.force;
    const gather = await runGather(c, { force });
    const feeds = await refreshFeeds(c, { force });
    return json({ gather, feeds });
  },

  'GET /api/gatherlog': async (c) => {
    const r = await c.db.query<any>('select kind, started_at, finished_at, ok, detail from gather_log order by id desc limit 12');
    return json({ runs: r.rows, importedAt: (await kvGet<{ at: string }>(c.db, 'import:last'))?.at || null });
  },

  'GET /api/live': async (c) => json(await getLive(c, { force: c.url.searchParams.get('force') === '1' })),

  'GET /api/twitch/channels': async (c) => json({ channels: await listTwitchChannels(c.db) }),

  'POST /api/twitch/channels': async (c) => {
    const login = cleanLogin(String(c.body?.login || ''));
    if (!login) return bad('Type a Twitch channel name, like "shroud".');
    await c.db.query(`insert into twitch_channels (login, display_name) values ($1, $1) on conflict (login) do nothing`, [login]);
    await c.db.query(`delete from kv where key = 'live:cache'`);
    return json({ ok: true, login });
  },

  'DELETE /api/twitch/channels': async (c) => {
    await c.db.query('delete from twitch_channels where login = $1', [String(c.url.searchParams.get('login') || '').toLowerCase()]);
    await c.db.query(`delete from kv where key = 'live:cache'`);
    return json({ ok: true });
  },

  'GET /api/twitch/auth': async (c) => {
    try { return redirect(await followsAuthUrl(c, c.origin)); }
    catch { return redirect('/?twitch=not-set-up'); }
  },

  'GET /api/twitch/callback': async (c) => {
    const p = c.url.searchParams;
    if (!p.get('code')) return redirect('/?twitch=cancelled');
    try {
      const n = await importFollows(c, c.origin, p.get('code')!, p.get('state') || '');
      await c.db.query(`delete from kv where key = 'live:cache'`);
      return redirect(`/?twitch=${n}`);
    } catch { return redirect('/?twitch=failed'); }
  },

  'GET /api/nfl': async (c) => json(await getNfl(c)),

  'GET /api/paper': async (c) => json(await buildEdition(c)),

  'POST /api/article': async (c) => {
    const id = Number(c.body?.id);
    if (!Number.isInteger(id)) return bad('Which article?');
    if (typeof c.body.saved === 'boolean') await c.db.query('update articles set saved = $2 where id = $1', [id, c.body.saved]);
    if (typeof c.body.read === 'boolean') await c.db.query('update articles set read = $2 where id = $1', [id, c.body.read]);
    return json({ ok: true });
  },

  'GET /api/feeds': async (c) => json({ feeds: await listFeeds(c.db), sections: SECTIONS }),

  'POST /api/feeds': async (c) => {
    if (Number.isInteger(c.body?.id) && typeof c.body.enabled === 'boolean') {
      await c.db.query('update feeds set enabled = $2 where id = $1', [c.body.id, c.body.enabled]);
      return json({ ok: true });
    }
    return (await addFeed(c.db, String(c.body?.url || '').trim(), String(c.body?.section || ''))) ? json({ ok: true }) : bad('That needs a feed link (https://…) and a section.');
  },

  'DELETE /api/feeds': async (c) => {
    const id = Number(c.url.searchParams.get('id'));
    await c.db.query('delete from articles where feed_id = $1 and not saved', [id]);
    await c.db.query('delete from feeds where id = $1', [id]);
    return json({ ok: true });
  },
};

/** Every API request comes through here. Anything not listed as public needs the session cookie. */
export async function handle(req: Request, deps: Deps): Promise<Response> {
  const url = new URL(req.url);
  const key = `${req.method} ${url.pathname.replace(/\/+$/, '')}`;
  const isLocal = /^(localhost|127\.0\.0\.1)$/.test(url.hostname);
  const origin = isLocal ? url.origin : `https://${req.headers.get('x-forwarded-host') || url.host}`;
  let body: any = null;
  if (req.method !== 'GET' && req.method !== 'DELETE') {
    try { body = await req.json(); } catch { body = null; }
  }
  const ctx: Ctx = { ...deps, req, url, body, token: readCookie(req, COOKIE), secure: !isLocal, origin };
  try {
    if (PUBLIC[key]) return await PUBLIC[key](ctx);
    const handler = PRIVATE[key];
    if (!handler) return bad('Not found.', 404);
    if (!(await checkSession(deps.db, ctx.token, deps.now()))) return bad('Sign in first.', 401);
    return await handler(ctx);
  } catch (e) {
    console.error(key, e);
    return bad('Something went wrong on the server.', 500);
  }
}
