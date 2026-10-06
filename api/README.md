# StatusCore backend guide

The NestJS backend owns GitHub OAuth, authenticated configuration/history APIs, public status serialization, analytics and queue production. Execution runs in a separate process from the same package. See the [project overview](../README.md) and [deployment guide](../DEPLOYMENT.md).

## Processes and queues

| Process | Entry point | Responsibilities |
| --- | --- | --- |
| API | `src/main.ts` / `AppModule` | HTTP, auth, ownership-scoped CRUD, public reads, analytics, both schedulers |
| Worker | `src/worker.ts` / `WorkerModule` | Monitor checks and notifications; no HTTP listener or schedulers |

`AppModule` initializes `ScheduleModule`, `MonitoringSchedulerModule` and `NotificationsModule`. `WorkerModule` imports `MonitoringModule` and `NotificationWorkerModule`; shared services import neither scheduler provider nor `ScheduleModule`.

| Queue | API scheduling | Consumer / defaults |
| --- | --- | --- |
| `monitor-check` | Every 15 seconds; up to 100 enabled due monitors ordered by `nextCheckAt` | `MonitoringWorkerService`; `MONITOR_WORKER_CONCURRENCY=10` |
| `notification-delivery` | Every 15 seconds; up to 100 due PENDING deliveries | `NotificationWorkerService`; `NOTIFICATION_WORKER_CONCURRENCY=5` |

The monitor scheduler conditionally claims each row and advances `nextCheckAt` by its interval before enqueueing. Enqueue failure reschedules after 15 seconds. Jobs have three infrastructure attempts with exponential backoff starting at five seconds. Checks are not guaranteed to run precisely on interval boundaries.

Notification scheduling conditionally changes PENDING to PROCESSING before enqueueing. It recovers up to 100 PROCESSING rows with leases older than five minutes, returning them to PENDING after 30 seconds; enqueue failure also delays retry by 30 seconds. Queue infrastructure failures have five attempts with exponential backoff starting at two seconds.

Run one API replica: conditional claims are not distributed scheduler leader election. Worker startup runs no migrations. `/health` checks PostgreSQL connectivity, not Redis or consumers; observe worker logs and queue progress separately.

## Monitor and incident lifecycle

`MonitorExecutionService` records checks, updates state, opens/resolves automatic incidents and creates delivery rows in one serializable transaction. Serialization and active-incident uniqueness conflicts are retried within four transaction attempts. Committed migrations include a partial unique index on monitor ID where `resolvedAt IS NULL`; Prisma schema declarations alone do not fully represent it.

- Failure outside maintenance increments the streak; the configured threshold (default three) transitions to DOWN and opens one incident.
- Further failures retain that incident and update error context.
- Success resets the streak and sets UP; recovery from DOWN resolves an existing incident and creates a resolution delivery.
- Disabled/deleted monitors are skipped. Disabling a DOWN monitor does not resolve its incident.
- Active maintenance is evaluated at check completion (`checkedAt`), start inclusive and end exclusive. Failure still creates `CheckResult`, resets the streak to zero, preserves prior state and suppresses new outage transitions/deliveries. Success can recover existing outages. Maintenance is an overlay.

Manual incidents are separate human-authored records. Creation, timeline updates and resolution use transactions and emit `MANUAL_INCIDENT_OPENED`, `MANUAL_INCIDENT_UPDATED` and `MANUAL_INCIDENT_RESOLVED`. Metadata edits emit no event. Resolved incidents cannot receive further timeline updates or reopen. Manual incidents never mutate check history, monitor state/failure streaks or automatic incidents, and do not change monitoring analytics.

## Notification outbox and retries

`NotificationDelivery` rows persist in the transition transaction, then drain asynchronously. Automatic events are `INCIDENT_OPENED` / `INCIDENT_RESOLVED` (webhook names `incident.opened` / `incident.resolved`). Manual webhook names are `manual_incident.opened`, `manual_incident.updated` and `manual_incident.resolved`.

Automatic uniqueness is channel + incident + event; manual uniqueness is channel + timeline update + event. A channel linked to multiple affected monitors receives one manual delivery per entry. Channel name/type and owner are retained. Manual deliveries also snapshot title, impact, status, message, affected monitor names and payload; snapshots survive manual-source or channel deletion. Deleted channels cannot receive pending deliveries. Automatic payloads use related live records and can include the configured monitor URL for the owner's receiver; they lack full immutable payload snapshots, and incident deletion cascades their deliveries.

Business delivery attempts persist separately from BullMQ infrastructure retries. Transient network errors, HTTP 429 and HTTP 5xx schedule retries, normally after 30 seconds, 60 seconds, five minutes and fifteen minutes, with a five-attempt budget. HTTP 3xx and other non-success responses fail permanently. Positive numeric `Retry-After` seconds on 429/5xx override the schedule, capped at one hour; HTTP-date values are unsupported, and zero falls back to the normal schedule. Certain invalid/ownership/secret errors are classified as permanent by the delivery service.

Delivery is retryable, not exactly-once. Generic webhooks include `deliveryId` and `X-StatusCore-Delivery`; receivers should deduplicate. Channel ownership and public destinations are checked before sending. Endpoint storage uses AES-256-GCM, a random 12-byte IV and authentication tag. Preserve the shared base64 32-byte key in API/worker and backups.

## Outbound networking

Source: [URL validation](src/monitors/ssrf-validation.service.ts), [address rules](src/monitoring/target-address.service.ts), [monitor HTTP client](src/monitoring/safe-http-client.service.ts), [channel validation](src/notifications/notifications.service.ts) and [notification sender](src/notifications/notification-delivery.service.ts).

