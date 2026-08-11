# AUTORUN — autonomous migration directive

## For the human: how to use this

1. Clone the repo and `cd` into it
2. Run `claude`
3. Paste exactly this:

> Read `docs/AUTORUN.md` and execute it. Work autonomously through the phases. Do not ask me for
> permission between phases — only stop for the things the document says to stop for.

4. Answer the handful of questions it asks (repo URL, API keys)
5. Review and push when it tells you to

Everything below this line is addressed to the agent.

---

# DIRECTIVE

You are migrating **OneWork Employee OS** — a live, multi-tenant SaaS — from a Python/Deno API to
an Express API, then hardening authentication and adding a billing layer.

**Read `CLAUDE.md` now, before anything else.** It contains the hard rules and the business
invariants. Everything in it applies to every phase below.

## Operating mode

- **Work autonomously.** Do not ask for permission between phases. Move to the next phase as soon
  as the current one's gate passes.
- **Never push to any remote.** Commit locally only. Pushing is the human's decision.
- **Never proceed past a failing gate.** Every phase ends with commands that must pass. If they
  fail: fix it, or roll back that phase and report. Do not continue with a red gate and do not
  weaken the gate to make it pass.
- **Never delete or weaken a test to make your code pass.** The test is the specification.
- **Keep `MIGRATION_PROGRESS.md` up to date** (below). It is how you resume after a context reset
  and how the human sees status.

## Before you start: write the progress file

Create `MIGRATION_PROGRESS.md` in the repo root with every phase listed as `PENDING`. After each
phase, update its status to `DONE` with a one-line note and the gate result. If you are resuming
and this file already exists, **read it first and continue from the first phase that is not
DONE** — do not redo completed work.

Add `MIGRATION_PROGRESS.md` to the repo (commit it). It is the run log.

## Stop and ask the human only for these

Everything else, decide yourself using `CLAUDE.md` and `docs/MERN_HANDOFF.md`.

| # | Stop for | Phase |
| --- | --- | --- |
| 1 | Their new Git remote URL (if they want the code moved) | 1 |
| 2 | Their database connection string, if not already in `.env.local` | 3 |
| 3 | Email provider API key (Resend/SendGrid/SES) | 6 |
| 4 | Stripe secret key + webhook secret | 7 |
| 5 | Any decision that would change the database schema | any |
| 6 | Any situation where the only way forward is weakening an `org_id` or role check | any |
| 7 | A gate that fails and that you cannot fix after two genuine attempts | any |
| 8 | Final review and push | 8 |

When you stop, say precisely what you need and why, then wait. Do not guess a value, and do not
invent a placeholder key and carry on.

## Decisions already made — do not re-litigate

- **Keep PostgreSQL.** Do not migrate to MongoDB. The reasoning is in `docs/MERN_HANDOFF.md` §0.2
  and §9.2 — tenant isolation is currently enforced by Postgres row-level security, and MongoDB
  has no equivalent. If the human explicitly instructs otherwise, follow `docs/MERN_HANDOFF.md`
  §9.4 and do it only after Phase 5 is complete and green.
- **Do not touch the frontend** (`app/`) except where a phase explicitly says to. It works. Every
  API call already funnels through `request()` in `app/platform/PlatformApp.tsx` reading
  `NEXT_PUBLIC_API_URL`, so the backend can be replaced without editing React.
- **Express + TypeScript** in a new top-level `api/` directory.
- **Argon2id** for new password hashes; keep verifying existing bcrypt hashes so current users can
  still log in.

---

# THE GATES

These commands are your definition of correct. Run them at every gate.

**G1 — backend tests (must be 29 passed, run one file at a time):**
```bash
cd backend && for f in tests/test_*.py; do .venv/bin/python -m pytest "$f" -q; done
```

**G2 — frontend:**
```bash
npm run lint && npm run build
```

**G3 — API responses unchanged:**
```bash
node scripts/compare-golden.mjs http://localhost:4000
```

**G4 — tenant isolation:**
```bash
cd backend && .venv/bin/python -m pytest tests/test_cross_tenant_isolation.py -q
```

---

# PHASE 0 — Orientation and local setup

1. Read `CLAUDE.md`, then `backend/app/main.py` in full. That file is the specification for all 79
   endpoints.
2. Set up and start the backend and frontend locally (see `docs/MERN_HANDOFF.md` Part 3).
3. If `backend/onework.db` produces errors, delete it and let it re-seed — it is a stale artifact.
4. Verify you can log in as all three demo roles.

