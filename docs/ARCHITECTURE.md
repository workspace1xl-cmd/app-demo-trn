# OneWork architecture

## Deployment topology

```text
Employee / Manager / Administrator
                │
                ▼
        Vercel global HTTPS edge
                │
        Next.js presentation layer
         ├─ management blueprint
         └─ authenticated platform
                │
                ▼
      Supabase Edge Function API
       ├─ request authentication
       ├─ role authorization
       ├─ organisation isolation
       ├─ training workflow
       ├─ knowledge retrieval
       └─ immutable audit writes
                │
                ▼
         Supabase PostgreSQL
       ├─ operational relational data
       ├─ controlled content metadata
       ├─ pgvector knowledge index
       ├─ row-level security
       └─ backup/restore by platform
                │
                └──── optional Claude API
                      grounded synthesis only
```

## Request workflow

1. The user signs in to the Edge API. The password hash is verified inside PostgreSQL.
2. The API returns a random opaque token; only its SHA-256 hash is stored.
3. Each protected request resolves that token to an active user and organisation.
4. Every database query includes the same `org_id`; administrator routes also check role.
5. Mutating actions create an audit event.
6. Knowledge search retrieves approved responsibility, SOP and learning records first.
7. If `ANTHROPIC_API_KEY` exists, only the retrieved evidence is sent to Claude for synthesis. A deterministic answer remains available if Claude is unavailable.

## Data domains

| Domain | Primary records | Controls |
| --- | --- | --- |
| Identity | organisations, departments, users, sessions | tenant keys, expiring sessions, role checks |
| Ownership | activities | owner, backup, channel, SLA, escalation, linked SOP/training |
| Knowledge | SOPs, knowledge chunks, feedback | version, approver, review date, unresolved queue |
| Learning | modules, questions, enrollments, attempts | ordered pathway, pass threshold, evidence |
| Certification | certificates | unique number, issue date, expiry date |
| Governance | audit events | actor, action, entity, timestamp, details |

## Scale path

- **Pilot:** Vercel + Supabase Edge + managed PostgreSQL, as currently deployed.
- **Department rollout:** enterprise SSO, employee import, email notifications, named content owners and pilot analytics.
- **Organisation rollout:** separate tenant configuration, asynchronous imports, scheduled reminders and support operating model.
- **Enterprise:** regional deployments, SAML/SCIM, data residency, customer-managed keys, warehouse export and formal disaster-recovery objectives.
- **AWS migration when requested:** Next.js can remain on Vercel or move to CloudFront; the FastAPI reference service can run on ECS/Fargate; PostgreSQL can move to RDS/Aurora with pgvector. The API contract and UI stay unchanged.

## Security boundary

The public frontend receives only the API URL. It never receives the Supabase service-role key or the Claude key. Database RLS denies direct `anon` and `authenticated` table access; only the server-side Edge Function uses privileged credentials. Production must add enterprise SSO, rate limiting/WAF policy, formal secret rotation and organisation-approved retention settings.
