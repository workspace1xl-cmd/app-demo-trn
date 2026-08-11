# CLAUDE.md — read this before changing anything

You are working on **OneWork Employee OS**: a live, multi-tenant, production SaaS used by real
companies to onboard and train employees. It works today. It has paying-customer-shaped data in
it. **Your default assumption is that existing code is correct and deliberate.**

Most of what looks odd here is a deliberate fix for a real bug. Check `git log` on a line before
"improving" it.

---

## 1. Hard rules — never violate these

1. **Never invent a number shown to a user.** Every metric on screen must come from a real
   endpoint or a deterministic count of real rows. If it can't be derived, show nothing. Do not
   estimate, project, or fill a gap with a plausible value.
2. **Never remove `org_id` scoping from a query.** Every row belongs to one customer company.
   `org_id` always comes from the verified auth token — **never** from the request body, query
   string, or URL. One missing filter leaks one company's employee records to another.
3. **Never trust the frontend for authorisation.** The UI hides things for convenience. Every
   `/api/v1/admin/*` route must independently verify the admin role server-side.
4. **Never change a database schema to make UI work easier.** Schema changes need a migration and
   a deliberate decision. If you think you need one, stop and say so.
5. **Never delete or rewrite a passing test to make your change pass.** The test is the
   specification. If your change breaks a test, your change is wrong until proven otherwise.
6. **Never modify `supabase/migrations/*.sql` that already exist.** They have run in production.
   Add a new migration instead.
7. **Never commit a secret.** No keys, tokens, passwords, or connection strings in code.
8. **Never do a "big bang" rewrite.** Change one layer at a time, verify, then continue.

## 2. What this is, architecturally

```
React 19 / Next.js 16  (app/)          ← the frontend. Works. Leave it alone unless asked.
        │  every call goes through request() in app/platform/PlatformApp.tsx
        │  which reads ONE env var: NEXT_PUBLIC_API_URL
        ▼
API  ── production: supabase/functions/onework-api  (Deno/TypeScript)
    └── reference:  backend/  (FastAPI/Python) + 29 tests
        ▼
PostgreSQL — 30 tables, row-level security on all of them, bcrypt passwords
```

**The whole logged-in app is one Next.js route**: `app/platform/[[...slug]]/page.tsx`. The URL is
the single source of truth for what's on screen — there is deliberately no React state mirroring
it. Preserve that.

**Both backends implement the same 79 endpoints.** When they disagree, production (the edge
function) is correct. The FastAPI backend is the readable specification — `backend/app/main.py`
is the best file in the repo for understanding any endpoint.

## 3. Traps that will waste your time

| Symptom | Cause | Fix |
| --- | --- | --- |
| 6 tests fail | You ran the suite in one process. Each test file sets `DATABASE_URL` at import, so the first one wins. | Run **one file at a time** — see §4 |
| Admin Feedback screen 500s locally | `backend/onework.db` is stale, predates a column | `rm backend/onework.db` and restart |
| Content Library 404s locally | `/api/v1/admin/content` exists only in the edge function, not FastAPI | Not a bug. Don't "fix" it. |
| Compliance screen empty locally | Local seed has no rules. Production has 9. | Not a bug |
| Rule status `published` returns 0 | Statuses are **`active`** and **`archived`**. There is no `published`. | Use the real values |

## 4. Verify every change — these exact commands

**Backend tests (29 must pass — run one file at a time):**
```bash
cd backend && for f in tests/test_*.py; do .venv/bin/python -m pytest "$f" -q; done
```

**Frontend:**
```bash
npm run lint && npm run build
```

**Run it locally** (two terminals):
```bash
cd backend && .venv/bin/python -m uvicorn app.main:app --port 8000
```
```bash
npm run dev
```
Then http://localhost:3000/platform — sign in with the one-click Employee / Manager / Admin
buttons.

## 5. Definition of done for any change

- [ ] 29/29 backend tests pass
- [ ] `npm run lint` and `npm run build` clean
- [ ] Signed in as **Employee** and confirmed their screens still work
- [ ] Signed in as **Manager** and confirmed My Team still works
- [ ] Signed in as **Admin** and confirmed the Management screens still load real data
- [ ] No schema change (or: a new migration file, explicitly flagged to the user)
- [ ] Reported honestly what you did **and** what you did not verify

## 6. Business rules with tests — breaking one is a regression

