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
        ws.column_dimensions[get_column_letter(i)].width = min(width, 52)
    ws.freeze_panes = "A2"
    wb.save(path)
    return path


def ensure_samples() -> dict[str, Path]:
    # KPI Input is entered in the application or uploaded with the user's own
    # bulk result file. A separate KPI Input sample is no longer exposed.
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
                "Reporting Manager Email",
            ],
            [
                [
                    "EMP-0001",
                    "Example Manager",
                    "manager@example.com",
                    "Admin@123",
                    "manager",
                    "Project Management",
                    "Project Manager",
                    "",
                ],
                [
                    "EMP-0002",
                    "Example Employee",
                    "employee@example.com",
                    "Admin@123",
                    "employee",
                    "Project Management",
                    "Project Executive",
                    "manager@example.com",
                ],
            ],
        ),
        "template": _save(
            "KPI_Template_Import_Sample.xlsx",
            [
                "KRA Name",
                "KRA Weight / Marks",
                "KPI Name",
                "Task Responsibility",
                "Result Entry Type",
                "Weight / Marks",
                "Expected Target",
                "Unit",
                "Scoring Direction",
                "Frequency",
                "Measurement / Guidance",
                "Custom Dropdown Results",
                "Source",
                "Weight Basis",
            ],
            [
                [
                    "Delivery",
                    60,
                    "Assigned tasks completed",
                    "Complete the tasks assigned for the month",
                    "Number / Quantity",
                    30,
                    100,
                    "tasks",
                    "Higher result is better",
                    "Monthly",
                    "Enter the number of tasks completed",
                    "",
                    "Task tracker",
                    "Configured by HR",
                ],
                [
                    "Delivery",
                    60,
                    "Completion rate",
                    "Complete assigned work within the agreed timeline",
                    "Percentage",
                    30,
                    100,
                    "%",
                    "Higher result is better",
                    "Monthly",
                    "Enter the actual completion percentage",
                    "",
                    "Project MIS",
                    "Configured by HR",
                ],
                [
                    "Customer / Result Status",
                    40,
                    "Customer result selection",
                    "Select the exact customer/result name configured by HR",
                    "Custom Dropdown",
                    40,
                    "",
                    "",
                    "Higher result is better",
                    "Monthly",
                    "Employee selects one configured result from the dropdown",
                    "Customer A=100; Customer B=80; Pending=40",
                    "CRM / Manager confirmation",
                    "Configured by HR",
                ],
            ],
        ),
    }
