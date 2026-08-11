# Agent Playbook — the manual, task-by-task route

## Most teams should use `docs/AUTORUN.md` instead

**[`docs/AUTORUN.md`](AUTORUN.md) is the hands-off version.** You clone the repo, paste one line
into Claude Code, and it runs the whole migration locally — self-verifying at every phase and
stopping only when it genuinely needs you (your repo URL, API keys, the final push). That is the
recommended path.

**Use this playbook instead when you want a human hand on each step:** you're new to the codebase
and want to learn it as you go, a phase in AUTORUN failed and you want to redo just that piece, or
you're doing something risky (like the MongoDB migration) and want to inspect every change.

Both documents cover the same work in the same order and use the same verification gates. The only
difference is who pulls the trigger between steps.

---

## How to use this playbook

Each task below is a **separate Claude Code session**. Copy the prompt in the grey box, paste it,
let it work, then run the verification command yourself. Only move to the next task when the
current one passes.

**❌ Do not paste the whole handoff and say "do all of this".**

That fails in the worst way — not with an error, but with an agent that confidently rewrites
working code, drops a business rule nobody notices for three weeks, and leaves you unable to tell
which of 200 changed files caused it. An agent given one huge ambiguous goal drifts: it invents
endpoints, weakens auth checks to make something pass, and deletes tests that get in the way.

AUTORUN avoids this not by being slow, but by making the agent verify itself against machine-
checkable gates between phases. This playbook avoids it by putting you in that role instead.

**✅ Either way: one task, one scope, one verification.** Each task below is scoped so that:
- it changes a small number of files
- it has a command that proves it worked
- if it goes wrong, you throw away one branch, not a month of work

### The five rules

1. **One task, one session, one branch.** Start each task with `git checkout -b task-name`.
2. **Never skip the verification step.** If it fails, do not continue to the next task.
3. **Commit after every green task.** That's your rollback point.
4. **If an agent says it can't do something, believe it.** Don't re-prompt harder — read what it
   said. It's usually telling you about a real problem.
5. **When an agent asks a question, answer it.** Don't say "you decide" on schema, auth, or
   money.

### Rolling back

```bash
git checkout . && git clean -fd
```
That discards everything uncommitted. Because you commit after each green task, the worst case is
losing one task.

---

# STAGE 0 — Get oriented (no code changes)

## Task 0.1 — Get it running locally

Do this yourself, following `docs/MERN_HANDOFF.md` Part 3. Don't delegate it — you need to know
how to start the app to verify everything later.

**Done when:** http://localhost:3000/platform loads and you can sign in as Admin.

## Task 0.2 — Have the agent explain the codebase to you

> Read CLAUDE.md first, then explore this codebase and explain it to me. I am new to it.
>
> Do not change any files. This is a read-only task.
>
> Tell me:
> 1. What this product does, in plain language
> 2. The three user roles and what each can see
> 3. How the frontend talks to the backend — specifically, how many places define the API URL
> 4. What the 5 most important database tables are and how they relate
> 5. Which file I should read to understand the API, and why
> 6. The three things most likely to break if we change the backend
>
> Keep it under 400 words. Do not list every file.

**Done when:** you understand the answers. If you don't, ask follow-ups in the same session.

**Verify:** `git status` shows no changes.

---

# STAGE 1 — Take ownership

## Task 1.1 — Move to your own repository

Do this yourself — `docs/MERN_HANDOFF.md` Part 4. It's four commands and you should know exactly
what happened to your git history.

## Task 1.2 — Rotate every secret

⚠️ **Do this before writing any code.** Assume everything shared during handover is compromised.

> Read CLAUDE.md first.
>
> I am taking over this project from another team. Help me find every secret, credential, API key
> and connection string this project uses, so I can rotate them all.
>
> Do not print any secret values you find — just tell me the name of each one, where it is
> configured (env var, CI secret, hosting dashboard), and what breaks if I rotate it.
>
> Also check whether any secret was ever committed to git history, and tell me which.
>
> Do not change any files.

**Then rotate, by hand:** database password, service-role key, `JWT_SECRET`, `ANTHROPIC_API_KEY`,
and all three demo account passwords.

**Verify:** the app still runs after you update your local `.env.local`.

## Task 1.3 — Stand up your own infrastructure

Your own Supabase (or Postgres) project and your own Vercel project. Do not build on the handover
team's infrastructure.

**Verify:** you can run the app pointed at *your* database, and sign in.

---

# STAGE 2 — Build the safety net BEFORE migrating

