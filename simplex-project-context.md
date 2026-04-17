# SimplexLabs — Project Context Document
## Purpose: paste this into every Cursor chat session to give the AI full project context

---

## What SimplexLabs is

SimplexLabs is a B2B SaaS platform that helps physical businesses (gyms, medical offices, entrepreneurs) establish and grow their online presence. SimplexLabs sells them a bundle of digital services: AI agents that respond to their customers on WhatsApp, Instagram, and Messenger; marketing services; and high-end websites.

The platform operates under different niches — **Simplex Gym**, **Simplex Medical**, **Simplex Entrepreneur** — but the product structure is identical across niches. Only pricing differs.

---

## What this codebase is

This is the **NestJS backend API** for the SimplexLabs internal platform. It serves a Next.js frontend dashboard where:

- **SimplexLabs admins** (internal team) manage clients, assign plans, schedule meetings, track everything
- **Clients** (gym owners, doctors, entrepreneurs) log in to see what SimplexLabs is doing for them — their agent conversations, appointments, orders, revenue stats, and website info

The backend is the single source of truth. The frontend consumes this API exclusively.

---

## Tech stack

- **Runtime:** Node.js 18+
- **Framework:** NestJS with TypeScript (strict mode)
- **Database:** PostgreSQL hosted on Supabase
- **ORM:** Prisma
- **Auth:** Supabase Auth (email/password + social OAuth), JWT stored in httpOnly cookies
- **Hosting:** Railway (backend), Vercel (frontend), Supabase (DB + Auth)
- **Validation:** class-validator + class-transformer
- **Documentation:** @nestjs/swagger

---

## Multi-tenancy model

Every piece of data belongs to a **Company** (tenant). This is enforced at the service layer — every query includes a `companyId` extracted from the authenticated user's JWT, never from the request body. A client can never access another company's data.

---

## Roles

Two roles exist in the system:

- `SUPER_ADMIN` — SimplexLabs internal team. `companyId` is null. Full access to everything.
- `CLIENT` — The business owner paying for the service. Scoped entirely to their own company's data.

A third entity, `ClientContact`, represents the end-customers of SimplexLabs clients (gym members, patients, leads). They never log in. They are created automatically by AI agent webhooks or manually by clients.

---

## Database — 13 tables

All primary keys are `text` (CUID). All tables have `createdAt` and `updatedAt` except `messages` (uses `sentAt`, `deliveredAt`) and `orderStatusHistory` (immutable audit log, `createdAt` only).

### Table list and purpose

**`companies`** — The tenant record. Every other table FK's back here.
Fields: `id`, `name`, `niche` (GYM/MEDICAL/ENTREPRENEUR), `phone`, `address`, `createdAt`, `updatedAt`

**`users`** — Platform users only (admins + clients). Not end-customers.
Fields: `id`, `supabaseId` (unique), `email` (unique), `firstName`, `lastName`, `role` (SUPER_ADMIN/CLIENT), `isActive`, `companyId` (nullable — null for SUPER_ADMIN), `createdAt`, `updatedAt`

**`clientContacts`** — End-customers of clients. No login. Created by agents or manually.
Fields: `id`, `companyId`, `firstName`, `lastName`, `email`, `phone`, `source` (WHATSAPP/INSTAGRAM/MESSENGER/MANUAL), `createdAt`, `updatedAt`

**`plans`** — The service plans SimplexLabs sells.
Fields: `id`, `name`, `niche`, `priceMonthly`, `setupFee`, `isActive`, `createdAt`, `updatedAt`

**`planFeatures`** — Features unlocked per plan (WEBSITE/MARKETING/AGENTS).
Fields: `id`, `planId`, `feature`, `createdAt`, `updatedAt`
Unique constraint: `[planId, feature]`

**`planChannels`** — Social channels unlocked per plan (WHATSAPP/INSTAGRAM/MESSENGER).
Fields: `id`, `planId`, `channel`, `createdAt`, `updatedAt`
Unique constraint: `[planId, channel]`

**`subscriptions`** — Which plan a company is on.
Fields: `id`, `companyId`, `planId`, `status` (ACTIVE/PAUSED/CANCELLED), `initialPayment`, `startedAt`, `nextBillingAt`, `createdAt`, `updatedAt`

**`websites`** — URL records assigned to a company. One company can have many.
Fields: `id`, `companyId`, `url`, `label`, `isActive`, `createdAt`, `updatedAt`

**`products`** — Products and services a company sells.
Fields: `id`, `companyId`, `name`, `description`, `type` (PRODUCT/SERVICE), `price`, `isActive`, `createdAt`, `updatedAt`

**`orders`** — A purchase by a contact for a product.
Fields: `id`, `companyId`, `contactId`, `productId`, `status` (PENDING/CONFIRMED/IN_PROGRESS/COMPLETED/CANCELLED), `amount`, `notes`, `createdAt`, `updatedAt`

**`orderStatusHistory`** — Immutable audit log of every order status change.
Fields: `id`, `orderId`, `changedById`, `prevStatus`, `newStatus`, `reason`, `createdAt`

