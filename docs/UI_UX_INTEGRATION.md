# UI/UX integration guide

The presentation layer is preserved independently on branch `codex/ui-ux-demo`. It contains the management blueprint, responsive design system, demo interactions and all source data needed to review the product experience without running a backend.

## Reuse the complete UI in another branch

```bash
git fetch origin
git checkout your-feature-branch
git checkout origin/codex/ui-ux-demo -- app public package.json package-lock.json next.config.ts tsconfig.json
npm install
npm run build
```

## Reuse only the visual system

Copy these paths:

- `app/globals.css` — tokens, typography, motion and shared responsive rules
- `app/page.tsx` — management blueprint information architecture
- `app/demo-data.ts` — presentation data contracts
- `public/` — static visual assets

The production application is in `app/platform`. It uses isolated module CSS, so backend teams can merge it or replace its data adapter without changing the management demo.

## API adapter boundary

`app/platform/page.tsx` sends JSON to `NEXT_PUBLIC_API_URL`. A replacement backend only needs to preserve the documented route shapes for login, dashboard, activities, SOPs, training, certificates, search, feedback and admin analytics. No visual component imports server credentials.

## Branch policy

- `codex/ui-ux-demo`: presentation-only, safe for design review and selective checkout.
- `main`: deployed full-stack product, migrations, API, tests and operations.
- Future visual experiments should branch from `codex/ui-ux-demo`.
- Production features should merge into `main` through normal review.
