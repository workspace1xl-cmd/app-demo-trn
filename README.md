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
| Administrator | `admin@company.com` | `Admin123!` |

These are demonstration credentials only. Replace seeded users and credentials before a real organisation pilot.

## What works now

- Database-backed employee and administrator login with expiring server-side sessions
- Tenant-scoped dashboard and role-based navigation
- Complete 22-module induction curriculum with sequential unlocking
- Quiz submission, scoring, attempts, progress updates and certificate issuance
- Verified knowledge search across responsibility records, SOPs and training
- Optional Claude synthesis that answers only from retrieved organisational context
- Department responsibility matrix with owners, backup, channel, SLA and escalation
- Ten controlled SOP records with owners, approvers, versions and review dates
- Unresolved-question feedback queue and audit events
- Administrator analytics across users, learning, certificates, ownership and SOPs
- Responsive management blueprint and working application deployed on Vercel

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
  ├─ activities and controlled SOPs
  ├─ modules, quizzes, enrollments and certificates
  ├─ knowledge chunks (pgvector-ready)
  └─ feedback and audit events
         │ optional
         └─ Claude Messages API for grounded answer synthesis
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
