# StatusCore

StatusCore is a self-hosted monitoring platform for public services, built around GitHub authentication, monitor management, and safe HTTP checks.

## Phase 3 implemented

This repository includes the following Phase 3 features:

- GitHub OAuth authentication with the minimum required profile scope
- authenticated monitor CRUD
- SSRF-safe public target validation
- Redis/BullMQ job queueing
- 15-second scheduler scan for due monitors
- separate monitoring worker process
- secure HTTP/HTTPS checks
- DNS/IP pinning for outbound socket connection
- CheckResult history storage
- automatic monitor state transitions
- recent check history API and UI

## Planned and not yet implemented

The following capabilities remain intentionally out of scope for the current Phase 3 work:

- incident lifecycle
- alerts
- uptime/latency analytics
- charts
- public status pages
- SSE/WebSockets
- retention/rollups

## Current stack

- Next.js
- React
- TypeScript
- Tailwind CSS
- NestJS
- Prisma
- PostgreSQL
- Redis
- BullMQ
- Docker Compose

## Repository structure

```text
statuscore/
├── api/
│   ├── .env.example
│   ├── docker-compose.yml
│   ├── prisma/
│   ├── src/
│   └── package.json
├── web/
│   ├── .env.example
│   ├── app/
│   ├── public/
│   └── package.json
├── README.md
├── .gitignore
└── .env.example (optional root config if used locally)
```

## Local development

### Prerequisites

- Node.js 20+
- npm
- Docker Desktop or Docker Engine

### Infrastructure

```bash
cd api
docker compose up -d
```

This starts PostgreSQL and Redis for local development.

### Frontend

```bash
cd web
npm install
cp .env.example .env.local
npm run dev
```

The frontend runs on http://localhost:3000 by default.

### API

```bash
cd api
npm install
cp .env.example .env
npm run db:generate
npm run db:deploy
npm run start:dev
```

The API runs on http://localhost:3001 by default.

### Monitoring worker

```bash
cd api
npm run start:worker:dev
```

The worker runs the background monitor execution queue without starting the API HTTP server or scheduler.

### Production worker

```bash
cd api
npm run build
npm run start:worker
```

## Required environment variables

### API (.env)

```env
NODE_ENV=development
PORT=3001
WEB_URL=http://localhost:3000
GITHUB_CLIENT_ID=
GITHUB_CLIENT_SECRET=
GITHUB_CALLBACK_URL=http://localhost:3001/auth/github/callback
AUTH_SESSION_SECRET=replace-with-a-long-random-secret
DATABASE_URL=postgresql://statuscore:statuscore_dev_password@localhost:5432/statuscore_dev?schema=public
REDIS_URL=redis://localhost:6379
MONITOR_WORKER_CONCURRENCY=10
```

### Web (.env.local)

```env
NEXT_PUBLIC_API_URL=http://localhost:3001
```

## Notes

The current implementation includes authenticated monitoring, a queue-backed scheduler, protected outbound HTTP checks, and persisted check results. It intentionally excludes incidents, alerting, and public status features for this phase.
