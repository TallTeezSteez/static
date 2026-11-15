import { XMLParser } from 'fast-xml-parser';

export type FeedItem = { url: string; title: string; summary: string; image: string; publishedAt: string | null };

const parser = new XMLParser({ ignoreAttributes: false, attributeNamePrefix: '@_', textNodeName: '#text', trimValues: true, processEntities: true, htmlEntities: true });
const SUMMARY_MAX = 240;

const arr = <T>(v: T | T[] | undefined | null): T[] => (v === undefined || v === null ? [] : Array.isArray(v) ? v : [v]);

function text(v: any): string {
  if (v === undefined || v === null) return '';
  if (typeof v === 'string' || typeof v === 'number') return String(v);
  if (typeof v === 'object' && '#text' in v) return String(v['#text']);
  return '';
}

/** Plain words from a chunk of HTML: tags out, entities decoded, cut at a word near 240 characters. */
export function toSummary(html: string): string {
  const plain = html
    .replace(/<(script|style)[\s\S]*?<\/\1>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"')
    .replace(/&#0?39;|&apos;|&#8217;|&rsquo;/g, "'").replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n)))
    .replace(/\s+/g, ' ').trim();
  if (plain.length <= SUMMARY_MAX) return plain;
  const cut = plain.slice(0, SUMMARY_MAX);
  return cut.slice(0, Math.max(cut.lastIndexOf(' '), SUMMARY_MAX - 40)).replace(/[\s,;:.]+$/, '') + '…';
}

function absolute(url: string, base: string): string {
  try {
    const u = new URL(url.trim(), base);
    return u.protocol === 'https:' || u.protocol === 'http:' ? u.toString() : '';
  } catch { return ''; }
}

function toIso(v: string): string | null {
  const t = Date.parse(v);
  return Number.isNaN(t) ? null : new Date(t).toISOString();
}

function firstImage(html: string): string {
  return /<img[^>]+src=["']([^"']+)["']/i.exec(html)?.[1] || '';
}

function mediaUrl(node: any): string {
  for (const key of ['media:thumbnail', 'media:content', 'enclosure']) {
    for (const m of arr(node?.[key])) {
      const url = m?.['@_url'];
      const type = String(m?.['@_type'] || m?.['@_medium'] || '');
      if (url && (key === 'media:thumbnail' || type === '' || type.startsWith('image'))) return String(url);
    }
  }
  const group = node?.['media:group'];
  return group ? mediaUrl(group) : '';
}

/** Reads an RSS 2.0 or Atom feed. Items without a title or a web link are dropped; a broken feed gives []. */
export function parseFeed(xml: string, feedUrl: string): FeedItem[] {
  let doc: any;
  try { doc = parser.parse(xml); } catch { return []; }
  const out: FeedItem[] = [];
  const push = (title: string, link: string, body: string, image: string, date: string) => {
    const url = absolute(link, feedUrl);
    const cleanTitle = toSummary(title);
    if (!url || !cleanTitle) return;
    out.push({ url, title: cleanTitle, summary: toSummary(body), image: absolute(image || firstImage(body), feedUrl), publishedAt: toIso(date) });
  };

  const rssItems = arr(doc?.rss?.channel?.item).concat(arr(doc?.['rdf:RDF']?.item));
  for (const it of rssItems) {
    const body = text(it.description) || text(it['content:encoded']);
    push(text(it.title), text(it.link) || text(it.guid), body, mediaUrl(it) || firstImage(text(it['content:encoded'])), text(it.pubDate) || text(it['dc:date']));
  }
  for (const e of arr(doc?.feed?.entry)) {
    const links = arr(e.link);
    const link = links.find((l: any) => (l?.['@_rel'] || 'alternate') === 'alternate') || links[0];
    const body = text(e.summary) || text(e.content) || text(e['media:group']?.['media:description']);
    push(text(e.title), typeof link === 'string' ? link : String(link?.['@_href'] || ''), body, mediaUrl(e), text(e.published) || text(e.updated));
  }
  return out;
}

export function feedTitle(xml: string): string {
  try {
    const doc = parser.parse(xml);
    return toSummary(text(doc?.rss?.channel?.title) || text(doc?.feed?.title) || '').slice(0, 80);
  } catch { return ''; }
}
