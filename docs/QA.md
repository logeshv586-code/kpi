# Functional QA Notes — Dynamic Edition

## Backend checks completed

The updated backend was executed against a fresh SQLite database for isolated QA while PostgreSQL remains the default/production database.

Verified:

- Python compile of the complete `backend/app` package.
- Seed completes successfully from an empty database.
- 16 seeded KPI templates are created and all 16 pass strict 100-mark validation.
- New source-based SVP, Software Team, Business Analyst/Testing Lead and Sales templates are present.
- Admin login/JWT authentication.
- Templates, masters, assignments, dashboard summary and system settings endpoints.
- KRA breakdown endpoint for an employee.
- Dynamic CSV import creates a 100-mark editable draft.
- Incomplete draft templates can be saved, while publishing them is correctly rejected.
- Auto-assign by designation on a new monthly cycle assigned every seeded non-superadmin user with no unmatched templates.
- Evidence-required rules are enforced by the backend at submission time.
- Higher-is-better, zero-target lower-is-better and objective-choice scoring examples.
- System scoring/rating settings can be written and read.

## Frontend validation limitation

The updated React source was reviewed alongside the backend/API contract, but a complete `npm install && npm run build` could not be run in this sandbox because outbound npm dependency download timed out and no package cache is present. The project pins its dependencies in `frontend/package.json` and the normal validation command on an internet-connected machine is:

```bash
cd frontend
npm install
npm run build
```

## Docker limitation

Docker is not installed in this execution environment, so `docker compose up --build` could not be executed here. `docker-compose.yml` remains the recommended end-user start path.

## Visual direction

The existing `ui-concept.png` and `qa-dashboard.png` remain the white/blue visual reference. This update preserves the same three primary user areas — **KPI Input**, **KPI**, **KPI Dashboard** — and extends HR management screens with dynamic rule configuration, CSV import, auto-assignment and scoring settings.
