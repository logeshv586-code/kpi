from datetime import date
from pydantic import BaseModel, ConfigDict, Field, field_validator


class LoginIn(BaseModel):
    email: str
    password: str

    @field_validator("email")
    @classmethod
    def normalize_email(cls, value: str):
        value = value.strip().lower()
        if "@" not in value or "." not in value.split("@")[-1]:
            raise ValueError("Enter a valid email address")
        return value


class UserOut(BaseModel):
    id: int
    employee_no: str | None = None
    name: str
    email: str
    role: str
    manager_id: int | None = None
    designation_id: int | None = None
    model_config = ConfigDict(from_attributes=True)


class UserCreate(BaseModel):
    employee_no: str | None = None
    name: str = Field(min_length=2, max_length=120)
    email: str
    password: str = Field(min_length=6)
    role: str = "employee"
    manager_id: int | None = None
    designation_id: int | None = None

    @field_validator("email")
    @classmethod
    def normalize_email(cls, value: str):
        value = value.strip().lower()
        if "@" not in value or "." not in value.split("@")[-1]:
            raise ValueError("Enter a valid email address")
        return value


class UserUpdate(BaseModel):
    employee_no: str | None = None
    name: str | None = None
    email: str | None = None
    password: str | None = None
    role: str | None = None
    manager_id: int | None = None
    designation_id: int | None = None
    active: bool | None = None


class MasterCreate(BaseModel):
    name: str = Field(min_length=2, max_length=120)
    parent_id: int | None = None


class KpiItemIn(BaseModel):
    question: str = Field(min_length=2)
    input_type: str = "percentage"
    weight: float = Field(ge=0, le=100)
    target_value: float | None = None
    direction: str = "higher"
    options: dict | None = None


class KraIn(BaseModel):
    name: str = Field(min_length=2)
    weight: float = Field(ge=0, le=100)
    items: list[KpiItemIn]


class TemplateIn(BaseModel):
    name: str = Field(min_length=2, max_length=160)
    division_id: int | None = None
    department_id: int | None = None
    designation_id: int | None = None
    kras: list[KraIn]


class TemplateImportIn(BaseModel):
    name: str = Field(min_length=2, max_length=160)
    designation_id: int | None = None
    csv_text: str = Field(min_length=3)


class CycleIn(BaseModel):
    name: str
    month: date
    start_date: date
    end_date: date
    status: str = "upcoming"


class CycleUpdate(BaseModel):
    status: str


class AssignmentIn(BaseModel):
    cycle_id: int
    user_id: int
    template_id: int


class AutoAssignIn(BaseModel):
    cycle_id: int
    include_managers: bool = True
    include_hr: bool = True


class ResponseIn(BaseModel):
    kpi_item_id: int
    actual_numeric: float | None = None
    answer_text: str | None = None
    selected_option: str | None = None
    measurement: str | None = None
    remarks: str | None = None
    evidence_url: str | None = None
    evidence_file_id: str | None = None


class ResetIn(BaseModel):
    confirm: str
    mode: str = "transactional"  # "transactional" or "full"


class ImportEmployeesResult(BaseModel):
    preview: bool = True
    total_rows: int = 0
    valid_rows: int = 0
    created: int = 0
    skipped: int = 0
    rows: list[dict] = []


class ReviewIn(BaseModel):
    comments: str | None = None
    score_override: float | None = Field(default=None, ge=0, le=100)
    decision: str = "approved"


class ReopenIn(BaseModel):
    reason: str = Field(min_length=3)


class SettingsIn(BaseModel):
    rating_bands: list[dict] | None = None
    default_choice_map: dict | None = None
    score_cap_pct: float | None = Field(default=None, ge=100, le=200)
    require_evidence_by_default: bool | None = None
