# StatusCore API

This is the NestJS API for StatusCore. It handles GitHub authentication, monitor management, scheduling, queue processing, notification channel ownership, and secure outbound HTTP checks.

## Scripts

- `npm run start:dev`
- `npm run start:worker:dev`
- `npm run build`
- `npm run test`
- `npm run test:dist` (run after `npm run build`; checks compiled SSRF modules under native Node ESM)
- `npm run db:generate`
- `npm run db:deploy`

## Worker configuration

Before deploying API or worker changes, run `npm run lint`, `npm run test`, `npm run build`, then `npm run test:dist`. The compiled-output tests catch CommonJS interop regressions that source-level Vitest tests can hide, including `ipaddr.js` public address parsing and private/mapped address blocking.

The background monitoring worker uses `MONITOR_WORKER_CONCURRENCY` to control how many queue jobs run concurrently. The separate notification worker uses `NOTIFICATION_WORKER_CONCURRENCY` for outbound delivery processing. Both workers must not start the API scheduler or HTTP server.

## Phase 5 notification model

The API creates `NotificationDelivery` rows in the same transaction that records incident transitions. Those rows are then drained by the notification queue and sent asynchronously to configured webhook or Discord endpoints. Endpoint secrets are encrypted with the configured `NOTIFICATION_ENCRYPTION_KEY`, and the notification worker enforces public HTTPS-only validation, DNS/IP pinning, and blocked-address checks before making outbound requests.