Each of these is enforced server-side and has a test proving it. If you touch the related area,
run the named test.

| Rule | Test |
| --- | --- |
| Employees cannot reach admin routes | `test_employee_cannot_reach_admin_routes` |
| A locked module's quiz can't be fetched **or** submitted | `test_locked_module_quiz_and_attempt_are_rejected_server_side` |
| Quiz questions carry different weights; missing a heavy one fails you | `test_missing_the_heavy_question_fails_even_if_light_question_is_correct` |
| Missing only a light question still passes | `test_missing_only_the_light_question_still_passes` |
| The quiz shows each question's weight before answering | `test_quiz_view_exposes_weight_percent_upfront` |
| Exhausting attempts blocks progression **and** flags the manager | `test_exhausted_attempts_locks_next_module_and_surfaces_to_manager` |
| Editing a rule's title alone still versions it and clears all read receipts | `test_editing_title_only_still_versions_and_clears_read_status` |
| A PATCH omitting `body` does **not** create a version | `test_editing_metadata_without_body_field_does_not_version` |
| An employee can't mark another org's rule as read | `test_rule_read_org_isolation` |
| Department-scoped rules are a real boundary, not a UI filter | `test_rules_department_scoping_is_a_real_boundary` |
| A resolved question becomes searchable by other employees | `test_resolved_query_becomes_searchable_by_a_different_employee` |
| Questions auto-route to the matching department | `test_query_matching_a_known_activity_auto_routes_to_that_department` |
| Candidate preview shows real mandatory rules | `test_candidate_preview_shows_real_mandatory_rules_org_wide_and_department` |
| Rule suggestions appear in My Submissions before and after a decision | `test_per_rule_suggestion_appears_in_my_submissions_before_and_after_decision` |
| Signup provisions a genuinely working tenant | `test_new_organization_signup_provisions_a_working_tenant` |
| Organisations stay isolated from each other | `test_organizations_stay_isolated_from_each_other` |
| Department-scoped search suggestions | `test_search_defaults_popular_in_department_is_scoped` |

**Rules without a dedicated test — be extra careful:**
- Onboarding stages unlock strictly in order; the journey screen disappears permanently once done
- Readiness score averages only the components that **currently apply**. A component that doesn't
  apply is omitted, never counted as 0%
- A department with `readiness_score: null` means "no learning assigned" — **not** 0%. Never
  render it as 0%
- `app_users.manager_id` is the reporting line, **not** `department_id`. A manager's team is who
  rolls up to them, which can span departments

## 7. Conventions to match

- **Errors:** `{"detail": "Human readable message"}`. Field errors add `"field": "email"` — the
  frontend uses it to highlight the input. Drop it and inline form errors silently stop working.
- **Pagination:** `{"items": [], "page": 1, "page_size": 20, "total": 0}`
- **Auth:** `Authorization: Bearer <token>`
- **IDs** are UUID strings; **dates** are ISO 8601
- **Empty states** say what's true and what to do next — never bare "No data found"
- **Comments** explain *why*, not *what*. Match the existing density.

## 8. When to stop and ask the user

Stop and ask rather than guessing when:
- A change would require a database migration
- A change would alter an API response shape the frontend depends on
- A test fails and the fix isn't obviously in your new code
- You'd need to weaken an auth or `org_id` check to make something work
- The task is ambiguous enough that two readings produce very different work
- You're about to touch more than a few files at once

**Say what you actually did and didn't verify.** If tests fail, show the output. If you skipped
something, say so. Never report success you haven't checked.

## 9. Key files

| File | What it is |
| --- | --- |
| `backend/app/main.py` | All 79 endpoints, readable. **Start here.** |
| `backend/tests/` | 29 tests = the executable spec |
| `supabase/migrations/` | Real schema, in order |
| `supabase/functions/onework-api/index.ts` | The production API |
| `app/platform/PlatformApp.tsx` | Frontend shell, routing, and `request()` — the one API choke point |
| `app/platform/AdminConsole.tsx` | All 12 management panels |
| `docs/AUTORUN.md` | **Autonomous migration directive — the default path. Read this if asked to migrate.** |
| `docs/AGENT_PLAYBOOK.md` | The same work as ordered, human-gated tasks (manual alternative) |
| `docs/MERN_HANDOFF.md` | Full takeover reference: data model, API contract, auth, SaaS plan |
