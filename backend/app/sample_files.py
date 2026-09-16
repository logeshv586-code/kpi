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
        width = max(
            len(str(header)) + 4,
            max((len(str(ws.cell(r, i).value or "")) for r in range(2, ws.max_row + 1)), default=0) + 2,
        )
        ws.column_dimensions[get_column_letter(i)].width = min(width, 52)
    ws.freeze_panes = "A2"
    wb.save(path)
    return path


def ensure_samples() -> dict[str, Path]:
    (SAMPLE_DIR / "KPI_Input_Sample.xlsx").unlink(missing_ok=True)

    return {
        "employees": _save(
            "Employee_Import_Sample.xlsx",
            [
                "Employee No / Unique ID",
                "Full Name",
                "Email",
                "Temporary Password",
                "System Role",
                "Department",
                "Designation / Role",
                "KPI Template",
                "Reporting Manager Email",
            ],
            [
                [
                    "EMP-1001",
                    "Sarah Jenkins",
                    "sarah.jenkins@company.com",
                    "",
                    "manager",
                    "Operations",
                    "Operations Manager",
                    "",
                    "",
                ],
                [
                    "EMP-1002",
                    "David Miller",
                    "david.miller@company.com",
                    "",
                    "employee",
                    "Operations",
                    "Operations Specialist",
                    "",
                    "sarah.jenkins@company.com",
                ],
                [
                    "EMP-1003",
                    "Anita Roy",
                    "anita.roy@company.com",
                    "",
                    "employee",
                    "Operations",
                    "Quality Lead",
                    "",
                    "sarah.jenkins@company.com",
                ],
            ],
        ),
        "template": _save(
            "KPI_Template_Import_Sample.xlsx",
            [
                "KRA Name",
                "KRA Weightage",
                "KPI Name",
                "Task Responsibility",
                "Measurement Type",
                "Unit",
                "Scoring Direction",
                "KPI Weightage",
                "Target Value for 100 Marks",
                "Qualifying Value",
                "Review Frequency",
                "Dropdown Results and Marks",
                "Measurement / Guidance",
                "Source",
            ],
            [
                [
                    "Operational Excellence",
                    40,
                    "Process Tasks Completed",
                    "Complete all assigned operational tasks for the month",
                    "Quantity / Count",
                    "tasks",
                    "Higher result is better",
                    100,
                    50,
                    0,
                    "Monthly",
                    "",
                    "Enter total completed tasks count",
                    "Task System",
                ],
                [
                    "Operational Excellence",
                    40,
                    "SLA Compliance Rate",
                    "Maintain high SLA response and resolution percentage",
                    "Percentage",
                    "%",
                    "Higher result is better",
                    100,
                    95,
                    0,
                    "Monthly",
                    "",
                    "Enter actual SLA compliance percentage achieved",
                    "Ticketing System",
                ],
                [
                    "Quality & Client Feedback",
                    30,
                    "Client Audit Result",
                    "Client audit score and performance label selection",
                    "Custom Dropdown",
                    "",
                    "",
                    100,
                    "",
                    "",
                    "Monthly",
                    "Grade A - Exceeds Expectations=100; Grade B - Meets Target=80; Grade C - Satisfactory=60; Grade D - Needs Improvement=30",
                    "Select configured audit result from dropdown",
                    "Audit Report",
                ],
                [
                    "Team Leadership & Initiatives",
                    30,
                    "Training Completion Status",
                    "Complete mandatory team training and skill upgrades",
                    "Custom Dropdown",
                    "",
                    "",
                    100,
                    "",
                    "",
                    "Monthly",
                    "Completed All Modules=100; Partially Completed=50; Not Started=0",
                    "Select training completion status",
                    "LMS Portal",
                ],
            ],
        ),
    }
