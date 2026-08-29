from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from starlette.middleware.base import BaseHTTPMiddleware
from starlette.requests import Request

from .database import Base, engine
from .file_storage import SAMPLE_DIR, UPLOAD_DIR
from .migrations import ensure_schema_upgrades
from .routers import admin_router, auth_router, dashboard_router, employee_import_v2, file_router, kpi_router, kpi_submit_override
from .sample_files import ensure_samples

Base.metadata.create_all(bind=engine)
ensure_schema_upgrades()
ensure_samples()

app = FastAPI(title="KPI Performance Management API", version="1.2.2")


class PrivateNetworkAccessMiddleware(BaseHTTPMiddleware):
    async def dispatch(self, request: Request, call_next):
        response = await call_next(request)
        response.headers["Access-Control-Allow-Private-Network"] = "true"
        return response


# Bearer auth (not cookies): permissive CORS keeps browser uploads working when UI
# and API run on different ports, e.g. :8080 → :8000.
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=False,
    allow_methods=["*"],
    allow_headers=["*"],
    expose_headers=["*"],
)
app.add_middleware(PrivateNetworkAccessMiddleware)
app.mount("/uploads", StaticFiles(directory=str(UPLOAD_DIR)), name="uploads")
app.mount("/samples", StaticFiles(directory=str(SAMPLE_DIR)), name="samples")
app.include_router(auth_router.router)
app.include_router(admin_router.router)
app.include_router(employee_import_v2.router)
app.include_router(employee_import_v2.employees_import_router)
# Register the corrected submit endpoint before the legacy KPI router so
# optional PDF evidence / description can never block a valid KPI submission.
app.include_router(kpi_submit_override.router)
app.include_router(kpi_router.router)
app.include_router(dashboard_router.router)
app.include_router(file_router.router)


@app.get("/api/health")
def health():
    return {"status": "ok", "version": "1.2.2"}
