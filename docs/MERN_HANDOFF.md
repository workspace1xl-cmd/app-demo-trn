# OneWork Employee OS — Engineering Handoff for the MERN Team

**Audience:** the incoming software team. This document assumes you know JavaScript, React and
Node, but assumes **nothing** about this codebase. Every command is written out in full.

**What you are receiving:** a working, deployed, multi-tenant employee onboarding and knowledge
platform. It is live, it has real data, and it passes its own test suite. Your job is to take it
over, move it to your own repository, replace the authentication with production-grade auth, and
turn it into a commercial SaaS — **without breaking the parts that already work.**

---

# PART 0 — READ THIS BEFORE YOU TOUCH ANYTHING

## 0.1 The one thing you must understand first

**OneWork is not currently a MERN application.** Here is the honest breakdown:

| MERN letter | What you expected | What OneWork actually uses | Verdict |
| --- | --- | --- | --- |
| **M** — MongoDB | MongoDB | **PostgreSQL** (30 tables, foreign keys, row-level security) | ❌ Different |
| **E** — Express | Express | **FastAPI** (Python) + **Supabase Edge Functions** (Deno/TypeScript) | ❌ Different |
| **R** — React | React | **React 19** (inside Next.js 16) | ✅ Same |
| **N** — Node | Node | **Node 22** (Next.js runs on it) | ✅ Same |

So you are keeping half of it. The frontend is already React on Node and needs almost no
migration work. The backend is the part that changes.

## 0.2 The decision you have to make on day one

You have two realistic paths. **Read both before choosing.** This choice affects everything else
in this document.

### Path A — "PERN" (Postgres + Express + React + Node) — **strongly recommended**

Replace the Python/Deno API with **Express**, and **keep PostgreSQL**.

- You get the "E", "R" and "N" of MERN. You keep a database that already models this domain
  correctly.
- Effort with Claude Code: roughly **1–2 days of agent working time.** The work is mechanical —
  translating a readable reference implementation into another language, with automated
  verification at every step.
- Risk: **low**. The database, the security model and all the business rules stay put. You are
  only re-expressing the HTTP layer in a different language.

### Path B — Full MERN (migrate PostgreSQL → MongoDB)

- Effort with Claude Code: roughly **4–7 days of agent working time**, plus ongoing risk that
  never fully goes away (below).
- Risk: **high**, for three specific reasons, explained in Part 9. In summary:
  1. **You lose Row-Level Security.** PostgreSQL currently enforces tenant isolation *inside the
     database* — 30 tables have RLS enabled and 36 policies. MongoDB has no equivalent. Every
     one of your queries would have to remember to filter by `orgId`. **One forgotten filter is a
     cross-customer data leak** — in a product where customers are companies and the data is
     their employees' records.
  2. **The data is genuinely relational.** Rules have versions, versions have per-employee read
     receipts, employees have enrollments in modules, modules have weighted questions, attempts
     roll up into certificates and readiness scores. This is not document-shaped data.
  3. **You would be rewriting working, tested logic**, which is how working products break.

**Our recommendation: take Path A.** If the "MERN" requirement is about your team's skills
(JavaScript everywhere, Express, Node), Path A delivers 100% of that. MongoDB is the only part
you would be giving up, and it is the part this particular product benefits from least.

If a stakeholder specifically requires MongoDB, Part 9.4 gives you a hybrid that limits the blast
radius. **Do not do a big-bang Postgres → Mongo rewrite.**

## 0.3 The single most important technical fact in this document

**The entire frontend talks to the backend through one function.**

Everything — all 79 endpoints, every screen, every role — goes through `request()` in
`app/platform/PlatformApp.tsx`, which reads one environment variable:

```ts
// app/platform/PlatformApp.tsx (line 15)
export const API = process.env.NEXT_PUBLIC_API_URL || "http://localhost:8000";
```

There is exactly **one** other place that defines it (`app/join/[token]/page.tsx`, line 12, the
public pre-joining page). Every other file imports `request` or `API` from `PlatformApp`.

**What this means for you:** you can rebuild the entire backend in Express and change **zero lines
of React**. Point `NEXT_PUBLIC_API_URL` at your new Express server. If your Express server returns
the same JSON shapes (Part 6), the app just works. This is your safety net — use it.

It also gives you a migration strategy that never has a "big bang" day: run the old API and your
new Express API side by side, and move endpoints across a few at a time (Part 9.3).

---

# PART 1 — WHAT ONEWORK ACTUALLY IS

## 1.1 The product in one paragraph

OneWork is an **Employee Operating System**. A company signs up, gets a private workspace, and
uses it to take a new hire from "offer accepted" to "fully productive": a pre-joining portal
before day one, a stage-gated onboarding journey, a training programme with assessments and
certificates, a searchable knowledge base that gives verified answers instead of guesses, a
register of company rules that employees must read and acknowledge, and a live map of who is
responsible for what. Managers see their team's readiness; management sees the whole organisation.

## 1.2 The three roles

| Role | Sees | Key screens |
| --- | --- | --- |
| **Employee** | Only their own work | Home (onboarding journey), My Learning, Knowledge, Rules & Regulations, Certificates, My Submissions |
| **Manager** | Their own work **+ their direct/indirect reports** | Everything an employee sees, plus **My Team** (readiness, overdue items, blocked assessments, nudge) |
| **Admin** | Their own work + the whole organisation | Everything above, plus the **Management** section (7 areas, 13 screens) |

There is a fourth, unauthenticated actor: a **Candidate**, who has not joined yet and accesses a
single public page via a one-time invite link.

## 1.3 Feature inventory — what is already built and working

Do not rebuild any of this. It exists, it is tested, and it is live.

**Pre-joining (before day one)**
- Admin invites a candidate → system generates a unique `invite_token`
- Candidate opens `/join/<token>` with no login at all — the token *is* the authorisation
- Candidate sees a welcome page and the real mandatory rules that will apply to them
- Candidate acknowledges; admin sees the status change

**Onboarding journey**
- Stages run in order. A stage is `completed`, `available`, or `locked`
- A later stage does not unlock until the one before it is finished — **enforced on the server**
- Items can be a training module, a content block, a rules acknowledgement, or a custom task
- When the last stage completes, the journey screen steps aside permanently and the normal
  dashboard takes over

