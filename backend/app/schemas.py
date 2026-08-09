from pydantic import BaseModel, EmailStr, Field


class LoginRequest(BaseModel):
    email: EmailStr
    password: str = Field(min_length=6)
    organization: str = "example-organisation"


class TokenResponse(BaseModel):
    access_token: str
    token_type: str = "bearer"
    user: dict


class OrganizationSignup(BaseModel):
    organization_name: str = Field(min_length=2)
    organization_slug: str = Field(min_length=2, max_length=63)
    full_name: str = Field(min_length=2)
    email: EmailStr
    password: str = Field(min_length=8)


class SearchRequest(BaseModel):
    query: str = Field(min_length=2, max_length=500)


class FeedbackRequest(BaseModel):
    query: str = Field(min_length=2)
    reason: str = Field(min_length=3)


class QuizSubmission(BaseModel):
    answers: list[int]


class ActivityCreate(BaseModel):
    name: str
    department: str
    responsible_role: str
    current_person: str = "Organisation to confirm"
    backup_person: str = "Department backup"
    contact_details: str
    sla: str
    escalation_level_1: str
    escalation_level_2: str
    related_documents: list[str] = []
    sop_link: str | None = None
    training_module_link: str | None = None
    process_steps: list[str] = []


class ModuleCreate(BaseModel):
    code: str
    title: str
    objective: str
    duration_minutes: int = Field(gt=0)
    content_type: str = "mixed"
    content: dict = {}
    passing_score: int = Field(default=80, ge=0, le=100)
    refresher_months: int = Field(default=12, ge=0)
    sop_url: str | None = None
    sop_label: str | None = None


class DepartmentCreate(BaseModel):
    name: str = Field(min_length=1)
    code: str = Field(min_length=1)


class DepartmentUpdate(BaseModel):
    name: str | None = None
    code: str | None = None


class EmployeeCreate(BaseModel):
    full_name: str = Field(min_length=1)
    email: EmailStr
    password: str = Field(min_length=8)
    role: str = "employee"
    department_id: str | None = None
    manager_id: str | None = None


class EmployeeUpdate(BaseModel):
    full_name: str | None = None
    department_id: str | None = None
    manager_id: str | None = None
    role: str | None = None
    is_active: bool | None = None
    password: str | None = Field(default=None, min_length=8)


class ActivityUpdate(BaseModel):
    name: str | None = None
    department: str | None = None
    responsible_role: str | None = None
    current_person: str | None = None
    backup_person: str | None = None
    contact_details: str | None = None
    sla: str | None = None
    escalation_level_1: str | None = None
    escalation_level_2: str | None = None
    sop_link: str | None = None
    training_module_link: str | None = None
    status: str | None = None


class ModuleUpdate(BaseModel):
    title: str | None = None
    objective: str | None = None
    duration_minutes: int | None = Field(default=None, gt=0)
    content_type: str | None = None
    passing_score: int | None = Field(default=None, ge=0, le=100)
    refresher_months: int | None = Field(default=None, ge=0)
    is_mandatory: bool | None = None
    status: str | None = None
    sop_url: str | None = None
    sop_label: str | None = None


class QuestionCreate(BaseModel):
    prompt: str = Field(min_length=1)
    options: list[str] = Field(min_length=2)
    correct_index: int = Field(ge=0)
    explanation: str = Field(min_length=1)


class QuestionUpdate(BaseModel):
    prompt: str | None = None
    options: list[str] | None = None
    correct_index: int | None = None
    explanation: str | None = None


class EnrollmentUpdate(BaseModel):
    status: str | None = None
    due_date: str | None = None


class AssignRequest(BaseModel):
    module_id: str
    employee_ids: list[str] = Field(min_length=1)
    due_date: str | None = None


class FeedbackResolve(BaseModel):
    status: str
    resolution: str | None = None


class MistakeCreate(BaseModel):
    code: str = Field(min_length=1)
    title: str = Field(min_length=1)
    description: str = Field(min_length=1)
    correct_practice: str = Field(min_length=1)
    category: str = Field(min_length=1)
    severity: str = "medium"
    department: str | None = None
    module_id: str | None = None


class MistakeUpdate(BaseModel):
    title: str | None = None
    description: str | None = None
    correct_practice: str | None = None
    category: str | None = None
    severity: str | None = None
    department: str | None = None
    module_id: str | None = None
    status: str | None = None