**Do not skip this stage.** These two tasks are what make the rest of the migration verifiable by
a team that doesn't yet know the codebase deeply. Without them you are migrating blind.

## Task 2.1 — Cross-tenant isolation test ⚠️ most important task in this document

> Read CLAUDE.md first, especially the hard rules about `org_id`.
>
> This is a multi-tenant product. Each customer company is an "organisation" and rows are
> separated by `org_id`. A user of one organisation must never be able to read or write another
> organisation's data.
>
> Write an automated test that proves this, in `backend/tests/test_cross_tenant_isolation.py`,
> following the existing tests' style.
>
> The test must:
> 1. Create two separate organisations, each with an admin and an employee
> 2. Create real data in both — a rule, a training module, an activity, a feedback item
> 3. For every GET endpoint that returns a list, assert org A's user sees only org A's rows
> 4. For every endpoint that takes an ID in the URL, assert org A's user gets 403 or 404 when
>    passing one of org B's IDs — never the row
> 5. Assert org A's admin cannot modify any of org B's rows
>
> Use the existing tests as your guide for setup. Do not modify any existing test or any
> application code — if you find a real isolation bug, stop and report it to me instead of fixing
> it.
>
> Then run your new test file on its own and show me the output.

**Verify:**
```bash
cd backend && .venv/bin/python -m pytest tests/test_cross_tenant_isolation.py -q
```

**If it finds a real leak:** stop the whole migration and fix that first. That is a live security
bug, and it matters more than any migration.

**Then:** make this test run on every pull request, forever.

## Task 2.2 — Record golden API responses

This is how you'll prove your Express rewrite matches the original — without having to understand
all 79 endpoints yourself.

> Read CLAUDE.md first.
>
> I am about to rewrite this API in Express. Before I do, I want to capture exactly what the
> current API returns, so I can diff my new implementation against it.
>
> Write a script at `scripts/capture-golden.mjs` that:
> 1. Logs in as employee, manager, and admin against a running local backend
> 2. Calls every GET endpoint each role is allowed to call
> 3. Saves each response to `golden/<role>/<endpoint-path>.json`, pretty-printed with sorted keys
> 4. Redacts values that change every run (ids, timestamps, tokens) by replacing them with the
>    string "<VOLATILE>", so two runs of the same unchanged server produce identical files
>
> Then write `scripts/compare-golden.mjs` that re-runs the same calls against a URL I pass as an
> argument and reports any differences from the saved golden files.
>
> Get the endpoint list from `backend/app/main.py`. Do not modify any application code.
>
> Then run the capture script against http://localhost:8000 and show me how many files it wrote.

**Verify:** run capture twice against the same server — `git status` should show no changes the
second time. If it does, the redaction isn't complete; tell the agent which fields still differ.

```bash
node scripts/capture-golden.mjs && git status --short golden/
```

**Commit the `golden/` directory.** It's now your specification.

---

# STAGE 3 — Create the seam

## Task 3.1 — Express server that proxies everything

The trick: your Express server starts by doing *nothing* except forwarding requests. Zero
behaviour change, but now you own the seam.

> Read CLAUDE.md first.
>
> Create a new Express API server in a new top-level `api/` directory. TypeScript, Node 22.
>
> For this first step it must implement exactly TWO things itself:
> - `GET /health` returning `{"status":"ok"}`
> - everything else proxied unchanged to the URL in `process.env.LEGACY_API_URL`, preserving
>   method, path, query, headers (including Authorization), body and status code
>
> Use `express`, `http-proxy-middleware`, `helmet`, and `cors`. Include:
> - `api/package.json` with `dev` and `start` scripts
> - `api/.env.example` documenting every variable
> - `api/README.md` with exact run instructions
>
> Do not implement any business logic yet. Do not modify anything in `app/`, `backend/`, or
> `supabase/`.
>
> Then start it and show me that a proxied request works.

**Verify** — with the FastAPI backend on 8000 and Express on 4000:
```bash
curl -s http://localhost:4000/health && node scripts/compare-golden.mjs http://localhost:4000
```
The comparison must report **zero differences** — you're proxying, so nothing should have changed.

## Task 3.2 — Point the frontend at Express

Change one environment variable in `.env.local`:

```bash
NEXT_PUBLIC_API_URL=http://localhost:4000
```

**Verify by hand.** Sign in as all three roles and click through. Everything must work exactly as
before — you have changed no behaviour, only added a hop.

**This is your safety net.** From here on, every endpoint you port is one line moving from
"proxied" to "implemented", and reverting is one line back.

