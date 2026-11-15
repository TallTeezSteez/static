# The settings window

**Standard for every app.** Written down from Drift's Settings (Nov 2026), which is the one Wyatt likes. An app's
settings should look and flow like this, so moving between apps feels the same. The styles are already in
`components.css` (`.settings`, `.field`, `.navbtn`, `.themepick`); this page is the "how to use them" part.

See it: open `preview.html` and scroll to **Settings window**. The theme picker there is live.

## The flow

1. **Getting in.** Three ways, all three in every app: the gear at the bottom of the left menu, **Ctrl+,** and
   "Settings" in the command bar (Ctrl+K). Other parts of the app can open Settings straight to a section
   (Drift: a "turn it on in Settings > Editor" message opens Editor).
2. **One window, sections on the left, rows on the right.** Click a section, its rows show on the right. Nothing
   opens a second window.
3. **Every change applies right away and is saved.** There is no Save or Apply button and no "are you sure".
   Flip a switch and it's done. Pick a theme and the whole app changes behind the window while you watch.
4. **Getting out.** Escape, the x at the top right, or a click outside the window. All three do the same thing.
   The cursor goes back to where it was (`dialog-keys.js`).

## The window

| Part | Size and look |
| --- | --- |
| Window | 820 px wide (never more than 94% of the screen), starts 12% down from the top, `--r-xl` corners, `--panel` fill, `--line` edge, the big `--shadow` |
| Header | 50 px tall. The word "Settings" in bold on the left, a close `.iconbtn` on the right, a hairline under it |
| Section list (left) | 190 px wide, a slightly darker tint than the rest, hairline on its right. Rows are `.navbtn`: 34 px tall, icon then name |
| Rows area (right) | Padding 18 px top, 22 px sides and bottom. **Fixed height** (66% of the screen, 600 px at most), so the window never jumps when you change section. Only this area scrolls |
| Footer | None. Nothing to save, so nothing to put there. (A plain dialog still gets a footer with Cancel then the primary button.) |

Behind it the app dims (`--scrim`). The window opens with the quick pop (`--dur-1`), nothing slides or bounces.

