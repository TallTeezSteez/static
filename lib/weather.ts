import type { Deps } from './types';
import { kvGet, kvSet } from './db';

export type WeatherDay = { date: string; label: string; high: number; low: number; rainChance: number | null; words: string };
export type Weather = { place: string; days: WeatherDay[]; at: string };

const CACHE_MS = 3600_000;

/** WMO weather codes (what Open-Meteo returns) in plain words. */
export function codeWords(code: number): string {
  if (code === 0) return 'Clear';
  if (code <= 2) return 'Partly cloudy';
  if (code === 3) return 'Cloudy';
  if (code <= 48) return 'Fog';
  if (code <= 57) return 'Drizzle';
  if (code <= 67) return 'Rain';
  if (code <= 77) return 'Snow';
  if (code <= 82) return 'Showers';
  if (code <= 86) return 'Snow showers';
  return 'Thunderstorms';
}

/** Today and tomorrow from Open-Meteo (free, no key). Returns null when it can't be reached; the paper prints without it. */
export async function getWeather(deps: Deps, loc: { name: string; lat: number; lon: number }): Promise<Weather | null> {
  const key = `weather:${loc.lat.toFixed(2)},${loc.lon.toFixed(2)}`;
  const now = deps.now();
  const cached = await kvGet<Weather>(deps.db, key);
  if (cached && now.getTime() - Date.parse(cached.at) < CACHE_MS) return cached;
  try {
    const qs = new URLSearchParams({
      latitude: String(loc.lat), longitude: String(loc.lon), timezone: 'auto', forecast_days: '2', temperature_unit: 'fahrenheit',
      daily: 'weather_code,temperature_2m_max,temperature_2m_min,precipitation_probability_max',
    });
    const res = await deps.fetch(`https://api.open-meteo.com/v1/forecast?${qs}`, { signal: AbortSignal.timeout(6000) });
    if (!res.ok) throw new Error(String(res.status));
    const d = ((await res.json()) as any).daily;
    const days: WeatherDay[] = (d.time as string[]).slice(0, 2).map((date, i) => ({
      date, label: i === 0 ? 'Today' : 'Tomorrow',
      high: Math.round(d.temperature_2m_max[i]), low: Math.round(d.temperature_2m_min[i]),
      rainChance: d.precipitation_probability_max?.[i] ?? null, words: codeWords(Number(d.weather_code[i])),
    }));
    const weather: Weather = { place: loc.name, days, at: now.toISOString() };
    await kvSet(deps.db, key, weather);
    return weather;
  } catch {
    return cached; // an old forecast beats none; null when there's never been one
  }
}
