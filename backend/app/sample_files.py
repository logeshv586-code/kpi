from pathlib import Path
from openpyxl import Workbook
from openpyxl.styles import Font, PatternFill
from openpyxl.utils import get_column_letter

from .file_storage import SAMPLE_DIR


def _save(name: str, headers: list[str], rows: list[list[object]]) -> Path:
    path = SAMPLE_DIR / name
    wb = Workbook()
    ws = wb.active
    ws.title = "Sample"
    ws.append(headers)
    for row in rows:
        ws.append(row)
    for cell in ws[1]:
        cell.font = Font(bold=True)
        cell.fill = PatternFill("solid", fgColor="EAF2FF")
    for i, header in enumerate(headers, 1):
        width = max(len(str(header)) + 4, max((len(str(ws.cell(r, i).value or "")) for r in range(2, ws.max_row + 1)), default=0) + 2)
        ws.column_dimensions[get_column_letter(i)].width = min(width, 42)
    ws.freeze_panes = "A2"
    wb.save(path)
    return path


def ensure_samples() -> dict[str, Path]:
    return {
        "kpi-input": _save(
            "KPI_Input_Sample.xlsx",
            ["KPI Parameter", "Actual Value", "Remarks", "Evidence File"],
            [
                ["Invoices raised on time", 96, "All except one invoice was raised on schedule", "invoice-summary.pdf"],
                ["Payments collected within agreed terms", 91, "Two customer payments carried forward", "collection-report.xlsx"],
            ],
        ),
        "employees": _save(
            "Employee_Import_Sample.xlsx",
            ["Name", "Email", "Role", "Department", "Designation", "Manager Email"],
            [
                ["Example Employee", "employee@example.com", "employee", "Project Management", "Project Executive", "manager@example.com"],
                ["Example Manager", "manager@example.com", "manager", "Project Management", "Project Manager", ""],
            ],
        ),
        "template": _save(
            "KPI_Template_Import_Sample.xlsx",
            ["KRA", "KRA Weight", "KPI", "KPI Weight", "Input Type", "Target", "Direction", "Frequency", "Measurement", "Evidence Required"],
            [
                ["Billing & Collection", 25, "Invoices raised on time", 10, "percentage", 100, "higher", "Monthly", "% invoices raised within timeline", "Yes"],
                ["Billing & Collection", 25, "Payments collected within agreed terms", 15, "percentage", 95, "higher", "Monthly", "% collection within terms", "Yes"],
                ["Reporting", 75, "Monthly MIS submitted on time", 75, "yesno", "", "higher", "Monthly", "Submit approved MIS by due date", "No"],
            ],
        ),
    }
