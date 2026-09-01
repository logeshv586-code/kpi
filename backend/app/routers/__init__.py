from . import admin_router, auth_router, dashboard_router, file_router, kpi_router
# Import after kpi_router so Reports To based review routes replace the legacy
# role-gated endpoints before FastAPI registers the routers in main.py.
from . import relationship_review_override  # noqa: F401
# Apply the final review-state rule after the relationship override: once a
# reporting person submits Manager Review, only Super Admin may change it.
from . import manager_review_lock_override  # noqa: F401

__all__ = ["admin_router", "auth_router", "dashboard_router", "file_router", "kpi_router"]
