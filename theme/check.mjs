// Theme check. Run from anywhere:   node theme/check.mjs          (checks only)
//                                  node theme/check.mjs --fix    (also rewrites the data files from tokens.css)
// tokens.css is the master copy of every color. This script reads it and:
//   1. makes sure every look sets every color role, and that text passes the contrast check;
//   2. keeps tokens.json, themes.json (the swatches and dark / light) and themes.js in step with it.
// Names and the one-line descriptions live in themes.json; edit those by hand.
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const dir = dirname(fileURLToPath(import.meta.url));
const fix = process.argv.includes('--fix');
const read = (f) => readFileSync(join(dir, f), 'utf8');

// Role (CSS variable) -> key in the data files. The order is the order they are written in.
const ROLES = [
  ['ground', 'ground'], ['panel', 'panel'], ['surface', 'surface'], ['surface-2', 'surface2'], ['crust', 'crust'], ['line', 'line'],
  ['overlay', 'overlay'], ['subtle', 'subtle'], ['ink', 'ink'], ['muted', 'muted'],
  ['accent', 'accent'], ['accent-ink', 'accentInk'], ['accent-soft', 'accentSoft'],
  ['ok', 'ok'], ['err', 'err'], ['warn', 'warn'], ['info', 'info'],
  ...['rosewater', 'flamingo', 'pink', 'mauve', 'red', 'maroon', 'peach', 'yellow', 'green', 'teal', 'sky', 'sapphire', 'blue', 'lavender'].map((n) => [n, n]),
];
const SWATCH = ['ground', 'panel', 'surface', 'line', 'ink', 'muted', 'accent', 'accentInk', 'accentSoft']; // what the theme picker draws with

// ---- Read tokens.css -----------------------------------------------------------------------------------------
const css = read('tokens.css').replace(/\/\*[\s\S]*?\*\//g, '');
const decls = (body) => Object.fromEntries([...body.matchAll(/(--[\w-]+)\s*:\s*([^;]+);/g)].map((m) => [m[1], m[2].trim()]));
const blocks = {};
let scheme = {};
for (const m of css.matchAll(/((?::root[^{,]*,?\s*)+)\{([^}]*)\}/g)) {
  const ids = [...m[1].matchAll(/data-theme='([\w-]+)'/g)].map((x) => x[1]);
  for (const id of ids) {
    blocks[id] = { ...(blocks[id] ?? {}), ...decls(m[2]) };
    const cs = /color-scheme:\s*(dark|light)/.exec(m[2]);
    if (cs) scheme[id] = cs[1];
  }
}
const base = blocks.mocha;
const resolve = (id) => {
  const vars = { ...base, ...blocks[id] };
  const get = (name, depth = 0) => {
    const v = vars[name];
    if (v === undefined || depth > 8) return undefined;
    const ref = /^var\((--[\w-]+)\)$/.exec(v);
    return ref ? get(ref[1], depth + 1) : v;
  };
  const out = {};
  for (const [role, key] of ROLES) out[key] = (get(`--${role}`) ?? '').toUpperCase();
  return out;
};

// ---- Contrast (WCAG 2) ---------------------------------------------------------------------------------------
const lum = (hex) => {
  const c = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255).map((v) => (v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4));
  return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
};
const ratio = (a, b) => { const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p); return (x + 0.05) / (y + 0.05); };
// Must pass (4.5 = normal text, WCAG AA; 7 = AAA). Two are a little lower because Catppuccin Latte's own colors are:
// its helper text is 4.37 on the panel and its text is 6.57 on the window frame.
const MUST = [['ink', 'panel', 7], ['ink', 'ground', 6.5], ['muted', 'panel', 4.3], ['accent', 'panel', 4.5], ['accentInk', 'accent', 4.5]];
// Good to know (3 = icons and large text). Printed, never fails the check: Latte's own orange and yellow sit under 3.
const NOTE = [['overlay', 'panel', 3], ['ok', 'panel', 3], ['err', 'panel', 3], ['warn', 'panel', 3], ['info', 'panel', 3]];

