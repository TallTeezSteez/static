'use client';
import { useEffect, useRef, useState } from 'react';
import { Clock, EyeOff, ExternalLink, Check, MoreHorizontal, ThumbsDown, ThumbsUp } from 'lucide-react';
import { formatDuration } from '@/lib/duration';
import { ago, compact, sendEvent, watchUrl, type Pick } from './api';

export type PickActions = {
  play: (pick: Pick, queue: Pick[]) => void;
  gone: (id: string, channelId?: string) => void; // remove a video (or a whole channel) from every list on screen
  toast: (msg: string) => void;
};

/** One video: thumbnail, title, why it's here, and the thumbs. */
export function PickCard({ pick, queue, actions, small }: { pick: Pick; queue: Pick[]; actions: PickActions; small?: boolean }) {
  const [liked, setLiked] = useState(false);
  const [later, setLater] = useState(pick.later);
  const [menu, setMenu] = useState<{ x: number; y: number } | null>(null);
  const moreRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!menu) return;
    const close = () => setMenu(null);
    window.addEventListener('click', close);
    window.addEventListener('scroll', close, true);
    return () => { window.removeEventListener('click', close); window.removeEventListener('scroll', close, true); };
  }, [menu]);

  const play = () => actions.play(pick, queue);
  const pct = pick.progressS > 0 && pick.durationS > 0 ? Math.min(100, (pick.progressS / pick.durationS) * 100) : 0;

  return (
    <div className={`pick${small ? ' small' : ''}`}>
      <button className="thumb" onClick={play} aria-label={`Play ${pick.title}`}>
        {pick.thumb && <img src={pick.thumb} alt="" loading="lazy" />}
        {pick.isNew && <span className="flag frost">New to you</span>}
        <span className="dur frost">{formatDuration(pick.durationS)}</span>
        {pct > 0 && <span className="bar" style={{ width: `${pct}%` }} />}
      </button>
      <h3 className="title" onClick={play} title={pick.title}>{pick.title}</h3>
      <div className="meta">{pick.channelTitle} · {compact(pick.views)} views · {ago(pick.publishedAt)}</div>
      <div className={`why${pick.isNew ? ' new' : ''}`}>{pick.reason}{!pick.embeddable && ' · opens on YouTube'}</div>
      {!small && (
        <div className="acts">
          <button className={`iconbtn small${liked ? ' on' : ''}`} data-tip="More like this" aria-label="More like this"
            onClick={() => { sendEvent({ type: liked ? 'unvote' : 'up', videoId: pick.id }); setLiked(!liked); if (!liked) actions.toast(`More from ${pick.channelTitle}`); }}>
            <ThumbsUp className="icon" />
          </button>
          <button className="iconbtn small" data-tip="Not for me" aria-label="Not for me"
            onClick={() => { sendEvent({ type: 'down', videoId: pick.id }); actions.gone(pick.id); }}>
            <ThumbsDown className="icon" />
          </button>
          <button className={`iconbtn small${later ? ' on' : ''}`} data-tip="Watch later" aria-label="Watch later"
            onClick={() => { sendEvent({ type: later ? 'unlater' : 'later', videoId: pick.id }); setLater(!later); if (!later) actions.toast('Saved to Watch Later'); }}>
            <Clock className="icon" />
          </button>
          <span className="grow" />
          <button ref={moreRef} className="iconbtn small" aria-label="More" onClick={(e) => {
            e.stopPropagation();
            const r = moreRef.current!.getBoundingClientRect();
            setMenu(menu ? null : { x: Math.max(8, Math.min(r.right - 220, window.innerWidth - 228)), y: Math.min(r.bottom + 4, window.innerHeight - 170) });
          }}>
            <MoreHorizontal className="icon" />
          </button>
        </div>
      )}
      {menu && (
        <div className="menu" style={{ left: menu.x, top: menu.y, width: 220 }}>
          <button onClick={() => { sendEvent({ type: 'seen', videoId: pick.id }); actions.gone(pick.id); actions.toast('Marked as watched'); }}>
            <Check className="icon" /> Already watched
          </button>
          <button onClick={() => window.open(watchUrl(pick), '_blank', 'noopener')}>
            <ExternalLink className="icon" /> Open on YouTube
          </button>
          <hr />
          <button className="danger" onClick={() => { sendEvent({ type: 'hide_channel', channelId: pick.channelId }); actions.gone(pick.id, pick.channelId); actions.toast(`Hid ${pick.channelTitle}. Undo in Library.`); }}>
            <EyeOff className="icon" /> Hide this channel
          </button>
        </div>
      )}
    </div>
  );
}
