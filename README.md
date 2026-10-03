# StatusCore

StatusCore is a self-hosted monitoring platform for public services, built around GitHub authentication, monitor management, and safe HTTP checks.

## Phase 6 implemented

This repository includes the following Phase 5 and Phase 6 features:

- GitHub OAuth authentication with the minimum required profile scope
- authenticated monitor CRUD and check history
- SSRF-safe public target validation for monitoring and notifications
- Redis/BullMQ job queueing for both monitor execution and notification delivery
- separate monitor and notification queue consumers in the worker process
- secure HTTP/HTTPS checks with DNS/IP pinning and no redirect following
- incident lifecycle management with a single open incident per monitor
- notification channel configuration UI with per-user ownership and monitor associations
- notification delivery outbox semantics with `NotificationDelivery` rows created during incident transitions
- encrypted endpoint storage via AES-256-GCM and secure secret handling
- retry scheduling with infrastructure vs. business retry separation and `Retry-After` honor
- recent notification delivery history API and dashboard visibility
- public HTTPS-only webhook validation and Discord webhook host restrictions

This repository now also includes Phase 6 public status pages:

- authenticated status page CRUD with public slug management
- public unauthenticated status page API for selected monitors and incident history
- public status page route under `/status/[slug]`
- safe public serialization that omits monitor URLs, webhook secrets, user identity, and internal error details
- monitor ordering and public availability semantics for enabled and disabled monitors

## Current scope

The project remains focused on the following operational capabilities:

- self-hosted service monitoring
- incident tracking and resolution
- status notifications via webhook/Discord channels
- delivery retry and resilient outbox processing
- secure outbound networking constraints
- public read-only status pages for selected monitors

The following capabilities remain intentionally out of scope for this phase:

- uptime/latency analytics
- charts
- SSE/WebSockets
- retention/rollups
- SLA reporting
- custom domains
- custom CSS/themes
- maintenance windows
- manual incidents
- subscriber email/SMS notifications

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

The public status page flow is:

- monitor checks update monitor state and open or resolve incidents
- authenticated users select monitors on a status page and publish a slug
- the public API serves only safe page, monitor status, and incident history fields
- the web status page at `/status/<slug>` polls the public API every 30 seconds
- public pages intentionally do not expose monitor URLs, webhook URLs, encrypted secrets, user data, or raw check errors
