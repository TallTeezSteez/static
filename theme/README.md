# Theme

> **This repo** is the shared copy for every app, so `Developer\theme` sits next to the apps on each PC
> (`git clone https://github.com/TallTeezSteez/theme` in the Developer folder; `git pull` to update).
> Changes are made in Drift's `theme/` folder first, checked there, then copied here.

**Version 2026-11-15** (see Changes at the bottom; each app's copy should show the same version).

One look for all of Wyatt's apps: glass windows, round corners, thin lines, and 19 themes to pick from
(Catppuccin Mocha is the home one). This folder is the master copy. Drift loads it directly. Other apps get a copy
of this folder.

**See it:** open `preview.html` in a browser. It shows every color, button, control, the settings window and the
menu. The Look dropdown at the top right (or the theme picker in the Settings window on the page) changes the
theme, and the slider tests glass. `preview.html#spruce` opens straight in a theme.

## What's in here

| File | What it is |
| --- | --- |
| `theme.css` | Everything in one. This is the file an app loads. |
| `tokens.css` | Colors, corners, spacing, text sizes, shadows, motion. The settings. |
| `base.css` | Page defaults: text, focus ring, scrollbars, text boxes, dropdowns, tick boxes, sliders. |
| `glass.css` | Window transparency. |
| `components.css` | Buttons, switches, pills, dialogs, the settings window, menus, toasts, tabs, toolbar, cards, phone parts. |
| `clean.css` | The clean look: fewer outlines, quiet fills, thin dividers. Only applies with `data-clean="on"` on `<html>`. |
| `fonts.css` + `fonts/` | IBM Plex Sans and IBM Plex Mono, with their license (`fonts/OFL.txt`). |
| `tailwind.css` | Bridge for apps built with Tailwind (Tagged). |
| `dialog-keys.js` | Dialogs take the cursor when they open, Escape always closes the top one (then the cursor goes back), Tab moves into it. Call `installDialogKeys()` once at startup. |
| `tokens.json` | The same settings as plain data, for games and native code. Every theme's full set of colors. |
| `themes.json` | The list of themes: id, name, dark or light, one line about it, and the few colors the picker draws with. |
| `themes.js` | The same list plus `Themes.apply(id)` and `Themes.picker(el, ...)`, for apps with no build step. |
| `check.mjs` | The theme check: `node theme/check.mjs`. Every theme sets every color, text passes contrast, data files match. |
| `SETTINGS.md` | The settings window standard: how every app's Settings looks and flows, and the theme picker. |
| `preview.html` | The gallery page. Also the test: if it looks right here, it looks right everywhere. |

## Put it in an app

1. Copy this `theme` folder into the app (same name, top level).
2. Load it before the app's own styles:
   - Plain CSS: `@import '../theme/fonts.css'; @import '../theme/theme.css';`
   - Vite / React: `import '../theme/theme.css';` as the first style import in the main file.
   - Tailwind v4: `@import 'tailwindcss'; @import '../theme/tokens.css'; @import '../theme/tailwind.css';`
     That gives the colors, corners and shadows as Tailwind classes (`bg-panel`, `text-ink`, `rounded-md`, `shadow-pop`).
     For the parts too (buttons, dialogs, menus, styled text boxes) add
     `@import '../theme/base.css' layer(components); @import '../theme/glass.css' layer(components);
     @import '../theme/components.css' layer(components);` and `@import '../theme/fonts.css';`.
     The layer keeps Tailwind classes on top, so `class="btn w-full"` works as you'd expect.
3. On `<html>` set `data-theme="mocha"` (or any id from `themes.json`) and `data-mode="dark"` (or `"light"`,
   also from `themes.json`). See **Themes** below for the picker.
4. Delete the app's own copies of anything this folder already has (color variables, button styles, dialog styles),
   so there is one source.

## The rules

1. **Never write a color, corner size or shadow by hand in an app.** Use the variable. If one is missing, add it to
   `tokens.css` here first, then use it.
2. **Use the role name, not the color name.** `var(--accent)`, not `var(--ctp-mauve)`. Role names keep working when
   the look changes.
3. **One primary button per screen.** Everything else is a normal, soft or ghost button.
4. **Corners go by what the thing is:**
   `--r-xs` 4 tiny marks · `--r-sm` 8 small things inside a control · `--r-md` 10 buttons, text boxes, rows ·
   `--r-lg` 14 cards, menus, toasts · `--r-xl` 18 windows and panes · `--r-2xl` 24 big feature cards · `--r-pill` pills.
5. **Lines are thin.** Inside a window use `--line-soft`. Use `--line` only for the outside edge of a window or box.
6. **Motion is quick and calm.** `--dur-1` (120 ms) for hover and press, `--dur-2` (180 ms) for things opening,
   `--dur-3` (280 ms) for panels sliding. Always with `--ease`. Nothing bounces. Never animate rows in a long list.
7. **A change to the look happens here first,** then gets copied to the apps. Never fix it in one app only.

## Themes

19 themes, all built the same way, so an app that uses the role names follows any of them with no extra work.

| | Dark | Light |
| --- | --- | --- |
| Catppuccin | Mocha (the home look) | Latte |
| Plain | Dark, Black | |
| Wyatt's own | Wasatch, Midnight, Glacier, Storm, Alpenglow, Redrock, Ember, Copper, Basalt, Spruce, Sagebrush | Powder, Bonneville, Aspen, Meadow |

Each of Wyatt's own is one family of backgrounds, one accent, and 14 named colors tuned to sit together. The
accent is always one of the theme's own named colors. Text passes the contrast check on every background
(`node theme/check.mjs --table` prints the numbers).

**In an app:**

1. Read the list from `themes.json` (apps with a build step) or load `themes.js` (plain pages: `Themes.list`).
   Never type a theme's name or colors into the app.
2. To switch: set `data-theme` to the theme's id and `data-mode` to its `mode` on `<html>`. Save the id in the
   app's settings. Plain pages: `Themes.apply(id)` does both attributes.
3. Glass is for dark themes. When `mode` is `light`, set `data-glass="off"` and gray out the transparency slider.
4. In CSS, `:root[data-mode='light']` means "any light theme" and `:root[data-mode='dark']` "any dark one". Never
   name one theme in a rule.
5. Put the **theme picker** in Settings > Look. The build is in `components.css` section 11 (`.themepick`) and the
   rules are in `SETTINGS.md`. Plain pages: `Themes.picker(el, { value, onPick })` draws it.

**Adding or changing a theme:** add its block to `tokens.css` (copy one of Wyatt's own; set every line), add its
id, name and one line to `themes.json`, then run `node theme/check.mjs --fix`. That checks contrast and writes
its colors into `tokens.json`, `themes.json` and `themes.js`. Look at it in `preview.html`.

## Colors (roles)

| Variable | Use it for |
| --- | --- |
| `--ground` | The window itself, behind everything |
| `--panel` | The main working area, dialogs, menus |
| `--surface` | Raised things: hover, the picked tab, cards on a panel |
| `--surface-2` | One step brighter: pressed |
| `--crust` | The darkest: wells, tooltips |
| `--line` / `--line-soft` | Borders / hairlines inside a window |
| `--ink` / `--muted` / `--overlay` | Normal text / helper text / placeholders and faint labels |
| `--accent` / `--accent-ink` / `--accent-soft` | The highlight / text on it / the quiet version |
| `--ok` `--warn` `--err` `--info` (+ `-soft`) | Status |
| `--red` `--peach` `--yellow` `--green` `--teal` `--sky` `--sapphire` `--blue` `--lavender` `--mauve` `--pink` ... | Tags, labels, charts |
| `--well` / `--field` / `--hover` / `--pressed` | Sunken track / text box fill / pointing at / holding down |
| `--paper` / `--shade` | Always white / always black, in every look: QR codes, print, things on top of a video |

## Glass (window transparency)

The app sets two things on `<html>`: `data-glass="on"` and `--t` (0% to 80%, the Transparency slider).
The blur of the desktop behind the window comes from the system (Windows acrylic, macOS vibrancy), turned on by the
app's own window code. The theme decides how see-through each layer is:

1. The window frame (`.app`): most see-through.
2. Working panels (`.glass-panel`): follow the slider.
3. Floating things (dialogs, settings, menus, toasts, or anything with `.glass-float`): never less than 78% solid,
   and they blur what is under them, so words on them always stay easy to read.

Light themes turn glass off (the app sets `data-glass="off"` when the theme's `mode` is `light`).

## The settings window

**The full standard is `SETTINGS.md`** (the flow, sizes, which control to use, the Look section and the theme
picker). Every app's settings use the same build, so they all look and behave alike:

```html
<div class="scrim">
  <div class="dialog settings">
    <header>Settings <span class="grow"></span> <button class="iconbtn">x</button></header>
    <div class="cols">
      <nav>
        <button class="navbtn on">Look</button>
        <button class="navbtn">Plugins</button>
      </nav>
      <div class="setpane">
        <h3>Look</h3>
        <div class="field"><label>Theme <div class="hint">Pick a theme and the whole app follows it.</div></label> <span class="muted">Mocha</span></div>
        <div class="themepick">...</div>   <!-- the theme picker, components.css section 11 -->
        <div class="field">
          <label>Autosave <div class="hint">One line that says what it does.</div></label>
          <label class="toggle"><input type="checkbox" /><span></span></label>
        </div>
      </div>
    </div>
  </div>
</div>
```

On a narrow window or a phone the settings list turns into a strip along the top and each control drops under its
name. That is built in; an app does nothing for it.

Any other dialog is the same without `settings` and `cols`: `header`, then `<div class="bodypad">`, then `footer`
with the buttons on the right (Cancel first, the primary button last).

**Bottom sheet (phones):** put `sheet` on the scrim (`<div class="scrim sheet">`) and the same dialog slides up from
the bottom edge on a phone, full width, with room for the home bar. On a wide window it is a centered dialog.
A `.menu` inside a sheet becomes an action sheet (full width, no box, tall rows), for long-press menus on a phone.

## Parts list

Buttons `.btn` (+ `primary` `soft` `ghost` `danger` `link`, `small` `large`, `pill`, `glow`) · `.iconbtn` (+ `on` `danger` `small`) ·
`.menubtn` · `.winbtn`
Controls: plain `input`, `select`, `textarea`, tick boxes, round options, sliders and `progress` are styled with no class ·
`.toggle` · `.segmented` · `.searchbox` · `.field` · `.bare` (a text box inside another control)
Labels `.pill` (+ `ok` `warn` `err` `info` `accent`) · `.chip` · `.badge` · `.section` · `kbd`
Windows `.scrim` (+ `center` `sheet`) · `.dialog` (+ `wide` `narrow`) · `.settings` · `.palette`
Popups `.menu` · `.popover` · `.toast` · `data-tip="..."`
Frame `.titlebar` · `.tabbar` `.tabs` `.tab` · `.toolbar` `.tb` `.sep` · `.statusbar` · `.navbtn`
Content `.card` (+ `raised`) · `.empty` · `.notice` (+ `ok` `warn` `err`) · `.progress` · `.spinner`
Theme picker `.themepick` · `.themebar` · `.themegrid` · `.themecard` (+ `on`) · `.themeprev` · `.themename` · `.themeabout`
Helpers `.grow` · `.muted` `.hint` · `.stack` · `.cluster` · `.frost`
Sizes `data-size="touch"` / `data-size="auto"` on `<html>` (see Touch sizes)
Phone `.fab` (round floating add button) · `.bottomnav` (bottom nav bar) · a `.menu` inside a `.scrim.sheet` becomes an action sheet

## Text size

Text sizes are `--fs-2xs` to `--fs-3xl`. They all multiply by `--tx`, so an app can offer a text size setting by
setting `--tx` on `<html>` (1 = normal, 1.15 = Drift's default). Apps that don't need it leave it alone.

## Touch sizes

Out of the box the theme is sized for a mouse (36 px buttons, 32 px text boxes). An app used on phones or tablets
turns on touch sizes with one setting on `<html>`:

- `data-size="touch"`: always big (44 px buttons, text boxes and menu rows, bigger switches and tick boxes).
- `data-size="auto"`: big only on a touch screen, normal with a mouse. Best pick for an app used on both.

Text in text boxes goes to 16 px in touch sizes, so an iPhone doesn't zoom in when you tap one. Apps that never set
`data-size` look exactly as before. Build an app's own parts from `--h-*` and they follow too.

## Changing the theme

The master copy lives in the Drift repo (GitHub `TallTeezSteez/drift`, folder `theme/`). Every app has a copy.
Any app's chat may change the theme, as long as it changes the master first, so all apps stay the same:

1. **Change the master, in its own pull request** on the Drift repo, touching only `theme/`. Never fix the look in
   one app only.
2. In the same pull request: add the new part or value to `tokens.css` / `components.css`, show it in
   `preview.html`, add it to `tokens.json` if it's a color or size, list it in the Parts list above, bump the
   **Version** line at the top, and add one line to **Changes** below.
3. Run `node theme/check.mjs` (it must pass), then open `preview.html` and click through the themes (the arrows
   next to the Look dropdown step through all of them) and the glass slider.
4. Only add what more than one app could use. App-only parts stay in that app's own styles, built from these
   variables.
5. Changing an existing value (a corner size, a color role) changes every app. Say so in the pull request and ask
   Wyatt first.
6. After it merges, copy the whole folder into the app you're working on. Other apps pick it up the next time
   they sync (ask Claude to "sync the theme to all apps").
7. Can't reach the Drift repo? Make the change in the app's copy, note it in the app's pull request as
   "theme change to send back", and tell Wyatt so it gets added to the master.

## Changes

- **2026-11-15** **Clean look** (`clean.css`, on with `<html data-clean="on">`): plain buttons, the search box, the
  2-to-4-choice switch, cards, tabs and the toolbar lose their outlines and sit on a quiet fill; status pills become a
  dot and the word. New colors `--fill-soft`, `--fill-hover`, `--line-faint`. Off = the look as it was. An app turns it
  on with one attribute and adds its own parts under `:root[data-clean='on']`. Switch in `preview.html` (top right).

- **2026-11-13** 15 new themes of Wyatt's own: Wasatch, Midnight, Glacier, Storm, Alpenglow, Redrock, Ember, Copper,
  Basalt, Spruce, Sagebrush (dark) and Powder, Bonneville, Aspen, Meadow (light). New: the list of themes
  (`themes.json`, `themes.js`), the theme picker part (`.themepick`), `data-mode="dark | light"` on `<html>`, the
  theme check (`check.mjs`) and the settings window standard (`SETTINGS.md`). `tokens.json` has every theme's
  colors. Mocha, Latte, Dark and Black did not change, and an app that does nothing new looks exactly as before.
- **2026-11-12.6** Phone parts, added for Kitted, usable by any app: the round floating add button (`.fab`, size
  `--h-fab`), the phone bottom nav bar (`.bottomnav`), and a `.menu` inside a `.scrim.sheet` becomes an action sheet.
  Shown in `preview.html`; `fab` added to `tokens.json`. Nothing existing changed.
- **2026-11-12.5** Added for Tagged, usable by any app: a bottom sheet for phones (`.scrim.sheet`), the Tailwind
  bridge's missing names (`hover`, `pressed`, `accent-hover`, `accent-line`, `paper`, `shade`, `scrim`, `flamingo`,
  `rosewater`), steps for loading the parts in a Tailwind app, and the fonts' license file (`fonts/OFL.txt`), so it
  travels with them. Nothing existing changed.
- **2026-11-12.4** Touch sizes for phones and tablets: `data-size="touch"` or `"auto"` on `<html>` (for Airflow
  Design, usable by any app). The few fixed sizes (menu rows, switch, tick box, search box, settings rows) became
  variables with the same values, so nothing changes in apps that don't turn it on. Shown with the Desktop / Touch
  switch in `preview.html`; sizes in `tokens.json` (`height`, `touchHeight`).
- **2026-11-12.3** `tokens.json` now has the Dark and Black looks too (it only had Mocha and Latte), so native code
  such as a window's title bar buttons can follow every look. Same values as `tokens.css`; nothing looks different.
- **2026-11-12.2** Added for Updraft, usable by any app: fixed white and black (`--paper`, `--shade`), the built-in
  `progress` bar styled like `.progress`, and a link-style button (`.btn.link`). Nothing existing changed.
- **2026-11-12** Code colors (`--syn-*`, `pre.code`) shown in `preview.html` and added to `tokens.json`.
- **2026-11-12** Dialogs take the cursor and Escape always closes the top one (`dialog-keys.js`).
- **2026-11-12** Code colors for 55 languages: `--syn-*` roles and `.syn-*` classes.
- **2026-11-12** First version: colors, corners, spacing, text, shadows, motion, glass, buttons, controls,
  dialogs, settings window, menus, toasts, frame, cards, fonts.

Palette: [Catppuccin](https://github.com/catppuccin/catppuccin) (MIT). Fonts: IBM Plex (SIL Open Font License).
