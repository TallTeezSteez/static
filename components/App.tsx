'use client';
import { useCallback, useEffect, useRef, useState } from 'react';
import { Library as LibraryIcon, Newspaper, PlayCircle, Radio, Settings as Gear, Trophy } from 'lucide-react';
import { installDialogKeys } from '@/theme/dialog-keys.js';
import { get, post, type Pick, type SettingsBundle } from './api';
import { NoDatabase, SignIn } from './Gate';
import Football from './Football';
import Library from './Library';
import Live from './Live';
import Paper from './Paper';
import Player, { type NowPlaying } from './Player';
import Settings, { applyLook } from './Settings';
import Watch from './Watch';
import type { PickActions } from './PickCard';

type Status = { db: boolean; setup: boolean; authed: boolean; error?: string };
const TABS = [
  { id: 'watch', name: 'Watch', Icon: PlayCircle },
  { id: 'live', name: 'Live', Icon: Radio },
  { id: 'football', name: 'Football', Icon: Trophy },
  { id: 'paper', name: 'Paper', Icon: Newspaper },
  { id: 'library', name: 'Library', Icon: LibraryIcon },
] as const;
type TabId = (typeof TABS)[number]['id'];
const isTab = (v: string): v is TabId => TABS.some((t) => t.id === v);

