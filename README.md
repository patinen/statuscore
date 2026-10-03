# StatusCore

StatusCore is a self-hosted monitoring platform for public services, built around GitHub authentication, monitor management, and safe HTTP checks.

## Phase 5 implemented

This repository includes the following Phase 5 features:

- GitHub OAuth authentication with the minimum required profile scope
- authenticated monitor CRUD and check history
- SSRF-safe public target validation for monitoring and notifications
- Redis/BullMQ job queueing for both monitor execution and notification delivery
- separate monitoring and notification worker processes
- secure HTTP/HTTPS checks with DNS/IP pinning and no redirect following
- incident lifecycle management with a single open incident per monitor
- notification channel configuration with per-user ownership and monitor associations
- notification delivery outbox semantics with `NotificationDelivery` rows created during incident transitions
- encrypted endpoint storage via AES-256-GCM and secure secret handling
- retry scheduling with infrastructure vs. business retry separation and `Retry-After` honor
- recent notification delivery history API and dashboard visibility
- public HTTPS-only webhook validation and Discord webhook host restrictions

## Current scope

The project remains focused on the following operational capabilities:

- self-hosted service monitoring
- incident tracking and resolution
- status notifications via webhook/Discord channels
- delivery retry and resilient outbox processing
- secure outbound networking constraints

The following capabilities remain intentionally out of scope for this phase:

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
NOTIFICATION_WORKER_CONCURRENCY=5
NOTIFICATION_ENCRYPTION_KEY=replace-with-a-32-byte-base64-or-raw-key
```

### Web (.env.local)

```env
NEXT_PUBLIC_API_URL=http://localhost:3001
```

## Notes

The current implementation includes authenticated monitoring, queue-backed schedulers, protected outbound HTTP checks, persisted incident history, and async notification delivery. The monitor lifecycle remains:

- failure threshold reached -> monitor DOWN -> incident opens
- continued failures -> same incident remains open
- successful check -> monitor UP -> incident resolves
- disabled DOWN monitor -> incident remains open until a successful check after monitoring resumes

The notification flow follows an outbox model:

- incident transitions create delivery rows in a transaction
- a dedicated notification queue processes due rows asynchronously
- workers retry transient failure without mutating the core monitor lifecycle
- endpoint URLs are encrypted at rest and validated against public HTTPS-only targets
- DNS/IP pinning and blocked-address protections remain enforced for all outbound notification requests
