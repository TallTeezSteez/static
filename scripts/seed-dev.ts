// Dev-only: fills the local database with made-up videos, articles and scores for a look-through. Not used in production.
import { Pool } from 'pg';
import { migrate } from '../lib/db';
import { upsertVideos } from '../lib/gather';
import { DEFAULT_TOPICS } from '../lib/topics';
import { TABLES } from '../lib/schema';
import type { Db, Video } from '../lib/types';

const pool = new Pool({ connectionString: process.env.DATABASE_URL });
const db = pool as unknown as Db;
const L = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';
const chan = (i: number) => 'UC' + L[i % 26].repeat(21) + L[Math.floor(i / 26) % 26];
const colors = ['#45475A', '#585B70', '#313244', '#6C7086', '#7F849C'];
const thumb = (i: number, label: string) => `data:image/svg+xml,${encodeURIComponent(`<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 320 180'><rect width='320' height='180' fill='${colors[i % 5]}'/><text x='16' y='100' font-family='sans-serif' font-size='20' fill='#CDD6F4'>${label}</text></svg>`)}`;
const TITLES: [string, number][] = [
  ['The Disappearance at Lake Mead: a cold case reopened', 3200], ['Full documentary: How the Panama Canal was built', 5400],
  ['Building AI agents with Claude Code, start to finish', 1500], ['I benchmarked every GPU for 1440p gaming', 1300],
  ['NFL film breakdown: why the Chiefs offense works', 1100], ['Backcountry elk hunt, 9 days solo', 4100],
  ['Homelab tour: Unraid server in a 10 inch rack', 1250], ['The rise and fall of a billion dollar startup', 2900],
  ['Interrogation analysis: the detail that broke the case', 2300], ['Local LLM on a 3080 Ti: Ollama setup that works', 950],
  ['Heat pump install mistakes that cost you callbacks', 800], ['UTV build series part 4: suspension', 1700],
];

async function main() {
  await migrate(db);
  await pool.query(`truncate ${TABLES.join(', ')} restart identity`);
  const now = Date.now();
  const videos: Video[] = [];
  for (let i = 0; i < 160; i++) {
    const [title, dur] = TITLES[i % TITLES.length];
    videos.push({
      id: `seed${String(i).padStart(7, '0')}`, channelId: chan(i % 60), channelTitle: `Channel ${i % 60}`, title: i < TITLES.length ? title : `${title} (${Math.floor(i / TITLES.length) + 1})`,
      description: '', publishedAt: new Date(now - (i % 20) * 86400_000 - 3600_000).toISOString(), durationS: dur + (i % 7) * 60, views: 20_000 + i * 9000,
      categoryId: '28', tags: '', embeddable: i % 23 !== 0, liveState: 'none', scheduledStart: null, liveViewers: null, thumb: thumb(i, title.slice(0, 26)),
    });
  }
  await upsertVideos(db, videos, DEFAULT_TOPICS, 'uploads');
  for (let c = 0; c < 60; c++) {
    await pool.query(`insert into channels (id, title, source, subscribed, watch_count, recent_count) values ($1, $2, $3, $4, $5, $6)`,
      [chan(c), `Channel ${c}`, c < 25 ? 'sub' : 'search', c < 25, c < 30 ? 40 - c : 0, c < 30 ? 12 - Math.floor(c / 3) : 0]);
  }
  await pool.query(`insert into kv (key, value) values ('secrets', '{"youtubeKey":"dev"}'), ('gather:uploads', $1), ('gather:search', $1), ('feeds:seeded', 'true')`, [JSON.stringify({ at: new Date(now + 86400_000).toISOString() })]);
  await pool.query(`insert into gather_log (kind, started_at, finished_at, ok, detail) values ('uploads', now(), now(), true, '{"channels":25,"videos":160}')`);
  await pool.query(`insert into feeds (url, title, section, last_ok, checked_at) values ('https://example.com/ai', 'AI Daily', 'ai', now(), now() + interval '1 day'), ('https://example.com/hvac', 'HVAC Trade', 'hvac', now(), now() + interval '1 day'), ('https://example.com/bad', 'Broken Feed', 'tech', null, now() + interval '1 day')`);
  await pool.query(`update feeds set last_error = 'answered 404' where title = 'Broken Feed'`);
  for (let i = 0; i < 9; i++) {
    await pool.query(`insert into articles (feed_id, url, title, summary, image, published_at, section, source) values ($1, $2, $3, $4, $5, now() - ($6 || ' hours')::interval, $7, $8)`,
      [i < 5 ? 1 : 2, `https://example.com/a/${i}`, i < 5 ? `Open models close the gap again, story ${i + 1}` : `What the 2027 refrigerant rules mean for installs, part ${i - 4}`,
        'A short summary of the article goes here so the front page has something to read under the headline.', i % 4 === 0 ? thumb(i, 'article') : '', String(i * 3 + 1), i < 5 ? 'ai' : 'hvac', i < 5 ? 'AI Daily' : 'HVAC Trade']);
  }
  const side = (abbr: string, name: string, score: number, record: string) => ({ abbr, name, score, logo: '', record });
  const g = (id: string, state: string, detail: string, home: any, away: any, extra: any = {}) => ({ id, state, detail, clock: '', period: 0, start: new Date(now + 3 * 3600_000).toISOString(), home, away, possession: null, redZone: false, downDistance: '', lastPlay: '', broadcast: 'CBS', ...extra });
  await pool.query(`insert into kv (key, value) values ('nfl:cache', $1)`, [JSON.stringify({ ok: true, week: 'Week 11', fetchedAt: new Date(now + 86400_000).toISOString(), games: [
    g('1', 'in', '4:12 - 3rd', side('DEN', 'Broncos', 17, '6-3'), side('KC', 'Chiefs', 20, '8-1'), { possession: 'away', redZone: true, downDistance: '2nd & Goal at DEN 6', lastPlay: 'Pass complete for 14 yards' }),
    g('2', 'in', '9:00 - 2nd', side('SEA', 'Seahawks', 3, '5-4'), side('SF', '49ers', 7, '6-3'), { possession: 'home', downDistance: '1st & 10 at SEA 25' }),
    g('3', 'pre', '', side('DAL', 'Cowboys', 0, '5-4'), side('PHI', 'Eagles', 0, '7-2'), { broadcast: 'NBC' }),
    g('4', 'post', 'Final', side('BUF', 'Bills', 31, '7-3'), side('MIA', 'Dolphins', 10, '3-7')),
  ] })]);
  await pool.query(`insert into kv (key, value) values ('weather:40.76,-111.89', $1)`, [JSON.stringify({ place: 'Salt Lake City', at: new Date(now + 86400_000).toISOString(), days: [
    { date: 'a', label: 'Today', high: 48, low: 30, rainChance: 0, words: 'Clear' }, { date: 'b', label: 'Tomorrow', high: 40, low: 25, rainChance: 70, words: 'Snow' }] })]);
  await pool.end();
  console.log('seeded');
}
main();
