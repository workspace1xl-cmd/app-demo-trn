# OneWork Employee OS — Management Demo

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

The production SaaS can later connect these interfaces to AWS services and the
organisation's Claude API while preserving this presentation layer.
