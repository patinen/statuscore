# StatusCore production deployment

Source audited: Phase 10, commit `7349639`. This guide covers preparation, not a live deployment. Use npm and the committed package locks. No new product features or distributed leader election are required.

## Environment inventory

All application configuration lookups in `api/` and `web/`, plus Prisma's schema, were inspected. `CORS_ORIGIN` is an additional variable beyond the requested minimum; it already existed at the source commit. No application variables are missing from the updated examples.

| Variable | Process | Production value / requirement |
| --- | --- | --- |
| `NODE_ENV` | API, worker; web framework | `production`; API uses this to enable Secure cookies |
| `PORT` | API | `3001` (default); match Coolify internal port |
| `CORS_ORIGIN` | API | `https://status.pat1.online`; comma-separated exact origins, no trailing slash |
| `WEB_URL` | API | `https://status.pat1.online` |
| `GITHUB_CLIENT_ID` | API | GitHub OAuth application client ID |
| `GITHUB_CLIENT_SECRET` | API | GitHub OAuth secret, runtime only |
| `GITHUB_CALLBACK_URL` | API | `https://api.status.pat1.online/auth/github/callback` |
| `AUTH_SESSION_SECRET` | API | Independently generated high-entropy secret, runtime only |
| `DATABASE_URL` | API, worker; Prisma generation | Coolify internal PostgreSQL URL including credentials and `?schema=public` |
| `REDIS_URL` | API, worker | Coolify internal Redis URL including password/database; localhost default is development only |
| `MONITOR_WORKER_CONCURRENCY` | Worker | Positive integer, default `10` |
| `NOTIFICATION_WORKER_CONCURRENCY` | Worker | Positive integer, default `5` |
| `NOTIFICATION_ENCRYPTION_KEY` | API, worker | Base64 encoding of exactly 32 random bytes; same key in both processes |
| `NEXT_PUBLIC_API_URL` | Web | `https://api.status.pat1.online`; required at build time |

Generate encryption key locally with `node -e "console.log(require('node:crypto').randomBytes(32).toString('base64'))"`. Generate a separate session secret with `node -e "console.log(require('node:crypto').randomBytes(48).toString('hex'))"`. Store real values only in Coolify secrets. Preserve the encryption key across redeployments and backups: replacing it makes existing encrypted channel URLs unreadable. Percent-encode reserved characters in connection URL passwords. Worker needs no OAuth secrets, frontend URL, or HTTP port.

Examples are production templates, not usable credentials. For local HTTP development set `NODE_ENV=development`, `CORS_ORIGIN` and `WEB_URL` to `http://localhost:3000`, callback to `http://localhost:3001/auth/github/callback`, public API URL to `http://localhost:3001`, and use README's local database/Redis URLs. Never bake `.env` files containing secrets into images.

## Exact Coolify resources and commands

Create five separate resources on the same server/destination and shared internal Docker network. Use the internal connection URLs shown by Coolify; `postgres` and `redis` in examples are placeholder hostnames. Configure DNS for both public names to the proxy and enable HTTPS certificates.

A. **PostgreSQL**: PostgreSQL 16, database `statuscore`, dedicated user/password, persistent volume, backups, internal port 5432 only. Do not publish it publicly.

B. **Redis**: Redis 7, password authentication, persistent volume/AOF enabled, `maxmemory-policy noeviction`, internal port 6379 only. The repository's local compose file disables persistence and contains development credentials; do not use it as production configuration.

C-E. Create repository applications using the **Nixpacks** build pack, static site mode disabled, Node.js 22 (tested locally on 22.17.1). Set Coolify's build-only `NIXPACKS_NODE_VERSION=22`; this is build tooling configuration, not an application lookup. Use the following overrides. Base directories are relative to repository root and commands execute inside them.

| Setting | API | Worker | Web |
| --- | --- | --- | --- |
| Base Directory | `/api` | `/api` | `/web` |
| Install Command | `npm ci --include=dev` | `npm ci --include=dev` | `npm ci --include=dev` |
| Build Command | `npm run db:generate && npm run build` | `npm run db:generate && npm run build` | `npm run build` |
| Start Command | `npm run db:deploy && npm run start:prod` | `npm run start:worker` | `npm run start` |
| Public domain | `https://api.status.pat1.online` | None; remove generated domain | `https://status.pat1.online` |
| Internal port | `3001` | No HTTP listener or published port | `3000` |
| HTTP health check | GET `/health`, port 3001 | Disabled | GET `/`, port 3000 |
| Runtime env | All API rows above except worker concurrency settings | `NODE_ENV`, `DATABASE_URL`, `REDIS_URL`, both concurrency settings, encryption key | `NODE_ENV=production`, `NEXT_PUBLIC_API_URL` |
| Build env | `NODE_ENV=production`, `DATABASE_URL` for Prisma | `NODE_ENV=production`, `DATABASE_URL` for Prisma | `NODE_ENV=production`, `NEXT_PUBLIC_API_URL` |

