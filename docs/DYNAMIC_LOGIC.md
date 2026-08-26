# Dynamic KPI Logic

The application is intentionally data-driven. New departments, designations, KRA groups, KPI parameters, targets and scoring rules are created in the UI and stored in PostgreSQL; normal KPI changes do not require source-code changes.

## 1. Configuration hierarchy

`Division → Department → Designation → KPI Template → KRA → KPI Parameter → Monthly Assignment → Response → Manager Review → HR Finalization`

An employee may change manager/designation later without losing historical assignments because each monthly assignment stores the template used for that month.

## 2. Template lifecycle

- **Draft:** HR can save an incomplete template while designing it.
- **Publish validation:** KRA total must be exactly 100, and every KRA's KPI parameter weights must exactly equal the KRA weight.
- **Active:** Can be assigned to employees. Published versions are locked.
- **New version:** Creates an editable copy for future months while historical assignments continue using the old version.
- **Archived:** A previous active version is archived automatically when its replacement is published.

## 3. Dynamic KPI parameter fields

Every KPI parameter can configure:

- Input type: percentage, number, currency, days/TAT, count, objective choice, yes/no, rating.
- Target value.
- Direction: higher-is-better or lower-is-better.
- Weight/marks.
- Frequency: monthly, weekly, per sprint, per release, per project, ongoing, etc.
- Unit.
- Measurement/guidance text.
- Evidence required/optional.
- Objective answer → score mapping.
- Rating maximum.
- Score cap percentage.
- Source/reference.
- Weight basis (source-defined, HR-defined, provisional import, etc.).

These extra rules are stored in the existing KPI item's JSON configuration so the upgraded build remains compatible with databases created by the earlier package.

## 4. Scoring engine

### Higher is better

`ratio = actual / target`

`item score = item weight × ratio`

The ratio is capped by the item's configured score cap. The default cap is 100%, so an item cannot normally contribute more marks than its weight.

### Lower is better

- Actual <= target → full item marks.
- Actual > target → `target / actual × weight`.
- Special zero target (for example penalty count) → zero actual gets full marks; any positive actual gets zero marks.

### Direct percentage

When scoring method is `direct_percentage`, the actual percentage itself is converted to the item weight.

### Objective choice / Yes-No

Example mapping:

- Excellent = 100%
- Good = 80%
- Average = 60%
- Poor = 40%
- Not achieved = 0%

HR can change the organization default under **Scoring Settings**, and individual KPI parameters can have their own mapping.

### Rating

`rating / maximum rating × item weight`

### Threshold rules

The backend scoring engine also supports threshold configuration stored in the KPI JSON (for future/custom API use), e.g. higher-is-better `{min: 95, score: 100}` or lower-is-better `{max: 2, score: 100}` bands.

## 5. Evidence enforcement

If a KPI is configured as evidence-required, the employee cannot submit until an evidence link is supplied. This is validated both in React and in the FastAPI backend, so it cannot be bypassed by calling the API directly.

## 6. Monthly automation

For a new month:

1. HR creates a KPI Cycle.
2. HR publishes one current template per designation.
3. HR clicks **Auto-assign by designation**.
4. The backend matches each active employee to the latest active template for their designation.
5. Existing assignments are skipped safely.
6. Employees without a matching active template are returned in the `no_active_template` result for HR follow-up.

## 7. Approval workflow

`Draft → Submitted → Manager Reviewed → HR Finalized`

- Employee controls responses only before submission.
- Manager reviews only direct reports and can approve, return, comment or provide an overall score override.
- HR/Super Admin performs final finalization.
- HR may reopen a record with a reason; this clears manager/final score and returns the KPI to draft.
- Actions are recorded in Audit Logs.

## 8. CSV import

The KPI Templates screen can import CSV files using common columns:

`KRA, KPI, Measurement, Target, Frequency`

A KPI cell containing bullets or line breaks is split into individual KPI parameters. If the source has no weightage, the importer creates an exactly-100 provisional distribution and records that the weights require HR review. If no numeric target is supplied, the imported parameter defaults to objective-choice scoring so HR can later convert it to target/actual, percentage, TAT, etc.

## 9. Dashboards

- Employee score trend across months.
- Current/latest KRA achievement breakdown.
- Division average comparison.
- Dynamic rating bands.
- HR multi-month employee matrix with CSV export.

## 10. Production extension points

The schema is ready for replacing evidence links with object storage uploads, adding SSO/LDAP, adding scheduled reminder jobs, or integrating targets from ERP/CRM/project systems. Those integrations should populate the same monthly response records instead of changing the KPI calculation model.