export default function App() {
  const [status, setStatus] = useState<Status | null>(null);
  const [bundle, setBundle] = useState<SettingsBundle | null>(null);
  const [tab, setTabState] = useState<TabId>('watch');
  const [now, setNow] = useState<NowPlaying | null>(null);
  const [settingsAt, setSettingsAt] = useState<string | null>(null);
  const [palette, setPalette] = useState(false);
  const [toastMsg, setToastMsg] = useState('');
  const [version, setVersion] = useState(0); // bumped when new videos or settings arrive, so Watch reloads
  const toastTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const mainRef = useRef<HTMLElement>(null);

  const toast = useCallback((msg: string) => {
    setToastMsg(msg);
    if (toastTimer.current) clearTimeout(toastTimer.current);
    toastTimer.current = setTimeout(() => setToastMsg(''), 3200);
  }, []);

  const setTab = useCallback((t: TabId) => {
    setTabState(t);
    try { history.replaceState(null, '', t === 'watch' ? location.pathname : `#${t}`); } catch { /* fine */ }
  }, []);

  const checkStatus = useCallback(() => {
    get<Status>('/api/status').then(setStatus).catch(() => setStatus({ db: false, setup: false, authed: false, error: 'database-unreachable' }));
  }, []);

  useEffect(() => {
    installDialogKeys();
    checkStatus();
    const hash = location.hash.slice(1);
    if (isTab(hash)) setTabState(hash);
    const signedOut = () => setStatus((s) => (s ? { ...s, authed: false } : s));
    window.addEventListener('static:signed-out', signedOut);
    return () => window.removeEventListener('static:signed-out', signedOut);
  }, [checkStatus]);

  // Once signed in: load settings, then quietly pull in anything new since the last visit.
  useEffect(() => {
    if (!status?.authed) return;
    get<SettingsBundle>('/api/settings').then((b) => { setBundle(b); applyLook(b.settings.theme, b.settings.clean); }).catch(() => undefined);
    post<any>('/api/refresh', { only: 'videos' }).then((r) => {
      const found = (r.gather?.uploads?.videos || 0) + (r.gather?.search?.videos || 0);
      if (found > 0) { setVersion((v) => v + 1); toast(`${found} new videos came in`); }
    }).catch(() => undefined);
    post('/api/refresh', { only: 'paper' }).catch(() => undefined);
    const p = new URLSearchParams(location.search).get('twitch');
    if (p) {
      toast(/^\d+$/.test(p) ? `Pulled in ${p} Twitch channels` : p === 'not-set-up' ? 'Add your Twitch keys first.' : "Twitch didn't finish. Try again.");
      setTab('live');
      history.replaceState(null, '', '/#live');
    }
  }, [status?.authed, toast, setTab]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!(e.ctrlKey || e.metaKey)) return;
      if (e.key === ',') { e.preventDefault(); setSettingsAt((s) => s || 'look'); }
      if (e.key === 'k' || e.key === 'K') { e.preventDefault(); setPalette((v) => !v); }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  const play = useCallback((pick: Pick, queue: Pick[]) => {
    setNow({ kind: 'video', pick, queue });
    mainRef.current?.scrollTo({ top: 0, behavior: 'smooth' });
  }, []);
  const gone = useCallback((id: string, channelId?: string) => {
    window.dispatchEvent(new CustomEvent('static:gone', { detail: { id, channelId } }));
  }, []);

  if (!status) return <div className="gate"><span className="spinner" /></div>;
  if (!status.db) return <NoDatabase reason={status.error} />;
  if (!status.setup || !status.authed) return <SignIn firstRun={!status.setup} onDone={checkStatus} />;
  if (!bundle) return <div className="gate"><span className="spinner" /></div>;

  const actions: PickActions = { play, gone, toast };
  const openSettings = (section: string) => setSettingsAt(section);
  const { settings } = bundle;
  const commands = [
    ...TABS.map((t) => ({ name: `Go to ${t.name}`, run: () => setTab(t.id) })),
    { name: 'Settings', run: () => setSettingsAt('look') },
    { name: 'Settings: add your YouTube key or import', run: () => setSettingsAt('sources') },
    { name: 'Close the player', run: () => setNow(null) },
  ];

  return (
    <div className="shell">
      <aside className="side">
        <div className="brand"><span className="dot" /> Static</div>
        {TABS.map(({ id, name, Icon }) => (
          <button key={id} className={`navbtn${tab === id ? ' on' : ''}`} onClick={() => setTab(id)}><Icon className="icon" /> {name}</button>
        ))}
        <span className="grow" />
        <button className="navbtn" onClick={() => setSettingsAt('look')}><Gear className="icon" /> Settings</button>
      </aside>

      <main className="main" ref={mainRef}>
        <div className="topbar">
          <div className="brand"><span className="dot" /> Static</div>
          <span className="grow" />
          <button className="iconbtn" onClick={() => setSettingsAt('look')} aria-label="Settings"><Gear className="icon" /></button>
        </div>
        {now && (
          <Player now={now} autoplay={settings.autoplay} onPlay={play} onClose={() => setNow(null)} toast={toast}
            onWatched={(id) => gone(id)} />
        )}
        {tab === 'watch' && <Watch actions={actions} version={version} openSettings={openSettings} />}
        {tab === 'live' && <Live playLive={(n) => { setNow(n); mainRef.current?.scrollTo({ top: 0, behavior: 'smooth' }); }} openSettings={openSettings} tz={settings.tz} />}
        {tab === 'football' && <Football nflLink={settings.nflLink} tz={settings.tz} />}
        {tab === 'paper' && <Paper actions={actions} openSettings={openSettings} tz={settings.tz} />}
        {tab === 'library' && <Library actions={actions} />}
        <div className="phonenav phone-only">
          <nav className="bottomnav">
            {TABS.map(({ id, name, Icon }) => (
              <button key={id} className={tab === id ? 'on' : ''} onClick={() => setTab(id)} aria-label={name}><Icon className="icon" /><span>{name}</span></button>
            ))}
          </nav>
        </div>
      </main>

      {settingsAt && (
        <Settings bundle={bundle} section={settingsAt} onSection={setSettingsAt} onChange={setBundle} toast={toast}
          onClose={() => setSettingsAt(null)} onDataChanged={() => setVersion((v) => v + 1)} />
      )}
      {palette && <Palette commands={commands} onClose={() => setPalette(false)} />}
      {toastMsg && <div className="toast" role="status">{toastMsg}</div>}
    </div>
  );
}

/** Ctrl+K: type a few letters, press Enter. */
function Palette({ commands, onClose }: { commands: { name: string; run: () => void }[]; onClose: () => void }) {
  const [q, setQ] = useState('');
  const shown = commands.filter((c) => c.name.toLowerCase().includes(q.toLowerCase()));
  const run = (c: { run: () => void }) => { onClose(); c.run(); };
  return (
    <div className="scrim" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="dialog narrow" role="dialog" aria-label="Commands">
        <div className="bodypad">
          <input autoFocus type="text" placeholder="Type a command…" value={q} onChange={(e) => setQ(e.target.value)} style={{ width: '100%' }}
            onKeyDown={(e) => { if (e.key === 'Enter' && shown[0]) run(shown[0]); if (e.key === 'Escape') onClose(); }} />
        </div>
        <div className="palette-list">
          {shown.map((c) => <button key={c.name} className="navbtn" onClick={() => run(c)}>{c.name}</button>)}
          {shown.length === 0 && <div className="muted" style={{ padding: 10 }}>No command like that.</div>}
        </div>
      </div>
    </div>
  );
}
