'use client';
import { useCallback, useEffect, useRef, useState } from 'react';
import { Info, ListVideo, Newspaper, Palette, Radio, SlidersHorizontal, Trash2, X } from 'lucide-react';
import themes from '@/theme/themes.json';
import { ago, api, get, post, type FeedRow, type Settings as SettingsData, type SettingsBundle, type Show, type Topic } from './api';
import { importTakeout, type ImportReport } from './importer';

type Props = {
  bundle: SettingsBundle;
  section: string;
  onSection: (s: string) => void;
  onChange: (b: SettingsBundle) => void;
  onClose: () => void;
  onDataChanged: () => void;
  toast: (msg: string) => void;
};

const SECTIONS = [
  { id: 'look', name: 'Look', Icon: Palette },
  { id: 'picks', name: 'Picks', Icon: SlidersHorizontal },
  { id: 'sources', name: 'Sources', Icon: ListVideo },
  { id: 'live', name: 'Live', Icon: Radio },
  { id: 'paper', name: 'Paper', Icon: Newspaper },
  { id: 'about', name: 'About', Icon: Info },
];
const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
type Theme = (typeof themes)[number];

/** Sets the look on the page right away and remembers it for the next visit (before sign-in too). */
export function applyLook(themeId: string, clean: boolean): void {
  const t = (themes as Theme[]).find((x) => x.id === themeId) || themes[0];
  const d = document.documentElement;
  d.dataset.theme = t.id;
  d.dataset.mode = t.mode;
  d.dataset.clean = clean ? 'on' : 'off';
  try {
    localStorage.setItem('static-theme', t.id);
    localStorage.setItem('static-mode', t.mode);
    localStorage.setItem('static-clean', clean ? 'on' : 'off');
  } catch { /* private mode: the look still applies for this visit */ }
}

export default function Settings({ bundle, section, onSection, onChange, onClose, onDataChanged, toast }: Props) {
  const s = bundle.settings;

  // Every change applies right away and is saved. No Save button (theme/SETTINGS.md).
  const save = useCallback(async (patch: Partial<SettingsData>) => {
    onChange({ ...bundle, settings: { ...bundle.settings, ...patch } });
    try { onChange(await api<SettingsBundle>('PUT', '/api/settings', { settings: patch }).then((r) => ({ ...bundle, ...r }))); }
    catch (e) { toast((e as Error).message); }
  }, [bundle, onChange, toast]);

  // Escape closes it from anywhere inside (the theme's helper covers the case where focus is behind the window).
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const saveSecrets = async (secrets: Record<string, string>) => {
    const r = await api<SettingsBundle>('PUT', '/api/settings', { secrets });
    onChange({ ...bundle, ...r });
  };

  return (
    <div className="scrim" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="dialog settings" role="dialog" aria-label="Settings">
        <header>Settings <span className="grow" /> <button className="iconbtn" onClick={onClose} aria-label="Close"><X className="icon" /></button></header>
        <div className="cols">
          <nav>
            {SECTIONS.map(({ id, name, Icon }) => (
              <button key={id} className={`navbtn${section === id ? ' on' : ''}`} onClick={() => onSection(id)}><Icon className="icon" /> {name}</button>
            ))}
          </nav>
          <div className="setpane">
            {section === 'look' && <Look s={s} save={save} />}
            {section === 'picks' && <Picks s={s} save={save} />}
            {section === 'sources' && <Sources has={bundle.has} saveSecrets={saveSecrets} toast={toast} onDataChanged={onDataChanged} />}
            {section === 'live' && <LiveSettings s={s} has={bundle.has} save={save} saveSecrets={saveSecrets} toast={toast} />}
            {section === 'paper' && <PaperSettings s={s} sections={bundle.sections} save={save} toast={toast} />}
            {section === 'about' && <About />}
          </div>
        </div>
      </div>
    </div>
  );
}

type SaveFn = (patch: Partial<SettingsData>) => void;