**Training & assessment**
- Sequential module path; a module is locked until the previous one is passed
- **Per-question weighting**: questions carry different weights, so missing one heavy question can
  fail you even if you got more questions right than wrong
- **Attempt caps**: a configurable maximum number of attempts. Exhausting them blocks progression
  *and* raises a flag to the person's manager
- Passing issues a certificate with a number and an expiry date

**Rules & Regulations**
- Rules are **versioned**. Editing a rule publishes a new version and **clears everyone's read
  status**, forcing re-acknowledgement
- Rules can be organisation-wide or scoped to one department — and that scoping is a real
  server-side boundary, not a UI filter
- Employees can suggest changes to any rule; admins review with a decision workflow

**Knowledge & support**
- Search over verified organisational content — responsibility records, leadership messages, and
  previously resolved questions
- If a question has no verified match, it is automatically logged to the feedback queue for the
  knowledge team, and **auto-routed to the right department** based on what it matched
- A resolved question becomes real searchable knowledge for everyone else

**Responsibility matrix / ownership graph**
- 22 seeded activities: who is responsible, backup, contact, SLA, two escalation levels
- Rendered as a live force-directed graph, colour-coded by whether an owner is named
- Admins can assign owners inline from the graph

**Management (admin)**
- Overview (KPIs, needs-attention, workforce and compliance snapshots), Executive View (readiness
  trend, department comparison), People (employees / departments / candidates), Learning
  (modules / assignments / content library / journey builder), Responsibilities, Compliance,
  Feedback, Activity Log

**Cross-cutting**
- Full audit log of who changed what and when
- Notification outbox with a bell and unread counts
- CSV import for employees and activities
- Organisation self-signup that provisions a complete working tenant
- Readiness scoring — a transparent 0–100 score with a component breakdown, for individuals,
  teams and the whole organisation

## 1.4 Size of what you are inheriting

| Part | Lines | Notes |
| --- | ---: | --- |
| Frontend (`app/`) | ~9,100 | React 19 / Next.js 16. **Keep this.** |
| Supabase Edge Function (production API) | ~1,850 | Deno/TypeScript. Replace with Express. |
| FastAPI reference backend | ~2,550 | Python. Your best **reading** reference — see 2.4. |
| SQL migrations | ~1,910 | 30 tables, RLS policies, seed data |
| Backend tests | ~1,320 | 29 tests. Your specification — see Part 10. |

---

# PART 2 — CURRENT ARCHITECTURE

## 2.1 The picture

```
┌─────────────────────────────────────────────────────────────┐
│  BROWSER                                                    │
│  Next.js 16 + React 19  (Vercel)                            │
│  onework-employee-os-demo.vercel.app                        │
│                                                             │
│  All network calls funnel through request() in              │
│  app/platform/PlatformApp.tsx  →  NEXT_PUBLIC_API_URL       │
└───────────────────────────┬─────────────────────────────────┘
                            │  HTTPS + Bearer token
                            ▼
┌─────────────────────────────────────────────────────────────┐
│  API  (this is the layer you are replacing with Express)    │
│                                                             │
│  Production: Supabase Edge Function `onework-api` (Deno)    │
│  Reference:  FastAPI app in backend/ (Python)               │
│                                                             │
│  Both expose the SAME 79 HTTP endpoints (Part 6)            │
└───────────────────────────┬─────────────────────────────────┘
                            │  service-role connection
                            ▼
┌─────────────────────────────────────────────────────────────┐
│  PostgreSQL  (Supabase, project ref bnzcjjdhfsdedwljdmjl)   │
│  30 tables · Row-Level Security on all of them              │
│  bcrypt password hashing via pgcrypto                       │
└─────────────────────────────────────────────────────────────┘
```

## 2.2 Repository map

```text
app/                          Next.js frontend — KEEP THIS
  page.tsx                      marketing / management blueprint page
  join/[token]/page.tsx         public pre-joining portal (no login)
  platform/[[...slug]]/page.tsx the entire authenticated app (one route)
  platform/PlatformApp.tsx      main shell, sidebar, routing, request()  ← the choke point
  platform/AdminConsole.tsx     all 12 management panels
  platform/ManagementOverview.tsx  management landing screen
  platform/icons.tsx            SVG icon set
  platform/platform.module.css  all styling
backend/                      FastAPI reference implementation + tests
supabase/migrations/          the real database schema (source of truth)
supabase/functions/onework-api/  the production API
docs/                         architecture, operations, this document
.github/workflows/            CI and deploy automation
```

## 2.3 How routing works (this surprises people)

The **entire logged-in application is one Next.js route**: `app/platform/[[...slug]]/page.tsx`.

The URL is the single source of truth for what is on screen:

- `/platform/dashboard` → `slug = ["dashboard"]` → the Home view
- `/platform/admin/employees` → `slug = ["admin","employees"]` → Management → People → Employees

There is deliberately **no React state mirroring the URL** — that was a past source of bugs where
the address bar and the screen disagreed. If you refactor the frontend, preserve this property.

## 2.4 Why there are two backends

This is important and often misunderstood:

- **`supabase/functions/onework-api/`** is what production actually runs.
- **`backend/`** (FastAPI) is a *portable reference implementation* of the same API. It exists so
  the whole stack can run locally with Docker, and so the business rules have executable tests.

**They are supposed to behave identically.** When they disagree, production (the edge function)
wins.

**For your migration, the FastAPI backend is your most valuable asset** — not because you will
keep Python, but because it is the clearest, most readable statement of every business rule, and
it comes with 29 tests that encode the rules precisely. Read `backend/app/main.py` as your
specification. Port it to Express endpoint by endpoint.

⚠️ **Known gap:** the FastAPI backend does **not** implement `/api/v1/admin/content` (the Content
Library). That exists only in the edge function. Do not conclude the feature does not exist.

---

# PART 3 — GET IT RUNNING ON YOUR MACHINE

This section assumes you have never seen this project. Follow it top to bottom.

## 3.1 Install the prerequisites

You need four things. Check what you already have:

```bash
node --version && npm --version && python3 --version && git --version
```

