# StatusCore frontend

The Next.js App Router frontend provides the operator dashboard and public status pages using React, TypeScript and Tailwind CSS. It uses npm with a committed lock. See the [project overview](../README.md) and [backend guide](../api/README.md).

## Routes and responsibilities

| Route / file | Role |
| --- | --- |
| `/` — `app/page.tsx` | GitHub login and authenticated dashboard |
| `/status/[slug]` — `app/status/[slug]/page.tsx` | Public, unauthenticated status page |
| `app/analytics-charts.tsx` | SVG uptime and average-latency bucket charts |
| `app/layout.tsx`, `app/globals.css` | Metadata, Geist fonts and global styles |

The dashboard manages monitors/check history, automatic incidents, one-time maintenance windows, manual incident metadata/update timelines, webhook/Discord channels and delivery history, and status-page monitor selection/slugs. Analytics provide overview cards and per-monitor uptime, latency and downtime for `24h`, `7d` and `30d`. API ownership and lifecycle rules remain authoritative.

The public route fetches `/public/status-pages/:slug` without authentication, disables fetch caching and refreshes every 30 seconds. It displays selected status, automatic history, manual timelines and active maintenance using the safe backend response. Published descriptions and messages are public text.

Dashboard requests send `credentials: "include"`; sessions remain in API-host HttpOnly cookies. Login navigates to API GitHub OAuth. Manual communication and maintenance overlays are distinct from persisted monitor health. Historical analytics are dashboard-only.

## API configuration

Copy [.env.example](.env.example) to `.env.local` and set:

```env
NEXT_PUBLIC_API_URL=http://localhost:3001
```

Both routes use this variable, falling back to localhost when unset. `NEXT_PUBLIC_` values are embedded in browser bundles at build time: set the production URL before `npm run build` and rebuild when it changes. A runtime-only change does not update existing bundles. Never put secrets in public variables.

Locally, API `CORS_ORIGIN` and `WEB_URL` should be `http://localhost:3000`; register `http://localhost:3001/auth/github/callback` with GitHub. Backend/worker and secret setup is in the [root local guide](../README.md#local-development).

## Local startup

Use Node.js 22 and npm. From repository root:

```sh
cd web
npm ci
cp .env.example .env.local
# Set NEXT_PUBLIC_API_URL=http://localhost:3001
npm run dev
```

PowerShell users can use `Copy-Item` instead of `cp`. Open `http://localhost:3000`; run API and worker in separate terminals to populate checks/deliveries.

## Validation and deployment

```sh
npm run lint
npm run build
npm run start
```

`lint` runs ESLint; `build` creates the production build; `start` serves it on port 3000 by default. There is no frontend test script. Geist uses `next/font/google`, so builds need Google's font endpoints.

Documented Coolify/Nixpacks resources run Web separately from API/worker. Web is public; worker, Redis and PostgreSQL remain private. Set the API URL at build time and credentialed backend CORS. Domains in [DEPLOYMENT.md](../DEPLOYMENT.md) are targets, not evidence of a verified live installation.