function Look({ s, save }: { s: SettingsData; save: SaveFn }) {
  const [filter, setFilter] = useState<'all' | 'dark' | 'light'>('all');
  const shown = (themes as Theme[]).filter((t) => filter === 'all' || t.mode === filter);
  const current = (themes as Theme[]).find((t) => t.id === s.theme) || themes[0];
  return (
    <>
      <h3>Look</h3>
      <div className="field"><label>Theme <div className="hint">Pick a theme and the whole app follows it.</div></label> <span className="muted">{current.name}</span></div>
      <div className="themepick">
        <div className="themebar">
          <div className="segmented">
            {(['all', 'dark', 'light'] as const).map((f) => (
              <button key={f} type="button" className={f === filter ? 'on' : ''} onClick={() => setFilter(f)}>{f[0].toUpperCase() + f.slice(1)}</button>
            ))}
          </div>
          <span className="hint">{shown.length} themes</span>
        </div>
        <div className="themegrid">
          {shown.map((t) => (
            <button key={t.id} type="button" className={`themecard${t.id === s.theme ? ' on' : ''}`} aria-pressed={t.id === s.theme}
              style={{ '--tg': t.swatch.ground, '--tp': t.swatch.panel, '--ts': t.swatch.surface, '--tl': t.swatch.line, '--ti': t.swatch.ink, '--tm': t.swatch.muted, '--ta': t.swatch.accent } as React.CSSProperties}
              onClick={() => { applyLook(t.id, s.clean); save({ theme: t.id }); }}>
              <span className="themeprev"><span className="tside"><i /><i /><i /></span><span className="tpane"><i /><i /><i /><b /></span></span>
              <span className="themename">{t.name}</span><span className="themeabout">{t.about}</span>
            </button>
          ))}
        </div>
      </div>
      <div className="field">
        <label>Clean look <div className="hint">Fewer outlines and quieter buttons.</div></label>
        <label className="toggle"><input type="checkbox" checked={s.clean} onChange={(e) => { applyLook(s.theme, e.target.checked); save({ clean: e.target.checked }); }} /><span /></label>
      </div>
    </>
  );
}

function TopicCard({ topic, onSave, onRemove }: { topic: Topic; onSave: (t: Topic) => void; onRemove: () => void }) {
  const [open, setOpen] = useState(false);
  const [keywords, setKeywords] = useState(topic.keywords.join(', '));
  const [queries, setQueries] = useState(topic.queries.join('\n'));
  const split = (text: string, by: RegExp) => text.split(by).map((x) => x.trim()).filter(Boolean);
  return (
    <div className="setcard" style={{ display: 'block' }}>
      <div className="inline">
        <div className="grow"><div className="ptitle">{topic.name}</div><div className="muted">{topic.minMinutes}+ minutes · {topic.keywords.length} words · {topic.queries.length} searches</div></div>
        <button className="btn small" onClick={() => setOpen(!open)}>{open ? 'Done' : 'Edit'}</button>
      </div>
      {open && (
        <div style={{ marginTop: 10 }}>
          <div className="field">
            <label>Shortest video <div className="hint">Nothing shorter shows on this shelf.</div></label>
            <select className="wide" value={topic.minMinutes} onChange={(e) => onSave({ ...topic, minMinutes: Number(e.target.value) })}>
              {[3, 5, 8, 10, 15, 20, 30, 45, 60].map((m) => <option key={m} value={m}>{m} minutes</option>)}
            </select>
          </div>
          <h4>Words that put a video on this shelf (commas between)</h4>
          <textarea value={keywords} onChange={(e) => setKeywords(e.target.value)} onBlur={() => onSave({ ...topic, keywords: split(keywords, /,/) })} />
          <h4>YouTube searches for new channels (one per line, six at most)</h4>
          <textarea value={queries} onChange={(e) => setQueries(e.target.value)} onBlur={() => onSave({ ...topic, queries: split(queries, /\n/) })} />
          <div className="inline" style={{ marginTop: 8 }}><span className="grow" /><button className="btn small danger" onClick={onRemove}><Trash2 className="icon" /> Remove shelf</button></div>
        </div>
      )}
    </div>
  );
}

