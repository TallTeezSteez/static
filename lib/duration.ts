/** Turns YouTube's ISO 8601 durations ("PT1H2M3S") into seconds. Anything unreadable is 0. */
export function parseIsoDuration(s: string | undefined | null): number {
  const m = /^P(?:(\d+)W)?(?:(\d+)D)?(?:T(?:(\d+)H)?(?:(\d+)M)?(?:(\d+(?:\.\d+)?)S)?)?$/.exec(s || '');
  if (!m) return 0;
  const [, w, d, h, min, sec] = m;
  return Math.round(
    Number(w || 0) * 604800 + Number(d || 0) * 86400 + Number(h || 0) * 3600 + Number(min || 0) * 60 + Number(sec || 0),
  );
}

export function formatDuration(totalS: number): string {
  const s = Math.max(0, Math.round(totalS));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  return h > 0 ? `${h}:${String(m).padStart(2, '0')}:${String(sec).padStart(2, '0')}` : `${m}:${String(sec).padStart(2, '0')}`;
}
