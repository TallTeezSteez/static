# Static

Wyatt's own picker, live guide, football board and daily paper. One private page to open instead of YouTube.

- **Watch:** Tonight's picks with Reroll, shelves by topic, no Shorts, nothing already seen. Learns from thumbs.
- **Live:** who's live on YouTube and Twitch, plus the week of regular shows.
- **Football:** live scores, red-zone games lit up, one click to the game on YouTube.
- **Paper:** a daily front page from RSS feeds, with videos mixed in and the weather.

## How it's put together

- Next.js on Vercel. One page (`app/page.tsx`) and one API route (`app/api/[...path]/route.ts`) that hands every request to `lib/api.ts`.
- All logic is in `lib/`. Postgres through `DATABASE_URL` (Neon, added from Vercel's Storage tab).
- The look is the shared `theme/` folder (copy of `TallTeezSteez/theme`). Follow `theme/README.md`: no hand-written colors.
- The YouTube key and Twitch keys are pasted into Settings and kept in the database, never in this repo.
- A daily job (`vercel.json`, 4 AM Mountain) pulls new videos and articles. Opening the app after a few hours away does the same.

## Working on it

```
npm install
npm test          # needs a local Postgres: TEST_DATABASE_URL, default postgres://postgres@127.0.0.1:5433/static_test
npm run build
DATABASE_URL=... npx tsx scripts/seed-dev.ts   # made-up data for a look-through (wipes that database)
DATABASE_URL=... npm run dev
```

Design: `docs/superpowers/specs/`. Build plan: `docs/superpowers/plans/`.
Changes go in through a pull request that Claude opens and merges after the Vercel check passes.
