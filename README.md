# StatusCore

StatusCore is a self-hosted service monitoring and status-page platform. It checks public HTTP/HTTPS services in background workers, tracks outages, delivers webhook and Discord notifications, and publishes selected service status alongside manual incident updates and maintenance windows.

**Technologies:** Next.js / React / TypeScript / Tailwind CSS · NestJS / Prisma / PostgreSQL · Redis / BullMQ · npm / Docker Compose

## Why StatusCore

A monitoring system must keep checking services independently of browser requests, safely call user-configured targets, persist outage transitions, and deliver notifications without blocking those transitions. StatusCore explores these engineering problems together through queue-backed execution, SSRF-resistant networking, transactional incident records and notification deliveries, and explicit public serialization.

## Highlights

- Separate API and worker processes with BullMQ monitor and notification queues.
- Public-target validation, DNS answer checks, pinned connections and TLS verification.
- Automatic incident state machine with a database constraint allowing one open incident per monitor.
- Transactional notification outbox, asynchronous retries and AES-256-GCM endpoint encryption.
- Independent manual incident timelines with notification payload snapshots.
- Maintenance-aware outage suppression while checks continue to be recorded.
- Public status pages with selected services and safe serialization.
- Authenticated uptime, latency percentiles, downtime summaries and bounded historical buckets.

## Architecture

```mermaid
flowchart LR
    Browser[Operator browser] --> Web[Next.js frontend]
    Web --> API[NestJS API]
    API --> DB[(PostgreSQL)]
    API --> MQ[Redis / BullMQ monitor-check]
    MQ --> Worker[NestJS worker context]
    Worker --> Targets[Public monitored services]
    Worker --> DB
    API --> Outbox[PostgreSQL NotificationDelivery outbox]
    Worker --> Outbox
    Outbox --> Scheduler[API notification scheduler]
    Scheduler --> NQ[Redis / BullMQ notification-delivery]
    NQ --> Worker
    Worker --> Receivers[HTTPS webhook / Discord endpoints]
    Visitor[Public visitor] --> PublicWeb[Next.js /status/slug]
    PublicWeb --> PublicAPI[Public API serializer]
    PublicAPI --> DB
```

The API owns HTTP endpoints, GitHub OAuth, ownership-scoped CRUD, analytics, public reads and both schedulers. Each scheduler runs every 15 seconds. Monitor scheduling claims due enabled monitors according to their configured intervals; notification scheduling drains due delivery records.

The worker starts a Nest application context, not an HTTP server. It contains both monitor and notification consumers and imports neither scheduler provider nor `ScheduleModule`. PostgreSQL persists configuration, checks, incidents and delivery state; Redis transports background work. Monitor execution creates automatic outbox rows, while API manual incident transitions create manual outbox rows.

## Monitoring and network safety

Naively fetching arbitrary user URLs can expose internal services through SSRF. StatusCore accepts HTTP/HTTPS URLs without embedded credentials, rejects localhost references and blocked literal addresses, and validates every DNS answer at execution time. Private, loopback, link-local and other configured special-use ranges are blocked; IPv4-mapped IPv6 addresses are checked against the underlying IPv4 rules.

Connections use a validated, pinned IP with the original Host header and TLS server name, with certificate verification enabled. **Monitor checks follow up to five redirects**, revalidating and pinning each destination and detecting loops. **Notification requests reject redirects** and require HTTPS. Discord channel configuration restricts hosts and webhook paths.

