# KPI Performance Management System — Dynamic Edition v1.2

Production-oriented monthly KPI/KRA application using **React + Vite**, **FastAPI (Python)** and **PostgreSQL**.

The employee experience remains intentionally simple:

1. **KPI Input** — enter monthly actuals/answers and evidence.
2. **KPI** — view monthly KPI records and scores.
3. **KPI Dashboard** — view history, KRA breakdown and performance trend.

HR/Super Admin gets the management screens needed to configure the organization, build KPI rules, run monthly cycles, approve results and report across months.

## Workflow

`Division → Department → Designation → KPI Template → 100-mark validation → Monthly Cycle → Assignment → Employee Input → Automatic Score → Manager Review → HR Finalization → Locked History → Dashboard / Report`

## Dynamic capabilities

- Draft KPI templates can be incomplete while HR is designing them.
- Publishing is blocked until KRA total = **100** and each KRA's KPI weights reconcile to its KRA weight.
- Published templates are immutable; changes use a **new version**, preserving historical calculations.
- Supported input/scoring types:
  - Percentage
  - Number
  - Currency
  - Days / TAT
  - Count
  - Objective choice
  - Yes / No
  - Rating
- Higher-is-better and lower-is-better logic.
- Per-KPI target, frequency, unit, measurement guidance, evidence requirement and score cap.
- Configurable objective answer-to-score mapping.
- Configurable final rating bands under **Scoring Settings**.
- Excel/CSV import for KPI templates, including KRA/KPI weights, input type, target, direction, frequency, measurement and evidence rules.
- Employee bulk import from Excel with Name, Email, Role, Department, Designation and Manager Email.
- Employee KPI response import from Excel/PDF/CSV with preview and fuzzy KPI-name matching.
- Local evidence file uploads (PDF/XLSX/XLS/CSV) up to 10 MB, plus optional manual evidence URL fallback.
- Uploaded evidence is stored under `backend/uploads/` with UUID-prefixed filenames.
- Missing source weights are auto-balanced to 100 and tagged as provisional for HR review.
- One-click **Auto-assign by designation** for monthly cycles.
- Frontend + backend evidence enforcement using either an uploaded file reference or evidence URL.
- Manager return/approve/override and HR finalization/reopen workflow.
- Audit log for administrative and approval actions.
- Employee multi-month line chart, latest KRA breakdown, division comparison and HR monthly matrix.
- CSV export of organization-wide monthly scores.
- Employee KPI summary export as PDF.
- Super Admin-only **Reset All Data** flow that clears cycles, assignments, responses, reviews, audit logs and uploaded evidence while preserving organization/users/templates/settings.
- Downloadable sample Excel files for KPI input, employee import and KPI template import.
- SMTP notification hooks for assignment/review/finalization events.

See [`docs/DYNAMIC_LOGIC.md`](docs/DYNAMIC_LOGIC.md) for calculation details.

## Included source-based KPI templates

In addition to the original AVP Technical, Finance, Project Manager, HR, Admin, Sales and employee examples, this build includes:

- **SVP Projects – Government Projects**
- **AVP Technology – Java Full Stack & Government Projects**
- **Project Manager – Java Full Stack / Government Projects**
- **Team Lead – Java Full Stack**
- **Business Analyst & Testing Lead**
- **Sales – Tender, Business Development & Collections**

Where the supplied source included weightage, the source weightage is retained. Where the source did **not** include weightage/targets, the seed uses explicitly tagged recommended/provisional defaults so HR can adjust them through template versioning instead of changing code. See [`docs/KPI_SOURCE_MAPPING.md`](docs/KPI_SOURCE_MAPPING.md).

## Organization structure

Five primary divisions are seeded:

- Operations & Projects
- Finance & Commercial
- Technical / Software Development
- Sales / Pre-Sales
- HR & Administration

You can add more divisions, departments and designations through **Masters**.

## Roles

### Employee
- Complete own KPI.
- Save draft.
- Submit after all required answers/evidence are present.
- View current and historical results.

### Manager
- Has own KPI if assigned.
- Sees direct-report submissions.
- Opens the employee's full KPI before review.
- Approves, returns, comments or provides overall score override.

### HR
- Manages organization structure, users and reporting managers.
- Creates/imports/version-controls templates.
- Creates cycles and auto-assigns employees.
- Finalizes scores and can reopen with reason.
- Views organization reports and history.

### Super Admin
- Full HR capability and system-level access.

## Main screens

- Login
- KPI Input
- KPI
- KPI Dashboard
- Overview
- KPI Templates
- Dynamic Template Builder
- Excel / CSV Template Import
- KPI Assignments + Auto-assign
- KPI Cycles
- Approvals
- Employees
- Hierarchy
- Masters
- Reports
- Audit Logs
- Settings (scoring, sample downloads, Super Admin reset)

## Demo accounts

All seeded accounts use `Admin@123`.

