import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import type { Db, Deps } from '@/lib/types';
import { call, closeDb, makeDeps, NOW, signIn, testDb } from './helpers';

let db: Db;
let deps: Deps;
beforeEach(async () => { db = await testDb(); deps = makeDeps(db); });
afterAll(closeDb);

describe('first run and sign-in', () => {
  it('reports a fresh install as not set up', async () => {
    const r = await call(deps, 'GET', '/api/status');
    expect(r.body).toEqual({ db: true, setup: false, authed: false });
  });

  it('refuses a 7-character password', async () => {
    const r = await call(deps, 'POST', '/api/setup', { password: '1234567' });
    expect(r.status).toBe(400);
    expect((await call(deps, 'GET', '/api/status')).body.setup).toBe(false);
  });

  it('sets the password once, then refuses to set it again', async () => {
    const first = await call(deps, 'POST', '/api/setup', { password: 'correct horse' });
    expect(first.status).toBe(200);
    expect(first.cookie).toMatch(/^static_session=[0-9a-f]{64}$/);
    const second = await call(deps, 'POST', '/api/setup', { password: 'another password' });
    expect(second.status).toBe(409);
  });

  it('rejects a wrong password and accepts the right one', async () => {
    await signIn(deps);
    expect((await call(deps, 'POST', '/api/login', { password: 'wrong wrong' })).status).toBe(401);
    const ok = await call(deps, 'POST', '/api/login', { password: 'correct horse' });
    expect(ok.status).toBe(200);
    expect((await call(deps, 'GET', '/api/status', undefined, ok.cookie!)).body.authed).toBe(true);
  });

  it('locks sign-in after 10 wrong tries, even for the right password', async () => {
    await signIn(deps);
    for (let i = 0; i < 10; i++) await call(deps, 'POST', '/api/login', { password: 'nope nope' });
    expect((await call(deps, 'POST', '/api/login', { password: 'correct horse' })).status).toBe(429);
    const later = makeDeps(db, { now: () => new Date(NOW.getTime() + 16 * 60_000) });
    expect((await call(later, 'POST', '/api/login', { password: 'correct horse' })).status).toBe(200);
  });

  it('keeps private routes closed without a session', async () => {
    await signIn(deps);
    expect((await call(deps, 'GET', '/api/settings')).status).toBe(401);
    expect((await call(deps, 'GET', '/api/home', undefined, 'static_session=' + 'f'.repeat(64))).status).toBe(401);
  });

  it('stops honoring a session after 30 days', async () => {
    const cookie = await signIn(deps);
    expect((await call(deps, 'GET', '/api/settings', undefined, cookie)).status).toBe(200);
    const later = makeDeps(db, { now: () => new Date(NOW.getTime() + 31 * 86400_000) });
    expect((await call(later, 'GET', '/api/settings', undefined, cookie)).status).toBe(401);
  });

  it('signs out', async () => {
    const cookie = await signIn(deps);
    await call(deps, 'POST', '/api/logout', {}, cookie);
    expect((await call(deps, 'GET', '/api/settings', undefined, cookie)).status).toBe(401);
  });

  it('answers 404 for a route that does not exist', async () => {
    const cookie = await signIn(deps);
    expect((await call(deps, 'GET', '/api/nope', undefined, cookie)).status).toBe(404);
  });
});

describe('settings', () => {
  it('starts with the defaults', async () => {
    const cookie = await signIn(deps);
    const r = await call(deps, 'GET', '/api/settings', undefined, cookie);
    expect(r.body.settings.mixNew).toBe(0.5);
    expect(r.body.settings.theme).toBe('mocha');
    expect(r.body.settings.location.name).toBe('Salt Lake City');
    expect(r.body.settings.topics.map((t: any) => t.id)).toEqual(
      ['docs', 'truecrime', 'tech', 'ai', 'pcgaming', 'football', 'outdoors', 'garage', 'shoptalk', 'business']);
    expect(r.body.has).toEqual({ youtubeKey: false, twitch: false });
  });

  it('never sends keys back to the browser', async () => {
    const cookie = await signIn(deps);
    const put = await call(deps, 'PUT', '/api/settings', { secrets: { youtubeKey: 'AIzaSECRETKEY', twitchId: 'tid', twitchSecret: 'tsecret' } }, cookie);
    const get = await call(deps, 'GET', '/api/settings', undefined, cookie);
    expect(get.body.has).toEqual({ youtubeKey: true, twitch: true });
    expect(JSON.stringify(put.body) + JSON.stringify(get.body)).not.toMatch(/AIzaSECRETKEY|tsecret/);
  });

  it('clears a key when it is saved empty', async () => {
    const cookie = await signIn(deps);
    await call(deps, 'PUT', '/api/settings', { secrets: { youtubeKey: 'AIzaSECRETKEY' } }, cookie);
    const r = await call(deps, 'PUT', '/api/settings', { secrets: { youtubeKey: '' } }, cookie);
    expect(r.body.has.youtubeKey).toBe(false);
  });

  it('clamps the mix and drops settings it does not know', async () => {
    const cookie = await signIn(deps);
    const r = await call(deps, 'PUT', '/api/settings', { settings: { mixNew: 7, bogus: 'x', theme: 'spruce' } }, cookie);
    expect(r.body.settings.mixNew).toBe(1);
    expect(r.body.settings.theme).toBe('spruce');
    expect(r.body.settings.bogus).toBeUndefined();
    const low = await call(deps, 'PUT', '/api/settings', { settings: { mixNew: -2 } }, cookie);
    expect(low.body.settings.mixNew).toBe(0);
    expect(low.body.settings.theme).toBe('spruce');
  });

  it('keeps the old topics when sent an empty or broken list', async () => {
    const cookie = await signIn(deps);
    const r = await call(deps, 'PUT', '/api/settings', { settings: { topics: [{ nope: 1 }] } }, cookie);
    expect(r.body.settings.topics).toHaveLength(10);
  });
});
