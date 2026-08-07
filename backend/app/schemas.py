from pydantic import BaseModel, EmailStr, Field


class LoginRequest(BaseModel):
    email: EmailStr
    password: str = Field(min_length=6)
    organization: str = "example-organisation"


class TokenResponse(BaseModel):
    access_token: str
    token_type: str = "bearer"
    user: dict


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


class SOPCreate(BaseModel):
    code: str
    title: str
    department: str
    owner_role: str
    approver_role: str
    summary: str
    content: dict = {}


class ModuleCreate(BaseModel):
    code: str
    title: str
    objective: str
    duration_minutes: int = Field(gt=0)
    content_type: str = "text"
    content: dict = {}
    passing_score: int = Field(default=80, ge=0, le=100)
    refresher_months: int = Field(default=12, ge=0)
    sequence: int = Field(gt=0)
    is_mandatory: bool = True
