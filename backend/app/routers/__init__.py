from . import admin_router, auth_router, dashboard_router, file_router, kpi_router
# Import after kpi_router so Reports To based review routes replace the legacy
# role-gated endpoints before FastAPI registers the routers in main.py.
from . import relationship_review_override  # noqa: F401
# Apply the final review-state rule after the relationship override: once a
# reporting person submits Manager Review, only Super Admin may change it.
from . import manager_review_lock_override  # noqa: F401
# Apply the KPI v2 business rules last: recursive hierarchy visibility,
# financial-year review periods, subordinate score cap and pending reminders.
from . import kpi_v2_enhancements  # noqa: F401
from . import kpi_pending_dashboard  # noqa: F401
# Override the legacy single-cycle dashboard summary so the latest review month
# includes every active period in that month and all summary scores are integers.
from . import dashboard_v13_summary  # noqa: F401
# Final reporting-scope layer: expose a real organization tree and make KPI
# Input include all descendants while preserving immediate-manager authority.
from . import team_hierarchy_v13  # noqa: F401

__all__ = ["admin_router", "auth_router", "dashboard_router", "file_router", "kpi_router"]