Set `NEXT_PUBLIC_API_URL` as both Build Variable and runtime variable in Coolify. Next embeds it in browser bundles; changing runtime env without rebuilding does not update the dashboard or public status pages. Prisma generation needs a syntactically valid PostgreSQL URL but does not connect; a non-secret placeholder may be used for build only. Keep real DB credentials runtime-only where separate build/runtime values are supported. Build does not require Redis or OAuth secrets. Retain dev dependencies during build for TypeScript, lint tools and Next tooling; do not replace npm with pnpm.

Coolify configuration references: [Nixpacks deployment](https://coolify.io/docs/applications/builds/nixpacks/deploy), [application settings](https://coolify.io/docs/applications/configuration/general), [health checks](https://coolify.io/docs/applications/configuration/health-checks). Ensure the final image includes curl or wget for Coolify's HTTP probe. Suggested API probe settings: HTTP, host `localhost`, GET `/health`, port 3001, expected status 200, interval 15 seconds, timeout 5 seconds, retries 5, start period 60 seconds.

## Migration and startup order

Verified existing scripts: `db:generate` = `prisma generate`, `db:deploy` = `prisma migrate deploy`, `build` = `tsc -p tsconfig.build.json`, `start:prod` = `node dist/main.js`, `start:worker` = `node dist/worker.js`. Web uses `next build` and `next start`.

For a shell on the runtime database network, the valid standalone API workflow is:

```sh
cd api
npm ci --include=dev
npm run db:generate
npm run db:deploy
npm run build
npm run start:prod
```

Coolify separates image building from runtime networking. Build the image without migrations; the API Start Command runs `db:deploy` on the runtime network and starts HTTP/schedulers only on success. Leave additional pre/post-deployment commands blank. Do not run migrations in image build or post-deployment. Never use `db:migrate` / `prisma migrate dev` in production. Worker start deliberately does not run migrations.

First deployment:

1. Start PostgreSQL and verify health/persistence.
2. Start Redis and verify health/persistence/noeviction.
3. Configure API environment and generated secrets; prepare the images. Set up the GitHub OAuth app values before testing login.
4. Deploy the API resource: its start wrapper applies all eight committed migrations before API bootstrap. Check migration success in logs; a migration failure prevents API startup.
5. Verify API `/health` returns 200.
6. Deploy worker only after schema migration success; verify both consumer startup logs.
7. Build/deploy web with the production public API URL.
8. Verify GitHub OAuth application settings and complete login/logout.
9. Run all smoke tests below.

For future schema changes stop workers and API schedulers before incompatible migrations; apply migrations through the API startup gate, then start worker with the matching revision. Deploy matching API/worker revisions. Take a database backup before migrations. A rolled-back image does not roll back schema. Keep one API replica and disable rolling overlap for it: even temporary overlap can run two schedulers. Do not allow worker auto-deploy to race API migrations.

## Process audit

`AppModule` imports `ScheduleModule.forRoot()`, `MonitoringSchedulerModule` and `NotificationsModule`. API owns monitor scheduling every 15 seconds and notification scheduling every 15 seconds. The latter also recovers `PROCESSING` deliveries older than five minutes, returning them to `PENDING` with a 30-second delay.

`worker.ts` uses `NestFactory.createApplicationContext(WorkerModule)`, never `listen()`. It registers `MonitoringWorkerService` and `NotificationWorkerModule`, starting both BullMQ consumers. Its import graph has no ScheduleModule or either scheduler provider. Some shared modules include auth/controller providers, but they do not create HTTP listeners or schedules in an application context. Worker requires no public domain and no HTTP health check. Monitor container restarts, both consumer logs and queue progress instead.

Multiple API replicas each schedule/recover deliveries. Conditional row claims reduce duplicate work but are not leader election. Run one API instance for the first deployment. Notification delivery can be retried; receivers should deduplicate by delivery ID.

## Health, auth and browser configuration

Existing unauthenticated `GET /health` executes a database `SELECT 1`. Healthy response: HTTP 200 with `{"status":"ok","service":"statuscore-api","database":"connected"}`. Database query failure: HTTP 503 with `database: "disconnected"`. No secrets are exposed. It does not check Redis, worker consumption or migration completeness; verify those separately. No redundant endpoint was added.

CORS allows the configured exact frontend origin and enables credentials. Blank `CORS_ORIGIN` now denies origins instead of reflecting arbitrary origins. The unset development default remains `http://localhost:3000`. Authenticated dashboard fetches send `credentials: "include"`; public `/status/[slug]` fetches need no authentication.

Both `sc_session` (seven days) and `sc_oauth_state` (ten minutes) are HttpOnly, SameSite=Lax, path `/`, and Secure when `NODE_ENV=production`. No Domain attribute means host-only cookies on `api.status.pat1.online`. Browser API requests between these HTTPS subdomains are same-site, so Lax works with credentialed CORS. GitHub callback is a top-level GET navigation, which also permits Lax state cookies. Cookies need not be shared with the frontend host. Coolify may terminate TLS; Secure is set from NODE_ENV, not Express's request protocol, so no trust-proxy change is required. Logout clears the same cookie name/host/path. HTTP localhost uses non-Secure cookies in development.

Success/error OAuth redirects use `WEB_URL`. GitHub OAuth app settings:

- Homepage URL: `https://status.pat1.online`
- Authorization callback URL: `https://api.status.pat1.online/auth/github/callback`

Only the dashboard and public status page define API base URLs. Both use `NEXT_PUBLIC_API_URL` with a localhost development fallback; there are no other hardcoded production API targets. A missing build value would ship localhost to browsers, so verify it before deployment. Existing Google Fonts require build-time access to `fonts.googleapis.com` and `fonts.gstatic.com`.

## Outbound security

Outbound implementation is unchanged: public IP validation, private/link-local/loopback and mapped-IP rejection, all DNS answer validation, pinned connections, TLS certificate verification, SNI and Host handling, no redirect following, HTTPS-only notification endpoints and Discord host restrictions remain enforced. Do not add `ALLOW_PRIVATE_NETWORK`. Database/Redis private connections are infrastructure connections, not monitored targets. Smoke-test targets must resolve exclusively to public addresses; do not use Docker service names or localhost targets. Allow DNS and required public outbound HTTP/HTTPS from the worker.

## Production smoke tests

1. Open frontend; sign in via GitHub; verify callback returns to frontend. In browser Network verify credentialed `GET /auth/me` returns the user, correct CORS headers and Secure/HttpOnly/Lax cookies. Logout; verify cookie removal and `/auth/me` is unauthenticated. Log in again for remaining tests.
2. Create an enabled monitor for a controlled public HTTPS target. Wait at least its interval plus 15 seconds. Confirm `CheckResult` in history, worker consumption, uptime/latency analytics and overview begin populating.
3. Configure and associate an enabled public HTTPS webhook or Discord channel before failure. Change the controlled target to fail; after the monitor's failure threshold verify exactly one automatic incident opens and NotificationDelivery outbox rows exist. Confirm delivery history succeeds and receiver gets `INCIDENT_OPENED` (generic webhook `event: incident.opened`). Restore target; verify incident resolution and `INCIDENT_RESOLVED` (`incident.resolved`).
4. Create a public status page with the monitor. Open `/status/<slug>` logged out and inspect public API JSON. Verify no monitor URLs, webhook URLs/encrypted secrets, user identity or raw private errors are exposed.
5. On an UP monitor create an active maintenance window, then fail the target for at least the threshold. Confirm checks persist, maintenance appears, no new automatic incident or INCIDENT_OPENED delivery is created. Restore target and end maintenance.
6. Create a manual incident associated with the notification-linked monitor; add a timeline update and resolve it. Confirm `MANUAL_INCIDENT_OPENED`, `MANUAL_INCIDENT_UPDATED`, `MANUAL_INCIDENT_RESOLVED` arrive (generic webhook events `manual_incident.opened`, `manual_incident.updated`, `manual_incident.resolved`). Metadata-only edits do not emit an update event.

## Local validation

Validated locally on Node 22.17.1 / npm 10.9.2:

- API `npm run db:generate`: passed (Prisma Client 6.19.3).
- API `npm run lint`: passed, including after the CORS change.
- API `npm run test`: 13 files / 149 tests passed.
- API `npm run build`: passed, including after the CORS change.
- `npm exec -- prisma migrate status`: all eight local migrations already applied; no migration was executed against production.
- Web `npm run lint`: passed.
- Web `npm run build`: passed with network access after the sandbox initially blocked the existing Google Fonts downloads; a subsequent build with `NEXT_PUBLIC_API_URL=https://api.status.pat1.online` also passed.
- Web production process booted on an isolated test port and GET `/` returned 200, then was stopped.
- API/worker boot was skipped: the local database contains 13 enabled monitors, so booting would run existing work. Module topology and consumer startup code were inspected instead. Full API/worker/OAuth runtime smoke tests remain deployment checks.

No application code blocker was found in this audit. Deployment prerequisites remain real secrets, shared database/Redis network connectivity, migration success, DNS/TLS, build font access and live smoke tests. Live Coolify routing, OAuth and external notification delivery require production configuration and the smoke tests above. No production resources were deployed and no secrets were added to tracked files. No commit or push was made.
