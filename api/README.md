# StatusCore API

This is the NestJS API for StatusCore. It handles GitHub authentication, monitor management, scheduling, queue processing, and secure outbound HTTP checks.

## Scripts

- `npm run start:dev`
- `npm run start:worker:dev`
- `npm run build`
- `npm run test`
- `npm run db:generate`

## Worker configuration

The background monitor worker uses `MONITOR_WORKER_CONCURRENCY` to control how many queue jobs run concurrently. The worker must not start the API scheduler or HTTP server.
