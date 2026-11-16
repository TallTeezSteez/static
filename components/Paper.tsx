'use client';
import { useCallback, useEffect, useState } from 'react';
import { Bookmark, BookmarkCheck, RefreshCw } from 'lucide-react';
import { ago, get, post, type Article, type Edition } from './api';
import { PickCard, type PickActions } from './PickCard';

type Props = { actions: PickActions; openSettings: (section: string) => void; tz: string };

function useArticleState(article: Article) {
  const [saved, setSaved] = useState(article.saved);
  const [read, setRead] = useState(article.read);
  const toggleSave = () => { post('/api/article', { id: article.id, saved: !saved }).catch(() => undefined); setSaved(!saved); };
  const markRead = () => { if (!read) { post('/api/article', { id: article.id, read: true }).catch(() => undefined); setRead(true); } };
  return { saved, read, toggleSave, markRead };
}

function Byline({ a, saved, toggleSave }: { a: Article; saved: boolean; toggleSave: () => void }) {
  return (
    <div className="byline">
      <span>{a.source}</span><span>·</span><span>{ago(a.publishedAt)}</span>
      <button className={`iconbtn small${saved ? ' on' : ''}`} onClick={toggleSave} aria-label={saved ? 'Saved' : 'Save for later'} data-tip={saved ? 'Saved' : 'Save for later'}>
        {saved ? <BookmarkCheck className="icon" /> : <Bookmark className="icon" />}
      </button>
    </div>
  );
}

function Lead({ a }: { a: Article }) {
  const s = useArticleState(a);
  return (
    <div className={`lead${s.read ? ' read' : ''}`}>
      {a.image && <a href={a.url} target="_blank" rel="noopener noreferrer" onClick={s.markRead}><img src={a.image} alt="" loading="lazy" onError={(e) => { (e.target as HTMLImageElement).style.display = 'none'; }} /></a>}
      <h3><a href={a.url} target="_blank" rel="noopener noreferrer" onClick={s.markRead}>{a.title}</a></h3>
      {a.summary && <div className="sum">{a.summary}</div>}
      <Byline a={a} saved={s.saved} toggleSave={s.toggleSave} />
    </div>
  );
}

function Row({ a }: { a: Article }) {
  const s = useArticleState(a);
  return (
    <div className={`art${s.read ? ' read' : ''}`}>
      <h4><a href={a.url} target="_blank" rel="noopener noreferrer" onClick={s.markRead}>{a.title}</a></h4>
      <Byline a={a} saved={s.saved} toggleSave={s.toggleSave} />
    </div>
  );
}

/** The daily paper: a front page per section from his feeds, with a couple of videos mixed into each. */
export default function Paper({ actions, openSettings, tz }: Props) {
  const [ed, setEd] = useState<Edition | null>(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  const load = useCallback(() => get<Edition>('/api/paper').then((e) => { setEd(e); setError(''); }).catch((e) => setError(e.message)), []);
  useEffect(() => { load(); }, [load]);

  async function refresh() {
    setBusy(true);
    try {
      const r = await post<any>('/api/refresh', { force: true, only: 'paper' });
      actions.toast(r.feeds?.added ? `${r.feeds.added} new articles` : 'Nothing new yet');
      await load();
    } catch (e) { actions.toast((e as Error).message); }
    setBusy(false);
  }

  if (error && !ed) return <div className="page"><div className="notice err">{error}</div></div>;
  if (!ed) return <div className="center"><span className="spinner" /></div>;

  const today = new Date(ed.date).toLocaleDateString([], { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric', timeZone: tz });
  const noArticles = ed.sections.every((s) => s.articles.length === 0);
  return (
    <div className="page">
      <div className="paper">
        <div className="masthead">
          <div>
            <h1>The Static</h1>
            <div className="date">{today}{ed.weather ? ` · ${ed.weather.place}` : ''}</div>
          </div>
          <div className="cluster">
            {ed.weather && (
              <div className="weather">
                {ed.weather.days.map((d) => (
                  <div className="day" key={d.date}>
                    <span>{d.label}</span>
                    <b>{d.high}° / {d.low}°</b>
                    <span>{d.words}{d.rainChance ? ` · ${d.rainChance}% wet` : ''}</span>
                  </div>
                ))}
              </div>
            )}
            <button className="iconbtn" onClick={refresh} disabled={busy} aria-label="Check for new articles" data-tip="Check for new articles">
              {busy ? <span className="spinner" /> : <RefreshCw className="icon" />}
            </button>
          </div>
        </div>

        {ed.feedProblems > 0 && (
          <div className="notice warn" style={{ marginTop: 16 }}>
            <span className="grow">{ed.feedProblems} of your feeds {ed.feedProblems === 1 ? "isn't" : "aren't"} answering.</span>
            <button className="btn small" onClick={() => openSettings('paper')}>See which</button>
          </div>
        )}
        {noArticles && (
          <div className="center">
            <div className="stack" style={{ justifyItems: 'center', textAlign: 'center' }}>
              <div className="muted">No articles yet. The paper fills in every morning, or you can fetch it now.</div>
              <button className="btn primary" onClick={refresh} disabled={busy}>{busy ? <span className="spinner" /> : <RefreshCw className="icon" />} Get today&apos;s paper</button>
            </div>
          </div>
        )}

        {ed.sections.map((s) => (
          <section className="psection" key={s.id}>
            <h2>{s.name}</h2>
            {s.articles.length > 0 && (
              <div className="pcols">
                <Lead a={s.articles[0]} />
                <div>{s.articles.slice(1).map((a) => <Row key={a.id} a={a} />)}</div>
              </div>
            )}
            {s.videos.length > 0 && (
              <div className="pvideos">{s.videos.map((v) => <PickCard key={v.id} pick={v} queue={s.videos} actions={actions} small />)}</div>
            )}
          </section>
        ))}

        {ed.saved.length > 0 && (
          <section className="psection">
            <h2>Saved for later</h2>
            <div>{ed.saved.map((a) => <Row key={a.id} a={a} />)}</div>
          </section>
        )}
      </div>
    </div>
  );
}
