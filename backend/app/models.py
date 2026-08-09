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
    # BUILD PROMPT v5 BLOCK F: org-wide fallback attempt cap — a
    # TrainingModule.max_attempts override always wins when set.
    default_max_quiz_attempts: Mapped[int] = mapped_column(Integer, default=3)


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
    # BUILD PROMPT v5 item A3: the real reports-to relationship, mirroring
    # Supabase's app_users.manager_id — department is not a reporting
    # line. Nullable: unassigned reports are a real state, not an error.
    manager_id: Mapped[str | None] = mapped_column(ForeignKey("users.id"), nullable=True)
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
    # BUILD PROMPT v5 BLOCK E: plain URL into SOPGalaxy, same convention as
    # Activity.sop_link — this app does not run its own SOP repository.
    sop_url: Mapped[str | None] = mapped_column(String(500), nullable=True)
    sop_label: Mapped[str | None] = mapped_column(String(200), nullable=True)
    # BUILD PROMPT v5 BLOCK F: per-module override; null falls back to
    # Organization.default_max_quiz_attempts.
    max_attempts: Mapped[int | None] = mapped_column(Integer, nullable=True)


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
    # BUILD PROMPT v5 BLOCK F: attempts-used is computed by counting
    # QuizAttempt rows created after attempts_reset_at (or all, if unset) —
    # a genuine reset, not a permanent block once tripped.
    onboarding_blocked: Mapped[bool] = mapped_column(Boolean, default=False)
    attempts_reset_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)


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
    # BUILD PROMPT v5 BLOCK G: 'query' keeps the original open/in_review/
    # resolved/dismissed lifecycle untouched; 'suggestion' uses the same
    # 5-state lifecycle as Rule.published_version_id's sibling table,
    # RuleChangeSuggestion (submitted -> under_review -> accepted/rejected
    # -> implementation_pending -> implemented).
    type: Mapped[str] = mapped_column(String(20), default="query")
    target_implementation_date: Mapped[date | None] = mapped_column(Date, nullable=True)
    rejection_reason: Mapped[str | None] = mapped_column(Text, nullable=True)


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


class Notification(Base):
    # Mirrors Supabase's notification_outbox (which the n8n email pipeline
    # also reads via status/sent_at) — read_at is purely in-app "seen in the
    # bell dropdown" state and must never be confused with email delivery.
    __tablename__ = "notification_outbox"
    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=uid)
    org_id: Mapped[str] = mapped_column(ForeignKey("organizations.id"), index=True)
    user_id: Mapped[str] = mapped_column(ForeignKey("users.id"), index=True)
    kind: Mapped[str] = mapped_column(String(40))
    subject: Mapped[str] = mapped_column(String(200))
    payload: Mapped[dict] = mapped_column(JSON, default=dict)
    status: Mapped[str] = mapped_column(String(20), default="pending")
    scheduled_for: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)
    sent_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    read_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow, index=True)


class ReadinessSnapshot(Base):
    # Mirrors Supabase's readiness_snapshots — one row per org per day,
    # captured lazily off the exact same formula /api/v1/admin/analytics
    # uses (see main.py's captureReadinessSnapshot equivalent), never a
    # second independent calculation.
    __tablename__ = "readiness_snapshots"
    __table_args__ = (UniqueConstraint("org_id", "captured_at"),)
    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=uid)
    org_id: Mapped[str] = mapped_column(ForeignKey("organizations.id"), index=True)
    score: Mapped[int] = mapped_column(Integer)
    components: Mapped[list] = mapped_column(JSON, default=list)
    captured_at: Mapped[date] = mapped_column(Date, default=date.today)


# BUILD PROMPT v5 BLOCK A — mirrors Supabase's candidates /
# preboarding_acknowledgments / org_preboarding_content. A candidate is
# deliberately its own table, not a User with a status flag — they have
# none of the fields a real employee needs (password_hash, role,
# manager_id), and giving them a User row would mean every
# employee-facing query has to remember to filter candidates back out.
class Candidate(Base):
    __tablename__ = "candidates"
    __table_args__ = (UniqueConstraint("org_id", "email"),)
    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=uid)
    org_id: Mapped[str] = mapped_column(ForeignKey("organizations.id"), index=True)
    department_id: Mapped[str | None] = mapped_column(ForeignKey("departments.id"), nullable=True)
    full_name: Mapped[str] = mapped_column(String(160))
    email: Mapped[str] = mapped_column(String(255))
    invite_token: Mapped[str] = mapped_column(String(36), default=uid, unique=True, index=True)
    status: Mapped[str] = mapped_column(String(20), default="invited")
    created_by: Mapped[str | None] = mapped_column(ForeignKey("users.id"), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)


class PreboardingAcknowledgment(Base):
    __tablename__ = "preboarding_acknowledgments"
    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=uid)
    candidate_id: Mapped[str] = mapped_column(ForeignKey("candidates.id"), unique=True)
    acknowledged_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)
    ip_address: Mapped[str | None] = mapped_column(String(64), nullable=True)
    user_agent: Mapped[str | None] = mapped_column(String(400), nullable=True)


class OrgPreboardingContent(Base):
    __tablename__ = "org_preboarding_content"
    org_id: Mapped[str] = mapped_column(ForeignKey("organizations.id"), primary_key=True)
    block_key: Mapped[str] = mapped_column(String(40), primary_key=True)
    body: Mapped[str] = mapped_column(Text, default="")
    updated_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)


