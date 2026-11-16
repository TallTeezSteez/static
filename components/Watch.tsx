'use client';
import { useCallback, useEffect, useRef, useState } from 'react';
import { Check, RefreshCw, Shuffle } from 'lucide-react';
import { ago, get, post, type Home, type Pick, type TimeBucket } from './api';
import { PickCard, type PickActions } from './PickCard';

type Props = { actions: PickActions; version: number; openSettings: (section: string) => void };
const TIMES: { id: TimeBucket | ''; label: string }[] = [
  { id: '', label: 'Any length' }, { id: 'short', label: '~20 min' }, { id: 'hour', label: '~1 hour' }, { id: 'long', label: 'A long one' },
];

/** The Watch screen: Tonight's Picks with Reroll, then a row per shelf. */
export default function Watch({ actions, version, openSettings }: Props) {
  const [home, setHome] = useState<Home | null>(null);
  const [error, setError] = useState('');
  const [time, setTime] = useState<TimeBucket | ''>('');
  const [busy, setBusy] = useState('');
  const [dry, setDry] = useState(false);
  const [browse, setBrowse] = useState<Pick[]>([]); // the long "keep browsing" grid under the shelves
  const [browseDone, setBrowseDone] = useState(false);
  const shown = useRef<Set<string>>(new Set()); // everything put on screen this visit, so a reroll never repeats

  const remember = (picks: Pick[]) => picks.forEach((p) => shown.current.add(p.id));

  const load = useCallback(async () => {
    try {
      const h = await get<Home>('/api/home');
      remember(h.tonight);
      h.shelves.forEach((s) => remember(s.picks));
      setHome(h);
      setBrowse([]);
      setBrowseDone(false);
      setError('');
    } catch (e) {
      setError((e as Error).message);
    }
  }, []);

  useEffect(() => { load(); }, [load, version]);

  // A thumbs-down, "already watched" or "hide channel" anywhere removes the card everywhere.
  useEffect(() => {
    const onGone = (e: Event) => {
      const { id, channelId } = (e as CustomEvent).detail as { id: string; channelId?: string };
      const keep = (p: Pick) => p.id !== id && (!channelId || p.channelId !== channelId);
      setHome((h) => h && { ...h, tonight: h.tonight.filter(keep), shelves: h.shelves.map((s) => ({ ...s, picks: s.picks.filter(keep) })) });
      setBrowse((b) => b.filter(keep));
    };
    window.addEventListener('static:gone', onGone);
    return () => window.removeEventListener('static:gone', onGone);
  }, []);

  async function fetchPicks(shelf: string | null, n: number, bucket: TimeBucket | ''): Promise<Pick[]> {
    const qs = new URLSearchParams({ n: String(n) });
    if (shelf) qs.set('shelf', shelf);
    if (bucket) qs.set('time', bucket);
    const exclude = [...shown.current].slice(-580);
    if (exclude.length) qs.set('exclude', exclude.join(','));
    let r = await get<{ picks: Pick[]; exhausted: boolean }>(`/api/picks?${qs}`);
    if (r.picks.length === 0 && exclude.length) {
      // Been through everything: start the lap over instead of showing an empty row.
      shown.current.clear();
      qs.delete('exclude');
      r = await get(`/api/picks?${qs}`);
      if (r.picks.length) actions.toast("That's everything for now. Starting over.");
    }
    remember(r.picks);
    return r.picks;
  }

  async function reroll(bucket: TimeBucket | '' = time) {
    setBusy('tonight');
    try {
      const picks = await fetchPicks(null, 12, bucket);
      setDry(picks.length === 0);
      setHome((h) => h && { ...h, tonight: picks });
    } catch (e) { actions.toast((e as Error).message); }
    setBusy('');
  }

  async function more(shelfId: string) {
    setBusy(shelfId);
    try {
      const picks = await fetchPicks(shelfId, 20, '');
      if (picks.length) setHome((h) => h && { ...h, shelves: h.shelves.map((s) => (s.id === shelfId ? { ...s, picks } : s)) });
      else actions.toast('Nothing else on this shelf right now.');
    } catch (e) { actions.toast((e as Error).message); }
    setBusy('');
  }

  /** Adds another 48 to the long grid. Unlike Reroll it never starts over: when there's nothing new left, it says so. */
  async function showMore() {
    setBusy('browse');
    try {
      const qs = new URLSearchParams({ n: '48' });
      const exclude = [...shown.current].slice(-580);
      if (exclude.length) qs.set('exclude', exclude.join(','));
      const r = await get<{ picks: Pick[]; exhausted: boolean }>(`/api/picks?${qs}`);
      remember(r.picks);
      setBrowse((b) => [...b, ...r.picks]);
      if (r.exhausted) setBrowseDone(true);
    } catch (e) { actions.toast((e as Error).message); }
    setBusy('');
  }

  function gatherMessage(r: any): string {
    const found = (r.gather?.uploads?.videos || 0) + (r.gather?.search?.videos || 0);
    if (r.gather?.skipped?.includes('no-key')) return 'Add your YouTube key first.';
    const limit = r.gather?.skipped?.includes('search-limit') || /limit|quota/i.test(r.gather?.error || '');
    if (limit) return `Found ${found} new videos from your channels. YouTube's search limit for today is used up, so new-channel searches run again tomorrow.`;
    if (r.gather?.error) return r.gather.error;
    return `Found ${found} new videos`;
  }

  async function gatherNow() {
    setBusy('gather');
    try {
      const r = await post<any>('/api/refresh', { force: true, only: 'videos' });
      actions.toast(gatherMessage(r));
      await load();
    } catch (e) { actions.toast((e as Error).message); }
    setBusy('');
  }

  // R rerolls, unless he's typing or a dialog is open.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement;
      if ((e.key === 'r' || e.key === 'R') && !e.ctrlKey && !e.metaKey && !/^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName) && !document.querySelector('.scrim')) reroll();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });

  if (error) return <div className="page"><div className="notice err">{error} <button className="btn small" onClick={load}>Try again</button></div></div>;
  if (!home) return <div className="center"><span className="spinner" /></div>;

  const empty = home.counts.catalog === 0;
  return (
    <div className="page">
      {empty ? (
        <div className="tonight">
          <div className="rowhead"><h2>Three steps and it starts filling up</h2></div>
          <div className="checklist">
            <div className="step">
              <span className={`num${home.hasKey ? ' done' : ''}`}>{home.hasKey ? <Check className="icon" /> : 1}</span>
              <span className="grow">Add your free YouTube key, so Static can look for new videos.</span>
              <button className="btn small" onClick={() => openSettings('sources')}>{home.hasKey ? 'Change' : 'Add key'}</button>
            </div>
            <div className="step">
              <span className={`num${home.counts.channels > 0 ? ' done' : ''}`}>{home.counts.channels > 0 ? <Check className="icon" /> : 2}</span>
              <span className="grow">Bring in your YouTube export, so it knows your channels and what you&apos;ve already seen.</span>
              <button className="btn small" onClick={() => openSettings('sources')}>{home.counts.channels > 0 ? 'Import again' : 'Import'}</button>
            </div>
            <div className="step">
              <span className="num">3</span>
              <span className="grow">Get the first batch of videos. Takes under a minute.</span>
              <button className="btn primary" disabled={!home.hasKey || busy === 'gather'} onClick={gatherNow}>
                {busy === 'gather' ? <span className="spinner" /> : <RefreshCw className="icon" />} Get videos
              </button>
            </div>
          </div>
        </div>
      ) : (
        <>
          <div className="tonight">
            <div className="rowhead">
              <h2>Tonight&apos;s picks</h2>
              <div className="segmented">
                {TIMES.map((t) => (
                  <button key={t.id} className={time === t.id ? 'on' : ''} onClick={() => { setTime(t.id); reroll(t.id); }}>{t.label}</button>
                ))}
              </div>
              <span className="grow" />
              <button className="btn primary" onClick={() => reroll()} disabled={busy === 'tonight'} data-tip="R">
                {busy === 'tonight' ? <span className="spinner" /> : <Shuffle className="icon" />} Reroll
              </button>
            </div>
            {home.tonight.length === 0 ? (
              <div className="muted">{dry ? 'Nothing that length right now. Try another length, or get new videos below.' : 'Nothing left to pick from. New videos come in every morning, or get some now below.'}</div>
            ) : (
              <div className="grid">
                {home.tonight.map((p) => <PickCard key={p.id} pick={p} queue={home.tonight} actions={actions} />)}
              </div>
            )}
          </div>

          {home.shelves.map((s) => (
            <section key={s.id}>
              <div className="rowhead">
                <h2>{s.name}</h2>
                <button className="btn ghost small" onClick={() => more(s.id)} disabled={busy === s.id}>
                  {busy === s.id ? <span className="spinner" /> : <Shuffle className="icon" />} More
                </button>
              </div>
              <div className="scroller">
                {s.picks.map((p) => <PickCard key={p.id} pick={p} queue={s.picks} actions={actions} />)}
              </div>
            </section>
          ))}

          <section>
            <div className="rowhead"><h2>Keep browsing</h2></div>
            {browse.length > 0 && (
              <div className="grid">{browse.map((p) => <PickCard key={p.id} pick={p} queue={browse} actions={actions} />)}</div>
            )}
            <div className="rowhead">
              {browseDone
                ? <span className="muted">That&apos;s everything for now. New videos come in every morning.</span>
                : <button className="btn" onClick={showMore} disabled={busy === 'browse'}>{busy === 'browse' ? <span className="spinner" /> : null} {browse.length ? 'Show 48 more' : 'Show 48 more videos'}</button>}
            </div>
          </section>

          <div className="rowhead">
            <span className="muted">
              {home.counts.catalog.toLocaleString()} videos to pick from · {home.counts.channels.toLocaleString()} channels
              {home.lastGather ? ` · updated ${ago(home.lastGather)}` : ''}
            </span>
            <button className="btn ghost small" onClick={gatherNow} disabled={busy === 'gather'}>
              {busy === 'gather' ? <span className="spinner" /> : <RefreshCw className="icon" />} Get new videos now
            </button>
          </div>
        </>
      )}
    </div>
  );
}
