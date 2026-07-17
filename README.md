# SmartLogistica

Plataforma SaaS multi-tenant para centralizar pedidos de marketplaces (VTEX/Addi, Shopify, MercadoLibre, Exito) y orquestar el flujo logistico (guias, facturacion, embalaje, despacho).

## Estructura

```
smartlogistica/
├── apps/
│   ├── web/        Next.js 15 (UI de la plataforma)
│   └── api/        NestJS (API + workers + integraciones marketplace)
├── packages/
│   ├── shared/     Tipos y schemas Zod compartidos
│   ├── eslint-config/
│   └── tsconfig/
└── DEV_SETUP.md    Guia de setup local (Railway, .env, primeros pasos)
```

## Quick start

```bash
pnpm install
cp apps/api/.env.example apps/api/.env.local
cp apps/web/.env.example apps/web/.env.local
# Edita los .env.local con las URLs de tu proyecto Railway (ver DEV_SETUP.md)

pnpm db:migrate          # Aplica migraciones del control plane
pnpm dev                 # Arranca web (3000) + api (3001)
```

Ver [DEV_SETUP.md](DEV_SETUP.md) para instrucciones detalladas.

## Stack

| Capa | Tecnologia |
|------|------------|
| Monorepo | Turborepo + pnpm |
| Frontend | Next.js 15 (App Router) + Tailwind + shadcn/ui |
| Backend | NestJS 10 + Prisma 5 |
| Database | PostgreSQL 16 (database-per-tenant) |
| Cache/Queue | Redis + BullMQ |
| Auth | Lucia v3 (sesiones httpOnly) |
| Deploy | Vercel (web) + Railway (api/workers/db/redis) |

## Documentacion

- [Plan Fase 1 (MVP)](./.claude/plans/hola-vamos-a-dar-distributed-crane.md) — fuera del repo
- [DEV_SETUP.md](DEV_SETUP.md) — setup local
- [SECURITY.md](SECURITY.md) — politicas de seguridad y crypto (TODO)
