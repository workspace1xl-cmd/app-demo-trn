# Management Navigation — Route Safety Map

_Created during the management-first IA refactor. This is the safety check required before
changing any navigation: every capability that existed before the refactor must have a
reachable location after it._

## How this app routes

There is exactly **one** Next.js route for the whole platform:

```
app/platform/[[...slug]]/page.tsx   →  PlatformApp.tsx
```

The URL is the single source of truth. `slug[0]` selects a `View`, and when that view is
`admin`, `slug[1]` selects an `AdminSection`. **No route changed in this refactor.** Only
the visible labels, grouping, icons and the Overview screen changed.

## Management area — 13 admin sections, all preserved

| Visible label (new)                | URL (unchanged)                | Component (unchanged) | Data source (unchanged)                |
| ---------------------------------- | ------------------------------ | --------------------- | -------------------------------------- |
| Management → Overview              | `/platform/admin/overview`     | `ManagementOverview`  | `GET /api/v1/admin/analytics` + reads below |
| Management → Overview → Executive View | `/platform/admin/exec`     | `ExecPanel`           | `GET /api/v1/admin/exec`               |
| Management → People → Employees    | `/platform/admin/employees`    | `EmployeesPanel`      | `GET /api/v1/admin/employees`          |
| Management → People → Departments  | `/platform/admin/departments`  | `DepartmentsPanel`    | `GET /api/v1/admin/departments`        |
| Management → People → Candidates   | `/platform/admin/candidates`   | `CandidatesPanel`     | `GET /api/v1/admin/candidates`         |
| Management → Learning → Training & Quiz Builder | `/platform/admin/training`   | `TrainingPanel`     | `GET /api/v1/admin/training/modules` |
| Management → Learning → Assignments | `/platform/admin/assignments` | `AssignmentsPanel`    | `GET /api/v1/admin/enrollments`        |
| Management → Learning → Content Library | `/platform/admin/content` | `ContentSection`      | `GET /api/v1/admin/content`            |
| Management → Learning → Onboarding Journey | `/platform/admin/journey` | `OnboardingJourneyPanel` | `GET /api/v1/admin/onboarding-stages` |
| Management → Responsibilities      | `/platform/admin/matrix`       | `MatrixPanel`         | `GET /api/v1/activities`               |
| Management → Compliance            | `/platform/admin/rules`        | `RulesPanel`          | `GET /api/v1/admin/rules`, `…/rule-suggestions` |
| Management → Feedback              | `/platform/admin/feedback`     | `FeedbackPanel`       | `GET /api/v1/feedback`, `…/submissions` |
| Management → Activity Log          | `/platform/admin/audit`        | `AuditPanel`          | `GET /api/v1/admin/audit`              |

`AdminConsole`'s `switch (section)` dispatch is **byte-for-byte unchanged** — the same 12
panels are reached by the same 12 `AdminSection` ids. `overview` is the 13th and is still
rendered by `PlatformApp` (not `AdminConsole`), exactly as before.

## Label transformations (display only — no identifier renamed)

| Internal id (unchanged) | Old visible label     | New visible label   |
| ----------------------- | --------------------- | ------------------- |
| view `admin`            | Admin analytics       | Management          |
| group `insights`        | Insights              | Overview            |
| section `exec`          | Exec View             | Executive View (inside Overview) |
| group `governance`      | Governance            | *(split — see below)* |
| section `rules`         | Rules & Regulations   | Compliance          |
| section `feedback`      | Feedback Queue        | Feedback            |
| section `audit`         | Audit Log             | Activity Log        |
| group `ownership`       | Ownership             | Responsibilities    |

The old `Governance` group bundled Rules + Feedback + Audit behind one word management
didn't recognise. It is now three separate top-level management concepts, which is the
specific change the brief asked for.

## Employee / Manager views — untouched

| Visible label          | URL                       | Role gate                        |
| ---------------------- | ------------------------- | -------------------------------- |
| Home                   | `/platform/dashboard`     | all                              |
| Knowledge              | `/platform/search`        | all                              |
| My Learning            | `/platform/training`      | all                              |
| Who does what          | `/platform/matrix`        | all                              |
| Responsibility graph   | `/platform/graph`         | all                              |
| Certificates           | `/platform/certificates`  | all                              |
| Rules & Regulations    | `/platform/rules`         | all                              |
| My Submissions         | `/platform/submissions`   | all                              |
| My Team                | `/platform/manager`       | manager + admin                  |
| Management             | `/platform/admin/*`       | admin only                       |
| SOP repository ↗       | external (SOPGalaxy)      | all                              |

## Authorisation — unchanged, still server-side

* Every `/api/v1/admin/*` endpoint is guarded by the FastAPI `admin_user` dependency.
  The navigation refactor did not touch a single endpoint or dependency.
* The client-side sidebar gate (`session.user.role === "admin"`) is a *convenience*, not
  the security boundary — it was that way before and still is.
* The deep-link guard in `login()` (a non-admin following a `/platform/admin/*` link is
  redirected to their own default) is unchanged.

## Overview screen — every number traced to a real source

No metric on the new Management Overview is invented. Each one:

| Displayed                          | Derived from                                                        |
| ---------------------------------- | ------------------------------------------------------------------- |
| Employees                          | `analytics.employees`                                                |
| Organisation readiness             | `analytics.readiness.score` (+ its real component breakdown)         |
| Training completion                | `analytics.training_completion`                                      |
| Open feedback                      | `analytics.open_feedback`                                            |
| Certificates issued                | `analytics.certificates`                                             |
| Candidates in pipeline             | `admin/candidates` filtered to status ≠ `joined`                     |
| Unassigned responsibilities        | `activities` where `current_person === "Organisation to confirm"`    |
| Suggested changes awaiting review  | `admin/rule-suggestions?status=submitted`                            |
| Workforce by department            | `admin/exec` → `departments[]` (`employee_count`, `readiness_score`, `ownership_coverage`) |
| Compliance: rules published/draft/mandatory | `admin/rules` (`status`, `is_mandatory`)                    |

**Deliberately not shown:** an organisation-wide "rule acknowledgement %". Per-employee
rule reads exist, but no admin endpoint aggregates them, and the brief forbids inventing
a number. Adding that aggregate would be a backend change, which this UX-only pass
explicitly avoids.
