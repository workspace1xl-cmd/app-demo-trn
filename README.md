# OneWork Employee OS

OneWork is a working, multi-tenant employee onboarding, training and organisational knowledge platform. The repository contains the management presentation, employee and administrator application, cloud API, PostgreSQL schema, seed content, tests and a portable local stack.

## Live links

- Management presentation: https://onework-employee-os-demo.vercel.app
- Working application: https://onework-employee-os-demo.vercel.app/platform
- Cloud API health: https://bnzcjjdhfsdedwljdmjl.supabase.co/functions/v1/onework-api/health
- Source: https://github.com/workspace1xl-cmd/app-demo-trn
- Reusable presentation branch: `codex/ui-ux-demo`

Demo accounts:

| Role | Email | Password |
| --- | --- | --- |
| Employee | `employee@company.com` | `Demo123!` |
| Manager | `manager@company.com` | `Manager123!` |
| Administrator | `admin@company.com` | `Admin123!` |

These are demonstration credentials only. Replace seeded users and credentials before a real organisation pilot.

## What works now

- Database-backed employee, manager and administrator login with expiring server-side sessions
- Tenant-scoped dashboard and role-based navigation
- Complete 22-module induction curriculum with sequential unlocking
- Quiz submission, scoring, attempts, progress updates and certificate issuance
- Verified knowledge search across responsibility records and training, optionally synthesised
  by Claude and grounded only in retrieved organisational context — plus a persistent
  AI assistant available from every screen
- Department responsibility matrix (RACI) with owner, backup, channel, SLA and escalation,
  and a live force-directed responsibility graph built from that same data
- A transparent, component-by-component readiness score (training completion, certificate
  currency, named-ownership coverage) at the individual, team and org level — never a black box
- Manager dashboard: team readiness, per-member training/overdue status, team-scoped
  responsibility graph
- Executive/org health view: readiness trend over time, department-by-department comparison,
  and an ownership-gap callout naming which departments lack a real owner
- In-app notification centre for overdue training and upcoming certificate expiry, backed by
  the same `pg_cron` job that also drives outbound email reminders
- Milestone and streak recognition on real completion data (no separate points/events system)
- SOP documents themselves live in SOPGalaxy, not here — OneWork keeps only a plain link on
  each responsibility record; there is deliberately no in-app SOP repository or workflow
- Unresolved-question feedback queue and audit events
- Administrator analytics across users, learning, certificates and ownership
- Responsive management blueprint and working application deployed on Vercel

## Known limitations (read before a live demo)

- **Manager Dashboard is department-scoped, not a real reporting hierarchy.** "My team" means
  "everyone in my department", not "everyone who reports to me" — there is no `manager_id`
  relationship yet. A manager sharing a department with other managers will see people who
  don't actually report to them.
- **Quiz questions are templated, one per module**, with the correct answer always in the same
  position. They demonstrate the assessment *mechanism*, not real compliance content.
- **Demo seed data is intentionally sparse.** Depending on when it was last reseeded, RACI rows
  may show no named owner, the readiness trend may have only a few days of history, and the
  notification bell may be empty — all of these are honestly computed from real (thin) data,
  not bugs, but they can make a fresh demo look emptier than the product actually is.
- **Search is keyword (`ILIKE`) matching, not semantic.** The `pgvector` column and index exist
  and are ready for real embeddings, but nothing populates or queries them yet — a search that
  doesn't share a keyword with the source record won't find it even if it's conceptually close.
- **The floating AI assistant is single-turn retrieval, not a stateful chat.** Each message is
  answered independently by the same grounded search the Knowledge search screen uses; it does
  not carry conversational memory between turns beyond what's shown on screen.

## Architecture

```text
Vercel / Next.js
  ├─ /            management blueprint and prototype
  └─ /platform    authenticated employee/admin application
         │ HTTPS + opaque bearer session
         ▼
Supabase Edge Function: onework-api
         │ service-role access; API enforces tenant scope
         ▼
Supabase PostgreSQL
  ├─ users, sessions and departments
  ├─ activities (RACI/ownership; sop_link points out to SOPGalaxy, no SOP content lives here)
  ├─ modules, quizzes, enrollments and certificates
  ├─ readiness_snapshots (daily org readiness history) and notification_outbox
  ├─ knowledge chunks (pgvector-ready, not yet wired into search — see Known limitations)
  └─ feedback and audit events
         │ optional
         └─ Claude Messages API for grounded answer synthesis (search + AI assistant)
```

Direct browser access to application tables is denied by row-level-security policies. The Edge Function authenticates every protected request and applies the signed-in user's `org_id` to every query.

## Local start

Frontend only, connected to the deployed cloud API:

```bash
npm install
cp .env.example .env.local
npm run dev
```

Full portable stack with PostgreSQL, FastAPI, Next.js and n8n:

```bash
cp .env.example .env
docker compose up --build
```

Open:

- Web: http://localhost:3000
- API docs: http://localhost:8000/docs
- n8n: http://localhost:5678

## Configuration

For the current Supabase + Vercel deployment, the application is fully usable without another vendor account. The only optional application secret requested from management is:

```env
ANTHROPIC_API_KEY=your-claude-api-key
```

Set it as a Supabase Edge Function secret, never in frontend code or Git. Without it, deterministic verified retrieval remains active; with it, Claude converts the same retrieved evidence into a natural-language response. See [operations](docs/OPERATIONS.md).

## Verification

```bash
make test
```

This runs backend API tests and the production Next.js build. Live browser QA also covers employee login, knowledge retrieval, curriculum loading, assessment submission, certificate issuance and administrator analytics.

## Documentation

- [System architecture](docs/ARCHITECTURE.md)
- [Cloud operations and Claude setup](docs/OPERATIONS.md)
- [UI/UX integration guide](docs/UI_UX_INTEGRATION.md)
- [Delivery handoff](docs/HANDOFF.md)

## Important production controls

Before onboarding real employees: replace demo credentials, connect enterprise SSO, configure an approved email provider if outbound email is required, load approved organisation content, run privacy/security review, define retention rules and assign named content owners. Those are governance decisions, not blockers for this working management pilot.