With window transparency on, the settings window stays at least 78% solid and blurs what's behind it, so the words
are always easy to read (that's in `glass.css`; an app does nothing for it).

## The section list

- The picked section has the soft accent fill (`--accent-soft`) and its icon turns the accent color. Others are plain.
- **Look is always first. About (version and updates) is always last. Plugins or accounts sit just above About.**
  The app's own sections go in between, most-used first.
- One line-style icon per section (Drift uses lucide). One or two words per name.
- Five to nine sections. Fewer than five rows in a section? Fold it into another one.

Drift's list, as the model: Look · Editor · Grammar · Fonts · Terminal · Sync · Sharing · Plugins · About & updates.

## The rows

Each section starts with its name as a heading (`h3`, 16 px bold). If the section needs explaining, one short
paragraph in the quiet color goes right under it. Then the rows.

**A row (`.field`)** is the setting's name on the left and its control on the right, 46 px tall or more, with a
hairline between rows.

- **Name:** two to four words, sentence case, no colon. "Window transparency", not "Transparency Level:".
- **Hint (optional):** one or two plain lines under the name in the quiet color. It says what the setting does, and
  where else it lives if it has a shortcut or a button ("Also the switch at the top right").
- **Control:** always on the right, lined up down the window.

Pick the control by what the setting is:

| The setting is... | Use | Notes |
| --- | --- | --- |
| On or off | `.toggle` switch | Never a tick box |
| One of two to four short choices | `.segmented` | "All / Dark / Light" |
| One of many | a dropdown (`select`) | At least 200 px wide. Put "(recommended)" on the best choice |
| A number on a scale | a slider, with the number shown to its right | Transparency: 0 to 80 in steps of 5, shows "35%" |
| Words or a key | a text box | At least 200 px wide. Passwords and keys use a password box |
| Something to do | a `.btn` | "Change…", "Check again". At most one `primary` button in a section |
| Just telling you something | a `.pill` | "Syncthing", "Signed in", "on" / "off" |

More rules:

- **Rows that depend on a switch only show when it's on,** right under it, with the parent's name in front:
  "Focus: typewriter scroll", "Focus: dim the rest".
- **A group inside a section** gets a small faint heading in capitals (`h4`), not a new section.
- **A thing with its own on/off and its own rows** (a plugin, an account, a download) is a box (`.plugin` /
  `.setcard`): name and an on/off pill on the left with one line about it, its switch on the right, and its own rows
  show inside the box once it's on.
- **Setup steps** are a numbered list in plain words, one action per step.
- A setting that can't be used right now is grayed out and its hint says why ("Dark themes only").

## The Look section (the same in every app)

Look is where the theme lives. Every app has these, in this order, before its own Look settings:

1. **Theme.** A row that says "Theme" with the hint "Pick a theme and the whole app follows it." and the name of the
   picked theme on the right. Under it, the **theme picker** (below).
2. The app's own look settings (Drift: notebook style, app size, text size...).
3. **Window transparency** (desktop apps with a see-through window): a slider, 0 to 80 in steps of 5, the number on
   the right. Hint: "See-through blur behind the app. Dark themes only." Grayed out while a light theme is picked.

### The theme picker (`.themepick`)

- A small **All / Dark / Light** switch and a count ("19 themes").
- A grid of cards, as many per row as fit (each at least 124 px wide; four per row in the standard window).
- Each card: a little picture of a window drawn in that theme's own colors, the theme's name, and one line about it.
  The list, names, lines and colors come from `themes.json`. Never type a theme's colors into an app.
- **Click a card and the app changes right away.** The picked card gets the accent outline, the soft accent fill and
  a tick. No confirm, no reload.
- Dark themes first (Mocha first of all), then light ones.

What the app does when a theme is picked:

1. Set `data-theme` (the theme's id) and `data-mode` (`dark` or `light`) on `<html>`.
2. Turn glass off for a light theme (`data-glass="off"`), back on for a dark one if the slider is above 0.
3. Save the id in the app's settings. Also remember it as the "last dark" or "last light" theme.
4. **Ctrl+Shift+L** flips between the last dark and the last light theme (Latte until another light one is picked).
   It's also in the command bar as "Switch light / dark".

An app with no build step can let the theme folder do all of that:
`Themes.picker(el, { value, onPick })` and `Themes.apply(id)` from `themes.js`.

## Saving

- Settings live on the device, in one place per app (Drift: `drift-settings-v1` in the app's own storage). Secrets
  such as sign-in tokens stay out of any synced folder.
- A setting the app doesn't know (saved by a newer version) is left alone, not wiped. A theme id the app doesn't
  have shows as Mocha.
- New features are a switch in Settings, off until turned on.

## On a phone or a narrow window

Built in, an app does nothing for it: under 640 px wide the window fills the width, the section list turns into a
strip along the top that scrolls sideways, and each control drops under its name. Turn on touch sizes
(`data-size="auto"` on `<html>`) so switches and rows are finger-sized.

## Checklist for matching an app

- [ ] Opens from the gear, Ctrl+, and the command bar. Escape, the x and a click outside close it.
- [ ] Built from `.scrim` > `.dialog.settings` > `header` + `.cols` (`nav` of `.navbtn`, then `.setpane`). No footer.
- [ ] Look is first with the Theme row and the theme picker on top. About is last.
- [ ] Every setting is a `.field` row: name left, optional hint under it, control right.
- [ ] Switches for on/off. No tick boxes, no Save button. Changes apply as you make them.
- [ ] Window transparency (if the app has it) is grayed out on light themes.
- [ ] Ctrl+Shift+L flips light and dark.
- [ ] No color, corner or shadow written by hand: only the theme's variables.