| User | Email |
|---|---|
| Super Admin | `admin@kpi.local` |
| HR | `hr@kpi.local` |
| Project Manager | `project@kpi.local` |
| Finance Manager | `finance@kpi.local` |
| AVP Technical | `sankar@kpi.local` |
| Sales Manager | `sales@kpi.local` |
| SVP Projects | `svp.projects@kpi.local` |
| AVP Technology | `avp.technology@kpi.local` |
| Java Project Manager | `java.pm@kpi.local` |
| Java Team Lead | `java.teamlead@kpi.local` |
| Business Analyst & Testing Lead | `ba.testing@kpi.local` |
| Project Employee | `project.employee@kpi.local` |
| Accounts Executive | `accounts@kpi.local` |
| Software Developer | `developer@kpi.local` |
| Sales Executive | `sales.employee@kpi.local` |

Change all demo passwords and `SECRET_KEY` before production.

# Run with Docker

Requirements: Docker Desktop / Docker Engine + Docker Compose.

```bash
docker compose up --build
```

Open:

- App: `http://localhost:8080`
- FastAPI docs: `http://localhost:8000/docs`
- Health: `http://localhost:8000/api/health`

Docker starts PostgreSQL, creates/updates the required schema, initializes the sample files and first-run demo data, starts FastAPI, builds React and serves the UI through Nginx. Uploaded evidence is persisted through the `./backend/uploads:/app/uploads` bind mount.

The seed process now records a `demo_seed_completed` marker. If Super Admin uses **Reset All Data**, a backend restart will **not** silently recreate old demo cycles/assignments; only preserved masters/users/templates remain.

## Existing database upgrade behavior

v1.2 adds `evidence_file_id` to `kpi_responses`. Startup runs a small backward-compatible schema check and adds that nullable column when an older database is detected. New advanced KPI configuration remains stored in the existing JSON rule field.

For larger future schema changes, use Alembic migrations.

## File upload policy

- Allowed: `.pdf`, `.xlsx`, `.xls`, `.csv`.
- Maximum: **10 MB per file**.
- Storage: local disk in `backend/uploads/`.
- File IDs are random UUIDs and filenames are sanitized.
- KPI imports are previewed before values are applied.
- Evidence references are preserved in KPI responses and are visible during manager/HR approval.
- JPG/PNG evidence is intentionally not enabled in this release because the agreed scope is PDF/Excel/CSV. Add them later by extending `UPLOAD_EXTENSIONS`.

## Sample workbooks

The UI under **Settings → Download sample Excel templates** provides:

- `KPI_Input_Sample.xlsx`
- `Employee_Import_Sample.xlsx`
- `KPI_Template_Import_Sample.xlsx`

The same files are included under `backend/samples/`.

## Data reset

Super Admin can open **Settings → Reset All Data**, acknowledge the warning, and type `RESET`. The operation removes all transactional KPI history and uploaded files but preserves:

- divisions, departments and designations
- users and reporting hierarchy
- KPI templates and versions
- scoring/system settings

CLI equivalent:

```bash
cd backend
python -m app.reset_seed --confirm RESET
```

# Local development

## Backend

```bash
cd backend
python -m venv .venv
```

Windows:

```powershell
.venv\Scripts\activate
```

Linux/macOS:

```bash
source .venv/bin/activate
```

Then:

```bash
pip install -r requirements.txt
cp .env.example .env
python -m app.seed
uvicorn app.main:app --reload --port 8000
```

If PostgreSQL is not configured locally, omit `DATABASE_URL` from `.env`; the
backend uses a local `backend/kpi.db` SQLite database for development. Docker
still uses PostgreSQL through the `DATABASE_URL` value in `docker-compose.yml`.

## Frontend

```bash
cd frontend
npm install
npm run dev
```

Open `http://localhost:5173`.

## Environment variables

```env
DATABASE_URL=postgresql+psycopg2://kpi:kpi_password@localhost:5432/kpi_db
SECRET_KEY=replace-with-a-long-random-production-secret
ACCESS_TOKEN_EXPIRE_MINUTES=720
CORS_ORIGINS=http://localhost:5173,http://localhost:8080
FRONTEND_URL=http://localhost:5173
SMTP_HOST=
SMTP_PORT=587
SMTP_USERNAME=
SMTP_PASSWORD=
SMTP_FROM=no-reply@example.com
KPI_MAX_UPLOAD_BYTES=10485760
KPI_UPLOAD_DIR=./uploads
KPI_SAMPLE_DIR=./samples
```

Frontend optional:

```env
VITE_API_URL=http://localhost:8000/api
```

## Production checklist

- Replace demo passwords.
- Store a 32+ byte random secret in a secret manager.
- Use HTTPS.
- Restrict CORS to real domains.
- Configure PostgreSQL backups.
- Configure SMTP.
- Add SSO/LDAP if required.
- Local disk uploads are ready for single-server deployment. For multi-server/cloud deployments, replace the storage adapter with S3/MinIO/Azure Blob while keeping `evidence_file_id` as the application reference.
- Add a scheduled worker if automatic deadline reminder emails are required.
- Add Alembic before future structural schema migrations.
- Put `/api/files/{file_id}` behind authenticated download or signed URLs if evidence must be strictly private outside the application network.
