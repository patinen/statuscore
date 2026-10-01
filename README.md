# StatusCore

StatusCore is a self-hosted monitoring platform for checking the health of public services and exposing a simple dashboard for operations teams.

## Phase 2 implemented

This repository now includes the following features:

- GitHub OAuth authentication
- HttpOnly application session cookies
- authenticated monitor CRUD
- SSRF-aware target URL validation
- PostgreSQL persistence via Prisma

## Planned and not yet implemented

The following capabilities are intentionally still planned for future phases and are not part of the current implementation:

- actual HTTP monitoring
- Redis/BullMQ processing
- scheduler
- monitoring worker
- incident state machine
- historical uptime and latency analytics
- alerts

## Current stack

- Next.js
- React
- TypeScript
- Tailwind CSS
- NestJS
- Prisma
- PostgreSQL
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

### Infrastructure

```bash
cd api
docker compose up -d
```

This starts PostgreSQL 16 for local development. Redis remains a future dependency for the queue and worker layer.

## Required environment variables

### API (.env)

```env
NODE_ENV=development
PORT=3001
CORS_ORIGIN=http://localhost:3000
WEB_URL=http://localhost:3000
GITHUB_CLIENT_ID=
GITHUB_CLIENT_SECRET=
GITHUB_CALLBACK_URL=http://localhost:3001/auth/github/callback
AUTH_SESSION_SECRET=replace-with-a-long-random-secret
DATABASE_URL=postgresql://statuscore:statuscore_dev_password@localhost:5432/statuscore_dev?schema=public
REDIS_URL=redis://localhost:6379
```

### Web (.env.local)

```env
NEXT_PUBLIC_API_URL=http://localhost:3001
```

## Notes

The current implementation focuses on secure authenticated monitor management and safe target validation. It does not yet implement actual monitoring requests, scheduling, or alerting workflows.
