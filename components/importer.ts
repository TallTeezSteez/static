// Reads a Google Takeout export in the browser and sends the app only what it keeps:
// subscribed channels, how often each channel was watched, and which video ids were seen.
import { unzipSync, strFromU8 } from 'fflate';
import { parseSubscriptionsCsv, parseWatchHistoryHtml, parseWatchHistoryJson, summarizeHistory, type WatchEntry } from '@/lib/takeout';
import { post } from './api';

export type ImportReport = { subscriptions: number; channels: number; seen: number; watched: number; notes: string[] };

type Found = { subscriptions: string | null; historyJson: string | null; historyHtml: string | null };

function sortInto(found: Found, name: string, text: () => string): void {
  const lower = name.toLowerCase();
  if (lower.endsWith('.csv') && lower.includes('subscri')) found.subscriptions = text();
  else if (lower.endsWith('watch-history.json')) found.historyJson = text();
  else if (lower.endsWith('watch-history.html')) found.historyHtml = text();
}

async function readFiles(files: File[]): Promise<Found> {
  const found: Found = { subscriptions: null, historyJson: null, historyHtml: null };
  for (const file of files) {
    if (file.name.toLowerCase().endsWith('.zip')) {
      const wanted = (name: string) => /subscri[^/]*\.csv$|watch-history\.(json|html)$/i.test(name);
      const entries = unzipSync(new Uint8Array(await file.arrayBuffer()), { filter: (f) => wanted(f.name) });
      for (const [name, bytes] of Object.entries(entries)) sortInto(found, name, () => strFromU8(bytes));
    } else {
      const content = await file.text();
      sortInto(found, file.name, () => content);
    }
  }
  return found;
}

/** Imports the chosen files (the Takeout zip, or the loose files from inside it). Safe to run more than once. */
export async function importTakeout(files: File[], onStep: (msg: string) => void): Promise<ImportReport> {
  onStep('Reading the export…');
  const found = await readFiles(files);
  const notes: string[] = [];
  const subs = found.subscriptions ? parseSubscriptionsCsv(found.subscriptions) : [];
  let entries: WatchEntry[] = [];
  if (found.historyJson) entries = parseWatchHistoryJson(found.historyJson);
  if (entries.length === 0 && found.historyHtml) {
    entries = parseWatchHistoryHtml(found.historyHtml);
    if (entries.length) notes.push('Your history came as a web page instead of JSON. It was read anyway.');
  }
  if (!found.subscriptions) notes.push("No subscriptions file was in there, so subscriptions weren't imported.");
  if (!found.historyJson && !found.historyHtml) notes.push("No watch history was in there. If YouTube history is turned off on your Google account, there's nothing to export.");
  if (subs.length === 0 && entries.length === 0) throw new Error("Couldn't find subscriptions or watch history in that file. Pick the zip Google sent you.");

  const summary = summarizeHistory(entries, new Date());
  onStep(`Saving ${subs.length} subscriptions and ${summary.channels.length} channels…`);
  await post('/api/import', { subscriptions: subs });
  for (let i = 0; i < summary.channels.length; i += 2000) await post('/api/import', { channels: summary.channels.slice(i, i + 2000) });
  for (let i = 0; i < summary.seen.length; i += 5000) {
    onStep(`Saving watched videos… ${Math.min(i + 5000, summary.seen.length)} of ${summary.seen.length}`);
    await post('/api/import', { seen: summary.seen.slice(i, i + 5000) });
  }
  await post('/api/import', { done: true });
  return { subscriptions: subs.length, channels: summary.channels.length, seen: summary.seen.length, watched: entries.length, notes };
}