---

# STAGE 4 — Port the endpoints

Repeat the same task shape for each group, **in this order** (safest first):

| # | Group | Endpoints | Risk |
| --- | --- | --- | --- |
| 4.1 | `/api/v1/me`, `/api/v1/activities`, `/api/v1/mistakes` | 4 | Low — read-only |
| 4.2 | `/api/v1/notifications/*` | 3 | Low |
| 4.3 | `/api/v1/dashboard`, `/api/v1/certificates` | 2 | Low |
| 4.4 | `/api/v1/training/*` | 3 | **Medium — weighted grading, attempt caps, sequential locks** |
| 4.5 | `/api/v1/onboarding/*`, `/api/v1/public/preview/*` | 4 | Medium — stage gating, invite tokens |
| 4.6 | `/api/v1/rules/*`, `/api/v1/submissions/*`, `/api/v1/feedback` | 7 | **High — versioning, read receipts, dept scoping** |
| 4.7 | `/api/v1/search/*` | 2 | Medium — auto-routing |
| 4.8 | `/api/v1/manager/*` | 2 | Medium — `manager_id` hierarchy |
| 4.9 | `/api/v1/admin/*` | ~45 | Large, but mostly CRUD |
| 4.10 | `/api/v1/auth/*`, `/api/v1/organizations` | 3 | **Do last, with Stage 5** |

### The reusable prompt — substitute the group each time

> Read CLAUDE.md first.
>
> In `api/`, implement these endpoints natively in Express instead of proxying them:
>
> **[PASTE THE ENDPOINT LIST FOR THIS GROUP]**
>
> Rules:
> - The reference implementation is in `backend/app/main.py`. Match its behaviour exactly,
>   including status codes, error message wording, and the `{"detail": ..., "field": ...}` error
>   shape.
> - Response JSON must match byte-for-byte what the current API returns. The files in `golden/`
>   are the specification.
> - Every query must be scoped by `org_id` taken from the auth token — never from user input.
> - Role checks are server-side. Do not rely on the frontend.
> - Connect to the same PostgreSQL database. Do not change the schema.
> - Everything not in the list above must keep being proxied.
> - Do not modify `app/`, `backend/`, or `supabase/`.
>
> When done, run `node scripts/compare-golden.mjs http://localhost:4000` and fix any differences
> until it reports none. Show me the final output.

**Verify after every group:**
```bash
node scripts/compare-golden.mjs http://localhost:4000
```
```bash
cd backend && .venv/bin/python -m pytest tests/test_cross_tenant_isolation.py -q
```
Plus: sign in as all three roles and click through the affected screens.

**Commit. Then next group.**

### Extra care on groups 4.4 and 4.6

These carry the rules that took a full QA cycle to get right. After 4.4 and 4.6, add:

> Now write tests in the Express project proving these still hold:
> - a locked module's quiz cannot be fetched or submitted
> - a heavier question missed fails the attempt even when more questions were right than wrong
> - exhausting attempts blocks the next module and flags the manager
> - editing only a rule's title still creates a new version and clears every read receipt
> - a PATCH that omits `body` does not create a version
> - a department-scoped rule is invisible to someone outside that department
>
> Read the equivalent tests in `backend/tests/` first and match their intent exactly.

---

# STAGE 5 — Authentication

⚠️ **Do not start Stage 5 until Stage 4 is finished and green.** Changing auth and porting
endpoints at the same time means you won't know which broke what.

Do these in order, one session each.

## Task 5.1 — Port auth as-is (no improvements yet)

> Read CLAUDE.md first.
>
> Implement `/api/v1/auth/login` and `/api/v1/organizations` natively in Express, matching the
> current behaviour exactly. Do not improve anything yet — I want a like-for-like port I can
> verify before changing the security model.
>
> Passwords are bcrypt via Postgres `pgcrypto` (`crypt(password, hash)`). Keep verifying against
> existing hashes so current users can still log in.
>
> Keep the same session model: a random opaque token, SHA-256 hashed before being stored in
> `sessions`, 8 hour expiry.
>
> Then remove the proxy entirely — nothing should be forwarded any more.

**Verify:** all three demo accounts log in; the golden comparison is clean; the cross-tenant test
passes.

## Task 5.2 — Auth middleware

