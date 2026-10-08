# LifePilot — runnable full-stack skeleton (architecture slice 1)

Personal-life automation web app. This order delivers the **first runnable slice** of the
target architecture: a working monorepo where a signed-in user creates a reminder, a queue
fires it at the due time, a worker delivers it through a pluggable channel adapter, every
attempt is recorded and visible in the UI, and files can be attached to reminders.

```
┌─────────────┐   HTTP/JSON    ┌──────────────┐   enqueue (delayed)   ┌─────────────────┐
│  apps/web   │ ─────────────▶ │   apps/api   │ ────────────────────▶ │    Redis        │
│ Next.js 14  │                │   Fastify    │                       │  (BullMQ)       │
└─────────────┘                └──────┬───────┘                       └────────┬────────┘
       │  MinIO presigned download    │ Prisma                poll/execute  │
       └──────────────────────────────┤                        ┌────────────▼────────┐
                                      ▼                        │    apps/worker      │
                              ┌──────────────┐   Prisma        │  channel adapters   │
                              │  PostgreSQL  │◀───────────────▶│ email·whatsapp·ai·  │
                              │ (attachments │                 │ webhook·razorpay    │
                              │  metadata)   │                 └─────────────────────┘
                              └──────────────┘
```

## Monorepo layout

| Path                | What it is |
| ------------------- | ---------- |
| `packages/db`       | Prisma schema, SQL migration, seed (PostgreSQL) |
| `packages/core`     | Shared channel contracts + HMAC/webhook signature utilities |
| `apps/api`          | Fastify API: auth, reminders, attachments, Razorpay webhook receiver |
| `apps/worker`       | BullMQ worker + 5 channel adapters (email, whatsapp, ai-agent, webhook, razorpay) |
| `apps/web`          | Next.js 14 (App Router) UI: sign-up/in, reminders, attempts, attachments |
| `scripts/`          | `dev-webhook-receiver.mjs` — local receiver that verifies our signatures |
| `docker-compose.yml`| PostgreSQL 16 + Redis 7 + MinIO with healthchecks |

## Quickstart (clean machine)

Prerequisites: **Node ≥ 18.17**, **Docker**, **pnpm ≥ 9** (`corepack enable` or `npm i -g pnpm`).

```bash
cp .env.example .env          # 1. environment (dev defaults are safe)
docker compose up -d --wait   # 2. start PostgreSQL + Redis + MinIO
pnpm install                  # 3. install deps (also runs prisma generate)
pnpm db:migrate               # 4. apply the SQL migration
pnpm db:seed                  # 5. optional: demo user + 2 sample reminders
pnpm dev                      # 6. run web + api + worker together
```

Then open:

- **Web UI:** http://localhost:3000 (log in or sign up)
- **API health:** http://localhost:3001/health
- **MinIO console:** http://localhost:9001 (minioadmin / minioadmin)
- **Worker logs:** visible in the `pnpm dev` output — the console email transport prints full emails there.

### See a delivery happen (30-second demo)

1. Log in → **New reminder** → title anything, **due at**: a time ~1 minute ahead, channel **EMAIL** → *Schedule reminder*.
2. When the clock passes the due time the worker logs the email (console transport) and the reminder flips to **DELIVERED** with the attempt visible on its detail page.
3. Tip: set the due time **in the past** to trigger delivery immediately.
4. WEBHOOK channel: start `pnpm webhook:receiver` (port 3100), create a reminder with payload URL `http://localhost:3100/hook` — the receiver verifies our HMAC signature and prints the payload.

## Commands

