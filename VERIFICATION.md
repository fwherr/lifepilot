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

## 7. End-to-end run with real infrastructure — EXECUTED 2026-10-24

This section previously recorded that the end-to-end run had **not** been
executed because the Docker engine would not start during the 2026-10-08 build
session. It was executed on 2026-10-24 and this section now documents the
actual run. Raw logs and screenshots are committed under `docs/evidence/`
(filenames referenced below).

**Environment of the run:** Windows 11 x64, Docker Desktop 29.7.2 (WSL2
Linux engine), Node v24.19.0, pnpm 11.7.0, PostgreSQL 16 / Redis 7 / MinIO
RELEASE.2024-06-13T22-53-53Z as pinned in `docker-compose.yml`.

### 7.1 `docker compose up -d --wait` — exit 0, three services healthy

`docs/evidence/01-docker-compose-up.log` — final lines:

```
 Container lifepilot-postgres Healthy
 Container lifepilot-minio Healthy
 Container lifepilot-redis Healthy
```

`docker compose ps` immediately after: all three `Up (healthy)` —
healthchecks (pg_isready / redis-cli ping / MinIO ready probe) gated startup
as designed.

### 7.2 `pnpm install` — build hooks now run on pnpm 10 and 11

`docs/evidence/02b-pnpm-install-fixed.log` — exit 0 with the dependency build
hooks executed and **no** ignored-builds error:

```
.../node_modules/@prisma/engines postinstall: Done
.../esbuild@0.21.5/node_modules/esbuild postinstall: Done
.../prisma@5.22.0/node_modules/prisma preinstall: Done
.../node_modules/@prisma/client postinstall: Done
Done in 14s using pnpm v11.7.0
```

`pnpm-workspace.yaml` now carries both allowlist shapes: `onlyBuiltDependencies`
(the list form pnpm 10 reads) and `allowBuilds` (the map form pnpm 11+ reads,
with `strictDepBuilds` defaulting to true there). README quickstart step 4 runs
`pnpm db:generate` explicitly, so the Prisma client exists on any pnpm
regardless of hook behaviour.

### 7.3 Schema: generate → migrate → seed — all exit 0

```
pnpm db:generate   # ✔ Generated Prisma Client (v5.22.0) in 115ms   (03-db-generate.log)
pnpm db:migrate    # 1 migration found — Applying `0001_init` — applied (05-db-migrate.log)
pnpm db:seed       # created demo user demo@lifepilot.local + 2 sample reminders (06-db-seed.log)
```

(On this run `DATABASE_URL` was exported from `.env` before invoking the
`packages/db` scripts; the quickstart shell steps are unchanged.)

### 7.4 `pnpm dev` — six processes up

`docs/evidence/04-pnpm-dev.log`:

- **web** (Next.js dev): `✓ Ready in 16.2s` — `GET http://localhost:3000` → HTTP 200
- **api** (Fastify via tsx watch): `GET /health` → `{"status":"ok","service":"lifepilot-api"}` on :3001
- **worker**: `lifepilot worker started {"queue":"reminders","concurrency":5,"redis":"redis://localhost:6379"}`
- plus the three healthy containers above = six processes.

### 7.5 Criterion 3 — EMAIL reminder PENDING → DELIVERED (real run)

`docs/evidence/api-evidence.log` (produced by `docs/evidence/collect-evidence.mjs`):

```
[3] POST /reminders -> 201 id=cmvmiljnp0009tmxkn3k1fhwk status=PENDING dueAt=2026-10-24T14:49:22.726Z
    queued job scheduled (BullMQ delayed job at dueAt)
[4] GET /reminders/... -> 200 status=PENDING (PENDING captured)
    poll#1 status=PENDING
    poll#2 status=PENDING
    poll#3 status=DELIVERED
[5] FINAL status=DELIVERED attempts=1
```

Worker console transport printed the email and closed the job
(`docs/evidence/17-worker-email-excerpt.log`, excerpt of `04-pnpm-dev.log`):

```
apps/worker dev: {"level":"info","msg":"email delivered via console transport",
  "reminderId":"cmvmiljnp0009tmxkn3k1fhwk","to":"e2e-...@lifepilot.local",
  "subject":"[LifePilot] E2E email proof (round-2 evidence)"}
apps/worker dev: {"level":"info","msg":"reminder delivered",
  "channel":"EMAIL","detail":{"transport":"console",...}}
apps/worker dev: {"level":"info","msg":"job completed","jobId":"reminder-cmvmiljnp0009tmxkn3k1fhwk"}
```

UI: `docs/evidence/20-ui-reminder-PENDING.png` (PENDING badge, no attempts) and
`docs/evidence/21-ui-reminder-DELIVERED.png` (DELIVERED badge + SUCCESS/EMAIL
attempt row with `transport:"console"` detail + the attachment entry) — the
attempt is visible in the UI as required. `22-ui-reminders-list.png` shows the
list view.

### 7.6 Criterion 5 — attachment stored in MinIO, linked to its reminder

- `POST /reminders/:id/attachments` → 201, `objectKey:
  reminders/cmvmiljnp0009tmxkn3k1fhwk/330e0b9b-…-e2e-proof.txt`
  (`docs/evidence/14-attachment-upload.json`)
- `GET /attachments/:id/download` → **302** with a short-lived AWS-SigV4
  presigned URL against `http://localhost:9000/lifepilot-attachments/…`
  (`docs/evidence/15-download-redirect.txt`)
- Bucket listing inside the MinIO container
  (`docs/evidence/16-minio-ls.txt`):

```
[2026-10-24 14:49:22 UTC]    92B STANDARD reminders/cmvmiljnp0009tmxkn3k1fhwk/330e0b9b-082f-45fd-87bd-f9cb876b87df-e2e-proof.txt
```

### 7.7 Bug found and fixed by this run (why runtime proof matters)

The first live reminder creation failed with HTTP 500
`Custom Id cannot contain :` — BullMQ rejects custom job ids containing
colons, and the unit tests exercise the queue through an injectable fake, so
the integration gap was invisible to `pnpm test`. Fixed in
`apps/api/src/lib/queue.ts` (`reminder:${id}` → `reminder-${id}`, both call
sites); `pnpm test` re-run after the fix: **60/60 green**
(`docs/evidence/18-pnpm-test-final.log`), typecheck 5/5 packages.

### 7.8 Note on image provenance

The pinned images (`postgres:16-alpine`, `redis:7-alpine`,
`minio/minio:RELEASE.2024-06-13T22-53-53Z`) were pulled through a registry
mirror because Docker Hub is unreachable from this network; layer digests were
verified against the manifest (`sha256:98fe67c08bf9…` for the MinIO tag). The
compose file itself is unchanged.

### 7.9 Reproduce

```bash
cp .env.example .env
docker compose up -d --wait
pnpm install
pnpm db:generate
pnpm db:migrate
pnpm db:seed
pnpm dev          # six processes; then follow README "See a delivery happen"
pnpm test         # 60/60, no external services
```

## 8. Security posture highlights

- Passwords: bcrypt (cost 10) — plaintext never stored or logged (asserted in tests).
- Refresh tokens: 48-byte random, stored **hashed** (SHA-256), rotated on every refresh, revoked on logout.
- Outgoing webhooks: `x-lifepilot-signature: sha256=<hmac>` over the exact raw body, constant-time compared.
- Incoming Razorpay webhooks: signature verified against the **raw** request body before any processing; 401 on mismatch.
- All credentials env-injected; `JWT_SECRET` refuses the dev default when `NODE_ENV=production`.
