import enum
from datetime import date, datetime

from sqlalchemy import Boolean, Date, DateTime, Enum, Float, ForeignKey, Integer, JSON, String, Text, UniqueConstraint
from sqlalchemy.orm import Mapped, mapped_column, relationship

from .database import Base


class Role(str, enum.Enum):
    superadmin = "superadmin"
    hr = "hr"
    manager = "manager"
    employee = "employee"


class TemplateStatus(str, enum.Enum):
    draft = "draft"
    active = "active"
    archived = "archived"


class CycleStatus(str, enum.Enum):
    upcoming = "upcoming"
    running = "running"
    closed = "closed"


class AssignmentStatus(str, enum.Enum):
    not_started = "not_started"
    draft = "draft"
    submitted = "submitted"
    manager_reviewed = "manager_reviewed"
    finalized = "finalized"


class Division(Base):
    __tablename__ = "divisions"
    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    name: Mapped[str] = mapped_column(String(120), unique=True, index=True)
    departments = relationship("Department", back_populates="division", cascade="all, delete-orphan")


class Department(Base):
    __tablename__ = "departments"
    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    name: Mapped[str] = mapped_column(String(120), index=True)
    division_id: Mapped[int] = mapped_column(ForeignKey("divisions.id", ondelete="CASCADE"))
    division = relationship("Division", back_populates="departments")
    designations = relationship("Designation", back_populates="department", cascade="all, delete-orphan")
    __table_args__ = (UniqueConstraint("name", "division_id", name="uq_department_division"),)


class Designation(Base):
    __tablename__ = "designations"
    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    name: Mapped[str] = mapped_column(String(120), index=True)
    department_id: Mapped[int] = mapped_column(ForeignKey("departments.id", ondelete="CASCADE"))
    department = relationship("Department", back_populates="designations")
    users = relationship("User", back_populates="designation")
    __table_args__ = (UniqueConstraint("name", "department_id", name="uq_designation_department"),)


class User(Base):
    __tablename__ = "users"
    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    employee_no: Mapped[str | None] = mapped_column(String(50), unique=True, nullable=True, index=True)
    name: Mapped[str] = mapped_column(String(120))
    email: Mapped[str] = mapped_column(String(180), unique=True, index=True)
    password_hash: Mapped[str] = mapped_column(String(255))
    role: Mapped[Role] = mapped_column(Enum(Role), default=Role.employee)
    manager_id: Mapped[int | None] = mapped_column(ForeignKey("users.id"), nullable=True)
    designation_id: Mapped[int | None] = mapped_column(ForeignKey("designations.id"), nullable=True)
    active: Mapped[bool] = mapped_column(Boolean, default=True)
    designation = relationship("Designation", back_populates="users")
    manager = relationship("User", remote_side=[id], backref="direct_reports")


class KpiTemplate(Base):
    __tablename__ = "kpi_templates"
    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    name: Mapped[str] = mapped_column(String(160))
    division_id: Mapped[int | None] = mapped_column(ForeignKey("divisions.id"), nullable=True)
    department_id: Mapped[int | None] = mapped_column(ForeignKey("departments.id"), nullable=True)
    designation_id: Mapped[int | None] = mapped_column(ForeignKey("designations.id"), nullable=True)
    status: Mapped[TemplateStatus] = mapped_column(Enum(TemplateStatus), default=TemplateStatus.draft)
    version: Mapped[int] = mapped_column(Integer, default=1)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)
    division = relationship("Division")
    department = relationship("Department")
    designation = relationship("Designation")
    kras = relationship("Kra", back_populates="template", cascade="all, delete-orphan", order_by="Kra.id")


class Kra(Base):
    __tablename__ = "kras"
    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    template_id: Mapped[int] = mapped_column(ForeignKey("kpi_templates.id", ondelete="CASCADE"))
    name: Mapped[str] = mapped_column(String(180))
    weight: Mapped[float] = mapped_column(Float)
    template = relationship("KpiTemplate", back_populates="kras")
    items = relationship("KpiItem", back_populates="kra", cascade="all, delete-orphan", order_by="KpiItem.id")


class KpiItem(Base):
    __tablename__ = "kpi_items"
    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    kra_id: Mapped[int] = mapped_column(ForeignKey("kras.id", ondelete="CASCADE"))
    question: Mapped[str] = mapped_column(Text)
    input_type: Mapped[str] = mapped_column(String(30), default="percentage")
    weight: Mapped[float] = mapped_column(Float)
    target_value: Mapped[float | None] = mapped_column(Float, nullable=True)
    direction: Mapped[str] = mapped_column(String(16), default="higher")
    options: Mapped[dict | None] = mapped_column(JSON, nullable=True)
    kra = relationship("Kra", back_populates="items")


