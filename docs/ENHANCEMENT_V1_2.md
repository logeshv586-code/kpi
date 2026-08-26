# KPI System v1.2 — File Uploads, Dynamic Imports, Evidence & Customer UX

## Implemented backend

- `POST /api/files/upload`: multipart upload, UUID filename, 10 MB limit, PDF/XLSX/XLS/CSV validation.
- `GET /api/files/{file_id}`: inline/download access to a stored upload.
- `POST /api/files/parse-kpi-excel`: parses KPI input from Excel/PDF/CSV and optionally matches it to an assignment.
- `POST /api/kpi/assignments/{id}/import-responses`: direct uploaded-file KPI preview/matching endpoint.
- `POST /api/kpi/templates/import-excel`: imports an Excel KPI template into an editable draft.
- `POST /api/admin/import-employees-excel`: preview or confirm bulk employee import.
- `POST /api/admin/reset-data`: Super Admin-only transactional reset requiring `{"confirm":"RESET"}`.
- `GET /api/admin/samples/{kind}`: generated KPI input, employee and template sample workbooks.
- `GET /api/kpi/assignments/{id}/pdf`: employee KPI summary PDF export.
- `KpiResponse.evidence_file_id`: nullable uploaded-file reference, with startup upgrade for older databases.
- `backend/app/reset_seed.py`: CLI reset utility.

## Import formats

### KPI input workbook

| KPI Parameter | Actual Value | Remarks | Evidence File |
|---|---:|---|---|
| Invoices raised on time | 96 | One delayed invoice | invoice-summary.pdf |

The importer performs normalized/fuzzy matching against the employee's assigned KPI questions. A preview shows matched/unmatched rows before values are applied. A value in `Evidence File` is treated as a reference; if it is an HTTP/HTTPS URL the UI can apply it as the evidence URL. Actual local evidence files still need to be uploaded to the relevant KPI row.

### Employee workbook

`Name | Email | Role | Department | Designation | Manager Email`

Preview validates roles, department/designation lookup, duplicate email and manager resolution. Confirmation creates users in two passes so managers included in the same workbook can be linked.

### KPI template workbook

`KRA | KRA Weight | KPI | KPI Weight | Input Type | Target | Direction | Frequency | Measurement | Evidence Required`

Complete source weights are preserved when they reconcile to 100. Missing/incomplete weights are auto-balanced and tagged provisional for HR review.

## Reset behavior

Reset deletes:

- KPI responses
- reviews
- assignments
- cycles
- audit logs
- files under `backend/uploads/`

Reset preserves:

- divisions/departments/designations
- users and reporting hierarchy
- templates and versions
- scoring settings
- the demo-seed marker

Keeping the seed marker is intentional: restarting the backend after a reset does not recreate old demo cycles.

## Frontend UX

- Large reusable drag-and-drop upload component with validation/progress/status.
- KPI Input first-time guide: Review → Enter actual → Attach evidence → Submit.
- KPI input PDF/Excel import preview and apply flow.
- Per-KPI evidence file chip, clickable evidence, URL fallback and evidence-required state.
- Excel/CSV template import.
- Excel employee import preview/confirm.
- Role-aware dashboard quick actions and pending task counts.
- Manager/HR evidence review with inline PDF preview.
- KPI completion progress and PDF download.
- Sidebar department/designation context and Help entry.
- Friendly login errors, password visibility and password-help message.
- Super Admin danger-zone reset with checkbox + typed `RESET` confirmation.
- Downloadable sample Excel files in Settings.

## Verification

Automated integration script:

```bash
DATABASE_URL=sqlite:////tmp/kpi_v12_test.db \
SECRET_KEY=test-secret-test-secret-test-secret-123 \
PYTHONPATH=backend \
python backend/tests/run_enhancement_tests.py
```

Verified:

- authentication and Super Admin reset restriction
- XLSX upload, parsing and KPI matching
- PDF parsing
- `evidence_file_id` persistence and metadata lookup
- Excel template import
- employee Excel preview
- KPI PDF export
- transactional reset preserves users/templates
- demo seed does not repopulate cycles after reset
- backend Python compilation
- frontend JSX/JS parser check
- CSS parse with zero syntax errors

The full `npm install && npm run build` step could not be completed in the build sandbox because npm dependency installation timed out. The source parses successfully; run the normal Docker build or npm build on an internet-connected machine for final browser-level bundle verification.
