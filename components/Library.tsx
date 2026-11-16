'use client';
import { useCallback, useEffect, useState } from 'react';
import { get, sendEvent, type Library as LibraryData } from './api';
import { PickCard, type PickActions } from './PickCard';

/** Watch Later, Continue watching, Recently watched, and the channels he hid. */
export default function Library({ actions }: { actions: PickActions }) {
  const [lib, setLib] = useState<LibraryData | null>(null);
  const [error, setError] = useState('');

  const load = useCallback(() => {
    get<LibraryData>('/api/library').then(setLib).catch((e) => setError(e.message));
  }, []);
  useEffect(load, [load]);

  if (error) return <div className="page"><div className="notice err">{error}</div></div>;
  if (!lib) return <div className="center"><span className="spinner" /></div>;

  const rows: [string, string, LibraryData['later']][] = [
    ['Continue watching', "Videos you start and don't finish show up here.", lib.continueWatching],
    ['Watch Later', 'Tap the clock on any video to save it here.', lib.later],
    ['Recently watched', 'What you finish in Static shows up here.', lib.recent],
  ];
  return (
    <div className="page">
      <div className="pagehead"><h1>Library</h1></div>
      {rows.map(([name, emptyText, picks]) => (
        <section key={name}>
          <div className="rowhead"><h2>{name}</h2></div>
          {picks.length === 0 ? <div className="muted">{emptyText}</div> : (
            <div className="scroller">{picks.map((p) => <PickCard key={p.id} pick={p} queue={picks} actions={actions} small />)}</div>
          )}
        </section>
      ))}
      <section>
        <div className="rowhead"><h2>Hidden channels</h2></div>
        {lib.hiddenChannels.length === 0 ? <div className="muted">Channels you hide land here, so you can bring one back.</div> : (
          <div className="card" style={{ maxWidth: 560 }}>
            {lib.hiddenChannels.map((c) => (
              <div className="listrow" key={c.id}>
                <span className="name">{c.title}</span>
                <button className="btn small" onClick={() => { sendEvent({ type: 'unhide_channel', channelId: c.id }); setLib({ ...lib, hiddenChannels: lib.hiddenChannels.filter((x) => x.id !== c.id) }); actions.toast(`${c.title} is back`); }}>
                  Bring back
                </button>
              </div>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}
