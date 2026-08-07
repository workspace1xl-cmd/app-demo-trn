from datetime import date, datetime
from uuid import uuid4

from sqlalchemy import Boolean, Date, DateTime, Float, ForeignKey, Integer, JSON, String, Text, UniqueConstraint
from sqlalchemy.orm import Mapped, mapped_column, relationship

from .db import Base


def uid() -> str:
    return str(uuid4())


class TimestampMixin:
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)
    updated_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)


class Organization(Base, TimestampMixin):
    __tablename__ = "organizations"
    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=uid)
    name: Mapped[str] = mapped_column(String(160), unique=True)
    slug: Mapped[str] = mapped_column(String(80), unique=True, index=True)
    status: Mapped[str] = mapped_column(String(30), default="active")
    settings: Mapped[dict] = mapped_column(JSON, default=dict)


class Department(Base, TimestampMixin):
    __tablename__ = "departments"
    __table_args__ = (UniqueConstraint("org_id", "name"),)
    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=uid)
    org_id: Mapped[str] = mapped_column(ForeignKey("organizations.id"), index=True)
    name: Mapped[str] = mapped_column(String(120))
    code: Mapped[str] = mapped_column(String(20))


class User(Base, TimestampMixin):
    __tablename__ = "users"
    __table_args__ = (UniqueConstraint("org_id", "email"),)
    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=uid)
    org_id: Mapped[str] = mapped_column(ForeignKey("organizations.id"), index=True)
    department_id: Mapped[str | None] = mapped_column(ForeignKey("departments.id"), nullable=True)
    email: Mapped[str] = mapped_column(String(255), index=True)
    full_name: Mapped[str] = mapped_column(String(160))
    role: Mapped[str] = mapped_column(String(30), default="employee")
    password_hash: Mapped[str] = mapped_column(String(255))
    is_active: Mapped[bool] = mapped_column(Boolean, default=True)


class Activity(Base, TimestampMixin):
    __tablename__ = "activities"
    __table_args__ = (UniqueConstraint("org_id", "name"),)
    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=uid)
    org_id: Mapped[str] = mapped_column(ForeignKey("organizations.id"), index=True)
    name: Mapped[str] = mapped_column(String(180), index=True)
    department: Mapped[str] = mapped_column(String(120), index=True)
    responsible_role: Mapped[str] = mapped_column(String(160))
    current_person: Mapped[str] = mapped_column(String(160), default="Organisation to confirm")
    backup_person: Mapped[str] = mapped_column(String(160), default="Department backup")
    contact_details: Mapped[str] = mapped_column(String(255))
    sla: Mapped[str] = mapped_column(String(120))
    escalation_level_1: Mapped[str] = mapped_column(String(160))
    escalation_level_2: Mapped[str] = mapped_column(String(160))
    related_documents: Mapped[list] = mapped_column(JSON, default=list)
    sop_link: Mapped[str | None] = mapped_column(String(255), nullable=True)
    training_module_link: Mapped[str | None] = mapped_column(String(255), nullable=True)
    process_steps: Mapped[list] = mapped_column(JSON, default=list)
    status: Mapped[str] = mapped_column(String(30), default="confirmed")


# SOP documents live in SOPGalaxy (https://app.sopgalaxy.com/), not here —
# no editor, no approval workflow, no status tracking. The former
# SOPDocument model / sop_documents table has been removed, not left
# running in parallel; Activity.sop_link (above) is the only trace of SOPs
# this backend keeps, and it's a plain URL, not an owned record.


class TrainingModule(Base, TimestampMixin):
    __tablename__ = "training_modules"
    __table_args__ = (UniqueConstraint("org_id", "code"),)
    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=uid)
    org_id: Mapped[str] = mapped_column(ForeignKey("organizations.id"), index=True)
    code: Mapped[str] = mapped_column(String(30), index=True)
    title: Mapped[str] = mapped_column(String(200))
    objective: Mapped[str] = mapped_column(Text)
    duration_minutes: Mapped[int] = mapped_column(Integer)
    content_type: Mapped[str] = mapped_column(String(50), default="text")
    content: Mapped[dict] = mapped_column(JSON, default=dict)
    passing_score: Mapped[int] = mapped_column(Integer, default=80)
    refresher_months: Mapped[int] = mapped_column(Integer, default=12)
    sequence: Mapped[int] = mapped_column(Integer)
    is_mandatory: Mapped[bool] = mapped_column(Boolean, default=True)
    status: Mapped[str] = mapped_column(String(30), default="published")


