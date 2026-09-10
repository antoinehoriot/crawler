# trend-crawler

A small TypeScript service that collects public trend signals from Google Trends,
Hacker News, and Reddit, stores snapshots in SQLite, and generates a daily ranked
Markdown digest.

The included GitHub Actions workflow runs every day at 04:23 UTC. Historical
snapshots are committed to [`data/trends.db`](data/trends.db), and generated
digests are committed under [`reports/`](reports/).

## Requirements

- Node.js 22 or later
- npm

## Getting started

```sh
npm ci
npm test
npm run go
```

`npm run go` collects fresh signals and writes `reports/YYYY-MM-DD.md`. The
SQLite database and `reports/` directory are created automatically if they do
not exist.

Available commands:

| Command | Description |
| --- | --- |
| `npm run collect` | Collect signals and update `data/trends.db` |
| `npm run report` | Generate a digest from the existing snapshots |
| `npm run go` | Collect signals, then generate a digest |
| `npm test` | Run the test suite |
| `npm run typecheck` | Check TypeScript types |

Set `LIVE=1` when running Vitest to include live API smoke tests:

```sh
LIVE=1 npx vitest run
```

## Configuration

Edit [`config.json`](config.json) to choose subreddits and tune scoring weights,
the history window, and the number of results. Scoring weights must add up to
`1`.

Reddit works without credentials by using public RSS/JSON endpoints. For more
reliable collection and richer signals, provide credentials for a Reddit
script app:

```sh
export REDDIT_CLIENT_ID='…'
export REDDIT_CLIENT_SECRET='…'
export REDDIT_USERNAME='…' # optional; used in the Reddit User-Agent
npm run go
```

Do not commit credentials. The repository ignores local `.env` files, but the
application reads environment variables from the process and does not load an
`.env` file automatically.

## GitHub Actions

The workflow in [`.github/workflows/crawl.yml`](.github/workflows/crawl.yml)
runs tests, collects signals, commits the database and report, and optionally
sends an [ntfy](https://ntfy.sh/) notification.

Configure these repository secrets under **Settings → Secrets and variables →
Actions**:

- `REDDIT_CLIENT_ID` and `REDDIT_CLIENT_SECRET` — optional Reddit OAuth
  credentials
- `REDDIT_USERNAME` — optional Reddit username for the API User-Agent
- `NTFY_TOPIC` — optional private ntfy topic name

The workflow needs permission to write repository contents. Public forks do not
receive the original repository's Actions secrets; fork owners must configure
their own.

## Data and security

The committed database and reports contain only collected public trend data:
topic titles, source names, public URLs, metrics, and capture timestamps. Keep
API credentials in environment variables or GitHub Actions secrets, never in
`config.json`, source files, reports, or the database.

If a secret is committed accidentally, revoke it before removing it from Git
history—the value remains exposed in earlier commits otherwise.

## License

[MIT](LICENSE)
