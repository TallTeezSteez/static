'use client';
import { useEffect, useRef, useState } from 'react';
import { ExternalLink, Maximize2, Minimize2, SkipForward, ThumbsUp, X } from 'lucide-react';
import { sendEvent, watchUrl, type Pick } from './api';

export type NowPlaying =
  | { kind: 'video'; pick: Pick; queue: Pick[] }
  | { kind: 'ytlive'; id: string; title: string; channel: string }
  | { kind: 'twitch'; login: string; title: string; channel: string };

type Props = {
  now: NowPlaying;
  autoplay: boolean;
  onPlay: (pick: Pick, queue: Pick[]) => void;
  onClose: () => void;
  onWatched: (id: string) => void;
  toast: (msg: string) => void;
};

declare global {
  interface Window { YT?: any; onYouTubeIframeAPIReady?: () => void }
}

let apiReady: Promise<void> | null = null;
/** Loads YouTube's player script once. */
function loadYouTubeApi(): Promise<void> {
  if (apiReady) return apiReady;
  apiReady = new Promise((resolve) => {
    if (window.YT?.Player) return resolve();
    const prev = window.onYouTubeIframeAPIReady;
    window.onYouTubeIframeAPIReady = () => { prev?.(); resolve(); };
    const s = document.createElement('script');
    s.src = 'https://www.youtube.com/iframe_api';
    document.head.appendChild(s);
  });
  return apiReady;
}

const CANT_EMBED = [100, 101, 150]; // removed, or the owner doesn't allow playing outside YouTube