class QuizQuestion(Base, TimestampMixin):
    __tablename__ = "quiz_questions"
    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=uid)
    org_id: Mapped[str] = mapped_column(ForeignKey("organizations.id"), index=True)
    module_id: Mapped[str] = mapped_column(ForeignKey("training_modules.id"), index=True)
    prompt: Mapped[str] = mapped_column(Text)
    options: Mapped[list] = mapped_column(JSON)
    correct_index: Mapped[int] = mapped_column(Integer)
    explanation: Mapped[str] = mapped_column(Text)


class Enrollment(Base, TimestampMixin):
    __tablename__ = "enrollments"
    __table_args__ = (UniqueConstraint("org_id", "user_id", "module_id"),)
    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=uid)
    org_id: Mapped[str] = mapped_column(ForeignKey("organizations.id"), index=True)
    user_id: Mapped[str] = mapped_column(ForeignKey("users.id"), index=True)
    module_id: Mapped[str] = mapped_column(ForeignKey("training_modules.id"), index=True)
    status: Mapped[str] = mapped_column(String(30), default="locked")
    progress_percent: Mapped[int] = mapped_column(Integer, default=0)
    best_score: Mapped[int | None] = mapped_column(Integer, nullable=True)
    completed_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    due_date: Mapped[date | None] = mapped_column(Date, nullable=True)
    assigned_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    assigned_by: Mapped[str | None] = mapped_column(ForeignKey("users.id"), nullable=True)


class QuizAttempt(Base, TimestampMixin):
    __tablename__ = "quiz_attempts"
    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=uid)
    org_id: Mapped[str] = mapped_column(ForeignKey("organizations.id"), index=True)
    user_id: Mapped[str] = mapped_column(ForeignKey("users.id"), index=True)
    module_id: Mapped[str] = mapped_column(ForeignKey("training_modules.id"), index=True)
    score: Mapped[int] = mapped_column(Integer)
    passed: Mapped[bool] = mapped_column(Boolean)
    answers: Mapped[list] = mapped_column(JSON)


class Certificate(Base, TimestampMixin):
    __tablename__ = "certificates"
    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=uid)
    org_id: Mapped[str] = mapped_column(ForeignKey("organizations.id"), index=True)
    user_id: Mapped[str] = mapped_column(ForeignKey("users.id"), index=True)
    module_id: Mapped[str] = mapped_column(ForeignKey("training_modules.id"), index=True)
    certificate_number: Mapped[str] = mapped_column(String(80), unique=True)
    issued_at: Mapped[date] = mapped_column(Date, default=date.today)
    expires_at: Mapped[date | None] = mapped_column(Date, nullable=True)


class KnowledgeFeedback(Base, TimestampMixin):
    __tablename__ = "knowledge_feedback"
    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=uid)
    org_id: Mapped[str] = mapped_column(ForeignKey("organizations.id"), index=True)
    user_id: Mapped[str] = mapped_column(ForeignKey("users.id"), index=True)
    query: Mapped[str] = mapped_column(Text)
    reason: Mapped[str] = mapped_column(Text)
    status: Mapped[str] = mapped_column(String(30), default="open")
    routed_to: Mapped[str | None] = mapped_column(String(160), nullable=True)
    resolution: Mapped[str | None] = mapped_column(Text, nullable=True)
    resolved_by: Mapped[str | None] = mapped_column(ForeignKey("users.id"), nullable=True)
    resolved_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)


class MistakeRegisterEntry(Base, TimestampMixin):
    __tablename__ = "mistake_register"
    __table_args__ = (UniqueConstraint("org_id", "code"),)
    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=uid)
    org_id: Mapped[str] = mapped_column(ForeignKey("organizations.id"), index=True)
    code: Mapped[str] = mapped_column(String(30), index=True)
    title: Mapped[str] = mapped_column(String(200))
    description: Mapped[str] = mapped_column(Text)
    correct_practice: Mapped[str] = mapped_column(Text)
    category: Mapped[str] = mapped_column(String(80))
    severity: Mapped[str] = mapped_column(String(20), default="medium")
    department: Mapped[str | None] = mapped_column(String(120), nullable=True)
    module_id: Mapped[str | None] = mapped_column(ForeignKey("training_modules.id"), nullable=True)
    status: Mapped[str] = mapped_column(String(30), default="active")
    is_seed: Mapped[bool] = mapped_column(Boolean, default=False)


class AuditEvent(Base):
    __tablename__ = "audit_events"
    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=uid)
    org_id: Mapped[str] = mapped_column(ForeignKey("organizations.id"), index=True)
    actor_user_id: Mapped[str | None] = mapped_column(ForeignKey("users.id"), nullable=True)
    action: Mapped[str] = mapped_column(String(120), index=True)
    entity_type: Mapped[str] = mapped_column(String(80))
    entity_id: Mapped[str | None] = mapped_column(String(36), nullable=True)
    details: Mapped[dict] = mapped_column(JSON, default=dict)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow, index=True)
