import { randomBytes, scrypt, timingSafeEqual } from 'node:crypto';
import type { Db } from './types';
import { kvGet, kvSet } from './db';

export const COOKIE = 'static_session';
const SESSION_DAYS = 30;

type PasswordRecord = { salt: string; hash: string };

function scryptAsync(pw: string, salt: string): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    scrypt(pw, salt, 64, (err, key) => (err ? reject(err) : resolve(key)));
  });
}

export async function hashPassword(pw: string): Promise<PasswordRecord> {
  const salt = randomBytes(16).toString('hex');
  const hash = (await scryptAsync(pw, salt)).toString('hex');
  return { salt, hash };
}

export async function verifyPassword(pw: string, rec: PasswordRecord): Promise<boolean> {
  const got = await scryptAsync(pw, rec.salt);
  const want = Buffer.from(rec.hash, 'hex');
  return got.length === want.length && timingSafeEqual(got, want);
}

export async function hasPassword(db: Db): Promise<boolean> {
  return (await kvGet<PasswordRecord>(db, 'auth')) !== null;
}

export async function setPassword(db: Db, pw: string): Promise<void> {
  await kvSet(db, 'auth', await hashPassword(pw));
}

export async function checkPassword(db: Db, pw: string): Promise<boolean> {
  const rec = await kvGet<PasswordRecord>(db, 'auth');
  return rec ? verifyPassword(pw, rec) : false;
}

export async function createSession(db: Db, now: Date): Promise<string> {
  const token = randomBytes(32).toString('hex');
  const expires = new Date(now.getTime() + SESSION_DAYS * 86400_000);
  await db.query('insert into sessions (token, created_at, expires_at) values ($1, $2, $3)', [token, now, expires]);
  await db.query('delete from sessions where expires_at < $1', [now]);
  return token;
}

export async function checkSession(db: Db, token: string | undefined, now: Date): Promise<boolean> {
  if (!token) return false;
  const r = await db.query('select 1 from sessions where token = $1 and expires_at > $2', [token, now]);
  return r.rows.length > 0;
}

export async function dropSession(db: Db, token: string | undefined): Promise<void> {
  if (token) await db.query('delete from sessions where token = $1', [token]);
}

export function readCookie(req: Request, name: string): string | undefined {
  const raw = req.headers.get('cookie') || '';
  for (const part of raw.split(';')) {
    const i = part.indexOf('=');
    if (i > 0 && part.slice(0, i).trim() === name) return decodeURIComponent(part.slice(i + 1).trim());
  }
  return undefined;
}

export function sessionCookie(token: string, secure: boolean): string {
  const maxAge = token ? SESSION_DAYS * 86400 : 0;
  return `${COOKIE}=${token}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${maxAge}${secure ? '; Secure' : ''}`;
}