> Read CLAUDE.md first.
>
> Add three Express middlewares and apply them across the whole API:
> - `requireAuth` — verifies the token, sets `req.user` and `req.orgId` from it, 401 otherwise
> - `requireAdmin` — 403 unless `req.user.role === "admin"`
> - `requireManager` — 403 unless role is manager or admin
>
> `req.orgId` must be the ONLY source of org scoping anywhere in the codebase. Then audit every
> route and show me a table of route → middleware applied. Flag any route reading an org id from
> the request body, query, or params — that's a bug.

**Verify:** cross-tenant test passes; an employee token gets 403 on every `/api/v1/admin/*` route.

## Task 5.3 — Rate limiting and lockout

> Read CLAUDE.md first.
>
> Add brute-force protection to login: rate limit per IP and per email address, plus temporary
> account lockout after repeated failures. Use `express-rate-limit` with Redis so limits survive a
> restart and work across instances.
>
> Failed attempts must be recorded in the audit log. Lockout responses must not reveal whether the
> email exists.
>
> Then write a test proving the limit actually triggers.

## Task 5.4 — Password reset and email verification

> Read CLAUDE.md first.
>
> Add password reset and email verification. Requirements:
> - Single-use, expiring tokens (1 hour reset, 24 hour verification), stored hashed
> - "Forgot password" gives the same response whether or not the email exists
> - Resetting a password invalidates all existing sessions for that user
> - New organisation signups must verify their email before the workspace becomes usable
> - Use [YOUR EMAIL PROVIDER] — put the API key in an env var
>
> Add the frontend screens in `app/`, matching the existing sign-in page's styling.

## Task 5.5 — Refresh tokens and httpOnly cookies

> Read CLAUDE.md first.
>
> Replace the 8-hour opaque token with:
> - a short-lived access JWT (15 minutes)
> - a long-lived rotating refresh token (30 days), stored hashed in `sessions`
> - both delivered as httpOnly, Secure, SameSite=Lax cookies rather than in the response body
> - refresh token rotation, with reuse detection that revokes the whole session family
>
> The frontend currently stores the token in `sessionStorage` (see `PlatformApp.tsx`). Update it
> to rely on cookies instead, and make sure `request()` sends credentials.
>
> This changes both the API and the frontend — go carefully and tell me every file you touched.

**Verify:** log in, wait past 15 minutes, confirm the session silently refreshes rather than
kicking the user out.

## Task 5.6 — MFA (optional, do when a customer asks)

> Add TOTP two-factor authentication using `otplib`: enrolment with a QR code, verification at
> login, and single-use recovery codes stored hashed. Make it opt-in per user and enforceable
> per organisation.

---

# STAGE 6 — SaaS commercial layer

## Task 6.1 — Billing schema and Stripe

> Read CLAUDE.md first. Note the rule about schema changes — this task needs them, which is why
> I'm asking explicitly.
>
> Add subscription billing with Stripe. Create a migration adding: `plans`, `subscriptions`,
> `invoices`, `usage_records`. Follow the existing migration style and org scoping.
>
> Integrate Stripe Billing: checkout for new subscriptions, a webhook handler for subscription
> lifecycle events, and a customer portal link for self-service.
>
> Show me the migration file before applying it.

## Task 6.2 — Plan limits

> Add middleware enforcing plan limits before creation endpoints — employee seats, training
> modules, storage.
>
> Return **402 Payment Required** with `{"detail": "..."}` explaining which limit was hit and that
> upgrading resolves it. Then add a frontend upgrade prompt for 402 responses, matching the
> existing design.

## Task 6.3 — Trials and lifecycle

> Add trial support: `trial_ends_at` on organisations, and states trialing → active → past_due →
> cancelled.
>
> On cancellation the workspace becomes read-only for 30 days, then data is exportable for a
> further 30, then deleted. Implement the state machine and the read-only enforcement. Do not
> implement deletion yet — show me the plan for that first.

## Task 6.4 — Operational readiness

Before charging anyone: automated backups **with a tested restore**, Sentry on frontend and API,
uptime monitoring, structured logging that includes `org_id`, per-tenant data export, and a
status page.

---

# Quick reference

**Verify everything:**
```bash
cd backend && for f in tests/test_*.py; do .venv/bin/python -m pytest "$f" -q; done
```
```bash
npm run lint && npm run build && node scripts/compare-golden.mjs http://localhost:4000
```

**Roll back the current task:**
```bash
git checkout . && git clean -fd
```

**If an agent has made a mess:** don't try to talk it into fixing it. Roll back, then re-run the
task with a smaller scope.

**If you're unsure whether something is a bug or intended:** it's usually intended. Check
`git log -S "the code"` and read the commit message.
