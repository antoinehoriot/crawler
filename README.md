# trend-crawler

Personal trend ranker. Crawls Google Trends, Reddit, and Hacker News daily
(GitHub Actions, 06:00 Europe/Paris), stores snapshots in `data/trends.db`
(SQLite, committed), and writes a ranked digest to `reports/YYYY-MM-DD.md`.

Design spec: `docs/superpowers/specs/2026-07-19-trend-crawler-design.md`.

## Usage

- `npm run go` — collect + report (what CI runs)
- `npm run collect` / `npm run report` — each half separately
- `npm test` — unit tests; `LIVE=1 npx vitest run` includes live API smoke tests

## Tuning

Weights, windows, and the subreddit list live in `config.json`.