| Tool | Minimum | If missing (macOS) | If missing (Windows) |
| --- | --- | --- | --- |
| Node.js | **22.13.0** | `brew install node` | download from nodejs.org |
| npm | 10+ | ships with Node | ships with Node |
| Python | 3.11 | `brew install python@3.11` | download from python.org |
| Git | any recent | `brew install git` | download from git-scm.com |

⚠️ **Node 22.13.0 is a hard minimum** — it is enforced in `package.json`. Node 20 will fail to
build. If you use `nvm`: `nvm install 22 && nvm use 22`.

## 3.2 Clone the repository

You will be given collaborator access to `workspace1xl-cmd/app-demo-trn`. Then:

```bash
git clone https://github.com/workspace1xl-cmd/app-demo-trn.git
```

```bash
cd app-demo-trn
```

If you are asked for a password, use a **GitHub personal access token**, not your account
password — GitHub removed password authentication for Git in 2021. Or install the GitHub CLI
(`gh auth login`), which handles it for you.

## 3.3 Start the backend (terminal 1)

```bash
cd backend && python3 -m venv .venv && .venv/bin/pip install -r requirements.txt
```

Then start it:

```bash
cd backend && .venv/bin/python -m uvicorn app.main:app --port 8000
```

The database (SQLite) creates and seeds itself on first start. You should see
`Uvicorn running on http://127.0.0.1:8000`.

Confirm it works — this should print JSON, not an error:

```bash
curl http://localhost:8000/health
```

## 3.4 Start the frontend (terminal 2 — leave terminal 1 running)

```bash
npm install
```

```bash
npm run dev
```

Open **http://localhost:3000/platform**.

## 3.5 Log in

The sign-in screen has three one-click buttons. Use them.

| Role | Email | Password |
| --- | --- | --- |
| Employee | `employee@company.com` | `Demo123!` |
| Manager | `manager@company.com` | `Manager123!` |
| Admin | `admin@company.com` | `Admin123!` |

**Sign in as Admin first** and click through the Management section. That is the fastest way to
understand what the product does.

## 3.6 Run the tests

⚠️ **Read this carefully — it will confuse you otherwise.**

Each test file sets the database path at import time, so the first file imported wins and the
rest inherit its database. **You must run the test files one at a time.** Running `pytest tests/`
in a single process produces 6 false failures.

This is what CI does, and this is the correct way:

```bash
cd backend && for f in tests/test_*.py; do .venv/bin/python -m pytest "$f" -q; done
```

You should see **29 passed** in total, across 13 separate runs. If you get 23 passed / 6 failed,
you ran them in one process — that is the known harness quirk, not a broken product.

## 3.7 Known local-environment gotchas

Four things that look like bugs but are not:

1. **`backend/onework.db` may be stale.** The committed SQLite file can predate a schema change,
   which makes the admin Feedback screen return a 500 locally. Fix: delete it and restart, or
   point somewhere fresh:
   ```bash
   cd backend && DATABASE_URL="sqlite:///./fresh.db" .venv/bin/python -m uvicorn app.main:app --port 8000
   ```
2. **Content Library 404s locally** — not implemented in the FastAPI backend (see 2.4).
3. **The local seed has no rules**, so Compliance looks empty locally. Production has 9.
4. **Rule statuses are `active` and `archived`.** There is no `published` status. Assuming
   otherwise has already caused one real bug.

---

# PART 4 — MOVE IT TO YOUR OWN GIT REPOSITORY

You asked to push into a fresh repository of your own. Here is exactly how, with the trade-offs.

## 4.1 Decide: keep history, or start clean?

| | Keep history (recommended) | Start clean |
| --- | --- | --- |
| You get | All 54 PRs, every commit, `git blame` works | One initial commit |
| You lose | nothing | **all context for why code is the way it is** |
| Use when | Normal handover | Legal/licensing requires a clean slate |

**Strongly prefer keeping history.** When you hit a line of code that looks wrong, `git log` will
usually tell you it was a deliberate fix for a specific bug. That context is worth a great deal.

## 4.2 Option 1 — Keep full history (recommended)

Create an **empty** repository on your GitHub (no README, no .gitignore, no licence — those cause
conflicts). Then:

```bash
git clone https://github.com/workspace1xl-cmd/app-demo-trn.git onework
```

```bash
cd onework && git remote rename origin upstream
```

```bash
cd onework && git remote add origin https://github.com/YOUR-ORG/YOUR-REPO.git
```

```bash
cd onework && git push -u origin main
```

You now have your own repo with the full history. `upstream` still points at the original, so you
can pull later fixes with `git fetch upstream && git merge upstream/main`.

## 4.3 Option 2 — Start clean (no history)

```bash
git clone https://github.com/workspace1xl-cmd/app-demo-trn.git onework && cd onework && rm -rf .git
```

```bash
cd onework && git init && git add . && git commit -m "Initial commit: OneWork Employee OS"
```

```bash
cd onework && git branch -M main && git remote add origin https://github.com/YOUR-ORG/YOUR-REPO.git && git push -u origin main
```

## 4.4 Do this immediately after pushing

**1. Rotate every secret.** Assume anything that was ever shared is compromised:
- Supabase database password and service-role key
- `JWT_SECRET`
- `ANTHROPIC_API_KEY`
- All three demo account passwords

**2. Check nothing secret is committed.** `.env.local` is gitignored, but verify:
```bash
git log --all --full-history -- .env.local .env
```
If that prints anything, a secret was committed at some point and **must** be rotated.

**3. Set up your own infrastructure** — your own Supabase (or Postgres) project and your own
Vercel project. Do not build on the handover project.

**4. Protect `main`.** Require a PR and passing CI. This repo has had 54 PRs and zero direct
pushes to main; keep that.

---

# PART 5 — THE DATA MODEL

30 tables. This is the heart of the product — understand it before changing anything.

## 5.1 The rule that governs everything: `org_id`

**Almost every table has an `org_id` column.** This is what makes the product multi-tenant. Two
customers' data live in the same tables, separated only by this column.

**Every query you ever write must be scoped by `org_id`.** In PostgreSQL today, the database
enforces this for you through Row-Level Security. If you move to MongoDB, **nothing enforces it
and it becomes entirely your responsibility.** See Part 9.2.

