# Delivery handoff

## Management demonstration order

1. Open the [management blueprint](https://onework-employee-os-demo.vercel.app) and use its navigation to show the complete scope: plan, curriculum, mistakes, responsibility matrix, architecture, prototype, assessments, roadmap and scale.
2. Select **Open working platform**.
3. Sign in as the employee and show the live dashboard, including the readiness score breakdown.
4. Ask “Who do I ask about leave?” via the floating AI assistant or Knowledge search to demonstrate verified organisational knowledge, grounded in the RACI data — not a document, a named owner.
5. Open **Who does what** and **Responsibility graph** to show operational ownership; SOP documents themselves live in SOPGalaxy — each activity carries only a link out to it.
6. Open **My learning**, complete the active assessment and show the generated certificate.
7. Sign in as manager and show **My team**: team readiness, per-member training/overdue, team-scoped responsibility graph.
8. Sign in as administrator and show organisation analytics, then **Exec View** for the readiness trend and department comparison.

## Delivered scope

| Management expectation | Delivered location |
| --- | --- |
| Detailed project plan | Management blueprint → Delivery plan |
| Complete training curriculum | Blueprint → Curriculum; live 22-module learning path |
| Common employee mistakes | Blueprint → Mistake register |
| Responsibility matrix + live ownership graph | Blueprint and live **Who does what** / **Responsibility graph** |
| SOP linkage | Each activity links out to SOPGalaxy; no SOP content or workflow is owned here |
| Manager and executive views | Live **My team** (manager) and **Exec View** (admin) |
| Architecture and workflow | Blueprint → Architecture; `docs/ARCHITECTURE.md` |
| UI/UX prototype | `/` and `/platform`; reusable UI branch |
| Training and assessment structure | Live learning, quiz attempts and certificates |
| Implementation roadmap | Blueprint → Roadmap |
| Future scalability | Blueprint → Scale; architecture scale path |

## Repository map

```text
app/                         Next.js management and live platform UI
backend/                     portable FastAPI implementation and tests
supabase/migrations/         cloud database schema, security and seed data
supabase/functions/          deployed cloud API source
n8n/workflows/               importable automation templates
infra/postgres/              local PostgreSQL bootstrap
docs/                        architecture, operations and UI integration
docker-compose.yml           one-command portable stack
```

## Remaining organisation inputs

The software is working. A real employee rollout still needs organisation-owned facts: approved policies/SOP text, named role holders, real support channels and SLAs, employee roster/SSO configuration, and management's Claude key if natural-language synthesis is required. Do not put any secret into Git.
