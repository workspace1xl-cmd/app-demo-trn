# Cloud operations

## Current production services

| Layer | Service | Status |
| --- | --- | --- |
| Web | Vercel | deployed |
| API | Supabase Edge Function `onework-api` | deployed |
| Database | Supabase PostgreSQL | migrated and seeded |
| AI synthesis | Claude Messages API | optional secret not stored in Git |
| Automation | database workflows + n8n templates | repository-ready |

No AWS deployment is required for the current pilot.

## Automated deployment

`.github/workflows/deploy.yml` runs on every push to `main`: it links the Supabase project, applies any pending SQL migrations under `supabase/migrations`, deploys the `onework-api` Edge Function, and polls `/health` until it reports 200. No manual `supabase` CLI step is required once these repository secrets are set under **Settings → Secrets and variables → Actions**:

| Secret | Value |
| --- | --- |
| `SUPABASE_ACCESS_TOKEN` | personal access token from https://supabase.com/dashboard/account/tokens |
| `SUPABASE_PROJECT_REF` | `bnzcjjdhfsdedwljdmjl` |
| `SUPABASE_DB_PASSWORD` | the project's Postgres password |

Vercel already deploys `main` through its own GitHub integration; the workflow does not duplicate that unless a `VERCEL_TOKEN` secret is also present, in which case it runs an explicit production deploy as a safety net.

`.github/workflows/ci.yml` runs `npm run lint`, `npm run build` and both backend test files on every push and pull request, independent of deployment.

To run the same migration and function deploy from a local machine instead of CI, export the three variables above and run:

```bash
npm run deploy:all
```

This runs `supabase link`, `supabase db push --include-all` and `supabase functions deploy onework-api` through `npx`, so no global CLI install is required.

## Add management's Claude API key

The key must be added as a server-side Supabase Edge Function secret named `ANTHROPIC_API_KEY`. It must not be pasted into `.env.local`, Vercel public variables, browser code or Git.

Using the Supabase dashboard:

1. Open project `bnzcjjdhfsdedwljdmjl`.
2. Go to **Edge Functions → Secrets**.
3. Add `ANTHROPIC_API_KEY` with management's value.
4. Optionally add `ANTHROPIC_MODEL`; the service already has a safe default.
5. Search in `/platform`. The response shows whether AI synthesis was used.

The rest of the deployed platform continues to work before this secret is added.

## Health and smoke checks

```bash
curl https://bnzcjjdhfsdedwljdmjl.supabase.co/functions/v1/onework-api/health
npm run build
make test-api
```

`make test-api` runs `test_api.py`, `test_admin.py` and `test_signup.py` as three separate `pytest` processes. They must not run in the same process: `app/db.py` creates its SQLAlchemy engine once, from whichever `DATABASE_URL` is set at first import of `app.main`, so a single combined `pytest -q` run silently makes all three files share one SQLite file and their row-count assertions collide.

Recommended production smoke path:

1. Employee login.
2. Search “How do I request leave?”.
3. Open the current training module and submit the assessment.
4. Confirm certificate issuance and next-module unlock.
5. Sign in as administrator and confirm analytics.

## Content onboarding

The seed content is presentation-ready, not a substitute for approved organisation policy. For a real pilot, named owners should validate each responsibility record and SOP, confirm SLAs and escalation paths, and replace placeholder people/contact details. Training content should then be approved module by module.

## Recovery and rollback

- Frontend releases are immutable Vercel deployments and can be promoted or rolled back in Vercel.
- Database changes are versioned SQL migrations under `supabase/migrations`.
- Edge Function source is versioned under `supabase/functions/onework-api`.
- The FastAPI implementation and Docker Compose stack provide a portable fallback outside Supabase.

## Required governance before live employee data

- Replace the public demo accounts and rotate credentials.
- Configure enterprise SSO and user lifecycle ownership.
- Decide retention for sessions, attempts, certificates, feedback and audit events.
- Assign security incident, privacy request and content-review owners.
- Verify local employment, privacy, accessibility and records obligations.