function Picks({ s, save }: { s: SettingsData; save: SaveFn }) {
  const [mix, setMix] = useState(Math.round(s.mixNew * 100));
  const [name, setName] = useState('');
  const [blocked, setBlocked] = useState(s.blockWords.join(', '));
  const setTopic = (i: number, t: Topic | null) => save({ topics: t ? s.topics.map((x, j) => (j === i ? t : x)) : s.topics.filter((_, j) => j !== i) });
  return (
    <>
      <h3>Picks</h3>
      <div className="field">
        <label>New channels in your picks <div className="hint">How many of Tonight&apos;s picks come from channels you&apos;ve never watched.</div></label>
        <span className="cluster"><input type="range" min={0} max={100} step={10} value={mix} onChange={(e) => setMix(Number(e.target.value))} onPointerUp={() => save({ mixNew: mix / 100 })} onKeyUp={() => save({ mixNew: mix / 100 })} /><span className="muted" style={{ width: 44 }}>{mix}%</span></span>
      </div>
      <div className="field">
        <label>Play the next pick <div className="hint">When a video ends, the next one in the row starts.</div></label>
        <label className="toggle"><input type="checkbox" checked={s.autoplay} onChange={(e) => save({ autoplay: e.target.checked })} /><span /></label>
      </div>
      <h4>Never show videos with these words</h4>
      <p className="muted">In the title or the channel name. Commas between. Videos made for kids and videos not in English are always left out.</p>
      <textarea value={blocked} onChange={(e) => setBlocked(e.target.value)} style={{ minHeight: 110 }}
        onBlur={() => save({ blockWords: blocked.split(',').map((w) => w.trim()).filter(Boolean) })} />
      <h4>Shelves</h4>
      {s.topics.map((t, i) => <TopicCard key={t.id} topic={t} onSave={(next) => setTopic(i, next)} onRemove={() => setTopic(i, null)} />)}
      <div className="inline">
        <input type="text" placeholder="New shelf name, like Woodworking" value={name} onChange={(e) => setName(e.target.value)} />
        <button className="btn" disabled={!name.trim()} onClick={() => {
          const id = name.toLowerCase().replace(/[^a-z0-9]/g, '').slice(0, 24) || `shelf${s.topics.length}`;
          if (s.topics.some((t) => t.id === id)) return;
          save({ topics: [...s.topics, { id, name: name.trim(), keywords: [name.trim().toLowerCase()], queries: [name.trim().toLowerCase()], minMinutes: 8 }] });
          setName('');
        }}>Add shelf</button>
      </div>
    </>
  );
}

