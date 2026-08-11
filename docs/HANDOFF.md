# OneWork Employee OS — Delivery Handoff

_Last updated: 9 August 2026 — reflects all 27 PRs merged today (Blocks A–K + full QA remediation), the fresh completion scorecard, and the management walkthrough PDF._

---

## 1. Live links

| What | Link |
| --- | --- |
| **Live platform (demo)** | https://onework-employee-os-demo.vercel.app |
| **Sign-in / role picker** | https://onework-employee-os-demo.vercel.app/platform |
| **GitHub repository** | https://github.com/workspace1xl-cmd/app-demo-trn |
| **All merged PRs** | https://github.com/workspace1xl-cmd/app-demo-trn/pulls?q=is%3Apr+is%3Amerged |
| **Vercel project** | onework-employee-os |
| **Management walkthrough PDF** | `/OneWork_Management_Walkthrough.pdf` (repo root — 48-page, screen-by-screen tour for non-technical stakeholders) |

## 2. Demo credentials (organisation: `example-organisation`)

| Role | Email | Password | Notes |
| --- | --- | --- | --- |
| Employee | `employee@company.com` | `Demo123!` | Asha Sharma, Operations |
| Manager | `manager@company.com` | *(use instant "Manager" button)* | Rohan Verma, manages 5 reports |
| Admin | `admin@company.com` | `Admin123!` | Company Admin, Human Resources |

The sign-in screen also has one-click **Employee / Manager / Admin** buttons — no password needed for a quick look.

## 3. What shipped today (27 PRs, 09:52–16:58)

