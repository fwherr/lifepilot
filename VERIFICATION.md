# Verification notes — LifePilot architecture slice 1

What was executed on the build machine (Windows 11, Node v24.19.0, pnpm 11.7.0)
and how to reproduce every step.

## 1. Toolchain

| Check | Result |
| --- | --- |
| `node -v` | v24.19.0 |
| `pnpm -v` | 11.7.0 |
| `git --version` | 2.53.0.windows.1 |
| `pnpm install` | ✅ exit 0 (lockfile committed: `pnpm-lock.yaml`) |
| Prisma client generation | ✅ `prisma generate` via `@lifepilot/db` postinstall (verified: generated `Channel`/model exports present in `.prisma/client`) |

## 2. Migration SQL shipped without a live database

The SQL migration was generated offline from the schema (no database required):

```bash
pnpm --filter @lifepilot/db exec prisma migrate diff \
  --from-empty --to-schema-datamodel prisma/schema.prisma --script \
  > packages/db/prisma/migrations/0001_init/migration.sql
```

`packages/db/prisma/migrations/0001_init/migration.sql` contains the full DDL
(3 enums, 5 tables, unique/regular indexes, cascade foreign keys) and is applied
by `pnpm db:migrate` (`prisma migrate deploy`). The exact same diff command was
run on the build machine and its output committed.

## 3. Typecheck — all 5 packages

```bash
pnpm typecheck        # tsc --noEmit in every workspace project
```

Result: ✅ `packages/core` ✅ `packages/db` ✅ `apps/api` ✅ `apps/worker` ✅ `apps/web`

## 4. Unit tests — one command, no external services

```bash
pnpm test             # = test:api + test:worker
```

Actual run on the build machine:

```
apps/api (vitest)
  ✓ test/crypto.test.ts      (8 tests)
  ✓ test/webhooks.test.ts    (4 tests)   ← Razorpay webhook signature: 200/401/503 paths
  ✓ test/attachments.test.ts (6 tests)   ← MinIO upload via injected S3 double, ownership 404s
  ✓ test/reminders.test.ts   (8 tests)   ← validation, payload defaults, queue scheduling, cancel
  ✓ test/auth.test.ts        (9 tests)   ← register/login/refresh-rotation/logout, bcrypt hashes
  Test Files  5 passed (5)
       Tests  35 passed (35)

apps/worker (vitest)
  ✓ test/processor.test.ts   (7 tests)   ← SUCCESS→DELIVERED, FAILED bookkeeping, cancelled skip
  ✓ test/webhook.test.ts     (5 tests)   ← signature == sha256=hex(hmac(secret, rawBody)) vs node:crypto
  ✓ test/stubs.test.ts       (4 tests)   ← whatsapp / ai-agent stubs
  ✓ test/razorpay.test.ts    (6 tests)   ← simulated + sandbox-API order creation, webhook verify
  ✓ test/email.test.ts       (3 tests)   ← console transport (to/subject defaults + overrides)
  Test Files  5 passed (5)
       Tests  25 passed (25)
```

**60/60 tests passed.** The suites use route-level `app.inject` and injected
doubles (in-memory Prisma fake, queue fake, S3 fake), so they run on any clean
machine without PostgreSQL/Redis/MinIO — exactly the "one command runs the API
and worker test suites and they pass" criterion.

## 5. Real-network smoke test (webhook channel, actual HTTP)

```bash
pnpm --filter @lifepilot/worker exec tsx scripts/smoke-webhook.ts
```

Spawns `scripts/dev-webhook-receiver.mjs` on localhost:3100, delivers a reminder
through the real WEBHOOK adapter over real HTTP, receiver validates the
`x-lifepilot-signature` HMAC and answers 200:

```
[smoke] delivery result: {"url":"http://localhost:3100/hook","status":200,"responseBody":"{\"received\":true}"}
SMOKE_OK: receiver validated our HMAC signature over real HTTP
```

## 6. Production build of the web app

```bash
pnpm --filter @lifepilot/web build
```

✅ exit 0 — all routes compile and prerender:

```
Route (app)            Size     First Load JS
○ /                    175 B     96.2 kB
○ /login               2.76 kB   98.8 kB
○ /reminders           3.88 kB   99.9 kB
ƒ /reminders/[id]      3.54 kB   90.9 kB
○ /signup              2.8 kB    98.8 kB
```

## 7. End-to-end run with real infrastructure (docker compose)

```bash
docker compose up -d --wait   # postgres 5432 · redis 6379 · minio 9000/9001 (healthchecks gate)
pnpm db:migrate               # applies 0001_init
pnpm db:seed                  # demo user + 2 sample reminders (prints demo password)
pnpm dev                      # web :3000 · api :3001 · worker (watch logs)
```

30-second delivery demo:

1. Log in at http://localhost:3000 → **New reminder** → due time ~1 min ahead (or in the past to fire immediately) → channel **EMAIL** → schedule.
2. Worker log prints the full email (`transport: "console"`) and the reminder flips **PENDING → DELIVERED**; the attempt (structured detail) is visible on the reminder page.
3. WEBHOOK: `pnpm webhook:receiver` → create reminder with payload `{"url":"http://localhost:3100/hook"}` → receiver validates the signature and prints the payload (already proven over real HTTP in section 5).
4. RAZORPAY: create a reminder on that channel → attempt detail shows `mode: "razorpay-simulated"` (or a real sandbox `order_…` id when `RAZORPAY_KEY_ID/SECRET` test keys are set).
5. Attachments: open any reminder → **Upload file** → file lands in MinIO (`lifepilot-attachments` bucket), downloadable via short-lived presigned URL.

**Honest status from the build session:** Docker Desktop is installed on the
build machine but its Linux engine could not be started during this sandboxed
session — the `docker-desktop` WSL distro stayed `Stopped` and the engine pipe
never appeared (relaunch + restart + ~50 min of polling). Therefore steps in
this section were not executed here; the compose stack is the standard
healthchecked postgres:16 + redis:7 + minio setup and the commands above are the
reproduction script for any machine where Docker Desktop starts normally. All
application-layer behaviour (auth, validation, queue scheduling semantics,
adapter logic, signature verification, processor bookkeeping, ownership checks)
is fully covered by the 60 tests in section 4 plus the real-HTTP smoke in
section 5.

## 8. Security posture highlights

- Passwords: bcrypt (cost 10) — plaintext never stored or logged (asserted in tests).
- Refresh tokens: 48-byte random, stored **hashed** (SHA-256), rotated on every refresh, revoked on logout.
- Outgoing webhooks: `x-lifepilot-signature: sha256=<hmac>` over the exact raw body, constant-time compared.
- Incoming Razorpay webhooks: signature verified against the **raw** request body before any processing; 401 on mismatch.
- All credentials env-injected; `JWT_SECRET` refuses the dev default when `NODE_ENV=production`.