These protections are not a claim of complete SSRF immunity. See the [backend guide](api/README.md#outbound-networking) and [deployment guide](DEPLOYMENT.md#outbound-security) for exact behavior and operational constraints.

## Incident and notification model

Failures outside maintenance increment a streak. Reaching the configured threshold (default three) changes the monitor to DOWN and opens an automatic `Incident`. Continued failures retain that incident; success resets the streak, sets UP and resolves an existing incident. Disabling a DOWN monitor leaves its incident open until success after monitoring resumes.

Check persistence, monitor state, automatic incident transitions and delivery records share a serializable database transaction with bounded conflict retries. A partial unique index enforces one unresolved automatic incident per monitor.

Manual incidents are human-authored communication with `INVESTIGATING`, `IDENTIFIED`, `MONITORING` and `RESOLVED` updates. They do not change `Monitor.currentStatus`, failure streaks, automatic incidents, `CheckResult` or monitoring analytics. Creation and timeline updates create delivery records in the same transaction; metadata edits emit no notification.

The delivery flow is **incident transition → persisted delivery record → asynchronous queue → delivery worker**. Webhook latency and delivery failures therefore do not block the committed transition. Delivery retries are persisted separately from queue infrastructure retries; receivers should deduplicate by delivery ID. Manual events retain immutable payload/timeline snapshots, with one delivery per channel and timeline entry. Automatic payloads use related incident/monitor records and do not have the same full snapshot guarantee.

Notification endpoints are encrypted at rest with AES-256-GCM. API and worker must share the encryption key and preserve it across redeployments and backups.

## Public status pages

Operators select and order monitors and publish a slug. `/status/[slug]` polls the unauthenticated public API every 30 seconds, displaying current service status, automatic incident history, manual timelines and active maintenance.

The serializer omits target URLs, notification endpoints, encrypted secrets, user identity, internal IDs and raw internal check errors. It includes curated automatic incident reasons and operator-authored titles, descriptions and messages; authors should treat those text fields as public.

Maintenance overlays a service's displayed status, including a disabled service; otherwise disabled monitors show UNKNOWN. Page priority is OUTAGE (manual major outage or uncovered automatic outage), DEGRADED (manual partial outage/degradation), MAINTENANCE, OPERATIONAL (a nonempty set of services all operational), then UNKNOWN.

## Analytics

Authenticated monitor and overview analytics use fixed `24h`, `7d` and `30d` ranges. Uptime is successful checks divided by total recorded checks; empty samples return null. Successful checks with non-null timings supply average/min/max latency and PostgreSQL continuous p50/p95/p99 percentiles.

| Range | Historical bucket size | Buckets |
| --- | --- | --- |
| 24h | 15 minutes | 96 |
| 7d | 1 hour | 168 |
| 30d | 6 hours | 120 |

Automatic incident intervals are clipped to the selected range; unresolved incidents extend to the request end. Total downtime merges overlaps, while longest downtime measures the longest individual clipped incident. Overview uptime averages per-monitor percentages for monitors with samples.

Queries use raw `CheckResult` and `Incident` history. Maintenance failures remain in check-based uptime; manual incidents do not contribute downtime. These observational monitoring metrics are not maintenance-adjusted SLA reports or an SLA guarantee. Historical analytics currently require authentication.

## Maintenance windows

One-time, monitor-scoped windows derive SCHEDULED, ACTIVE, ENDED or DISABLED state. Active coverage includes the start and excludes the end. Checks continue: failures are recorded, reset the failure streak to zero, preserve prior monitor state and do not open new automatic incidents or outage deliveries. Success can recover DOWN monitors and resolve existing incidents. Maintenance is an overlay rather than a persisted monitor status. Recurring schedules remain future work.

## Tech stack

Versions describe package declarations; committed npm locks resolve exact installations.

| Layer | Packages / tooling |
| --- | --- |
| Frontend | Next.js `16.3.8`, React / React DOM `19.2.8`, TypeScript `^5`, Tailwind CSS `^4` |
| Backend | NestJS `^11.0.0`, TypeScript `^6.0.2`, Prisma / client `^6.3.0` |
| Jobs | BullMQ `^6.3.11`, ioredis `^6.0.0`, Redis 7 local image |
| Persistence | PostgreSQL 16 local image |
| Validation | Vitest `^4.1.2`, oxlint `^1.58.0`, native Node compiled-output tests, frontend ESLint `^9` |
| Operations | npm locks, Docker Compose local dependencies, documented Coolify / Nixpacks topology |

## Deployment architecture

The [deployment guide](DEPLOYMENT.md) describes five separate resources: public Web and API, a private worker, private PostgreSQL and private Redis. API applies committed migrations before starting HTTP/schedulers; worker starts after migrations and runs no migrations or HTTP listener. Use one API replica because scheduler leader election is not implemented.

Node.js 22 is the documented runtime target. Set `NEXT_PUBLIC_API_URL` before building Web, configure credentialed CORS and production Secure cookies, and retain the notification encryption key. Guide domains are configuration targets; repository evidence does not establish a completed live deployment.

## Local development

Prerequisites: Node.js 22, npm and Docker. From the repository root:

```sh
cd api
npm ci
docker compose up -d
cp .env.example .env
```

PowerShell users can use `Copy-Item` instead of `cp`. Examples are production templates: edit `api/.env` before starting locally.

```env
NODE_ENV=development
PORT=3001
CORS_ORIGIN=http://localhost:3000
WEB_URL=http://localhost:3000
GITHUB_CALLBACK_URL=http://localhost:3001/auth/github/callback
DATABASE_URL=postgresql://statuscore:statuscore_dev_password@localhost:5432/statuscore_dev?schema=public
REDIS_URL=redis://localhost:6379
MONITOR_WORKER_CONCURRENCY=10
NOTIFICATION_WORKER_CONCURRENCY=5
```

Create a GitHub OAuth application with homepage `http://localhost:3000` and callback `http://localhost:3001/auth/github/callback`; set its `GITHUB_CLIENT_ID` and `GITHUB_CLIENT_SECRET` in `api/.env`. Generate a separate high-entropy `AUTH_SESSION_SECRET` and a `NOTIFICATION_ENCRYPTION_KEY` encoding exactly 32 random bytes:

```sh
node -e "console.log(require('node:crypto').randomBytes(48).toString('hex'))"
node -e "console.log(require('node:crypto').randomBytes(32).toString('base64'))"
```

Save outputs only in the local environment file. API and worker read the same file when started from `api/`.

```sh
# Terminal 1, in api/: initialize existing schema and start API
npm run db:generate
npm run db:deploy
npm run start:dev

# Terminal 2, in api/: start both background consumers
npm run start:worker:dev

# Terminal 3, from repository root
cd web
npm ci
cp .env.example .env.local
# Set NEXT_PUBLIC_API_URL=http://localhost:3001 in .env.local
npm run dev
```

Open `http://localhost:3000`; API listens on `http://localhost:3001`. Compose credentials are development-only. Monitor targets must still be public; localhost targets are blocked.

`db:deploy` applies the eight existing committed migrations for reproducible setup. Use `db:migrate` (`prisma migrate dev`) when developing schema changes and creating migrations, never in production. See [API documentation](api/README.md) for process/database commands.

## Validation / testing

```sh
# In api/
npm run db:generate
npm run lint
npm run test
npm run build
npm run test:dist
npm run test:e2e

# In web/
npm run lint
npm run build
```

`test:dist` runs native Node tests against compiled production ESM modules after the build. It catches interoperability regressions hidden by source-level transformation, including `ipaddr.js` parsing and SSRF-related private/mapped address blocking. Web builds use Google Fonts and need font download access. See the backend guide for e2e configuration.

## Current limitations / roadmap

The supplied roadmap links cover [external / multi-region probes (#1)](https://github.com/patinen/statuscore/issues/1), [recurring maintenance (#2)](https://github.com/patinen/statuscore/issues/2), [public historical analytics (#3)](https://github.com/patinen/statuscore/issues/3), [check retention and rollups (#4)](https://github.com/patinen/statuscore/issues/4), and [GitHub Actions CI (#5)](https://github.com/patinen/statuscore/issues/5). Their current open/closed state could not be verified during this documentation audit.

The inspected revision has no multi-region probes, recurring maintenance, public historical analytics, retention/rollups or committed GitHub Actions workflow. Raw history grows without an operator retention strategy. Delivery is retryable rather than exactly-once. SLA guarantees, subscriber email/SMS, custom domains/themes and real-time push updates are outside current scope. Track future work in [GitHub Issues](https://github.com/patinen/statuscore/issues).
