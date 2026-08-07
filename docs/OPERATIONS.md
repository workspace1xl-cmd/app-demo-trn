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
cd backend && python -m pytest -q
```

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
