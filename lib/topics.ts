import type { Topic, Video } from './types';

/** The shelves the app starts with. Wyatt can edit these in Settings > Picks. */
export const DEFAULT_TOPICS: Topic[] = [
  {
    id: 'docs', name: 'Long docs', minMinutes: 20,
    keywords: ['documentary', 'full documentary', 'the story of', 'the rise and fall', 'investigation', 'explained', 'deep dive', 'history of'],
    queries: ['full documentary', 'documentary 2026', 'investigative documentary', 'engineering documentary'],
  },
  {
    id: 'truecrime', name: 'True crime', minMinutes: 15,
    keywords: ['true crime', 'murder', 'disappearance', 'cold case', 'interrogation', 'serial killer', 'detective', 'missing person', 'unsolved', 'homicide', 'bodycam'],
    queries: ['true crime documentary', 'cold case solved documentary', 'interrogation analysis', 'unsolved mystery documentary'],
  },
  {
    id: 'tech', name: 'Tech', minMinutes: 8,
    keywords: ['tech review', 'teardown', 'benchmark', 'linux', 'home server', 'homelab', 'nas', 'unraid', 'gadget', 'tech', 'smartphone', 'laptop', 'self-hosted'],
    queries: ['tech review this week', 'homelab build', 'linux desktop 2026'],
  },
  {
    id: 'ai', name: 'AI', minMinutes: 8,
    keywords: ['ai', 'claude', 'gpt', 'chatgpt', 'grok', 'llm', 'ollama', 'local model', 'anthropic', 'openai', 'ai agent', 'agents', 'machine learning', 'deepseek', 'gemini'],
    queries: ['claude code tutorial', 'local llm ollama', 'ai agents build', 'ai news this week'],
  },
  {
    id: 'pcgaming', name: 'PC gaming', minMinutes: 8,
    keywords: ['pc gaming', 'gpu', 'rtx', 'radeon', 'fps', 'gaming pc', 'pc build', 'steam', 'gameplay', 'bazzite', 'steam deck', 'esports'],
    queries: ['pc gaming news', 'gaming pc build 2026', 'gpu benchmark'],
    categoryIds: ['20'],
  },
  {
    id: 'football', name: 'Football', minMinutes: 5,
    keywords: ['nfl', 'football', 'quarterback', 'touchdown', 'super bowl', 'game highlights', 'film breakdown', 'film room'],
    queries: ['nfl film breakdown', 'nfl week recap', 'nfl highlights this week'],
  },
  {
    id: 'outdoors', name: 'Hunting & outdoors', minMinutes: 10,
    keywords: ['hunting', 'hunt', 'elk', 'mule deer', 'bear hunt', 'backcountry', 'archery', 'bowhunting', 'fishing', 'backpacking', 'camping'],
    queries: ['backcountry elk hunt', 'mule deer hunt film', 'spring bear hunt'],
  },
  {
    id: 'garage', name: 'Garage & dirt', minMinutes: 10,
    keywords: ['truck build', 'utv', 'side by side', 'dirt bike', 'off-road', 'overland', 'engine swap', 'restoration', 'garage', 'sim racing'],
    queries: ['utv build', 'truck build series', 'off road trail ride'],
  },
  {
    id: 'shoptalk', name: 'Shop talk', minMinutes: 8,
    keywords: ['hvac', 'furnace', 'heat pump', 'refrigerant', 'ductwork', 'air conditioner', 'mini split', 'insulation', 'manual j'],
    queries: ['hvac install', 'hvac training heat pump'],
  },
  {
    id: 'business', name: 'Business', minMinutes: 10,
    keywords: ['business', 'entrepreneur', 'leadership', 'management', 'startup', 'sales', 'investing', 'home service business'],
    queries: ['home service business growth', 'leadership management interview'],
  },
];

function escapeRe(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** Which topics a video belongs to: whole-word keyword match on its text, or a matching YouTube category. */
export function classify(
  v: Pick<Video, 'title' | 'channelTitle' | 'tags' | 'description' | 'categoryId' | 'durationS'>,
  topics: Topic[],
): string[] {
  const text = `${v.title} \n ${v.channelTitle} \n ${v.tags} \n ${(v.description || '').slice(0, 300)}`.toLowerCase();
  const out: string[] = [];
  for (const t of topics) {
    if (t.id === 'docs' && v.durationS < 20 * 60) continue;
    const byCategory = !!t.categoryIds?.includes(v.categoryId);
    const byKeyword = t.keywords.some((k) => new RegExp(`(^|[^a-z0-9])${escapeRe(k.toLowerCase())}([^a-z0-9]|$)`).test(text));
    if (byCategory || byKeyword) out.push(t.id);
  }
  return out;
}