## 5.2 The tables, grouped by purpose

**Tenancy & identity**
| Table | Purpose |
| --- | --- |
| `organizations` | One row per customer company. The root of everything. |
| `departments` | Departments within an organisation |
| `app_users` | Every person. Holds `role` (employee/manager/admin), `department_id`, `manager_id` (self-referencing — this is the reporting line), `password_hash` |
| `sessions` | Active login sessions — `token_hash`, `expires_at` |

**Onboarding & pre-joining**
| Table | Purpose |
| --- | --- |
| `candidates` | Invited but not yet joined. Holds the unique `invite_token` |
| `preboarding_acknowledgments` | Candidate confirmed they read the pre-joining pack |
| `org_preboarding_content` | Per-org customisable welcome content |
| `onboarding_stages` | Ordered stages of the journey |
| `onboarding_stage_items` | Items within a stage (module / content / rules ack / task) |
| `employee_item_progress` | Which employee completed which item, and when |

**Learning & assessment**
| Table | Purpose |
| --- | --- |
| `training_modules` | The curriculum (22 seeded). Holds `passing_score`, `max_attempts`, `sequence` |
| `quiz_questions` | Questions, each with a **weight** — see Part 10 |
| `enrollments` | Which employee is assigned which module, its status and due date |
| `quiz_attempts` | Every attempt, with score and pass/fail |
| `certificates` | Issued on pass. Has a certificate number and expiry |
| `module_resources` | Videos/documents attached to a module |
| `content_assets` | The Content Library — uploaded or externally linked media |

**Rules & compliance**
| Table | Purpose |
| --- | --- |
| `rules` | A rule. `status` is `active` or `archived`. `is_mandatory`, optional `department_id` |
| `rule_versions` | Immutable versions of a rule's body. **Editing creates a new one** |
| `rule_reads` | Per-employee, per-**version** read receipts. New version ⇒ read status resets |
| `rule_change_suggestions` | Employee-proposed changes and the review decision |

**Knowledge & operations**
| Table | Purpose |
| --- | --- |
| `activities` | The Responsibility Matrix (22 rows): owner, backup, contact, SLA, escalations |
| `knowledge_chunks` | Indexed searchable content |
| `knowledge_feedback` | Unanswered questions and suggestions — the Feedback queue |
| `mistake_register` | Common mistakes, linked to training |
| `sop_documents` | Legacy; SOP content lives in the external SOPGalaxy system |

**Observability**
| Table | Purpose |
| --- | --- |
| `audit_events` | Who did what, when — the Activity Log |
| `notification_outbox` | Notifications with read state |
| `readiness_snapshots` | Daily readiness score capture — powers the Executive View trend |
| `import_jobs` | CSV import runs |

## 5.3 The relationships that matter most

```
organizations
  ├── departments
  ├── app_users ──── manager_id → app_users   (self-referencing reporting line)
  │     ├── enrollments → training_modules
  │     │     └── quiz_attempts → certificates
  │     ├── rule_reads → rule_versions → rules
  │     └── employee_item_progress → onboarding_stage_items → onboarding_stages
  ├── candidates → preboarding_acknowledgments
  ├── activities
  ├── rules → rule_versions
  │            └── rule_change_suggestions
  ├── knowledge_feedback
  └── audit_events
```

**`app_users.manager_id` is the reporting line, not `department_id`.** A manager's team is
everyone who rolls up to them directly or indirectly — which can span several departments. Do not
substitute "same department" for "my team"; that is a different and wrong answer.

---

# PART 6 — THE API CONTRACT (your Express rebuild specification)

79 endpoints. If your Express server implements these with the same request and response shapes,
the existing React frontend works unchanged.

## 6.1 How to read the contract precisely

Do not work from this table alone. For each endpoint, read the FastAPI handler — it is the
clearest statement of the logic:

```bash
grep -n "api/v1/dashboard" backend/app/main.py
```

Or browse the auto-generated interactive API docs with the backend running:
**http://localhost:8000/docs** — every endpoint, every field, and a "Try it out" button.
This is the single best way to learn the contract.

## 6.2 Authentication & tenancy

| Method | Path | Notes |
| --- | --- | --- |
| POST | `/api/v1/auth/login` | `{email, password, organization}` → `{access_token, user}` |
| POST | `/api/v1/organizations` | Self-signup; provisions a whole tenant |
| GET | `/api/v1/me` | Current user |
| GET | `/health` | Liveness |

## 6.3 Public / unauthenticated (candidate)

| Method | Path | Notes |
| --- | --- | --- |
| GET | `/api/v1/public/preview/{token}` | **The invite token IS the authorisation.** No session. |
| POST | `/api/v1/public/preview/{token}/acknowledge` | Candidate confirms |

⚠️ These are the only unauthenticated data endpoints. Treat `invite_token` as a credential: long,
random, single-purpose. Add expiry and one-time use when you harden auth (Part 7).

## 6.4 Employee

| Method | Path |
| --- | --- |
| GET | `/api/v1/dashboard` |
| GET | `/api/v1/onboarding/journey` |
| POST | `/api/v1/onboarding/journey/items/{item_id}/complete` |
| GET | `/api/v1/training/modules` |
| GET | `/api/v1/training/modules/{module_id}/quiz` |
| POST | `/api/v1/training/modules/{module_id}/attempt` |
| GET | `/api/v1/certificates` |
| GET | `/api/v1/rules` |
| POST | `/api/v1/rules/versions/{version_id}/read` |
| POST | `/api/v1/rules/{rule_id}/suggest` |
| GET | `/api/v1/rules/my-suggestions` |
| POST | `/api/v1/search` · GET `/api/v1/search/defaults` |
| GET | `/api/v1/activities` · GET `/api/v1/activities/{activity_id}` |
| GET | `/api/v1/mistakes` |
| POST | `/api/v1/feedback` |
| GET | `/api/v1/submissions/mine` · POST `/api/v1/submissions` |
| GET | `/api/v1/notifications` · POST `…/{id}/read` · POST `…/read-all` |

## 6.5 Manager

| Method | Path |
| --- | --- |
| GET | `/api/v1/manager/dashboard` |
| POST | `/api/v1/manager/nudge/{target_id}` |

