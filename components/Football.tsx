'use client';
import { useCallback, useEffect, useRef, useState } from 'react';
import { Bell, BellOff, ExternalLink, Tv } from 'lucide-react';
import { ago, get, type Game, type NflData } from './api';

/** A short two-tone chime for a new red-zone trip. No sound file needed. */
function chime() {
  try {
    const Ctx = window.AudioContext || (window as any).webkitAudioContext;
    const ctx = new Ctx();
    [660, 880].forEach((freq, i) => {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.frequency.value = freq;
      gain.gain.setValueAtTime(0.0001, ctx.currentTime + i * 0.16);
      gain.gain.exponentialRampToValueAtTime(0.18, ctx.currentTime + i * 0.16 + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + i * 0.16 + 0.3);
      osc.connect(gain).connect(ctx.destination);
      osc.start(ctx.currentTime + i * 0.16);
      osc.stop(ctx.currentTime + i * 0.16 + 0.32);
    });
  } catch { /* no sound on this device: the red glow still shows */ }
}

/** The link to a game on YouTube: the Sunday Ticket link, narrowed to this matchup when it's a search link. */
export function gameLink(nflLink: string, g: Game): string {
  try {
    const u = new URL(nflLink);
    const q = u.searchParams.get('search_query');
    if (q !== null) { u.searchParams.set('search_query', `${q} ${g.away.name} ${g.home.name}`); return u.toString(); }
  } catch { /* fall through to the plain link */ }
  return nflLink;
}
const highlightsLink = (g: Game) => `https://www.youtube.com/results?search_query=${encodeURIComponent(`NFL ${g.away.name} vs ${g.home.name} highlights`)}`;

function GameCard({ g, nflLink, tz }: { g: Game; nflLink: string; tz: string }) {
  const kickoff = g.start ? new Date(g.start).toLocaleString([], { weekday: 'short', hour: 'numeric', minute: '2-digit', timeZone: tz }) : '';
  const lost = (mine: number, theirs: number) => g.state === 'post' && mine < theirs;
  const row = (side: 'away' | 'home') => {
    const t = g[side];
    const other = g[side === 'away' ? 'home' : 'away'];
    return (
      <div className={`team${lost(t.score, other.score) ? ' lose' : ''}`}>
        {t.logo ? <img src={t.logo} alt="" loading="lazy" /> : <span />}
        <span className="name">{t.name} {g.possession === side && <span className="ball" title="Has the ball" />}<span className="rec">{t.record}</span></span>
        <span className="score">{g.state === 'pre' ? '' : t.score}</span>
      </div>
    );
  };
  return (
    <div className={`game${g.redZone ? ' rz' : ''}`}>
      <div className="top">
        {g.redZone && <span className="pill err">Red zone</span>}
        <span>{g.state === 'pre' ? kickoff : g.detail}</span>
        <span className="grow" />
        <span>{g.broadcast}</span>
      </div>
      <div className="teams">{row('away')}{row('home')}</div>
      <div className="sit">{g.state === 'in' && (<><b>{g.downDistance}</b>{g.downDistance && g.lastPlay ? ' · ' : ''}{g.lastPlay}</>)}</div>
      <div className="cluster">
        {g.state === 'post'
          ? <a className="btn small" href={highlightsLink(g)} target="_blank" rel="noopener noreferrer"><ExternalLink className="icon" /> Highlights</a>
          : <a className={`btn small${g.redZone ? ' soft' : ''}`} href={gameLink(nflLink, g)} target="_blank" rel="noopener noreferrer"><Tv className="icon" /> {g.state === 'in' ? 'Watch this game' : 'Find this game'}</a>}
      </div>
    </div>
  );
}

/** Football Sunday: every game's score, with games inside the 20 lit up and moved to the top. */
export default function Football({ nflLink, tz }: { nflLink: string; tz: string }) {
  const [data, setData] = useState<NflData | null>(null);
  const [sound, setSound] = useState(false);
  const inRedZone = useRef<Set<string>>(new Set());
  const soundRef = useRef(false);
  soundRef.current = sound;

  useEffect(() => { try { setSound(localStorage.getItem('static-rz-sound') === 'on'); } catch { /* private mode */ } }, []);

  const load = useCallback(async () => {
    try {
      const d = await get<NflData>('/api/nfl');
      const now = new Set(d.games.filter((g) => g.redZone).map((g) => g.id));
      if (soundRef.current && [...now].some((id) => !inRedZone.current.has(id))) chime();
      inRedZone.current = now;
      setData(d);
    } catch { setData((prev) => prev ? { ...prev, ok: false } : { ok: false, games: [], fetchedAt: new Date().toISOString() }); }
  }, []);

  const anyLive = !!data?.games.some((g) => g.state === 'in');
  useEffect(() => {
    load();
    const timer = setInterval(() => { if (document.visibilityState === 'visible') load(); }, anyLive ? 30_000 : 5 * 60_000);
    return () => clearInterval(timer);
  }, [load, anyLive]);

  if (!data) return <div className="center"><span className="spinner" /></div>;
  const live = data.games.filter((g) => g.state === 'in');
  const rest = data.games.filter((g) => g.state !== 'in');

  return (
    <div className="page">
      <div className="pagehead">
        <h1>Football</h1>
        <span className="sub">{data.week ? `${data.week} · ` : ''}scores {ago(data.fetchedAt) === '1 min ago' ? 'just now' : ago(data.fetchedAt)}</span>
        <span className="grow" />
        <button className={`iconbtn${sound ? ' on' : ''}`} data-tip={sound ? 'Red zone sound is on' : 'Red zone sound is off'} aria-label="Red zone sound"
          onClick={() => { const next = !sound; setSound(next); try { localStorage.setItem('static-rz-sound', next ? 'on' : 'off'); } catch { /* fine */ } if (next) chime(); }}>
          {sound ? <Bell className="icon" /> : <BellOff className="icon" />}
        </button>
        <a className="btn primary" href={nflLink} target="_blank" rel="noopener noreferrer"><Tv className="icon" /> Open Sunday Ticket</a>
      </div>
      {!data.ok && <div className="notice warn">Scores aren&apos;t available right now. ESPN&apos;s free feed isn&apos;t answering. The Sunday Ticket button still works.</div>}
      {data.ok && data.games.length === 0 && <div className="muted">No games on the board right now.</div>}
      {live.length > 0 && (
        <>
          <div className="rowhead"><h2>On now</h2></div>
          <div className="games">{live.map((g) => <GameCard key={g.id} g={g} nflLink={nflLink} tz={tz} />)}</div>
        </>
      )}
      {rest.length > 0 && (
        <>
          <div className="rowhead"><h2>{live.length ? 'Later and finished' : 'This week'}</h2></div>
          <div className="games">{rest.map((g) => <GameCard key={g.id} g={g} nflLink={nflLink} tz={tz} />)}</div>
        </>
      )}
    </div>
  );
}
