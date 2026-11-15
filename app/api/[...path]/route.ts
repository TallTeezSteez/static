import { handle, json } from '@/lib/api';
import { dbUrl, ensureMigrated, getDb } from '@/lib/db';

export const maxDuration = 60;

async function route(req: Request): Promise<Response> {
  if (!dbUrl()) {
    // No database connected yet: the page shows how to add one instead of a login.
    return json({ db: false, setup: false, authed: false, error: 'no-database' }, new URL(req.url).pathname === '/api/status' ? 200 : 503);
  }
  let db;
  try {
    db = getDb();
    await ensureMigrated(db);
  } catch (e) {
    console.error('database', e);
    return json({ db: false, setup: false, authed: false, error: 'database-unreachable' }, new URL(req.url).pathname === '/api/status' ? 200 : 503);
  }
  return handle(req, { db, fetch, now: () => new Date(), rng: Math.random, env: process.env });
}

export { route as GET, route as POST, route as PUT, route as DELETE };