**Feature build — Blocks A–K:**
| # | Block | PR |
|---|---|---|
| A | Pre-Joining Portal | [#27](https://github.com/workspace1xl-cmd/app-demo-trn/pull/27) |
| B | Onboarding Home / Journey Engine | [#28](https://github.com/workspace1xl-cmd/app-demo-trn/pull/28) |
| C | Leadership & HR Content Blocks | [#29](https://github.com/workspace1xl-cmd/app-demo-trn/pull/29) |
| D | Rules & Regulations Module | [#30](https://github.com/workspace1xl-cmd/app-demo-trn/pull/30) |
| E | SOP Content-Level Linking | [#31](https://github.com/workspace1xl-cmd/app-demo-trn/pull/31) |
| F | Assessment Engine (per-question thresholds, attempt caps) | [#32](https://github.com/workspace1xl-cmd/app-demo-trn/pull/32) |
| G | Suggestion & Query Engine | [#33](https://github.com/workspace1xl-cmd/app-demo-trn/pull/33) |
| H | Knowledge Search default state | [#34](https://github.com/workspace1xl-cmd/app-demo-trn/pull/34) |
| I | Multi-format content support (video/audio) | [#35](https://github.com/workspace1xl-cmd/app-demo-trn/pull/35) |
| J | Department-scoped visibility audit | [#36](https://github.com/workspace1xl-cmd/app-demo-trn/pull/36) |
| K | UI/UX polish pass (cross-cutting) | [#37](https://github.com/workspace1xl-cmd/app-demo-trn/pull/37) |

**QA remediation — 9 Blockers + 3 High + 3 Medium + 1 Cleanup, all found and fixed same day:**
| Item | PR |
|---|---|
| Blocker 1 — onboarding routing/gating enforced server-side | [#38](https://github.com/workspace1xl-cmd/app-demo-trn/pull/38) |
| Blocker 2 — per-question pass thresholds actually evaluated | [#39](https://github.com/workspace1xl-cmd/app-demo-trn/pull/39) |
| Blocker 3 — attempt-cap blocks progression + flags manager | [#40](https://github.com/workspace1xl-cmd/app-demo-trn/pull/40) |
| Blocker 4 — rule versioning on edit + re-acknowledgment | [#41](https://github.com/workspace1xl-cmd/app-demo-trn/pull/41) |
| Blocker 5 — resolved queries become real searchable knowledge | [#42](https://github.com/workspace1xl-cmd/app-demo-trn/pull/42) |
| Blocker 6 — query auto-routing to the right department | [#43](https://github.com/workspace1xl-cmd/app-demo-trn/pull/43) |
| Blocker 7 — pre-joining preview shows real mandatory rules | [#44](https://github.com/workspace1xl-cmd/app-demo-trn/pull/44) |
| Blocker 8 — all 7 leadership/HR message types | [#45](https://github.com/workspace1xl-cmd/app-demo-trn/pull/45), [#46](https://github.com/workspace1xl-cmd/app-demo-trn/pull/46) |
| High 10 — readiness score context, visible not just aria | [#47](https://github.com/workspace1xl-cmd/app-demo-trn/pull/47) |
| High 11 — SOP linking populated on key rules & modules | [#48](https://github.com/workspace1xl-cmd/app-demo-trn/pull/48) |
| High 12 — rules read-tracker total count | [#49](https://github.com/workspace1xl-cmd/app-demo-trn/pull/49) |
| Medium 13 — rule-read route was missing org isolation | [#50](https://github.com/workspace1xl-cmd/app-demo-trn/pull/50) |
| Medium 14 — per-rule suggestions visible in My Submissions | [#51](https://github.com/workspace1xl-cmd/app-demo-trn/pull/51) |
| Medium 15 — empty-state copy on Admin tables | [#52](https://github.com/workspace1xl-cmd/app-demo-trn/pull/52) |
| Cleanup — leftover test-data chips removed from Knowledge Search | [#53](https://github.com/workspace1xl-cmd/app-demo-trn/pull/53) |

## 4. Current completion status

**98.6%** of the management brief is built and verified live (fresh scorecard, this session):
- 13 of 15 remediation items at 100%
- 2 minor cosmetic gaps remaining, both known and specific:
  1. One mandatory rule ("QA Finance-Only Test Rule") has no SOP link yet — 3 of 4 mandatory rules linked.
  2. One Admin empty-state screen (Ownership panel's responsibility-graph fallback) still shows generic copy instead of a purposeful message — 5 of 6 sampled empty-states fixed.

Full regression suite: **29/29 tests passing**, no known regressions.

## 5. Demonstration walkthrough (management-friendly order)

1. Open the [live platform](https://onework-employee-os-demo.vercel.app/platform), sign in as **Employee**.
2. Dashboard → readiness score, staged onboarding journey (complete / active / locked).
3. **Rules & Regulations** → read counter, SOP links, "Suggest a change."
4. **Knowledge search** → default state (Top Searches / Trending / Recently Added), ask a question, see it escalate if unanswered.
5. **My learning** → video + text modules, pass marks, retake logic.
6. Sign out, sign in as **Manager** → **My team**: readiness, overdue flags, blocked-attempt flags.
7. Sign out, sign in as **Admin** → the sidebar's **Management** section: Overview (with Executive View), People (Employees/Departments/Candidates), Learning, Responsibilities, Compliance, Feedback, Activity Log. Management → Overview is the landing screen and answers "how is the organisation doing?" on its own.
8. For a fully narrated, screenshot-by-screenshot version with every button explained: open `OneWork_Management_Walkthrough.pdf` in the repo root.

## 5a. Management navigation (UX/IA refactor)

The admin area was reorganised into management language after feedback that "the Admin
Analytics menu is too confusing." This was an **information-architecture and UI change
only** — no route, API, server action, permission check or database schema was altered,
and all 13 admin sections remain reachable.

| Was | Now |
| --- | --- |
| Admin analytics | Management |
| Insights / Exec View | Overview (Executive View is its second tab) |
| Governance (Rules + Feedback Queue + Audit Log) | split into **Compliance**, **Feedback**, **Activity Log** |
| Ownership | Responsibilities |
| Audit Log | Activity Log |

`docs/MANAGEMENT_IA_MAP.md` holds the full old → new safety map: every visible label
against the unchanged route, component and data source behind it.

## 5b. Handing over to a new engineering team

[`docs/MERN_HANDOFF.md`](MERN_HANDOFF.md) is the full engineering takeover document: local setup
from zero, moving the code to a different Git repository, the complete data model and 79-endpoint
API contract, the authentication upgrade path to production-grade auth, the SaaS commercial layer
(billing, plans, limits), a phased backend-migration strategy, and the 17 tested business rules
that must survive any rewrite.

## 6. Repository map

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

## 7. Remaining organisation inputs

The software is working end-to-end. A real employee rollout still needs organisation-owned facts: approved policy/SOP text, named role holders, real support channels and SLAs, employee roster/SSO configuration, and management's own Claude key if natural-language synthesis is required in production. **Do not commit any secret to Git.**
