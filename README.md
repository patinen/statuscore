# StatusCore

StatusCore is a self-hosted monitoring platform for public services, built around GitHub authentication, monitor management, and safe HTTP checks.

## Phase 8 implemented

This repository includes the following Phase 5, Phase 6, Phase 7, and Phase 8 features:

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

This repository now also includes Phase 7 uptime and latency analytics:

- authenticated monitor analytics endpoint: `GET /monitors/:id/analytics?range=24h|7d|30d`
- authenticated overview analytics endpoint: `GET /analytics/overview?range=24h|7d|30d`
- check-based uptime percentage computed as successful checks / total checks within the selected range
- latency statistics from successful checks with non-null response times (average, min, max, p50, p95, p99)
- incident downtime summaries including overlap-aware total downtime and longest downtime span
- bounded historical bucket series with fixed resolutions:
	- `24h`: 15-minute buckets
	- `7d`: 1-hour buckets
	- `30d`: 6-hour buckets
- dashboard analytics cards and monitor-level charts for uptime and average latency

This repository now also includes Phase 8 maintenance windows:

- authenticated maintenance window CRUD (`/maintenance-windows`)
- ownership-scoped monitor associations for maintenance windows
- derived maintenance state (`SCHEDULED`, `ACTIVE`, `ENDED`, `DISABLED`)
- maintenance-aware monitor overlays on authenticated dashboards
- maintenance suppression in automatic outage transitions:
	- checks continue and `CheckResult` rows are still persisted
	- failed checks during active maintenance do not increment outage streaks
	- failed checks during active maintenance do not open automatic incidents
	- failed checks during active maintenance do not create `INCIDENT_OPENED` deliveries
	- successful checks can still recover DOWN monitors and resolve pre-existing incidents
- public status pages now expose `MAINTENANCE` monitor/page states and active maintenance details for affected services

Uptime percentage is calculated from recorded monitoring checks and is not an SLA guarantee.

## Current scope

The project remains focused on the following operational capabilities:

- self-hosted service monitoring
- incident tracking and resolution
- status notifications via webhook/Discord channels
- delivery retry and resilient outbox processing
- secure outbound networking constraints
- public read-only status pages for selected monitors
- authenticated analytics for uptime, latency, incidents, and historical trend buckets

The following capabilities remain intentionally out of scope for this phase:

- SSE/WebSockets
- retention/rollups
- SLA reporting
- custom domains
- custom CSS/themes
- recurring maintenance schedules
- manual incidents
- subscriber email/SMS notifications
- public historical uptime analytics
- multi-region monitoring

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

Maintenance behavior follows these rules:

- monitoring checks continue during maintenance windows
- check failures during active maintenance are recorded but do not push monitor lifecycle into new outages
- failure streak remains reset during maintenance suppression
- pre-existing incidents can still resolve on successful checks during maintenance
- maintenance acts as a status overlay; monitor `currentStatus` is not replaced with a persisted maintenance state

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

## Analytics notes

Phase 7 analytics use fixed bounded ranges (`24h`, `7d`, `30d`) and UTC timestamps internally.

- no arbitrary unbounded range queries are exposed yet
- failed checks and null response times are excluded from latency calculations
- unresolved incidents contribute downtime through the request `to` timestamp
- overlapping incident intervals are merged for downtime duration aggregation to avoid double counting
- `totalDowntimeMs` uses merged overlaps, while `longestDowntimeMs` represents the longest individual incident overlap within the window
- public historical analytics remain out of scope and are not exposed in this phase
- analytics are intentionally check-based in this phase and are not maintenance-adjusted or SLA-adjusted metrics

Analytics currently query raw `CheckResult` and `Incident` records with bounded aggregation. Future retention/rollups can replace raw-history query paths while preserving API contracts.

## Planned future enhancements

- retention/rollups for long-term analytics efficiency
- public historical uptime views
- recurring maintenance schedules
- custom domains
- multi-region monitoring
