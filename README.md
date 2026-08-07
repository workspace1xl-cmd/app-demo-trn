# OneWork Employee OS — Management Demo

> Reusable UI/UX branch: this branch intentionally contains no production API,
> database or secrets. Teams can run it independently or selectively copy the
> presentation layer into another application.

A polished, responsive management prototype for employee onboarding, training,
trusted organisational knowledge, controlled SOPs and responsibility ownership.

## Included demo areas

- Employee dashboard and universal knowledge search
- Role-based training paths and interactive learning player
- Department-wide Responsibility Matrix
- Controlled SOP and policy repository
- Certificates and learning evidence
- Management analytics and content health
- Administration, governance and audit activity

All interactions are safe prototype actions backed by local UI state. No login,
database or paid service is required to present the demo.

## Run locally

```bash
npm install
npm run dev
```

Open `http://localhost:3000`.

## Production verification

```bash
npm run build
npm start
```

## Deploy to Vercel

Import this GitHub repository into Vercel. Vercel detects Next.js automatically;
use the default build settings and deploy. No environment variables are required
for this management prototype.

## Merge this UI into another codebase

```bash
git fetch origin
git checkout your-feature-branch
git checkout origin/codex/ui-ux-demo -- app public package.json package-lock.json next.config.ts tsconfig.json
npm install
npm run build
```

The visual system is concentrated in `app/globals.css`; presentation data is in
`app/demo-data.ts`; the management experience is in `app/page.tsx`. Keep API
credentials and server integrations outside these files.

The full working product, cloud API, database migrations and tests remain on
`main`. This branch stays presentation-only so design can be reused without
pulling in backend infrastructure.