| Command | Where | What it does |
| --- | --- | --- |
| `pnpm dev` | root | Runs api + worker + web concurrently (tsx watch / next dev) |
| `pnpm dev:api` / `dev:worker` / `dev:web` | root | Run one service alone |
| `pnpm build` | root | Typechecks every package; production-builds the web app |
| `pnpm typecheck` | root | `tsc --noEmit` in all packages |
| `pnpm test` | root | **One command**: runs the API + worker test suites (no external services needed) |
| `pnpm test:api` / `pnpm test:worker` | root | Individual suites (vitest) |
| `pnpm db:up` / `pnpm db:down` | root | `docker compose up -d --wait` / `down` |
| `pnpm db:generate` | root | Regenerate the Prisma client after schema edits |
| `pnpm db:migrate` | root | `prisma migrate deploy` (applies `packages/db/prisma/migrations`) |
| `pnpm db:seed` | root | Idempotent seed: demo user + 2 sample reminders (prints the demo password) |
| `pnpm webhook:receiver` | root | Local webhook receiver on port 3100 with signature verification |
| `pnpm --filter @lifepilot/api test:watch` | root | Vitest watch mode |

API dev server: `tsx watch` on port **3001**. Web dev server: **3000**. All ports are env-configurable.

## Environment variables (all in `.env`, see `.env.example`)

| Variable | Used by | Default (dev) | Purpose |
| --- | --- | --- | --- |
| `DATABASE_URL` | api, worker, db | `postgresql://lifepilot:lifepilot@localhost:5432/lifepilot?schema=public` | PostgreSQL connection |
| `REDIS_URL` | api, worker | `redis://localhost:6379` | BullMQ connection |
| `API_PORT` / `API_HOST` | api | `3001` / `0.0.0.0` | HTTP bind |
| `CORS_ORIGIN` | api | `http://localhost:3000` | Allowed web origin |
| `JWT_SECRET` | api | `dev-only-secret-change-me` | Access-token signing (must change outside local dev) |
| `ACCESS_TOKEN_TTL` | api | `15m` | Access token lifetime |
| `REFRESH_TOKEN_TTL_DAYS` | api | `7` | Refresh token lifetime |
| `LOG_LEVEL` | api, worker | `info` | Pino/console level |
| `NEXT_PUBLIC_API_URL` | web | `http://localhost:3001` | Browser→API base URL |
| `EMAIL_TRANSPORT` | worker | `console` | `console` (logs the email) or `smtp` |
| `SMTP_HOST/PORT/SECURE/USER/PASS` | worker | — | SMTP settings when transport=smtp |
| `EMAIL_FROM` | worker | `LifePilot <no-reply@lifepilot.local>` | From header |
| `WEBHOOK_SIGNING_SECRET` | api, worker | `dev-webhook-secret` | HMAC-SHA256 secret for outgoing webhook signatures |
| `S3_ENDPOINT` | api | `http://localhost:9000` | MinIO endpoint |
| `S3_REGION` | api | `us-east-1` | S3 region string |
| `S3_ACCESS_KEY_ID` / `S3_SECRET_ACCESS_KEY` | api | `minioadmin` / `minioadmin` | MinIO credentials |
| `S3_BUCKET` | api | `lifepilot-attachments` | Bucket (auto-created on first upload) |
| `S3_FORCE_PATH_STYLE` | api | `true` | Required for MinIO |
| `RAZORPAY_KEY_ID` / `RAZORPAY_KEY_SECRET` | worker | — | **Test-mode** keys (rzp_test_…); empty ⇒ simulated orders |
| `RAZORPAY_WEBHOOK_SECRET` | api | `dev-razorpay-webhook-secret` | Verifies `x-razorpay-signature` on `POST /webhooks/razorpay` |
| `WORKER_CONCURRENCY` / `QUEUE_NAME` | worker | `5` / `reminders` | Worker tuning |

## API surface

| Method & path | Auth | Purpose |
| --- | --- | --- |
| `GET /health` | — | Liveness |
| `POST /auth/register` | — | `{email, password}` → `{user, accessToken, refreshToken}` (bcrypt-hashed storage) |
| `POST /auth/login` | — | Same response shape |
| `POST /auth/refresh` | — | `{refreshToken}` → rotated pair (old token revoked server-side) |
| `POST /auth/logout` | Bearer | Revokes the presented refresh token |
| `GET /reminders` | Bearer | List with latest attempts + counts |
| `POST /reminders` | Bearer | `{title, body?, dueAt, channel, payload?}` → schedules the BullMQ job |
| `GET /reminders/:id` | Bearer | Detail incl. all attempts + attachments |
| `DELETE /reminders/:id` | Bearer | Cancels a PENDING reminder and removes its queued job |
| `POST /reminders/:id/attachments` | Bearer | Multipart upload (≤10 MB) → MinIO + metadata row |
| `GET /attachments/:id/download` | Bearer | 302 → short-lived presigned MinIO URL |
| `POST /webhooks/razorpay` | signature | Verifies `x-razorpay-signature` (HMAC-SHA256 of the **raw** body) |