function Sources({ has, saveSecrets, toast, onDataChanged }: { has: SettingsBundle['has']; saveSecrets: (s: Record<string, string>) => Promise<void>; toast: (m: string) => void; onDataChanged: () => void }) {
  const [key, setKey] = useState('');
  const [keyMsg, setKeyMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [step, setStep] = useState('');
  const [report, setReport] = useState<ImportReport | null>(null);
  const [importError, setImportError] = useState('');
  const [channel, setChannel] = useState('');
  const [log, setLog] = useState<{ runs: any[]; importedAt: string | null } | null>(null);
  const [busy, setBusy] = useState('');
  const fileRef = useRef<HTMLInputElement>(null);

  const loadLog = useCallback(() => get('/api/gatherlog').then(setLog).catch(() => undefined), []);
  useEffect(() => { loadLog(); }, [loadLog]);

  async function saveKey() {
    setBusy('key');
    try {
      await saveSecrets({ youtubeKey: key.trim() });
      const r = await post<{ ok: boolean; message: string }>('/api/test-key');
      setKeyMsg({ ok: r.ok, text: r.message });
      if (r.ok) { setKey(''); onDataChanged(); }
    } catch (e) { setKeyMsg({ ok: false, text: (e as Error).message }); }
    setBusy('');
  }

  async function onFiles(files: FileList | null) {
    if (!files?.length) return;
    setImportError(''); setReport(null); setBusy('import');
    try { setReport(await importTakeout([...files], setStep)); onDataChanged(); loadLog(); }
    catch (e) { setImportError((e as Error).message); }
    setStep(''); setBusy('');
    if (fileRef.current) fileRef.current.value = '';
  }

  async function gather() {
    setBusy('gather');
    try {
      const r = await post<any>('/api/refresh', { force: true, only: 'videos' });
      const limit = r.gather?.skipped?.includes('search-limit') || /limit|quota/i.test(r.gather?.error || '');
      const found = (r.gather?.uploads?.videos || 0) + (r.gather?.search?.videos || 0);
      toast(r.gather?.skipped?.includes('no-key') ? 'Add your YouTube key first.' : limit ? `Found ${found} new videos. Today's YouTube searches are used up; they run again tomorrow.` : r.gather?.error || `Found ${found} new videos`);
      onDataChanged(); loadLog();
    } catch (e) { toast((e as Error).message); }
    setBusy('');
  }

  return (
    <>
      <h3>Sources</h3>
      <p className="muted">Where your videos come from: a free YouTube key to look things up, your YouTube export so Static knows your channels, and any channels you add by hand.</p>

      <div className="field"><label>YouTube key <div className="hint">Free from Google. Lets Static look up new videos.</div></label> <span className={`pill ${has.youtubeKey ? 'ok' : 'warn'}`}>{has.youtubeKey ? 'Saved' : 'Needed'}</span></div>
      {!has.youtubeKey && (
        <ol className="steps">
          <li>Go to <b>console.cloud.google.com</b> and sign in with your Google account.</li>
          <li>Click the project name at the top, then <b>New Project</b>. Name it <b>Static</b> and click <b>Create</b>.</li>
          <li>In the search bar at the top, type <b>YouTube Data API v3</b>, open it, and click <b>Enable</b>.</li>
          <li>Open the left menu, click <b>APIs &amp; Services</b>, then <b>Credentials</b>.</li>
          <li>Click <b>Create credentials</b>, then <b>API key</b>. Copy the key it shows.</li>
          <li>Paste it below and click <b>Save key</b>.</li>
        </ol>
      )}
      <div className="inline">
        <input type="password" autoComplete="off" placeholder={has.youtubeKey ? 'Paste a new key to replace it' : 'Paste your key here'} value={key} onChange={(e) => setKey(e.target.value)} />
        <button className="btn" disabled={!key.trim() || busy === 'key'} onClick={saveKey}>{busy === 'key' ? <span className="spinner" /> : null} Save key</button>
      </div>
      {keyMsg && <div className={`notice ${keyMsg.ok ? 'ok' : 'err'}`} style={{ marginTop: 8 }}>{keyMsg.text}</div>}

      <h4>Your YouTube export</h4>
      <div className="field">
        <label>Import from Google Takeout <div className="hint">Pick the zip Google emailed you. It&apos;s read on this computer; only channel names, counts and video ids are saved.{log?.importedAt ? ` Last import ${ago(log.importedAt)}.` : ''}</div></label>
        <button className="btn" disabled={busy === 'import'} onClick={() => fileRef.current?.click()}>{busy === 'import' ? <span className="spinner" /> : null} Choose file…</button>
        <input ref={fileRef} type="file" hidden multiple accept=".zip,.json,.html,.csv" onChange={(e) => onFiles(e.target.files)} />
      </div>
      {step && <div className="notice">{step}</div>}
      {importError && <div className="notice err">{importError}</div>}
      {report && (
        <div className="notice ok"><div>
          Imported {report.subscriptions.toLocaleString()} subscriptions, {report.channels.toLocaleString()} channels you&apos;ve watched and {report.seen.toLocaleString()} videos you&apos;ve already seen.
          {report.notes.map((n) => <div key={n} className="muted">{n}</div>)}
        </div></div>
      )}

      <h4>Add a channel by hand</h4>
      <div className="inline">
        <input type="text" placeholder="Paste a channel link or @handle" value={channel} onChange={(e) => setChannel(e.target.value)} />
        <button className="btn" disabled={!channel.trim() || busy === 'channel'} onClick={async () => {
          setBusy('channel');
          try { const r = await post<any>('/api/channels', { input: channel }); toast(`Added ${r.channel.title}`); setChannel(''); onDataChanged(); }
          catch (e) { toast((e as Error).message); }
          setBusy('');
        }}>Add</button>
      </div>

      <h4>Updates</h4>
      <div className="field">
        <label>Get new videos now <div className="hint">This also runs on its own every morning, and when you open Static after a few hours away.</div></label>
        <button className="btn" disabled={busy === 'gather' || !has.youtubeKey} onClick={gather}>{busy === 'gather' ? <span className="spinner" /> : null} Run now</button>
      </div>
      {log?.runs.slice(0, 6).map((r, i) => (
        <div className="listrow" key={i}>
          <span className={`pill ${r.ok ? 'ok' : 'err'}`}>{r.ok ? 'OK' : 'Stopped'}</span>
          <span className="name">{r.kind === 'uploads' ? `Your channels: ${r.detail?.videos ?? 0} new from ${r.detail?.channels ?? 0} channels` : `Searches: ${r.detail?.videos ?? 0} new from ${r.detail?.queries ?? 0} searches`}{r.detail?.error ? ` · ${r.detail.error}` : ''}</span>
          <span className="muted">{ago(r.started_at)}</span>
        </div>
      ))}
    </>
  );
}

function LiveSettings({ s, has, save, saveSecrets, toast }: { s: SettingsData; has: SettingsBundle['has']; save: SaveFn; saveSecrets: (x: Record<string, string>) => Promise<void>; toast: (m: string) => void }) {
  const [id, setId] = useState('');
  const [secret, setSecret] = useState('');
  const [login, setLogin] = useState('');
  const [channels, setChannels] = useState<{ login: string; displayName: string; source: string }[]>([]);
  const [show, setShow] = useState<{ name: string; url: string; time: string; days: number[] }>({ name: '', url: '', time: '10:00', days: [] });
  const load = useCallback(() => get('/api/twitch/channels').then((r) => setChannels(r.channels)).catch(() => undefined), []);
  useEffect(() => { load(); }, [load]);
  const origin = typeof window === 'undefined' ? '' : window.location.origin;

  return (
    <>
      <h3>Live</h3>
      <div className="field"><label>Twitch keys <div className="hint">Free from Twitch. Lets Static see who&apos;s live.</div></label> <span className={`pill ${has.twitch ? 'ok' : 'warn'}`}>{has.twitch ? 'Saved' : 'Needed'}</span></div>
      {!has.twitch && (
        <ol className="steps">
          <li>At home (Twitch is blocked at work), go to <b>dev.twitch.tv/console</b> and sign in.</li>
          <li>Click <b>Register Your Application</b>.</li>
          <li>Name: <b>Static Wyatt</b>. OAuth Redirect URL: <code>{origin}/api/twitch/callback</code></li>
          <li>Category: <b>Website Integration</b>. Client Type: <b>Confidential</b>. Click <b>Create</b>.</li>
          <li>Click <b>Manage</b> on it. Copy the <b>Client ID</b>, then click <b>New Secret</b> and copy that too.</li>
          <li>Paste both below and click <b>Save keys</b>.</li>
        </ol>
      )}
      <div className="inline">
        <input type="text" autoComplete="off" placeholder="Client ID" value={id} onChange={(e) => setId(e.target.value)} />
        <input type="password" autoComplete="off" placeholder="Client secret" value={secret} onChange={(e) => setSecret(e.target.value)} />
        <button className="btn" disabled={!id.trim() || !secret.trim()} onClick={async () => {
          try { await saveSecrets({ twitchId: id, twitchSecret: secret }); setId(''); setSecret(''); toast('Twitch keys saved'); } catch (e) { toast((e as Error).message); }
        }}>Save keys</button>
      </div>

      <h4>Twitch channels</h4>
      <div className="field">
        <label>Pull in the channels you follow <div className="hint">Opens Twitch to ask your OK, then comes back here.</div></label>
        <a className="btn" href="/api/twitch/auth" aria-disabled={!has.twitch}>Pull in my follows</a>
      </div>
      <div className="inline">
        <input type="text" placeholder="Add a channel by name, like shroud" value={login} onChange={(e) => setLogin(e.target.value)} />
        <button className="btn" disabled={!login.trim()} onClick={async () => {
          try { await post('/api/twitch/channels', { login }); setLogin(''); load(); } catch (e) { toast((e as Error).message); }
        }}>Add</button>
      </div>
      {channels.map((c) => (
        <div className="listrow" key={c.login}>
          <span className="name">{c.displayName}</span>
          <button className="iconbtn small danger" aria-label={`Remove ${c.displayName}`} onClick={async () => { await api('DELETE', `/api/twitch/channels?login=${encodeURIComponent(c.login)}`); load(); }}><Trash2 className="icon" /></button>
        </div>
      ))}

      <h4>Regular shows</h4>
      {s.shows.map((sh: Show) => (
        <div className="listrow" key={sh.id}>
          <span className="name">{sh.name} <span className="muted">· {sh.days.map((d) => DAYS[d]).join(' ')} · {sh.approx ? '~' : ''}{sh.time}</span></span>
          <button className="iconbtn small danger" aria-label={`Remove ${sh.name}`} onClick={() => save({ shows: s.shows.filter((x) => x.id !== sh.id) })}><Trash2 className="icon" /></button>
        </div>
      ))}
      <div className="inline" style={{ marginTop: 10 }}>
        <input type="text" placeholder="Show name" value={show.name} onChange={(e) => setShow({ ...show, name: e.target.value })} />
        <input type="url" placeholder="Link to watch it (https://…)" value={show.url} onChange={(e) => setShow({ ...show, url: e.target.value })} />
        <input type="time" value={show.time} onChange={(e) => setShow({ ...show, time: e.target.value })} />
      </div>
      <div className="inline" style={{ marginTop: 8 }}>
        <div className="segmented">
          {DAYS.map((d, i) => (
            <button key={d} type="button" className={show.days.includes(i) ? 'on' : ''} onClick={() => setShow({ ...show, days: show.days.includes(i) ? show.days.filter((x) => x !== i) : [...show.days, i].sort() })}>{d}</button>
          ))}
        </div>
        <button className="btn" disabled={!show.name.trim() || show.days.length === 0} onClick={() => {
          const twitch = /twitch\.tv\/([A-Za-z0-9_]+)/.exec(show.url)?.[1];
          const next: Show = { id: `s${Date.now()}`, name: show.name.trim(), platform: twitch ? 'twitch' : 'youtube', match: twitch ? twitch.toLowerCase() : show.name.trim(), url: show.url.trim(), days: show.days, time: show.time, approx: true };
          save({ shows: [...s.shows, next] });
          setShow({ name: '', url: '', time: '10:00', days: [] });
        }}>Add show</button>
      </div>

      <h4>Football</h4>
      <div className="field">
        <label>Sunday Ticket link <div className="hint">Where the Football tab&apos;s buttons send you.</div></label>
        <input className="wide" type="url" defaultValue={s.nflLink} onBlur={(e) => { if (e.target.value !== s.nflLink) save({ nflLink: e.target.value }); }} />
      </div>
    </>
  );
}

function PaperSettings({ s, sections, save, toast }: { s: SettingsData; sections: { id: string; name: string }[]; save: SaveFn; toast: (m: string) => void }) {
  const [feeds, setFeeds] = useState<FeedRow[]>([]);
  const [url, setUrl] = useState('');
  const [section, setSection] = useState(sections[0]?.id || 'tech');
  const [loc, setLoc] = useState({ name: s.location.name, lat: String(s.location.lat), lon: String(s.location.lon) });
  const load = useCallback(() => get('/api/feeds').then((r) => setFeeds(r.feeds)).catch(() => undefined), []);
  useEffect(() => { load(); }, [load]);
  const saveLoc = () => { if (loc.name.trim() && loc.lat.trim() && loc.lon.trim()) save({ location: { name: loc.name.trim(), lat: Number(loc.lat), lon: Number(loc.lon) } }); };

  return (
    <>
      <h3>Paper</h3>
      <div className="field">
        <label>Weather for <div className="hint">Place name, then latitude and longitude.</div></label>
        <span className="inline" style={{ flexWrap: 'nowrap' }}>
          <input type="text" style={{ width: 150 }} value={loc.name} onChange={(e) => setLoc({ ...loc, name: e.target.value })} onBlur={saveLoc} />
          <input type="text" style={{ width: 76 }} value={loc.lat} onChange={(e) => setLoc({ ...loc, lat: e.target.value })} onBlur={saveLoc} />
          <input type="text" style={{ width: 86 }} value={loc.lon} onChange={(e) => setLoc({ ...loc, lon: e.target.value })} onBlur={saveLoc} />
        </span>
      </div>
      <h4>Add a feed</h4>
      <div className="inline">
        <input type="url" placeholder="Feed link (https://…/feed)" value={url} onChange={(e) => setUrl(e.target.value)} />
        <select value={section} onChange={(e) => setSection(e.target.value)}>{sections.map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}</select>
        <button className="btn" disabled={!url.trim()} onClick={async () => {
          try { await post('/api/feeds', { url: url.trim(), section }); setUrl(''); load(); toast('Feed added. It shows up after the next update.'); } catch (e) { toast((e as Error).message); }
        }}>Add</button>
      </div>
      {sections.map((sec) => {
        const mine = feeds.filter((f) => f.section === sec.id);
        if (mine.length === 0) return null;
        return (
          <div key={sec.id}>
            <h4>{sec.name}</h4>
            {mine.map((f) => (
              <div className="listrow" key={f.id}>
                <span className={`pill ${f.lastError ? 'err' : f.lastOk ? 'ok' : ''}`} title={f.lastError || ''}>{f.lastError ? 'Not answering' : f.lastOk ? 'OK' : 'Not checked yet'}</span>
                <span className="name" title={f.url}>{f.title || f.url}{f.lastError ? <span className="muted"> · {f.lastError}</span> : null}</span>
                <label className="toggle"><input type="checkbox" checked={f.enabled} onChange={async (e) => { await post('/api/feeds', { id: f.id, enabled: e.target.checked }); load(); }} /><span /></label>
                <button className="iconbtn small danger" aria-label={`Remove ${f.title}`} onClick={async () => { await api('DELETE', `/api/feeds?id=${f.id}`); load(); }}><Trash2 className="icon" /></button>
              </div>
            ))}
          </div>
        );
      })}
    </>
  );
}

function About() {
  const [info, setInfo] = useState<{ channels: any[]; total: number } | null>(null);
  useEffect(() => { get('/api/channels').then(setInfo).catch(() => undefined); }, []);
  return (
    <>
      <h3>About</h3>
      <p className="muted">Static is your own picker, live guide, football board and daily paper. Built with Claude.</p>
      <div className="field"><label>Channels it knows</label> <span className="muted">{info ? info.total.toLocaleString() : '…'}</span></div>
      <div className="field"><label>Keys <div className="hint">Space play or pause · N next · T theater · R reroll · Ctrl+K commands · Ctrl+, settings</div></label></div>
      <div className="field">
        <label>Sign out <div className="hint">You&apos;ll need your password to get back in.</div></label>
        <button className="btn" onClick={async () => { await post('/api/logout'); location.reload(); }}>Sign out</button>
      </div>
    </>
  );
}