**Gate:** G1 and G2 pass. Record the exact test count in `MIGRATION_PROGRESS.md`.

If G1 does not show 29 passed **before you have changed anything**, stop and report — you have an
environment problem, not a code problem.

---

# PHASE 1 — Repository ownership

Ask the human for their new Git remote URL (stop reason #1). If they say to skip this, skip it.

Then: rename the existing remote to `upstream`, add theirs as `origin`, and **do not push** —
tell them the command to run themselves.

Also scan for secrets: list every credential the project uses, where it is configured, and whether
any was ever committed to git history. **Do not print secret values.** Write the list to
`MIGRATION_PROGRESS.md` as a rotation checklist for the human.

**Gate:** `git remote -v` shows the intended remotes. No secret values printed anywhere.

---

# PHASE 2 — Safety net ⚠️ do not skip

This phase is what makes every later phase verifiable. Build it before changing anything.

## 2.1 Cross-tenant isolation test

Write `backend/tests/test_cross_tenant_isolation.py` following the existing tests' style. It must:

1. Create two organisations, each with an admin and an employee
2. Create real data in both — a rule, a training module, an activity, a feedback item
3. For every list endpoint, assert org A's user sees only org A's rows
4. For every endpoint taking an ID in the URL, assert org A's user gets 403 or 404 for org B's
   IDs — never the row
5. Assert org A's admin cannot modify org B's rows

Do not modify existing tests or application code. **If this test finds a real isolation bug, stop
immediately and report it** — that is a live security defect and it outranks the migration.

## 2.2 Golden response capture

Write `scripts/capture-golden.mjs`:
- logs in as employee, manager and admin against the running backend
- calls every GET endpoint each role may call (get the list from `backend/app/main.py`)
- saves each response to `golden/<role>/<path>.json`, pretty-printed, keys sorted
- replaces volatile values (ids, timestamps, tokens) with `"<VOLATILE>"` so two runs of an
  unchanged server produce byte-identical files

Write `scripts/compare-golden.mjs <baseUrl>` that re-runs the same calls and reports differences.

Run capture twice and confirm the second run produces no file changes. If it does, your redaction
is incomplete — fix it until it is stable.

**Gate:** G4 passes. `node scripts/capture-golden.mjs && git status --short golden/` shows no
changes on the second run. Commit `golden/`.

---

# PHASE 3 — Express seam

Create `api/` — Express + TypeScript, Node 22. In this phase it implements exactly two things:

- `GET /health` → `{"status":"ok"}`
- **everything else proxied unchanged** to `process.env.LEGACY_API_URL`, preserving method, path,
  query, headers (including `Authorization`), body and status code

Include `api/package.json`, `api/.env.example`, `api/README.md`. Use `express`,
`http-proxy-middleware`, `helmet`, `cors`.

No business logic. Do not modify `app/`, `backend/` or `supabase/`.

Then start Express on port 4000 with `LEGACY_API_URL=http://localhost:8000` and point the frontend
at it by setting `NEXT_PUBLIC_API_URL=http://localhost:4000` in `.env.local`.

**Gate:** G3 reports **zero differences** (you are proxying — nothing should have changed). Then
confirm by loading the app and signing in as each role.

---

# PHASE 4 — Port the endpoints

Port these groups **in this order**, one group at a time. After each group, run the gates and
commit before starting the next.

| # | Group | Notes |
| --- | --- | --- |
| 4.1 | `/api/v1/me`, `/api/v1/activities`, `/api/v1/mistakes` | Read-only, start here |
| 4.2 | `/api/v1/notifications/*` | Simple writes |
| 4.3 | `/api/v1/dashboard`, `/api/v1/certificates` | |
| 4.4 | `/api/v1/training/*` | **Weighted grading, attempt caps, sequential locks** |
| 4.5 | `/api/v1/onboarding/*`, `/api/v1/public/preview/*` | Stage gating; invite token IS the auth |
| 4.6 | `/api/v1/rules/*`, `/api/v1/submissions/*`, `/api/v1/feedback` | **Versioning, read receipts, dept scoping** |
| 4.7 | `/api/v1/search/*` | Auto-routing to department |
| 4.8 | `/api/v1/manager/*` | Uses `manager_id` hierarchy, not department |
| 4.9 | `/api/v1/admin/*` | ~45 endpoints, mostly CRUD |

For every group:
- `backend/app/main.py` is the reference. Match behaviour exactly — status codes, error wording,
  and the `{"detail": ..., "field": ...}` shape.
- Responses must match `golden/` exactly.
- Every query scoped by `org_id` from the auth token, never from user input.
- Role checks server-side.
- Same PostgreSQL database. No schema changes.
- Everything not yet ported stays proxied.

After groups **4.4** and **4.6**, additionally write Express tests proving the invariants listed
in `CLAUDE.md` §6 for those areas. Read the equivalent tests in `backend/tests/` first and match
their intent.

**Gate after every group:** G3 and G4 pass, plus G1 still passes. Commit.

---

# PHASE 5 — Authentication port and hardening

Do not start until Phase 4 is fully green.

**5.1 — Like-for-like port.** Implement `/api/v1/auth/login` and `/api/v1/organizations` in
Express, matching current behaviour exactly. Keep verifying existing bcrypt hashes. Keep the same
session model (random opaque token, SHA-256 hashed in `sessions`, 8h expiry). Then remove the
proxy entirely — nothing should be forwarded any more.

**5.2 — Middleware.** Add `requireAuth`, `requireAdmin`, `requireManager` and apply across every
route. `req.orgId` must come only from the verified token. Produce a route → middleware table in
`MIGRATION_PROGRESS.md`, and flag any route reading an org id from body/query/params.

**5.3 — Brute force protection.** Per-IP and per-account rate limiting plus temporary lockout on
login, using `express-rate-limit` with Redis. Record failed attempts in the audit log. Responses
must not reveal whether an email exists. Write a test proving the limit triggers.

**5.4 — Argon2id.** Hash new and changed passwords with Argon2id; keep verifying legacy bcrypt
hashes and transparently upgrade a user's hash on successful login.

**5.5 — Refresh tokens and cookies.** Short-lived access JWT (15 min) plus rotating refresh token
(30 days, hashed in `sessions`), both delivered as httpOnly/Secure/SameSite=Lax cookies. Implement
rotation with reuse detection that revokes the session family. Update `PlatformApp.tsx` to stop
using `sessionStorage` and to send credentials. **This phase touches the frontend** — list every
file you changed.

**Gate:** G1–G4 all pass. All three demo accounts log in. A session survives past 15 minutes by
refreshing rather than logging the user out.

---

# PHASE 6 — Account lifecycle

Stop and ask for the email provider API key (stop reason #3) before starting.

Add password reset and email verification:
- single-use expiring tokens, stored hashed (1h reset, 24h verification)
- "forgot password" responds identically whether or not the email exists
- resetting a password invalidates all that user's sessions
- new organisation signups verify their email before the workspace becomes usable
- candidate invite tokens get an expiry and become single-use

Add the frontend screens in `app/`, matching the existing sign-in page's styling.

**Gate:** G1–G4 pass. Reset and verification flows work end to end against a real inbox.

---

# PHASE 7 — Billing

Stop and ask for Stripe keys (stop reason #4) before starting.

This phase **requires schema changes** — that is expected here and is the one exception to the
`CLAUDE.md` rule. Show the human each migration file before applying it.

- New migration adding `plans`, `subscriptions`, `invoices`, `usage_records`, following the
  existing migration style and org scoping
- Stripe Billing: checkout, webhook handler for subscription lifecycle, customer portal link
- Plan-limit middleware before creation endpoints; return **402** with a `detail` explaining which
  limit was hit
- Frontend upgrade prompt on 402, matching existing design
- Trials: `trial_ends_at`, states trialing → active → past_due → cancelled, workspace read-only
  after cancellation

Do **not** implement data deletion. Write the plan for it and stop.

**Gate:** G1–G4 pass. A test subscription completes in Stripe test mode and the webhook updates
the subscription row.

---

# PHASE 8 — Hand back to the human

Do not push. Instead:

1. Run all four gates one final time and record the results
2. Write a summary in `MIGRATION_PROGRESS.md` containing:
   - every phase and its status
   - every file created or modified, grouped by phase
   - the secret-rotation checklist from Phase 1
   - **anything you could not verify**, stated plainly
   - any invariant from `CLAUDE.md` §6 you are not fully confident survived
3. Tell the human:
   - the exact `git push` command to run
   - what to click through manually before trusting it: sign in as Employee, Manager and Admin and
     exercise each role's main screens
   - that the auth changes deserve a human security review

Report honestly. If a gate is red, say so at the top of your summary — do not bury it. If you
skipped something, say what and why. Never report success you have not verified.