## 6.6 Admin (all require the admin role — see Part 7.4)

**Analytics** — `GET /api/v1/admin/analytics`, `GET /api/v1/admin/exec`, `GET /api/v1/admin/audit`

**People** — employees (`GET`/`POST`/`PATCH {id}`, `POST /import`, `GET /lookup`),
departments (`GET`/`POST`/`PATCH {id}`), candidates (`GET`/`POST`)

**Learning** — training modules (`GET`/`POST`/`PATCH {id}`), questions
(`GET`/`POST`/`PATCH`/`DELETE`), enrollments (`GET`, `POST /assign`, `PATCH {id}`,
`POST {id}/reset-attempts`)

**Onboarding builder** — stages (`GET`/`POST`/`PATCH`/`DELETE`), stage items
(`POST`/`PATCH`/`DELETE`)

**Compliance** — rules (`GET`/`POST`/`PATCH {id}`, `POST {id}/versions`), rule suggestions
(`GET`/`PATCH {id}`)

**Feedback** — `GET /api/v1/admin/feedback`, `PATCH /api/v1/admin/feedback/{id}`

**Responsibilities** — activities (`POST`/`PATCH {id}`, `POST /import`)

**Org & content** — `GET`/`PATCH /api/v1/admin/organization`,
`GET`/`PATCH /api/v1/admin/preboarding-content`, mistakes (`GET`/`POST`/`PATCH`/`DELETE`),
content library (edge function only — see 2.4)

## 6.7 Response conventions you must copy exactly

- **Auth:** `Authorization: Bearer <token>`
- **Errors:** `{"detail": "Human readable message"}`. For field-level validation:
  `{"detail": "message", "field": "email"}` — the frontend uses `field` to highlight the input.
  Copy this or forms will silently stop showing inline errors.
- **Pagination:** `{"items": [...], "page": 1, "page_size": 20, "total": 57}`
- **Dates:** ISO 8601 strings
- **IDs:** UUID strings

---

# PART 7 — AUTHENTICATION: WHAT EXISTS, AND WHAT YOU MUST BUILD

This is your primary brief, so it is the most detailed part of this document.

## 7.1 What exists today — an honest assessment

**Production (Supabase Edge Function):**
- Password hashing: **bcrypt** via `pgcrypto` (`crypt(password, gen_salt('bf'))`) — ✅ genuinely fine
- Login: a Postgres function `authenticate_onework_user` verifies the password
- Session token: two concatenated UUIDs, **SHA-256 hashed before storage** in `sessions` — ✅ a
  stolen database dump does not yield usable tokens
- Expiry: 8 hours, server-side

**FastAPI reference:** PBKDF2-SHA256 (210,000 iterations) + HS256 JWT. Also fine cryptographically.

**Verdict: the cryptography is not the problem.** Password hashing is correct in both. What is
missing is everything *around* it that a commercial SaaS needs.

## 7.2 What is missing — your actual work list

| Missing | Why it matters | Priority |
| --- | --- | --- |
| **Password reset / forgot password** | No recovery path. A locked-out admin needs a developer. | 🔴 Blocker |
| **Email verification** | Anyone can sign up as any email and provision a tenant | 🔴 Blocker |
| **Rate limiting on login** | Unlimited password guesses | 🔴 Blocker |
| **Account lockout / backoff** | Same | 🔴 Blocker |
| **Refresh tokens** | 8h hard expiry: users are logged out mid-work, and there is no way to revoke early without deleting sessions | 🟠 High |
| **Session revocation UI** | Cannot "log out all devices" after a compromise | 🟠 High |
| **MFA / 2FA** | Enterprise buyers will ask. Some will require it. | 🟠 High |
| **Password policy** | Only a length check (≥8) today | 🟠 High |
| **Token in `sessionStorage`** | Readable by any JS on the page (XSS). Prefer httpOnly cookies. | 🟠 High |
| **Audit of auth events** | Failed logins, resets and lockouts are not recorded | 🟡 Medium |
| **SSO / SAML / OIDC** | Table stakes for enterprise deals | 🟡 Medium (revenue-driven) |
| **Invite-token expiry** | Candidate invite tokens never expire and are reusable | 🟡 Medium |

## 7.3 Recommended auth architecture for Express

**Do not write your own session framework.** Use proven libraries.

**Recommended stack:**

| Concern | Use | Why |
| --- | --- | --- |
| Password hashing | `argon2` (preferred) or `bcrypt` | Argon2id is the current OWASP recommendation |
| Tokens | Short-lived **access JWT** (15 min) + long-lived **refresh token** (30 days, rotating, stored hashed in `sessions`) | Revocable, and survives a stolen access token |
| Token transport | **httpOnly, Secure, SameSite=Lax cookies** | Not readable by JavaScript — kills the XSS token-theft path |
| Rate limiting | `express-rate-limit` + Redis | Per-IP *and* per-account |
| Validation | `zod` | Validate every request body at the boundary |
| Headers | `helmet` | Sensible security headers by default |
| MFA | `otplib` (TOTP) | Works with Google Authenticator/Authy |
| Email | Resend / SendGrid / SES | Verification and password reset |

**If you would rather not build it at all:** Auth0, Clerk, WorkOS or Supabase Auth will give you
password reset, MFA, SSO and email verification out of the box. **For a B2B SaaS this is usually
the right call** — WorkOS and Clerk in particular are built for organisation-based tenancy, which
is exactly this product's shape. Weigh a few hundred dollars a month against several engineer-weeks
plus the ongoing responsibility of owning authentication security.

## 7.4 The authorisation rules you must preserve exactly

Getting these wrong is a data breach, so implement them as middleware, not as per-route checks
you might forget.

**Rule 1 — Every request is scoped to one organisation.**
The token identifies a user; that user belongs to exactly one `org_id`. **Every** query must be
filtered by it. Never accept an `org_id` from the client — always take it from the verified token.

```js
// Express middleware sketch
function requireAuth(req, res, next) {
  const user = verifyToken(req);                       // from cookie or Bearer header
  if (!user) return res.status(401).json({ detail: "Not authenticated." });
  req.user  = user;
  req.orgId = user.org_id;   // ← the ONLY source of org_id. Never req.body.org_id.
  next();
}

function requireAdmin(req, res, next) {
  if (req.user.role !== "admin")
    return res.status(403).json({ detail: "Administrator permission required." });
  next();
}
```

