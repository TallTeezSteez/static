import { Pool } from 'pg';
import type { Db, Deps, Fetch, Video } from '@/lib/types';
import { migrate } from '@/lib/db';
import { TABLES } from '@/lib/schema';
import { handle } from '@/lib/api';

const URL_TEST = process.env.TEST_DATABASE_URL || 'postgres://postgres@127.0.0.1:5433/static_test';
let pool: Pool | null = null;

/** A clean test database: tables exist and are empty. */
export async function testDb(): Promise<Db> {
  if (!pool) {
    pool = new Pool({ connectionString: URL_TEST, max: 3 });
    await migrate(pool as unknown as Db);
  }
  await pool.query(`truncate ${TABLES.join(', ')} restart identity`);
  return pool as unknown as Db;
}

export async function closeDb(): Promise<void> {
  await pool?.end();
  pool = null;
}

export const NOW = new Date('2026-11-15T20:00:00Z');

/** A random-number source that always gives the same run, so picks are repeatable in tests. */
export function seededRng(seed = 1): () => number {
  let s = seed;
  return () => {
    s = (s * 1664525 + 1013904223) % 4294967296;
    return s / 4294967296;
  };
}

export function makeDeps(db: Db, over: Partial<Deps> = {}): Deps {
  const noNet: Fetch = async (input) => { throw new Error(`unexpected network call: ${String(input)}`); };
  return { db, fetch: noNet, now: () => NOW, rng: seededRng(), env: {}, ...over };
}

export type CallResult = { status: number; body: any; cookie: string | null; location: string | null };

export async function call(deps: Deps, method: string, path: string, body?: unknown, cookie?: string): Promise<CallResult> {
  const headers: Record<string, string> = { 'content-type': 'application/json' };
  if (cookie) headers.cookie = cookie;
  const res = await handle(new Request(`http://localhost${path}`, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) }), deps);
  const setCookie = res.headers.get('set-cookie');
  let parsed: any = null;
  try { parsed = await res.json(); } catch { /* redirects have no body */ }
  return { status: res.status, body: parsed, cookie: setCookie ? setCookie.split(';')[0] : null, location: res.headers.get('location') };
}

/** Sets a password and returns the session cookie, for tests of signed-in routes. */
export async function signIn(deps: Deps): Promise<string> {
  const r = await call(deps, 'POST', '/api/setup', { password: 'correct horse' });
  return r.cookie!;
}

export function video(over: Partial<Video> & { id: string }): Video {
  return {
    channelId: 'UC' + 'A'.repeat(22), channelTitle: 'Chan A', title: 'A video', description: '',
    publishedAt: new Date(NOW.getTime() - 2 * 86400_000).toISOString(), durationS: 1500, views: 50_000, categoryId: '28', tags: '',
    embeddable: true, liveState: 'none', scheduledStart: null, liveViewers: null, madeForKids: false, lang: '', thumb: 'https://i.ytimg.com/vi/x/mqdefault.jpg',
    ...over,
  };
}

export const chanId = (letter: string) => 'UC' + letter.repeat(22);
export const vidId = (n: number) => `vid${String(n).padStart(8, '0')}`;

/** A fake fetch that answers from a list of [url-part, response] pairs and records what was asked. */
export function fakeFetch(routes: [string | RegExp, (url: string, init?: RequestInit) => unknown | Response][]): Fetch & { calls: string[] } {
  const calls: string[] = [];
  const f = (async (input: any, init?: RequestInit) => {
    const url = String(input instanceof Request ? input.url : input);
    calls.push(url);
    for (const [match, make] of routes) {
      if (typeof match === 'string' ? url.includes(match) : match.test(url)) {
        const out = make(url, init);
        if (out instanceof Response) return out;
        return new Response(typeof out === 'string' ? out : JSON.stringify(out), { status: 200 });
      }
    }
    return new Response('not found', { status: 404 });
  }) as Fetch & { calls: string[] };
  f.calls = calls;
  return f;
}