# BUILD PROMPT v5 BLOCK B: stage-gated onboarding journey. Mirrors
# supabase/migrations/20260809050000_block_b_onboarding_journey.sql
# exactly. See that file's header comment for the item_type reasoning
# (why 'rules_ack' is deliberately not a valid value yet).
class OnboardingStage(Base, TimestampMixin):
    __tablename__ = "onboarding_stages"
    __table_args__ = (UniqueConstraint("org_id", "sequence"),)
    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=uid)
    org_id: Mapped[str] = mapped_column(ForeignKey("organizations.id"), index=True)
    name: Mapped[str] = mapped_column(String(160))
    description: Mapped[str] = mapped_column(Text, default="")
    sequence: Mapped[int] = mapped_column(Integer)


class OnboardingStageItem(Base, TimestampMixin):
    __tablename__ = "onboarding_stage_items"
    __table_args__ = (UniqueConstraint("stage_id", "sequence"),)
    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=uid)
    stage_id: Mapped[str] = mapped_column(ForeignKey("onboarding_stages.id"), index=True)
    item_type: Mapped[str] = mapped_column(String(30))
    training_module_id: Mapped[str | None] = mapped_column(ForeignKey("training_modules.id"), nullable=True)
    # BUILD PROMPT v5 BLOCK C: not a real FK — Content Library
    # (content_assets) has never been mirrored in this reference backend
    # (it depends on Supabase Storage for file uploads, which this stack
    # doesn't replicate). This column exists only so the row shape matches
    # the Edge Function's; the journey/admin routes below always report
    # content_asset: None here rather than pretending to resolve it.
    content_asset_id: Mapped[str | None] = mapped_column(String(36), nullable=True)
    title: Mapped[str] = mapped_column(String(200))
    description: Mapped[str] = mapped_column(Text, default="")
    sequence: Mapped[int] = mapped_column(Integer)


class EmployeeItemProgress(Base):
    __tablename__ = "employee_item_progress"
    __table_args__ = (UniqueConstraint("user_id", "item_id"),)
    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=uid)
    user_id: Mapped[str] = mapped_column(ForeignKey("users.id"), index=True)
    item_id: Mapped[str] = mapped_column(ForeignKey("onboarding_stage_items.id"), index=True)
    completed_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)


# BUILD PROMPT v5 BLOCK D: mirrors
# supabase/migrations/20260809070000_block_d_rules_and_regulations.sql.
# See that file's header comment for the versioning/gating reasoning.
# Cross-field validation (rejected requires rejection_reason, etc.) is
# enforced in the route handlers below, matching every other model in
# this file — none of them use a DB-level CheckConstraint either.
class Rule(Base, TimestampMixin):
    __tablename__ = "rules"
    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=uid)
    org_id: Mapped[str] = mapped_column(ForeignKey("organizations.id"), index=True)
    department_id: Mapped[str | None] = mapped_column(ForeignKey("departments.id"), nullable=True)
    title: Mapped[str] = mapped_column(String(200))
    category: Mapped[str] = mapped_column(String(60), default="general")
    is_mandatory: Mapped[bool] = mapped_column(Boolean, default=True)
    status: Mapped[str] = mapped_column(String(20), default="active")
    published_version_id: Mapped[str | None] = mapped_column(String(36), nullable=True)
    created_by: Mapped[str | None] = mapped_column(ForeignKey("users.id"), nullable=True)
    # BUILD PROMPT v5 BLOCK E: plain URL into SOPGalaxy, same convention as
    # Activity.sop_link / TrainingModule.sop_url.
    sop_url: Mapped[str | None] = mapped_column(String(500), nullable=True)
    sop_label: Mapped[str | None] = mapped_column(String(200), nullable=True)


class RuleVersion(Base):
    __tablename__ = "rule_versions"
    __table_args__ = (UniqueConstraint("rule_id", "version"),)
    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=uid)
    rule_id: Mapped[str] = mapped_column(ForeignKey("rules.id"), index=True)
    version: Mapped[int] = mapped_column(Integer)
    body: Mapped[str] = mapped_column(Text)
    created_by: Mapped[str | None] = mapped_column(ForeignKey("users.id"), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)


class RuleRead(Base):
    __tablename__ = "rule_reads"
    __table_args__ = (UniqueConstraint("rule_version_id", "user_id"),)
    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=uid)
    rule_version_id: Mapped[str] = mapped_column(ForeignKey("rule_versions.id"), index=True)
    user_id: Mapped[str] = mapped_column(ForeignKey("users.id"), index=True)
    read_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)


class RuleChangeSuggestion(Base, TimestampMixin):
    __tablename__ = "rule_change_suggestions"
    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=uid)
    rule_id: Mapped[str] = mapped_column(ForeignKey("rules.id"), index=True)
    suggested_by: Mapped[str] = mapped_column(ForeignKey("users.id"), index=True)
    suggestion_text: Mapped[str] = mapped_column(Text)
    status: Mapped[str] = mapped_column(String(30), default="submitted")
    rejection_reason: Mapped[str | None] = mapped_column(Text, nullable=True)
    target_implementation_date: Mapped[date | None] = mapped_column(Date, nullable=True)
    reviewed_by: Mapped[str | None] = mapped_column(ForeignKey("users.id"), nullable=True)
    reviewed_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)


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
