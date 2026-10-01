# StatusCore

StatusCore is a self-hosted service monitoring and incident tracking application designed for teams that want visibility into uptime, response times, and failure patterns without depending on a SaaS provider.

## MVP goal

The initial goal is to establish a solid foundation for a self-hosted monitoring platform: a Next.js frontend shell, a NestJS API, PostgreSQL persistence, and local development infrastructure. The first phase is intentionally limited to project scaffolding and database structure.

## Current stack

- Next.js
- React
- TypeScript
- Tailwind CSS
- NestJS
- Prisma
- PostgreSQL
- Docker Compose
- Redis (for later BullMQ-based monitoring worker work)

## Planned architecture

Browser
   |
Next.js
   |
NestJS API
   |
PostgreSQL

Redis and BullMQ will be introduced in a later phase, alongside a dedicated monitoring worker for scheduled checks and background processing.

## Repository structure

```text
statuscore/
├── web/
├── api/
├── README.md
├── .gitignore
└── .env.example
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

This starts PostgreSQL 16 and Redis 7 for local development. The database schema is managed through Prisma and is not intended to represent production credentials or deployment configuration.

## Notes

This repository intentionally does not describe the later monitoring, notifications, authentication, or incident-management features as complete. These capabilities are planned for subsequent phases.
