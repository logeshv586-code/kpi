from fastapi import APIRouter, Depends, Form, HTTPException, UploadFile
from fastapi.responses import FileResponse
from sqlalchemy.orm import Session

from ..auth import get_current_user
from ..database import get_db
from ..file_storage import find_upload, parse_response_rows, save_upload, upload_metadata
from ..importing import match_response_rows
from ..models import KpiAssignment, KpiTemplate, Kra
from sqlalchemy import select
from sqlalchemy.orm import joinedload

router = APIRouter(prefix="/api/files", tags=["files"])


def _load_assignment(db: Session, assignment_id: int):
    return db.scalar(
        select(KpiAssignment)
        .where(KpiAssignment.id == assignment_id)
        .options(joinedload(KpiAssignment.template).joinedload(KpiTemplate.kras).joinedload(Kra.items), joinedload(KpiAssignment.user))
    )


@router.post("/upload")
async def upload_file(file: UploadFile, _=Depends(get_current_user)):
    return await save_upload(file)


@router.get("/{file_id}")
def get_file(file_id: str):
    # This route is intentionally link-friendly so evidence opens in a new tab.
    # Deployments that require private evidence can swap this for signed URLs/auth.
    path = find_upload(file_id)
    if not path:
        raise HTTPException(404, "File not found")
    meta = upload_metadata(file_id)
    return FileResponse(path, filename=meta["filename"], media_type=meta["content_type"], content_disposition_type="inline")


@router.post("/parse-kpi-excel")
def parse_kpi_file(file_id: str = Form(...), assignment_id: int | None = Form(None), db: Session = Depends(get_db), user=Depends(get_current_user)):
    path = find_upload(file_id)
    if not path:
        raise HTTPException(404, "Uploaded file not found")
    rows = parse_response_rows(path)
    if not rows:
        raise HTTPException(400, "No KPI response rows found. Use columns: KPI Parameter | Actual Value | Remarks | Evidence File")
    if assignment_id is None:
        return {"file": upload_metadata(file_id), "rows": rows}
    assignment = _load_assignment(db, assignment_id)
    if not assignment:
        raise HTTPException(404, "Assignment not found")
    if user.role.value == "employee" and assignment.user_id != user.id:
        raise HTTPException(403, "Forbidden")
    if user.role.value == "manager" and assignment.user_id != user.id and assignment.user.manager_id != user.id:
        raise HTTPException(403, "Forbidden")
    preview = match_response_rows(assignment, rows)
    return {"file": upload_metadata(file_id), "rows": preview, "matched": sum(1 for x in preview if x["matched"]), "unmatched": sum(1 for x in preview if not x["matched"])}