**Rule 2 — Role gates are server-side.** The frontend hides the Management menu from non-admins,
but that is convenience, not security. Every `/api/v1/admin/*` route must independently verify the
admin role. There is a test for this (`test_employee_cannot_reach_admin_routes`) — keep it passing.

**Rule 3 — Department scoping is a real boundary.** A rule scoped to Finance must not be visible
to, or acknowledgeable by, someone outside Finance. Enforced server-side, with tests.

**Rule 4 — Cross-org access is impossible.** A user of org A must never read or write org B's
rows, even with a valid token and a guessed row ID. Tests:
`test_rule_read_org_isolation`, `test_organizations_stay_isolated_from_each_other`.

**Rule 5 — Manager scope follows `manager_id`, not department.** See 5.3.

## 7.5 Suggested implementation order

1. Port auth to Express with **argon2 + access/refresh JWTs in httpOnly cookies**
2. Add `requireAuth` / `requireAdmin` / `requireOrgScope` middleware and apply globally
3. Rate limiting and account lockout on login
4. Email verification and password reset (needs an email provider)
5. Session management UI ("log out all devices")
6. MFA (TOTP)
7. SSO (only when a customer is paying for it)

**After each step, run the 29 tests** (Part 3.6). They will catch a broken auth boundary
immediately.

---

# PART 8 — MAKING IT A REAL SAAS

The product is already multi-tenant. What it lacks is the commercial layer.

## 8.1 Already built ✅

- Multi-tenancy with `organizations` as the root
- Self-service signup that provisions a complete working tenant
  (`POST /api/v1/organizations`) — including departments, an admin user and seeded content
- Tenant isolation enforced in the database (RLS)
- Per-organisation configuration (e.g. default max quiz attempts)
- Role-based access control

## 8.2 What you need to add

**Billing & plans** — the biggest gap. New tables:

```
plans            id, name, price_monthly, max_employees, max_modules, features (jsonb)
subscriptions    org_id, plan_id, status, current_period_end, stripe_subscription_id
invoices         org_id, amount, status, stripe_invoice_id, issued_at
usage_records    org_id, metric, value, recorded_at
```

Use **Stripe Billing**. Do not build billing yourself — tax, dunning, proration and invoicing are
each their own product.

**Plan enforcement** — middleware that checks limits before a create:
```js
async function enforceSeatLimit(req, res, next) {
  const { count } = await countUsers(req.orgId);
  const plan = await getPlan(req.orgId);
  if (count >= plan.max_employees)
    return res.status(402).json({ detail: "Your plan's employee limit has been reached. Upgrade to add more people." });
  next();
}
```
Return **402 Payment Required** for limit breaches so the frontend can show an upgrade prompt
rather than a generic error.

**Trials and lifecycle** — `trial_ends_at` on the organisation; states: trialing → active →
past_due → cancelled. Decide *now* what happens to data on cancellation (recommended: read-only
for 30 days, then export, then delete) and write it into your terms.

**Onboarding funnel** — signup already provisions a tenant. Add: email verification, a guided
first-run checklist, sample data the admin can clear in one click, and an invite-your-team step.

**Operational must-haves before you charge anyone money**
| Need | Why |
| --- | --- |
| **Automated backups + a tested restore** | An untested backup is not a backup |
| Error tracking (Sentry) | You cannot fix what you cannot see |
| Uptime monitoring | Customers should not be your alerting |
| Structured logging with `org_id` | Debugging one tenant without reading everyone's logs |
| Data export per tenant | GDPR portability, and it wins deals |
| Hard delete on request | GDPR erasure |
| Status page | Reduces support load during incidents |

**Compliance** — if you sell to enterprises in Europe or handle employee data seriously, you will
meet GDPR (DPA, sub-processors, retention), and eventually SOC 2. Both are far cheaper to design
for now than to retrofit.

## 8.3 Multi-tenancy: keep this shape

The current model is **shared database, shared schema, `org_id` column, RLS enforcement**. This is
the right default: cheapest to run, easiest to migrate, scales to thousands of tenants.

Only consider a database per tenant if a specific enterprise contract demands physical isolation.
Do not do it pre-emptively — it multiplies your migration and operations burden by the number of
customers you have.

---

# PART 9 — MIGRATION STRATEGY

## 9.1 The golden rule

> **Migrate the backend. Do not touch the frontend.**

The frontend is ~9,100 lines of working, tested, recently-redesigned React. It is the part your
users see and the part most likely to break in subtle ways. Because everything funnels through
`request()` (Part 0.3), you can replace 100% of the backend without editing it.

## 9.2 If you migrate to MongoDB, read this first

The most dangerous thing you will lose is **Row-Level Security**.

Today, PostgreSQL refuses to return another organisation's rows even if your application code asks
for them. It is a second line of defence underneath your application logic. **MongoDB has no
equivalent.** After migrating, tenant isolation depends entirely on every query being written
correctly, forever, by every developer who ever joins your team.

If you go to MongoDB, you **must** compensate:

1. **Never** query a collection directly from a route handler.
2. Put a repository layer in front of the driver that takes `orgId` as a **required** argument and
   injects it into every filter. Make it impossible to call without one.
3. Add a CI check that fails the build if `db.collection(` appears outside that layer.
4. Write an automated cross-tenant test — seed two orgs, then assert every endpoint returns
   nothing for the other org's IDs. Run it on every PR.

Also expect to hand-implement, in application code, things Postgres does for you today: the
`rule_versions` → `rule_reads` cascade (editing a rule must invalidate every read receipt), unique
constraints, and the recursive `manager_id` query that resolves a manager's full team.

## 9.3 The safe path: strangler migration

Never do a big-bang cutover. Move endpoints a few at a time.

**Step 1 — Stand up Express next to the existing API.** New server, connected to the *same*
PostgreSQL database. It implements nothing yet.

**Step 2 — Proxy everything through it.** Express forwards every request to the existing API:
```js
app.use("/api", createProxyMiddleware({ target: process.env.LEGACY_API_URL, changeOrigin: true }));
```
Point `NEXT_PUBLIC_API_URL` at Express. **Nothing has changed behaviourally** — you now have a
seam you control.