class KpiCycle(Base):
    __tablename__ = "kpi_cycles"
    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    name: Mapped[str] = mapped_column(String(120), unique=True)
    month: Mapped[date] = mapped_column(Date)
    start_date: Mapped[date] = mapped_column(Date)
    end_date: Mapped[date] = mapped_column(Date)
    status: Mapped[CycleStatus] = mapped_column(Enum(CycleStatus), default=CycleStatus.upcoming)
    assignments = relationship("KpiAssignment", back_populates="cycle", cascade="all, delete-orphan")


class KpiAssignment(Base):
    __tablename__ = "kpi_assignments"
    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    cycle_id: Mapped[int] = mapped_column(ForeignKey("kpi_cycles.id", ondelete="CASCADE"))
    user_id: Mapped[int] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"))
    template_id: Mapped[int] = mapped_column(ForeignKey("kpi_templates.id"))
    status: Mapped[AssignmentStatus] = mapped_column(Enum(AssignmentStatus), default=AssignmentStatus.not_started)
    calculated_score: Mapped[float] = mapped_column(Float, default=0)
    manager_score: Mapped[float | None] = mapped_column(Float, nullable=True)
    final_score: Mapped[float | None] = mapped_column(Float, nullable=True)
    submitted_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    finalized_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    cycle = relationship("KpiCycle", back_populates="assignments")
    user = relationship("User")
    template = relationship("KpiTemplate")
    responses = relationship("KpiResponse", back_populates="assignment", cascade="all, delete-orphan")
    reviews = relationship("KpiReview", back_populates="assignment", cascade="all, delete-orphan")
    __table_args__ = (UniqueConstraint("cycle_id", "user_id", name="uq_cycle_user"),)


class KpiResponse(Base):
    __tablename__ = "kpi_responses"
    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    assignment_id: Mapped[int] = mapped_column(ForeignKey("kpi_assignments.id", ondelete="CASCADE"))
    kpi_item_id: Mapped[int] = mapped_column(ForeignKey("kpi_items.id", ondelete="CASCADE"))
    actual_numeric: Mapped[float | None] = mapped_column(Float, nullable=True)
    answer_text: Mapped[str | None] = mapped_column(Text, nullable=True)
    selected_option: Mapped[str | None] = mapped_column(String(120), nullable=True)
    measurement: Mapped[str | None] = mapped_column(Text, nullable=True)
    remarks: Mapped[str | None] = mapped_column(Text, nullable=True)
    evidence_url: Mapped[str | None] = mapped_column(String(500), nullable=True)
    evidence_file_id: Mapped[str | None] = mapped_column(String(80), nullable=True, index=True)
    score: Mapped[float] = mapped_column(Float, default=0)
    updated_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)
    assignment = relationship("KpiAssignment", back_populates="responses")
    item = relationship("KpiItem")
    __table_args__ = (UniqueConstraint("assignment_id", "kpi_item_id", name="uq_assignment_item"),)


class KpiReview(Base):
    __tablename__ = "kpi_reviews"
    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    assignment_id: Mapped[int] = mapped_column(ForeignKey("kpi_assignments.id", ondelete="CASCADE"))
    reviewer_id: Mapped[int] = mapped_column(ForeignKey("users.id"))
    stage: Mapped[str] = mapped_column(String(20))
    decision: Mapped[str] = mapped_column(String(20), default="approved")
    comments: Mapped[str | None] = mapped_column(Text, nullable=True)
    score_override: Mapped[float | None] = mapped_column(Float, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)
    assignment = relationship("KpiAssignment", back_populates="reviews")
    reviewer = relationship("User")


class SystemSetting(Base):
    __tablename__ = "system_settings"
    key: Mapped[str] = mapped_column(String(120), primary_key=True)
    value: Mapped[dict] = mapped_column(JSON, default=dict)
    updated_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)


class AuditLog(Base):
    __tablename__ = "audit_logs"
    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    actor_id: Mapped[int | None] = mapped_column(ForeignKey("users.id"), nullable=True)
    action: Mapped[str] = mapped_column(String(120))
    entity_type: Mapped[str] = mapped_column(String(80))
    entity_id: Mapped[int | None] = mapped_column(Integer, nullable=True)
    details: Mapped[dict | None] = mapped_column(JSON, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)
