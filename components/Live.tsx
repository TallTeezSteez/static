'use client';
import { useCallback, useEffect, useState } from 'react';
import { ExternalLink, RefreshCw } from 'lucide-react';
import { ago, compact, get, type LiveData, type LiveItem } from './api';
import type { NowPlaying } from './Player';

type Props = { playLive: (now: NowPlaying) => void; openSettings: (section: string) => void; tz: string };

const NOTES: Record<string, string> = {
  'youtube-not-set-up': 'YouTube streams show up once your YouTube key is added.',
  'twitch-not-set-up': 'Twitch streams show up once your Twitch keys are added.',
  'youtube-quota': "YouTube's free daily limit is used up, so its live list is paused until tomorrow.",
  'youtube-unavailable': "YouTube isn't answering right now.",
  'twitch-unavailable': "Twitch isn't answering right now. It's blocked on some work networks.",
};

function LiveCard({ item, onPlay }: { item: LiveItem; onPlay: () => void }) {
  return (
    <div className="pick livecard">
      <button className="thumb" onClick={onPlay} aria-label={`Watch ${item.channel}`}>
        {item.thumb && <img src={item.thumb} alt="" loading="lazy" />}
        <span className="flag live">LIVE</span>
        {item.viewers !== null && <span className="dur frost">{compact(item.viewers)} watching</span>}
      </button>
      <h3 className="title" onClick={onPlay}>{item.title || item.channel}</h3>
      <div className="meta">{item.channel}{item.game ? ` · ${item.game}` : ''}</div>
    </div>
  );
}

/** Who's live right now on YouTube and Twitch, what's scheduled, and the week of regular shows. */
export default function Live({ playLive, openSettings, tz }: Props) {
  const [data, setData] = useState<LiveData | null>(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  const load = useCallback(async (force = false) => {
    setBusy(true);
    try { setData(await get<LiveData>(`/api/live${force ? '?force=1' : ''}`)); setError(''); }
    catch (e) { setError((e as Error).message); }
    setBusy(false);
  }, []);

  useEffect(() => {
    load();
    const timer = setInterval(() => { if (document.visibilityState === 'visible') load(); }, 5 * 60_000);
    return () => clearInterval(timer);
  }, [load]);

  if (error && !data) return <div className="page"><div className="notice err">{error}</div></div>;
  if (!data) return <div className="center"><span className="spinner" /></div>;

  const play = (i: LiveItem) => playLive(i.platform === 'twitch'
    ? { kind: 'twitch', login: i.id, title: i.title, channel: i.channel }
    : { kind: 'ytlive', id: i.id, title: i.title, channel: i.channel });
  const live = [...data.youtube, ...data.twitch];
  const clock = (iso: string) => new Date(iso).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit', timeZone: tz });
  const dayOf = (iso: string) => new Date(iso).toLocaleDateString([], { weekday: 'short', month: 'short', day: 'numeric', timeZone: tz });

  return (
    <div className="page">
      <div className="pagehead">
        <h1>Live</h1>
        <span className="sub">Checked {ago(data.at)}</span>
        <span className="grow" />
        <button className="btn small" onClick={() => load(true)} disabled={busy}>{busy ? <span className="spinner" /> : <RefreshCw className="icon" />} Check now</button>
      </div>
      <div className="stack">
        {data.notes.map((n) => (
          <div className={`notice${n.endsWith('not-set-up') ? '' : ' warn'}`} key={n}>
            <span className="grow">{NOTES[n] || n}</span>
            {n.endsWith('not-set-up') && <button className="btn small" onClick={() => openSettings(n.startsWith('twitch') ? 'live' : 'sources')}>Set up</button>}
          </div>
        ))}
      </div>

      <div className="rowhead"><h2>Live now</h2></div>
      {live.length === 0 ? <div className="muted">Nobody you follow is live right now.</div> : (
        <div className="grid">{live.map((i) => <LiveCard key={i.platform + i.id} item={i} onPlay={() => play(i)} />)}</div>
      )}

      {data.upcoming.length > 0 && (
        <>
          <div className="rowhead"><h2>Scheduled streams</h2></div>
          <div className="week">
            {data.upcoming.map((u) => (
              <div className="slot" key={u.id}>
                <span className="day">{u.startsAt ? dayOf(u.startsAt) : ''}</span>
                <span className="time">{u.startsAt ? clock(u.startsAt) : ''}</span>
                <span><b>{u.channel}</b> <span className="muted">{u.title}</span></span>
                <a className="btn small" href={u.url} target="_blank" rel="noopener noreferrer"><ExternalLink className="icon" /> Open</a>
              </div>
            ))}
          </div>
        </>
      )}

      <div className="rowhead"><h2>This week&apos;s shows</h2></div>
      {data.week.length === 0 ? <div className="muted">No regular shows saved. Add some in Settings.</div> : (
        <div className="week">
          {data.week.map((s) => (
            <div className={`slot${s.live ? ' on' : ''}`} key={s.showId + s.date}>
              <span className="day">{s.dayLabel}</span>
              <span className="time">{s.approx ? '~' : ''}{clock(s.startsAt)}</span>
              <span><b>{s.name}</b> {s.live && <span className="pill err">Live now</span>}</span>
              {s.url && <a className="btn small" href={s.url} target="_blank" rel="noopener noreferrer"><ExternalLink className="icon" /> Open</a>}
            </div>
          ))}
        </div>
      )}
      <div className="rowhead"><button className="btn ghost small" onClick={() => openSettings('live')}>Edit shows and Twitch channels</button></div>
    </div>
  );
}