Configuration-time monitor validation accepts HTTP/HTTPS, rejects credentials, localhost references and blocked literal IPs. DNS validation happens at execution: all answers must pass configured address rules, then the first validated address is normalized and pinned. Private, loopback, link-local, carrier-grade NAT, configured reserved/documentation ranges and multicast are blocked; mapped IPv6 addresses are checked as IPv4. These explicit range rules do not guarantee every special-purpose address is excluded.

Native requests connect to the pinned address and preserve the original Host/TLS server name, with `rejectUnauthorized: true`. Monitor GET/HEAD checks follow 301/302/303/307/308 responses with Location up to five redirects, validate every destination and detect loops. Notification POST requests require HTTPS and reject all 3xx responses. Channel creation restricts Discord hosts to `discord.com`, `discordapp.com` and their subdomains, with `/api/webhooks/<numeric-id>/<token>` and no query string. Public-address checks run again at delivery time.

Do not bypass validation for local development or monitor private infrastructure addresses. See [deployment outbound requirements](../DEPLOYMENT.md#outbound-security).

## Public reads and analytics

`GET /public/status-pages/:slug` requires an enabled page and explicitly serializes selected labels/status/check timestamps, curated automatic reasons, manual messages/timelines and active maintenance text. It omits internal IDs, user identity, monitor URLs, notification configuration and raw check errors. Operator-authored text is public. Status priority is described in the [root README](../README.md#public-status-pages).

Authenticated `GET /monitors/:id/analytics?range=24h|7d|30d` and `GET /analytics/overview?range=24h|7d|30d` enforce ownership. Buckets are 15 minutes, one hour and six hours respectively. Raw check uptime includes maintenance failures; latency uses successful non-null timings and PostgreSQL `percentile_cont`. Automatic downtime merges overlaps for totals and measures individual clipped spans for longest downtime. Manual incidents do not enter these calculations. These metrics are observational, not SLA guarantees.

## Environment

Copy [.env.example](.env.example) to `.env` and adapt its production placeholders. Configuration loads `.env` then `.env.local` from the working directory. Run commands inside `api/`.

| Variables | Purpose |
| --- | --- |
| `DATABASE_URL`, `REDIS_URL` | PostgreSQL and BullMQ; Redis defaults to localhost for development |
| `PORT` | API listener, default 3001 |
| `NODE_ENV` | `development` locally; `production` enables Secure cookies |
| `CORS_ORIGIN`, `WEB_URL` | Comma-separated browser origins and OAuth redirect destination |
| `GITHUB_CLIENT_ID`, `GITHUB_CLIENT_SECRET`, `GITHUB_CALLBACK_URL` | API GitHub OAuth configuration |
| `AUTH_SESSION_SECRET` | API session JWT signing/verification secret |
| `NOTIFICATION_ENCRYPTION_KEY` | API/worker base64 key decoding to 32 bytes |
| `MONITOR_WORKER_CONCURRENCY`, `NOTIFICATION_WORKER_CONCURRENCY` | Worker concurrency, defaults 10 / 5; configure positive integers |

OAuth requests `read:user` and validates random state. Session cookies last seven days; state cookies last ten minutes. Both are HttpOnly, SameSite=Lax, host-only, path `/`, and Secure in production. CORS enables credentials for exact configured origins; explicitly blank origins deny browser origins. Worker needs no OAuth/session secrets or HTTP port. Production values and secret generation are in [DEPLOYMENT.md](../DEPLOYMENT.md#environment-inventory).

## Local startup and Prisma

Use Node.js 22 and npm. See [root setup](../README.md#local-development) for OAuth and localhost environment overrides.

```sh
npm ci
docker compose up -d
cp .env.example .env
# Edit .env for localhost and supply generated secrets / OAuth values
npm run db:generate
npm run db:deploy
npm run start:dev
```

In another terminal inside `api/`, run `npm run start:worker:dev`. PowerShell supports `Copy-Item` instead of `cp`. Compose is local-only: PostgreSQL 16 has development credentials and Redis 7 disables persistence.

| Script | Use |
| --- | --- |
| `db:generate` | Generate Prisma Client |
| `db:deploy` | Apply committed migrations for setup/production |
| `db:migrate` | Develop schema changes/create migrations (`prisma migrate dev`); development only |
| `db:studio` | Inspect local data with Prisma Studio |

Eight SQL migrations are committed, ending with `20261004001000_add_manual_incident_notification_delivery`. Their presence does not prove application to any database. Inspect a configured database with `npm exec -- prisma migrate status`. Production applies migrations through API startup before worker startup.

## Validation and compiled startup

```sh
npm run db:generate
npm run lint
npm run test
npm run build
npm run test:dist
npm run test:e2e
```

`lint` uses type-aware oxlint; `test` uses Vitest; `test:e2e` selects [vitest.config.e2e.ts](vitest.config.e2e.ts). The [e2e test](test/app.e2e-spec.ts) initializes `AppModule`, including schedulers, and retains a legacy `/` → `Hello World!` assertion that does not match the current controller's `/health` route. It was not repaired or run in this documentation pass. Use isolated database/Redis infrastructure and supplied environment values for future e2e work; this script is not evidence of operational readiness. `test:watch` and `test:cov` support development.

`test:dist` follows `build`: native Node tests load compiled ESM to catch production interoperability problems source transforms can hide, including `ipaddr.js` default imports and public/private/mapped address validation.

After generation, migrations and build, production API runs `npm run start:prod` (`node dist/main.js`), and worker runs `npm run start:worker` (`node dist/worker.js`). Follow [deployment startup order](../DEPLOYMENT.md#migration-and-startup-order); booting these processes can begin existing scheduled work.