## Delivery channels

| Channel | Status | Notes |
| --- | --- | --- |
| `EMAIL` | Working (console + smtp) | Console transport logs the full email — no credentials needed in dev |
| `WEBHOOK` | Working | Signs raw body with HMAC-SHA256; verify via `@lifepilot/core` or `pnpm webhook:receiver` |
| `RAZORPAY` | Working (test mode) | Creates a sandbox order with test keys; **simulated** order (clearly marked) when keys are empty. Incoming webhook signatures verified with unit tests |
| `WHATSAPP` | Working stub | Records the would-be send; implement Meta Cloud API call to go live |
| `AI_AGENT` | Working stub | Returns a deterministic plan; plug an LLM/agent runtime into `deliver()` |

Out of scope (per the order): production deployment, real WhatsApp/Razorpay accounts,
mobile apps, and design beyond a clean functional UI. All channel credentials are
env-injected — nothing is hardcoded.

## Testing

```bash
pnpm test          # api + worker suites, no external services required
```

- **API suite** (`apps/api/test`): registers/logins/refresh-rotation via route-level
  `app.inject` against an in-memory Prisma double; reminder validation + queue scheduling;
  attachment upload/download ownership; Razorpay webhook signature acceptance/rejection
  (200/401/503 paths). Password hashing and HMAC utilities are tested directly.
- **Worker suite** (`apps/worker/test`): webhook adapter signs exactly `sha256=<hmac(rawBody)>`
  (headers verified against node:crypto reference), Razorpay simulated + sandbox-API order
  creation, email console transport, WhatsApp/AI stubs, and the job processor (SUCCESS →
  DELIVERED, FAILED attempt recording, retry vs final-failure bookkeeping, cancelled skip).

## How to add a new channel (e.g. TELEGRAM)

1. Add `TELEGRAM` to the `Channel` enum in `packages/db/prisma/schema.prisma`, create a
   migration (`pnpm --filter @lifepilot/db exec prisma migrate dev`), and extend `CHANNELS`
   in `packages/core/src/channels.ts` with a payload schema.
2. Implement `ChannelAdapter` in `apps/worker/src/channels/telegram.ts` and register it in
   `apps/worker/src/index.ts`.
3. Normalize its payload in `apps/api/src/routes/reminders.ts` (`normalizePayload`) and add
   the option fields in `apps/web/src/app/reminders/page.tsx`.

## Acceptance criteria → where to look

| Criterion | Where |
| --- | --- |
| `docker compose up` + README steps start everything | `docker-compose.yml` (with healthchecks) + Quickstart above |
| Sign-up / sign-in / token refresh, bcrypt-hashed passwords | `apps/api/src/routes/auth.ts`, `apps/api/src/lib/passwords.ts`, web `/signup` `/login` |
| Reminder → queued job → email at due time, attempts stored & visible in UI | `apps/api/src/lib/queue.ts`, `apps/worker/src/processor.ts`, reminder detail page |
| Webhook HMAC-SHA256 + Razorpay test-mode signature verification, unit-tested | `packages/core/src/crypto.ts`, `apps/worker/test/webhook.test.ts`, `apps/api/test/webhooks.test.ts`, `apps/worker/test/razorpay.test.ts` |
| Attachment stored in MinIO and linked to its reminder | `apps/api/src/routes/attachments.ts`, `apps/api/src/lib/s3.ts` |
| One command runs API+worker tests and they pass; README lists commands & env | `pnpm test` + tables above |

See `VERIFICATION.md` for what was executed on the build machine and how to reproduce it.
