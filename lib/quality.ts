import type { Video } from './types';

export const MIN_SEARCH_VIEWS = 2000; // a search result nobody watched isn't worth a seat
export const MIN_SECONDS = 180; // nothing shorter is ever picked: no Shorts

/** Words and phrases that mark the stuff Wyatt doesn't want. He can change the list in Settings > Picks. */
export const DEFAULT_BLOCK_WORDS = [
  'skibidi', 'brainrot', 'rizz', 'gyatt', 'mrbeast', 'prank', 'pranks', 'challenge', 'reacts', 'reacting',
  'tier list', 'roblox', 'fortnite', 'tiktok', 'tiktoks', 'shorts', '100 days', 'for 24 hours', 'in 24 hours',
  'last to leave', '$1 vs', 'vs $1', 'asmr', 'mukbang', 'storytime', 'grwm', 'vlog', 'vlogs', 'vlogmas',
  'kai cenat', 'ishowspeed', 'sidemen', 'jake paul', 'logan paul', 'adin ross', 'among us', 'brawl stars',
  'fnaf', 'gacha', 'diss track', 'try not to laugh', 'memes', 'meme compilation', 'cringe', 'anime', 'kpop', 'k-pop',
];

const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

function hasBlockedWord(text: string, blockWords: string[]): boolean {
  const lower = text.toLowerCase();
  return blockWords.some((w) => w && new RegExp(`(^|[^a-z0-9])${escapeRe(w.toLowerCase())}([^a-z0-9]|$)`).test(lower));
}

/** True when most of the letters aren't from the Latin alphabet: the title is in a language he doesn't read. */
function otherAlphabet(title: string): boolean {
  const letters = title.match(/\p{L}/gu) || [];
  if (letters.length < 4) return false;
  const latin = letters.filter((ch) => /\p{Script=Latin}/u.test(ch)).length;
  return latin / letters.length < 0.6;
}

/**
 * Junk never gets offered, whatever its source: made for kids, not in English, or carrying a blocked word
 * in its title or channel name.
 */
export function isJunk(v: Pick<Video, 'title' | 'channelTitle' | 'madeForKids' | 'lang'>, blockWords: string[]): boolean {
  if (v.madeForKids) return true;
  if (v.lang && !v.lang.toLowerCase().startsWith('en')) return true;
  if (otherAlphabet(v.title)) return true;
  return hasBlockedWord(`${v.title} \n ${v.channelTitle}`, blockWords);
}

/** The bar a search result has to clear to be kept at all. Videos from his own channels skip the views bar. */
export function worthKeepingFromSearch(v: Video, blockWords: string[]): boolean {
  return !isJunk(v, blockWords) && v.durationS >= MIN_SECONDS && v.views >= MIN_SEARCH_VIEWS && v.liveState === 'none';
}
