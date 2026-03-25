# Claude Session Analytics

A local-first analytics dashboard for [Claude Code](https://docs.anthropic.com/en/docs/claude-code) session logs. Ingests JSONL session files, stores structured data in SQLite, and serves an interactive UI for exploring token consumption, tool usage, subagent behavior, and anomaly detection.

![TypeScript](https://img.shields.io/badge/TypeScript-5.7-blue)
![React](https://img.shields.io/badge/React-19-61dafb)
![Fastify](https://img.shields.io/badge/Fastify-5-000)
![SQLite](https://img.shields.io/badge/SQLite-node:sqlite-003B57)

## Features

- **Token analytics** — Track input, output, cache creation, and cache read tokens across sessions, projects, and models
- **Subagent accounting** — Distinguish top-level vs rolled-up (subagent-inclusive) token counts per session
- **Anomaly detection** — Automatic badges for sessions that are above project P90, subagent-heavy, cache-build-heavy, single-request spikes, or tool-loop heavy
- **Filtering** — Filter by project, model, Claude version, git branch, tool, date range, or free text
- **Visualizations** — Token trend charts, project/model breakdowns, top tools table, and session scatter plots (via Recharts)
- **Session comparison** — Select up to 2 sessions for side-by-side metric comparison
- **Session deep-dive** — Browse all requests in a session with subagent breakdown, tool calls, and fragment details
- **Incremental ingestion** — Skips unchanged files on re-scan (tracked by size + mtime)
- **URL-persisted state** — All filters and sort order stored in query params for shareable views

## How It Works

Claude Code writes JSONL session logs to `~/.claude/projects/`. This tool scans that directory, parses the events, deduplicates assistant messages by request ID, and stores structured data in a local SQLite database. A Fastify API serves the data to a React SPA.

```
~/.claude/projects/
├── <project>/
│   ├── <session-id>.jsonl              # main session log
│   └── <session-id>/subagents/
│       ├── agent-<id>.jsonl            # subagent log
│       └── agent-<id>.meta.json        # agent metadata
```

## Quick Start

```bash
# Install dependencies
npm install

# Start dev server (API on :3001, Vite on :5173)
npm run dev

# Or build and run production
npm run build
npm start
```

Open [http://localhost:5173](http://localhost:5173) in development, or [http://localhost:3001](http://localhost:3001) in production.

Click **Scan** to ingest session logs, or wait for the auto-scan on startup.

## Configuration

| Environment Variable | Default | Description |
|---|---|---|
| `CLAUDE_PROJECTS_DIR` | `~/.claude/projects` | Root directory containing JSONL session logs |
| `CLAUDE_ANALYTICS_DB` | `.data/claude-analytics.sqlite` | Path to the SQLite database file |
| `PORT` | `3001` | Server port |

## Project Structure

```
├── client/src/          # React SPA
│   ├── App.tsx          # Dashboard + session detail pages
│   ├── api.ts           # API client
│   └── styles.css       # Design system
├── server/src/          # Fastify API
│   ├── app.ts           # Route definitions
│   ├── db.ts            # SQLite schema + queries
│   ├── ingest.ts        # JSONL discovery + parsing
│   ├── analytics.ts     # Query engine for filters, overview, sessions
│   └── config.ts        # Environment defaults
├── shared/
│   └── contracts.ts     # TypeScript types shared between client/server
└── tests/               # Vitest integration + unit tests
```

## API Endpoints

| Method | Path | Description |
|---|---|---|
| `GET` | `/api/health` | Health check |
| `POST` | `/api/scan` | Trigger ingestion scan |
| `GET` | `/api/filters` | Available filter options |
| `GET` | `/api/overview` | KPIs, trends, breakdowns (accepts filter query params) |
| `GET` | `/api/sessions` | Paginated session list (filterable, sortable) |
| `GET` | `/api/sessions/:id` | Session detail with subagents |
| `GET` | `/api/sessions/:id/requests` | All requests in a session |

## Testing

```bash
npm test            # run once
npm run test:watch  # watch mode
```

To validate against a real session file:

```bash
REAL_SAMPLE_JSONL=~/.claude/projects/<project>/<session>.jsonl npm test
```

## Tech Stack

- **Server**: Fastify, Node.js native `node:sqlite`
- **Client**: React 19, React Router 7, Recharts
- **Build**: Vite, TypeScript
- **Test**: Vitest, React Testing Library

## License

MIT