**Step 3 — Take over endpoints one group at a time.** Implement a route natively in Express; it
stops being proxied. Start with the safest, most read-only group:

1. `/health`, `/api/v1/me` — trivial
2. `GET /api/v1/activities`, `/api/v1/mistakes` — read-only, simple shapes
3. `/api/v1/notifications` — simple writes
4. `/api/v1/dashboard`, `/api/v1/training/*`, `/api/v1/certificates`
5. `/api/v1/rules/*` — careful: versioning and read receipts
6. `/api/v1/admin/*` — the largest group
7. `/api/v1/auth/*` — **do this last**, and pair it with the Part 7 hardening

**Step 4 — Verify after every group.** Run the 29 tests. Click through all three roles. Compare
the JSON your endpoint returns against the old one — byte-for-byte where you can.

**Step 5 — Delete the proxy** once nothing is being forwarded.

At no point in this sequence is the product down, and at every point you can roll back by
re-enabling the proxy for that route.

## 9.4 If MongoDB is non-negotiable

Do it **after** Step 5 above, never at the same time as the language migration. Changing the
language and the database simultaneously means that when something breaks you will not know which
change caused it.

A hybrid that limits risk: keep PostgreSQL for the relational, security-critical core
(organisations, users, sessions, rules, versions, reads, enrollments, attempts, certificates,
audit) and use MongoDB for the genuinely document-shaped parts (content assets, knowledge chunks,
search indexes, notification payloads). You get MongoDB in the stack without betting tenant
isolation on it.

## 9.5 Realistic effort estimate

**This project was largely built by Claude Code, and it should be migrated by Claude Code.** The
estimates below are therefore in *agent working time*, not human developer time. If you are
hand-writing this, multiply by roughly 15–20×.

| Phase | Path A (Postgres + Express) | Path B (full MERN) |
| --- | --- | --- |
| Orientation + safety net (isolation test, golden files) | 1–2 hours | 1–2 hours |
| Express scaffold + proxy seam | ~1 hour | ~1 hour |
| Port 79 endpoints | 4–8 hours | 4–8 hours |
| Database migration to MongoDB | — | **1–3 days** |
| Reimplement RLS as application guards | — | **4–8 hours** |
| Auth hardening (Part 7) | 3–6 hours | 3–6 hours |
| SaaS billing layer (Part 8) | 3–6 hours | 3–6 hours |
| **Total agent working time** | **~1–2 days** | **~4–7 days** |

### What does *not* compress

Agent speed is real, but some things are bounded by the outside world, not by typing speed:

| Blocker | Why it takes calendar time |
| --- | --- |
| Stripe account + verification | Stripe reviews new accounts; can take days |
| Email provider + domain verification | DNS propagation, sender reputation |
| Your own Supabase/Vercel/DNS setup | Human accounts, human approvals |
| Reviewing what the agent built | You are accountable for this code |
| Staging soak before real customers | You want a few days of it running |
| Security review of the auth changes | Worth paying a human for |

**Realistic calendar estimate: 1–2 weeks**, most of which is waiting on external accounts and
reviewing, not building. The building is days.

**And the important caveat:** fast is not the same as safe. The staging in Part 9.3 and in
`docs/AGENT_PLAYBOOK.md` is not there because the work is slow — it is there because a
verification gate between phases is what stops a fast agent from confidently shipping a
cross-tenant data leak. Keep the gates; they cost minutes and they are the whole safety story.

---

# PART 10 — THE INVARIANTS YOU MUST NOT BREAK

These are hard-won business rules. Several were bugs found in QA and fixed deliberately. If your
rewrite quietly drops one, the product regresses in a way users will notice and you may not.

**Each rule below has a test. The test name is your proof it still works.**

| # | Invariant | Test |
| --- | --- | --- |
| 1 | An employee cannot reach any admin route | `test_employee_cannot_reach_admin_routes` |
| 2 | A locked module's quiz cannot be fetched **or** submitted — enforced server-side, not just hidden in the UI | `test_locked_module_quiz_and_attempt_are_rejected_server_side` |
| 3 | Per-question weights are really applied: missing one heavy question fails you even if you answered more questions correctly | `test_missing_the_heavy_question_fails_even_if_light_question_is_correct` |
| 4 | Missing only a light question still passes | `test_missing_only_the_light_question_still_passes` |
| 5 | The quiz shows each question's weight **before** you answer | `test_quiz_view_exposes_weight_percent_upfront` |
| 6 | Exhausting attempts blocks the next module **and** flags the manager | `test_exhausted_attempts_locks_next_module_and_surfaces_to_manager` |
| 7 | Editing a rule's **title alone** still creates a new version and clears everyone's read status | `test_editing_title_only_still_versions_and_clears_read_status` |
| 8 | A PATCH that omits `body` entirely does **not** create a version | `test_editing_metadata_without_body_field_does_not_version` |
| 9 | An employee cannot mark another organisation's rule as read | `test_rule_read_org_isolation` |
| 10 | Department-scoped rules are a real boundary, not a filter | `test_rules_department_scoping_is_a_real_boundary` |
| 11 | A resolved question becomes searchable by a **different** employee | `test_resolved_query_becomes_searchable_by_a_different_employee` |
| 12 | A question matching a known activity auto-routes to that department | `test_query_matching_a_known_activity_auto_routes_to_that_department` |
| 13 | Candidate preview shows the **real** mandatory rules (org-wide + department) | `test_candidate_preview_shows_real_mandatory_rules_org_wide_and_department` |
| 14 | Per-rule suggestions appear in My Submissions before **and** after a decision | `test_per_rule_suggestion_appears_in_my_submissions_before_and_after_decision` |
| 15 | Signup provisions a genuinely working tenant | `test_new_organization_signup_provisions_a_working_tenant` |
| 16 | Organisations stay isolated from each other | `test_organizations_stay_isolated_from_each_other` |
| 17 | Search "popular in your department" is department-scoped | `test_search_defaults_popular_in_department_is_scoped` |

**Additional rules that are real but have no dedicated test — be careful with these:**

- Onboarding stages unlock strictly in order; the journey screen disappears permanently once
  complete