**`appointments`** — All scheduling: SimplexLabs↔client, client↔contact, client↔external.
Fields: `id`, `companyId`, `organizerId`, `contactId`, `productId`, `title`, `description`, `type` (SIMPLEX_WITH_CLIENT/CLIENT_WITH_CONTACT/EXTERNAL), `status` (PENDING/CONFIRMED/COMPLETED/CANCELLED), `scheduledAt`, `durationMinutes`, `meetingUrl`, `externalAttendeeName`, `externalAttendeeEmail`, `createdAt`, `updatedAt`

**`conversations`** — One thread per contact per channel.
Fields: `id`, `companyId`, `contactId`, `channel` (WHATSAPP/INSTAGRAM/MESSENGER), `status` (OPEN/CLOSED/PENDING), `createdAt`, `updatedAt`

**`messages`** — Individual messages in a conversation.
Fields: `id`, `conversationId`, `senderType` (AGENT/CONTACT), `content`, `metadata` (JSON), `sentAt`, `deliveredAt`

---

## Enums

```
Role:               SUPER_ADMIN, CLIENT
Niche:              GYM, MEDICAL, ENTREPRENEUR
PlanFeature:        WEBSITE, MARKETING, AGENTS
Channel:            WHATSAPP, INSTAGRAM, MESSENGER
SubStatus:          ACTIVE, PAUSED, CANCELLED
OrderStatus:        PENDING, CONFIRMED, IN_PROGRESS, COMPLETED, CANCELLED
AppointmentType:    SIMPLEX_WITH_CLIENT, CLIENT_WITH_CONTACT, EXTERNAL
AppointmentStatus:  PENDING, CONFIRMED, COMPLETED, CANCELLED
ConvoStatus:        OPEN, CLOSED, PENDING
SenderType:         AGENT, CONTACT
ProductType:        PRODUCT, SERVICE
ContactSource:      WHATSAPP, INSTAGRAM, MESSENGER, MANUAL
```

---

## Auth flow

1. User signs in via Supabase Auth (email/password or OAuth — Google)
2. Supabase returns an access token + refresh token
3. NestJS stores both as **httpOnly, Secure, SameSite=Strict cookies**
4. Every request: `JwtAuthGuard` reads the cookie, validates the JWT with Supabase, injects the user into `req.user`
5. `RolesGuard` checks `req.user.role` against the `@Roles()` decorator
6. Every service query uses `companyId` from `req.user` — never from request body or params
7. `/auth/refresh` uses the refresh cookie to issue a new access token silently

---

## Security rules (enforced everywhere)

- `whitelist: true` and `forbidNonWhitelisted: true` on global `ValidationPipe`
- `helmet()` applied in `main.ts`
- CORS restricted to `FRONTEND_URL` env variable only
- Rate limiting via `@nestjs/throttler`
- No raw Prisma queries in controllers — always goes through service
- No Prisma model types returned directly to client — always mapped to response DTO
- Authorization checked at service layer, not just guard level

---

## Folder structure

```
src/
├── common/
│   ├── decorators/
│   │   ├── current-user.decorator.ts
│   │   ├── company-id.decorator.ts
│   │   └── roles.decorator.ts
│   ├── guards/
│   │   ├── jwt-auth.guard.ts
│   │   └── roles.guard.ts
│   ├── filters/
│   │   └── http-exception.filter.ts
│   └── interceptors/
│       └── response.interceptor.ts
├── config/
│   └── configuration.ts
├── prisma/
│   ├── prisma.module.ts
│   └── prisma.service.ts
├── modules/
│   ├── auth/
│   ├── users/
│   ├── companies/
│   ├── plans/
│   ├── subscriptions/
│   ├── client-contacts/
│   ├── websites/
│   ├── products/
│   ├── orders/
│   ├── appointments/
│   ├── conversations/
│   └── webhooks/
└── main.ts
```

Each module contains: `*.module.ts`, `*.controller.ts`, `*.service.ts`, `dto/` folder.

---

## Environment variables required

```env
PORT=3000
NODE_ENV=development
DATABASE_URL=postgresql://...
SUPABASE_URL=https://xxx.supabase.co
SUPABASE_SERVICE_ROLE_KEY=eyJ...
SUPABASE_ANON_KEY=eyJ...
JWT_SECRET=...
JWT_EXPIRES_IN=15m
JWT_REFRESH_EXPIRES_IN=7d
FRONTEND_URL=http://localhost:3000
```

---

## Code standards (always follow these)

- Never use `any`. Use `unknown` and narrow it.
- Never cast with `as Type` to silence errors. Fix the type.
- All service methods have explicit return types.
- Early returns over nested if/else.
- No business logic in controllers. No HTTP concepts in services.
- All input goes through a DTO with class-validator decorators.
- All responses are mapped to a typed response shape — never return raw Prisma models.
- Errors throw typed NestJS `HttpException` subclasses with context (entity, operation, id).
- Never log sensitive data (tokens, passwords, emails in prod).
- Never use `console.log` — use NestJS `Logger`.
- Prisma queries only inside services, never in controllers.
- Multi-step DB operations use `prisma.$transaction()`.