export default function Player({ now, autoplay, onPlay, onClose, onWatched, toast }: Props) {
  const [theater, setTheater] = useState(false);
  const [blocked, setBlocked] = useState(false);
  const holder = useRef<HTMLDivElement>(null);
  const player = useRef<any>(null);
  const latest = useRef({ now, autoplay, onPlay, onWatched });
  latest.current = { now, autoplay, onPlay, onWatched };

  const videoId = now.kind === 'video' ? now.pick.id : now.kind === 'ytlive' ? now.id : null;
  const pick = now.kind === 'video' ? now.pick : null;
  const upNext = now.kind === 'video' ? now.queue.slice(now.queue.findIndex((p) => p.id === now.pick.id) + 1) : [];
  const cantEmbed = blocked || (pick ? !pick.embeddable : false);

  function next() {
    const cur = latest.current.now;
    if (cur.kind !== 'video') return;
    const i = cur.queue.findIndex((p) => p.id === cur.pick.id);
    const following = cur.queue[i + 1];
    if (following) latest.current.onPlay(following, cur.queue);
  }

  /** Saves how far into a video he is. The id is passed in, so a report made while switching videos can't land on the next one. */
  function reportProgress(id: string | null) {
    const p = player.current;
    if (!id || !p?.getCurrentTime) return;
    const seconds = Math.floor(p.getCurrentTime() || 0);
    if (seconds > 5) sendEvent({ type: 'progress', videoId: id, seconds });
  }

  // (Re)build the YouTube player whenever the video changes.
  useEffect(() => {
    setBlocked(false);
    if (!videoId || (pick && !pick.embeddable)) return;
    let dead = false;
    let timer: ReturnType<typeof setInterval> | undefined;
    const trackedId = pick ? pick.id : null; // live streams aren't tracked
    loadYouTubeApi().then(() => {
      if (dead || !holder.current) return;
      const mount = document.createElement('div');
      mount.className = 'yt';
      holder.current.replaceChildren(mount);
      player.current = new window.YT.Player(mount, {
        videoId,
        playerVars: { autoplay: 1, rel: 0, playsinline: 1, start: pick && pick.progressS > 30 ? Math.max(0, pick.progressS - 5) : 0, origin: window.location.origin },
        events: {
          onStateChange: (e: any) => {
            if (e.data !== 0) return; // 0 = ended
            const cur = latest.current.now;
            if (cur.kind !== 'video') return;
            sendEvent({ type: 'seen', videoId: cur.pick.id });
            latest.current.onWatched(cur.pick.id);
            if (latest.current.autoplay) next();
          },
          onError: (e: any) => { if (CANT_EMBED.includes(e.data) || e.data === 2 || e.data === 5) setBlocked(true); },
        },
      });
      timer = setInterval(() => reportProgress(trackedId), 15_000);
    });
    return () => {
      dead = true;
      if (timer) clearInterval(timer);
      reportProgress(trackedId);
      try { player.current?.destroy?.(); } catch { /* already gone */ }
      player.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [videoId]);

  // Keys: space play/pause, N next, T theater. Ignored while typing.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement;
      if (e.ctrlKey || e.metaKey || e.altKey || /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName) || t.isContentEditable || document.querySelector('.scrim')) return;
      const p = player.current;
      if (e.key === ' ' && p?.getPlayerState) { e.preventDefault(); if (p.getPlayerState() === 1) p.pauseVideo(); else p.playVideo(); }
      else if (e.key === 'n' || e.key === 'N') next();
      else if (e.key === 't' || e.key === 'T') setTheater((v) => !v);
      else if (e.key === 'ArrowRight' && p?.seekTo) p.seekTo((p.getCurrentTime() || 0) + 10, true);
      else if (e.key === 'ArrowLeft' && p?.seekTo) p.seekTo(Math.max(0, (p.getCurrentTime() || 0) - 10), true);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  const title = now.kind === 'video' ? now.pick.title : now.title;
  const channel = now.kind === 'video' ? now.pick.channelTitle : now.channel;
  const outside = now.kind === 'twitch' ? `https://www.twitch.tv/${now.login}` : watchUrl({ id: videoId! });

  return (
    <div className="playerwrap">
      <div className={`player${theater ? ' theater' : ''}`}>
        <div className="screen">
          {now.kind === 'twitch' ? (
            <iframe title={title} allowFullScreen allow="autoplay; fullscreen"
              src={`https://player.twitch.tv/?channel=${encodeURIComponent(now.login)}&parent=${window.location.hostname}&autoplay=true`} />
          ) : cantEmbed ? (
            <div className="cover" style={pick?.thumb ? { backgroundImage: `url(${pick.thumb})` } : undefined}>
              <div>
                <b>This one only plays on YouTube.</b>
                <span>Its owner doesn&apos;t allow it to play inside other sites.</span>
                <div className="cluster">
                  <a className="btn primary" href={outside} target="_blank" rel="noopener noreferrer"
                    onClick={() => { if (pick) { sendEvent({ type: 'seen', videoId: pick.id }); onWatched(pick.id); } }}>
                    <ExternalLink className="icon" /> Open on YouTube
                  </a>
                  {upNext.length > 0 && <button className="btn" onClick={next}><SkipForward className="icon" /> Next pick</button>}
                </div>
              </div>
            </div>
          ) : (
            <div ref={holder} style={{ position: 'absolute', inset: 0 }} />
          )}
        </div>
        <div className="nowinfo">
          <div>
            <h2>{title}</h2>
            <div className="muted">{channel}</div>
            {pick && <div className="why">{pick.reason}</div>}
          </div>
          <div className="cluster">
            {pick && (
              <button className="btn small" onClick={() => { sendEvent({ type: 'up', videoId: pick.id }); toast(`More from ${pick.channelTitle}`); }}>
                <ThumbsUp className="icon" /> More like this
              </button>
            )}
            {upNext.length > 0 && <button className="btn small" onClick={next} data-tip="N"><SkipForward className="icon" /> Next</button>}
            <button className="iconbtn" onClick={() => setTheater(!theater)} data-tip="Theater (T)" aria-label="Theater mode">
              {theater ? <Minimize2 className="icon" /> : <Maximize2 className="icon" />}
            </button>
            <a className="iconbtn" href={outside} target="_blank" rel="noopener noreferrer" data-tip="Open outside" aria-label="Open outside"><ExternalLink className="icon" /></a>
            <button className="iconbtn" onClick={onClose} data-tip="Close player" aria-label="Close player"><X className="icon" /></button>
          </div>
          {upNext.length > 0 && (
            <div className="upnext">
              <div className="section" style={{ margin: 0, padding: 0 }}>Up next</div>
              {upNext.slice(0, 4).map((p) => (
                <button key={p.id} className="item" onClick={() => onPlay(p, (now as any).queue)}>
                  {p.thumb ? <img src={p.thumb} alt="" loading="lazy" /> : <span />}
                  <span>{p.title}</span>
                </button>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