- Readiness score = the average of only the components that currently *apply*. A component that
  does not apply (e.g. certificate currency for someone with no certificates) is **omitted**, not
  counted as 0%
- Rule statuses are `active` / `archived` — there is no `published`
- `null` readiness for a department means "no learning assigned", which is **not** the same as 0%
  and must not be displayed as 0%
- Never display an invented or estimated metric. If a number cannot be derived from real data,
  show nothing

## 10.1 Your definition of done for the migration

- [ ] All 29 backend tests pass (run per-file — Part 3.6)
- [ ] `npm run build` and `npm run lint` are clean
- [ ] Manually verified as Employee: login, onboarding journey, learning, quiz, certificate,
      rules, knowledge search, submissions
- [ ] Manually verified as Manager: My Team, readiness, overdue flags, blocked attempts, nudge
- [ ] Manually verified as Admin: all 13 Management screens load real data
- [ ] Cross-tenant test: a user of org A cannot read or write **any** org B row
- [ ] A non-admin deep-linking to `/platform/admin/*` is refused by the API and redirected
- [ ] Invite-token flow works for a candidate with no session

---

# PART 11 — DEPLOYMENT

## 11.1 How it deploys today

**Merging to `main` deploys to production.** Two independent things fire:

1. **Vercel** builds and deploys the frontend via its own native GitHub integration (not from CI)
2. **`.github/workflows/deploy.yml`** applies pending Supabase migrations, redeploys the edge
   function, and checks health

`.github/workflows/ci.yml` runs on every push and PR: lint, build, and the backend tests one file
at a time.

## 11.2 Recommended target architecture for your Express stack

| Piece | Option | Notes |
| --- | --- | --- |
| Frontend | Vercel | Already configured; keep it |
| Express API | Railway / Render / Fly.io | Simplest. AWS ECS if you have platform people |
| Database | Supabase, Neon or RDS | Keep managed Postgres and automated backups |
| Cache / rate limits | Upstash Redis | Needed for rate limiting |
| Files | S3 or Supabase Storage | Content Library uploads |
| Email | Resend / SendGrid | Verification and password reset |
| Errors | Sentry | Both frontend and API |

## 11.3 Environments

Run **three**: `development` (local), `staging` (a full deploy, real infrastructure, fake data),
`production`. Never test a migration for the first time in production.

## 11.4 Environment variables

```bash
# Frontend
NEXT_PUBLIC_API_URL=https://api.yourdomain.com

# Express API
DATABASE_URL=postgresql://...
JWT_ACCESS_SECRET=          # openssl rand -base64 48
JWT_REFRESH_SECRET=         # different from the above
REDIS_URL=
EMAIL_API_KEY=
STRIPE_SECRET_KEY=
STRIPE_WEBHOOK_SECRET=
ANTHROPIC_API_KEY=          # optional — enables AI answer synthesis
CORS_ORIGIN=https://app.yourdomain.com
```

**Never commit any of these.** Use your platform's secret manager. Rotate everything inherited
from the handover (Part 4.4).

---

# PART 12 — GLOSSARY & FAQ

## 12.1 Terms used in this codebase

| Term | Meaning |
| --- | --- |
| **Organisation / org / tenant** | One customer company. The isolation boundary. |
| **RLS** | Row-Level Security — Postgres refusing to return rows you should not see |
| **Readiness score** | 0–100 measure of how prepared a person/team/org is. ≥70 is "on track" |
| **Responsibility matrix / RACI** | The table of who owns which activity |
| **Enrollment** | The link between an employee and a training module |
| **Attempt** | One submission of a module's quiz |
| **Rule version** | An immutable snapshot of a rule's text; editing creates a new one |
| **Read receipt** | A record that employee X read rule version Y |
| **Journey / stage / item** | The stage-gated onboarding flow |
| **Candidate** | An invited person who has not yet joined |
| **Feedback queue** | Unanswered questions and suggestions awaiting admin action |
| **Activity Log** | The audit trail (`audit_events`) |
| **SOPGalaxy** | An **external** system that owns SOP documents. OneWork only stores links. |

## 12.2 FAQ

**Q: Can we just rewrite it from scratch? It might be faster.**
No. There are ~1,900 lines of SQL schema, 79 endpoints and 17 tested business rules that took a
full QA cycle to get right. A rewrite would rediscover those bugs one customer complaint at a
time. Migrate the backend layer by layer (Part 9.3).

**Q: Do we have to keep Next.js? Can we use plain React + Vite?**
You can, but there is no benefit. Next.js is doing useful work (routing, build, Vercel deploy) and
the app is only two routes. Spend the time on auth and billing instead.

**Q: Why is the whole app one route with a catch-all slug?**
So the URL is the single source of truth for what is displayed. It removed a class of bug where
the address bar and the visible screen disagreed. Keep this property.

**Q: The tests fail when I run them all at once.**
Expected. Run them one file at a time — Part 3.6.

**Q: Can we drop the FastAPI backend?**
Eventually, yes — it is a reference implementation, not production. But keep it until your Express
API passes all 29 tests. Until then it is your executable specification.

**Q: Where do I start on day one?**
Part 3 (get it running), then sign in as Admin and click every screen. Then read
`backend/app/main.py` top to bottom — it is the whole product in one readable file.

**Q: What is the single biggest risk in this project?**
Losing tenant isolation. Everything else is a bug; that one is a breach. Whatever else you do,
build the cross-tenant test in Part 10.1 early and run it on every pull request.

---

## Appendix — Reference documents in this repository

| Document | Contents |
| --- | --- |
| `docs/HANDOFF.md` | Delivery status, live links, demo credentials, walkthrough order |
| `docs/MANAGEMENT_IA_MAP.md` | Admin route → label map; what each management screen calls |
| `docs/ARCHITECTURE.md` | Original architecture notes |
| `docs/OPERATIONS.md` | Deploy secrets and operational runbook |
| `docs/UI_UX_INTEGRATION.md` | Frontend/API integration contract |
| `backend/app/main.py` | **The most useful file in the repository** — every endpoint, readable |
| `backend/tests/` | 29 tests = the executable specification of the business rules |
| `supabase/migrations/` | The real database schema, in order |
