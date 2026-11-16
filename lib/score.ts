// Scoring and choosing. Pure functions: no database, no clock of their own.

export type Candidate = {
  id: string;
  title: string;
  channelId: string;
  channelTitle: string;
  durationS: number;
  publishedAt: string | null;
  views: number;
  thumb: string;
  embeddable: boolean;
  topics: string[];
  subscribed: boolean;
  watchCount: number;
  recentCount: number;
  rating: number;
  shown: number;
  vote: number;
  progressS: number;
  later: boolean;
};

export type Scored = Candidate & { score: number; reason: string; isNew: boolean };

/** A channel is "new to you" until Wyatt subscribes to it, watches it, or thumbs it up. */
export function isNewChannel(c: Pick<Candidate, 'subscribed' | 'watchCount' | 'rating'>): boolean {
  return !c.subscribed && c.watchCount === 0 && c.rating <= 0;
}

export function scoreVideo(c: Candidate, now: Date): Scored {
  const ageDays = c.publishedAt ? Math.max(0.25, (now.getTime() - Date.parse(c.publishedAt)) / 86400_000) : 30;
  const isNew = isNewChannel(c);
  let score = 2 * Math.pow(0.5, ageDays / 10); // fresh videos first; worth half as much every 10 days
  let reason: string;

  if (isNew) {
    const viewsPerDay = c.views / ageDays;
    score += Math.min(3, Math.log10(1 + viewsPerDay) * 0.6);
    reason = viewsPerDay >= 20_000 ? 'New to you · popular right now' : 'New to you';
  } else {
    score += Math.min(3, Math.log2(1 + c.recentCount) * 0.8 + Math.log2(1 + c.watchCount) * 0.25);
    if (c.subscribed) score += 0.6;
    if (c.rating > 0) reason = 'From a channel you liked';
    else if (c.recentCount >= 5) reason = 'You watch this channel a lot';
    else if (c.subscribed) reason = 'From your subscriptions';
    else reason = 'From a channel you watch';
  }
  score += Math.max(-1.8, Math.min(2.4, c.rating * 0.6));

  if (c.durationS >= 20 * 60) score += 0.5; // he likes long ones
  else if (c.durationS >= 10 * 60) score += 0.3;
  else if (c.durationS < 6 * 60) score -= 0.5;

  if (c.progressS > 30) { score += 0.8; reason = 'You started this one'; }
  if (c.vote > 0) score += 1;
  score -= 0.7 * c.shown; // shown and passed over: sink

  return { ...c, score, reason, isNew };
}

export type PickSetOpts = { n: number; mixNew: number; rng: () => number; maxPerTopic?: number };

/** Draws one from near the top of a sorted list, so a reroll isn't the same list again. */
function drawNearTop<T>(sorted: T[], rng: () => number): number {
  const window = Math.min(sorted.length, 10);
  const weights = Array.from({ length: window }, (_, i) => 1 / (1 + i * 0.45));
  let r = rng() * weights.reduce((a, b) => a + b, 0);
  for (let i = 0; i < window; i++) { r -= weights[i]; if (r <= 0) return i; }
  return window - 1;
}

/**
 * Chooses n videos: at most one per channel, with `mixNew` of the seats going to new-to-you channels
 * when there are enough of them. Whatever one side can't fill, the other side fills.
 */
export function pickSet(cands: Scored[], opts: PickSetOpts): Scored[] {
  const byScore = (a: Scored, b: Scored) => b.score - a.score || (a.id < b.id ? -1 : 1);
  const pools = { new: cands.filter((c) => c.isNew).sort(byScore), known: cands.filter((c) => !c.isNew).sort(byScore) };
  const wantNew = Math.round(opts.n * Math.min(1, Math.max(0, opts.mixNew)));
  const seats: ('new' | 'known')[] = [];
  for (let i = 0; i < opts.n; i++) seats.push(i < wantNew ? 'new' : 'known');

  const out: Scored[] = [];
  const usedChannels = new Set<string>();
  const topicCount = new Map<string, number>();
  const allowed = (c: Scored, strictTopics: boolean) => {
    if (usedChannels.has(c.channelId)) return false;
    if (strictTopics && opts.maxPerTopic && c.topics.length > 0 && c.topics.every((t) => (topicCount.get(t) || 0) >= opts.maxPerTopic!)) return false;
    return true;
  };
  const take = (kind: 'new' | 'known', strictTopics: boolean): boolean => {
    const pool = pools[kind].filter((c) => allowed(c, strictTopics));
    if (pool.length === 0) return false;
    const chosen = pool[drawNearTop(pool, opts.rng)];
    pools[kind] = pools[kind].filter((c) => c.id !== chosen.id);
    usedChannels.add(chosen.channelId);
    for (const t of chosen.topics) topicCount.set(t, (topicCount.get(t) || 0) + 1);
    out.push(chosen);
    return true;
  };

  for (const seat of seats) {
    const other = seat === 'new' ? 'known' : 'new';
    if (take(seat, true) || take(other, true) || take(seat, false) || take(other, false)) continue;
    break; // nothing left at all
  }
  // interleave so new and known alternate on screen instead of sitting in two blocks
  const news = out.filter((c) => c.isNew);
  const knowns = out.filter((c) => !c.isNew);
  const mixed: Scored[] = [];
  while (news.length || knowns.length) {
    if (knowns.length) mixed.push(knowns.shift()!);
    if (news.length) mixed.push(news.shift()!);
  }
  return mixed;
}