// ---- Check ---------------------------------------------------------------------------------------------------
const list = JSON.parse(read('themes.json'));
const tokens = JSON.parse(read('tokens.json'));
const problems = [];
const notes = [];
const ids = Object.keys(blocks);
for (const id of ids) if (!list.some((t) => t.id === id)) problems.push(`${id}: in tokens.css but not in themes.json (add its name and one line about it)`);
for (const t of list) if (!blocks[t.id]) problems.push(`${t.id}: in themes.json but not in tokens.css`);

const palettes = {};
for (const t of list.filter((x) => blocks[x.id])) {
  const p = (palettes[t.id] = resolve(t.id));
  for (const [, key] of ROLES) if (!/^#[0-9A-F]{6}$/.test(p[key])) problems.push(`${t.id}: --${key} is not a plain color (${p[key] || 'missing'})`);
  if (!scheme[t.id]) problems.push(`${t.id}: no color-scheme (dark or light)`);
  for (const [fg, bg, min] of MUST) { const r = ratio(p[fg], p[bg]); if (r < min) problems.push(`${t.id}: ${fg} on ${bg} is ${r.toFixed(2)}, needs ${min}`); }
  for (const [fg, bg, min] of NOTE) { const r = ratio(p[fg], p[bg]); if (r < min) notes.push(`${t.id}: ${fg} on ${bg} is ${r.toFixed(2)} (under ${min})`); }
}

// ---- Data files: what they should say ---------------------------------------------------------------------------
const wantList = list.map((t) => (palettes[t.id]
  ? { id: t.id, name: t.name, mode: scheme[t.id], about: t.about, swatch: Object.fromEntries(SWATCH.map((k) => [k, palettes[t.id][k]])) }
  : t));
// Palettes first (in themes.json order), then the sizes, fonts and the rest, untouched.
const rest = Object.entries(tokens).filter(([k, v]) => k !== '_about' && !(v && typeof v === 'object' && 'ground' in v));
const wantTokens = { _about: tokens._about, ...palettes, ...Object.fromEntries(rest) };
const listText = '[\n' + wantList.map((t) => '  ' + JSON.stringify(t)).join(',\n') + '\n]\n';
const tokensText = JSON.stringify(wantTokens, null, 2) + '\n';
const js = read('themes.js');
const jsText = js.replace(/(\/\/ <list>[^\n]*\n)[\s\S]*?(\n\s*\/\/ <\/list>)/, (_, a, b) => `${a}  const THEMES = ${listText.trim().split('\n').join('\n  ')};${b}`);

for (const [file, want, have] of [['themes.json', listText, read('themes.json')], ['tokens.json', tokensText, read('tokens.json')], ['themes.js', jsText, js]]) {
  if (want === have) continue;
  if (fix) { writeFileSync(join(dir, file), want); console.log(`updated ${file}`); } else problems.push(`${file} is out of step with tokens.css (run: node theme/check.mjs --fix)`);
}

// ---- Report --------------------------------------------------------------------------------------------------
if (process.argv.includes('--table')) {
  console.log('look         mode   text  helper accent on-accent faint');
  for (const t of wantList) {
    const p = palettes[t.id]; if (!p) continue;
    console.log(`${t.id.padEnd(12)} ${t.mode.padEnd(6)} ${ratio(p.ink, p.panel).toFixed(1).padStart(4)}  ${ratio(p.muted, p.panel).toFixed(1).padStart(5)}  ${ratio(p.accent, p.panel).toFixed(1).padStart(5)}  ${ratio(p.accentInk, p.accent).toFixed(1).padStart(8)}  ${ratio(p.overlay, p.panel).toFixed(1).padStart(4)}`);
  }
}
for (const n of notes) console.log(`note: ${n}`);
if (problems.length) { for (const p of problems) console.error(`FAIL: ${p}`); process.exit(1); }
console.log(`Theme check passed: ${Object.keys(palettes).length} themes, every role set, text contrast OK.`);
