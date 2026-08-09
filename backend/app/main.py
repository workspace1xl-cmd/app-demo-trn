import math
import re
import secrets
from contextlib import asynccontextmanager
from datetime import date, datetime, timedelta

import httpx
from fastapi import Depends, FastAPI, HTTPException, Query, Request, status
from fastapi.middleware.cors import CORSMiddleware
from sqlalchemy import func, or_, select
from sqlalchemy.orm import Session

from .config import get_settings
from .db import Base, SessionLocal, engine, get_db
from .deps import admin_user, current_user
from .models import Activity, AuditEvent, Candidate, Certificate, Department, Enrollment, KnowledgeFeedback, MistakeRegisterEntry, Notification, OrgPreboardingContent, Organization, PreboardingAcknowledgment, QuizAttempt, QuizQuestion, ReadinessSnapshot, TrainingModule, User
from .schemas import ActivityCreate, ActivityUpdate, AssignRequest, DepartmentCreate, DepartmentUpdate, EmployeeCreate, EmployeeUpdate, EnrollmentUpdate, FeedbackRequest, FeedbackResolve, LoginRequest, MistakeCreate, MistakeUpdate, ModuleCreate, ModuleUpdate, OrganizationSignup, QuestionCreate, QuestionUpdate, QuizSubmission, SearchRequest, TokenResponse
from .security import create_token, hash_password, verify_password
from .seed import MODULES, seed_database


settings = get_settings()


def audit(db: Session, user: User, action: str, entity_type: str, entity_id: str | None = None, details: dict | None = None) -> None:
    db.add(AuditEvent(org_id=user.org_id, actor_user_id=user.id, action=action, entity_type=entity_type, entity_id=entity_id, details=details or {}))


# Mirrors Supabase's public.enqueue_onework_reminders(), which runs nightly
# there via pg_cron. There's no scheduler in this local reference backend,
# so it's run lazily and idempotently (same "not already enqueued today"
# guard) the moment a signed-in user asks for their notifications, instead
# of introducing a whole separate job runner just for the demo mirror.
def _enqueue_reminders(db: Session, org_id: str) -> None:
    today = date.today()
    todays_notifs = db.scalars(select(Notification).where(Notification.org_id == org_id, func.date(Notification.created_at) == today)).all()
    already_reminded = {(n.user_id, n.kind, n.payload.get("module_id") or n.payload.get("certificate_id")) for n in todays_notifs}

    stale_cutoff = datetime.utcnow() - timedelta(days=7)
    stale = db.scalars(
        select(Enrollment).where(Enrollment.org_id == org_id, Enrollment.status.in_(["assigned", "in_progress"]), Enrollment.updated_at < stale_cutoff)
    ).all()
    for enrollment in stale:
        if (enrollment.user_id, "learning_reminder", enrollment.module_id) in already_reminded:
            continue
        module = db.get(TrainingModule, enrollment.module_id)
        if not module:
            continue
        db.add(Notification(org_id=org_id, user_id=enrollment.user_id, kind="learning_reminder", subject="Continue your required OneWork training",
                             payload={"module_id": module.id, "module_code": module.code, "module_title": module.title, "status": enrollment.status}))

    expiring = db.scalars(
        select(Certificate).where(Certificate.org_id == org_id, Certificate.expires_at.isnot(None), Certificate.expires_at >= today, Certificate.expires_at <= today + timedelta(days=60))
    ).all()
    for cert in expiring:
        if (cert.user_id, "certificate_expiry", cert.id) in already_reminded:
            continue
        module = db.get(TrainingModule, cert.module_id)
        db.add(Notification(org_id=org_id, user_id=cert.user_id, kind="certificate_expiry", subject="Your OneWork certificate is approaching expiry",
                             payload={"certificate_id": cert.id, "certificate_number": cert.certificate_number, "expires_at": cert.expires_at.isoformat(), "module_title": module.title if module else None}))
    db.flush()


def activity_dict(item: Activity) -> dict:
    return {column.name: getattr(item, column.name) for column in item.__table__.columns}


def module_dict(item: TrainingModule, enrollment: Enrollment | None = None) -> dict:
    data = {column.name: getattr(item, column.name) for column in item.__table__.columns}
    data["progress"] = None if not enrollment else {"status": enrollment.status, "percent": enrollment.progress_percent, "best_score": enrollment.best_score}
    return data


def row_dict(item) -> dict:
    return {column.name: getattr(item, column.name) for column in item.__table__.columns}


def paginate_query(stmt, db: Session, page: int, page_size: int):
    page_size = page_size if page_size in (10, 20, 50, 100) else 20
    page = max(page, 1)
    total = db.scalar(select(func.count()).select_from(stmt.subquery())) or 0
    rows = db.scalars(stmt.offset((page - 1) * page_size).limit(page_size)).all()
    return rows, {"page": page, "page_size": page_size, "total": total}


def require_status(value: str | None, allowed: set[str], field: str) -> None:
    if value is not None and value not in allowed:
        raise HTTPException(400, {"detail": f"Select a valid {field}.", "field": field})


SLUG_RE = re.compile(r"^[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?$")


@asynccontextmanager
async def lifespan(_: FastAPI):
    Base.metadata.create_all(bind=engine)
    with SessionLocal() as db:
        seed_database(db)
    yield


app = FastAPI(title=settings.app_name, version="1.0.0", lifespan=lifespan)
app.add_middleware(CORSMiddleware, allow_origins=settings.allowed_origins, allow_credentials=True, allow_methods=["*"], allow_headers=["*"])


@app.get("/health")
def health(db: Session = Depends(get_db)):
    db.execute(select(1))
    return {"status": "healthy", "service": "onework-api", "time": datetime.utcnow().isoformat()}


@app.post("/api/v1/auth/login", response_model=TokenResponse)
def login(payload: LoginRequest, db: Session = Depends(get_db)):
    org = db.scalar(select(Organization).where(Organization.slug == payload.organization, Organization.status == "active"))
    if not org:
        raise HTTPException(status_code=401, detail="Organisation unavailable")
    user = db.scalar(select(User).where(User.org_id == org.id, func.lower(User.email) == payload.email.lower()))
    if not user or not verify_password(payload.password, user.password_hash):
        raise HTTPException(status_code=401, detail="Incorrect email or password")
    audit(db, user, "auth.login", "user", user.id); db.commit()
    return TokenResponse(access_token=create_token(user.id, user.org_id, user.role), user={"id": user.id, "name": user.full_name, "email": user.email, "role": user.role, "org_id": user.org_id, "org_name": org.name})


@app.post("/api/v1/organizations", response_model=TokenResponse, status_code=201)
def create_organization(payload: OrganizationSignup, db: Session = Depends(get_db)):
    name = payload.organization_name.strip()
    slug = payload.organization_slug.strip().lower()
    if not SLUG_RE.match(slug):
        raise HTTPException(400, {"detail": "Organisation URL may only contain lowercase letters, numbers and hyphens.", "field": "organization_slug"})
    if db.scalar(select(Organization).where(or_(Organization.slug == slug, Organization.name == name))):
        raise HTTPException(400, {"detail": "An organisation with this name or URL already exists.", "field": "organization_name"})
    if db.scalar(select(User).where(func.lower(User.email) == payload.email.lower())):
        raise HTTPException(400, {"detail": "An account with this Email ID already exists.", "field": "email"})

    org = Organization(name=name, slug=slug, settings={"passing_score": 80, "onboarded_via": "self_signup"})
    db.add(org); db.flush()
    department = Department(org_id=org.id, name="Human Resources", code="HR")
    db.add(department)
    for dept_name, dept_code in [("Information Technology", "IT"), ("Finance", "FIN"), ("Operations", "OPS"), ("Administration", "ADM")]:
        db.add(Department(org_id=org.id, name=dept_name, code=dept_code))
    db.flush()
    admin = User(org_id=org.id, department_id=department.id, email=payload.email.lower(), full_name=payload.full_name.strip(), role="admin", password_hash=hash_password(payload.password))
    db.add(admin); db.flush()

    for index, (code, title, objective, duration) in enumerate(MODULES, 1):
        module = TrainingModule(org_id=org.id, code=code, title=title, objective=objective, duration_minutes=duration, sequence=index, content_type="mixed", status="published")
        db.add(module); db.flush()
        db.add(QuizQuestion(org_id=org.id, module_id=module.id, prompt=f"Which action best demonstrates: {title}?", options=["Use the approved process and documented owner", "Ask informally and skip the record", "Use a personal channel", "Wait without escalating"], correct_index=0, explanation="Use the approved process, official channel and documented owner."))

    audit(db, admin, "organization.provision", "organization", org.id, {"name": org.name}); db.commit()
    return TokenResponse(access_token=create_token(admin.id, org.id, admin.role), user={"id": admin.id, "name": admin.full_name, "email": admin.email, "role": admin.role, "org_id": org.id, "org_name": org.name})


# ---------------------------------------------------------------------------
# BUILD PROMPT v5 BLOCK A: Pre-Joining Portal — genuinely public routes
# (no Depends(current_user)/admin_user): a candidate has no account yet,
# so there's no session to authenticate. Scoped entirely by invite_token.
# ---------------------------------------------------------------------------
@app.get("/api/v1/public/preview/{token}")
def public_preview(token: str, db: Session = Depends(get_db)):
    candidate = db.scalar(select(Candidate).where(Candidate.invite_token == token))
    if not candidate:
        raise HTTPException(404, "This invite link isn't valid. Ask whoever sent it for a new one.")
    org = db.get(Organization, candidate.org_id)
    department = db.get(Department, candidate.department_id) if candidate.department_id else None
    content = {c.block_key: c.body for c in db.scalars(select(OrgPreboardingContent).where(OrgPreboardingContent.org_id == candidate.org_id)).all()}
    ack = db.scalar(select(PreboardingAcknowledgment).where(PreboardingAcknowledgment.candidate_id == candidate.id))
    return {
        "candidate_name": candidate.full_name,
        "org_name": org.name if org else "the organisation",
        "department_name": department.name if department else None,
        "welcome": content.get("welcome", ""),
        "expectations_from_you": content.get("expectations_from_you", ""),
        "expectations_from_us": content.get("expectations_from_us", ""),
        # Block D (Rules & Regulations) doesn't exist yet — say so rather
        # than silently showing an empty rules section.
        "rules_available": False,
        "already_acknowledged": ack is not None,
        "acknowledged_at": ack.acknowledged_at.isoformat() if ack else None,
    }


@app.post("/api/v1/public/preview/{token}/acknowledge")
def public_acknowledge(token: str, request: Request, db: Session = Depends(get_db)):
    candidate = db.scalar(select(Candidate).where(Candidate.invite_token == token))
    if not candidate:
        raise HTTPException(404, "This invite link isn't valid. Ask whoever sent it for a new one.")
    # Idempotent: a double-click or a reloaded confirmation page must not
    # error just because the acknowledgment already exists.
    existing = db.scalar(select(PreboardingAcknowledgment).where(PreboardingAcknowledgment.candidate_id == candidate.id))
    if not existing:
        db.add(PreboardingAcknowledgment(candidate_id=candidate.id, ip_address=request.client.host if request.client else None, user_agent=request.headers.get("user-agent")))
        candidate.status = "acknowledged"
        db.commit()
    return {"ok": True}


@app.get("/api/v1/me")
def me(user: User = Depends(current_user), db: Session = Depends(get_db)):
    org = db.get(Organization, user.org_id)
    return {"id": user.id, "org_id": user.org_id, "org_name": org.name if org else None, "name": user.full_name, "email": user.email, "role": user.role, "department_id": user.department_id}


def _round_half_up(value: float) -> int:
    # Python's builtin round() rounds .5 to the nearest EVEN integer
    # (round(54.5) == 54, round(55.5) == 56) — "banker's rounding". The
    # Supabase Edge Function this backend mirrors is TypeScript/Deno, where
    # Math.round always rounds .5 up (Math.round(54.5) === 55). Same
    # formula, same input, different output between the two backends for
    # any score that happens to land exactly on a half-point — caught by
    # hovering the readiness ring in the browser and seeing 54 where the
    # component math (9% + 100%) / 2 = 54.5 should read 55.
    return math.floor(value + 0.5)


def _certificate_currency(certificates: list[Certificate]) -> float | None:
    if not certificates:
        return None
    today = date.today()
    current = sum(1 for c in certificates if not c.expires_at or c.expires_at >= today)
    return _round_half_up(current / len(certificates) * 100)


def _score_from_components(components: list[dict]) -> dict:
    applicable = [c for c in components if c["percent"] is not None]
    score = _round_half_up(sum(c["percent"] for c in applicable) / len(applicable)) if applicable else 0
    return {"score": score, "components": components}


# BUILD PROMPT v4 item 6 — mirrors the Edge Function's captureReadinessSnapshot:
# upserts today's org-wide readiness (already computed by _score_from_components,
# never recalculated here) so /api/v1/admin/exec has a trend to draw. Idempotent
# per (org_id, captured_at); caller still owns the commit.
def _capture_readiness_snapshot(db: Session, org_id: str, readiness: dict) -> None:
    today = date.today()
    existing = db.scalar(select(ReadinessSnapshot).where(ReadinessSnapshot.org_id == org_id, ReadinessSnapshot.captured_at == today))
    if existing:
        existing.score = readiness["score"]
        existing.components = readiness["components"]
    else:
        db.add(ReadinessSnapshot(org_id=org_id, score=readiness["score"], components=readiness["components"], captured_at=today))


# BUILD PROMPT v4 item 8 — mirrors the Edge Function's buildGamification():
# milestones are thresholds against the real curriculum size, and the
# streak is the longest run of consecutive CALENDAR DAYS with at least one
# real completed_at, not "days since login" — a historical fact, not
# something that implies activity happening today.
_MILESTONE_THRESHOLDS = [
    {"key": "getting_started", "label": "Getting started", "fraction": 0.25},
    {"key": "halfway", "label": "Halfway there", "fraction": 0.5},
    {"key": "almost_there", "label": "Almost there", "fraction": 0.75},
    {"key": "graduate", "label": "Fully certified", "fraction": 1},
]


def _longest_streak(completed_ats: list[datetime | None]) -> int:
    days = sorted({d.date() for d in completed_ats if d})
    if not days:
        return 0
    best = current = 1
    for i in range(1, len(days)):
        current = current + 1 if (days[i] - days[i - 1]).days == 1 else 1
        best = max(best, current)
    return best


def _build_gamification(completed: int, total: int, enrollments: list[Enrollment]) -> dict:
    milestones = [{**m, "achieved": total > 0 and completed >= math.ceil(m["fraction"] * total)} for m in _MILESTONE_THRESHOLDS]
    return {"streak_days": _longest_streak([e.completed_at for e in enrollments]), "milestones": milestones}


@app.get("/api/v1/dashboard")
def dashboard(user: User = Depends(current_user), db: Session = Depends(get_db)):
    enrollments = db.scalars(select(Enrollment).where(Enrollment.org_id == user.org_id, Enrollment.user_id == user.id)).all()
    certificates = db.scalars(select(Certificate).where(Certificate.org_id == user.org_id, Certificate.user_id == user.id)).all()
    complete = sum(item.status == "completed" for item in enrollments)
    total = len(enrollments)
    training_percent = _round_half_up(complete / total * 100) if total else 0
    components = [{"key": "training", "label": "Training completion", "percent": training_percent}]
    currency = _certificate_currency(certificates)
    if currency is not None:
        components.append({"key": "cert_currency", "label": "Certificates current (not expired)", "percent": currency})
    return {"user": {"name": user.full_name, "role": user.role}, "training": {"completed": complete, "total": total, "percent": training_percent}, "certificates": len(certificates), "points": sum((item.best_score or 0) * 5 for item in enrollments), "open_actions": sum(item.status in {"in_progress", "assigned"} for item in enrollments), "readiness": _score_from_components(components), "gamification": _build_gamification(complete, total, enrollments)}


# -----------------------------------------------------------------------
# Manager dashboard (BUILD PROMPT v4 item 4) — RBAC-scoped to "my team",
# reusing department_id as the reporting-line signal since that's the
# only one that already exists on User; there is no real org-chart/
# reports-to model yet. "manager" was already a valid role value on the
# admin Employees form before this route existed — nothing previously
# treated it differently from "employee".
# -----------------------------------------------------------------------
# BUILD PROMPT v5 item A3 — mirrors the Edge Function's manager/dashboard
# rewrite: walks the real manager_id chain (depth-capped BFS, so
# manager-of-manager rollup works) instead of the department_id proxy the
# first version used. Department is not a reporting line.
def _team_subtree(db: Session, org_id: str, root_id: str) -> list[User]:
    all_users = db.scalars(select(User).where(User.org_id == org_id, User.is_active == True)).all()  # noqa: E712
    direct_reports_of: dict[str, list[User]] = {}
    for u in all_users:
        if u.manager_id:
            direct_reports_of.setdefault(u.manager_id, []).append(u)
    subtree: list[User] = []
    seen = {root_id}
    frontier = [root_id]
    for _ in range(10):
        if not frontier:
            break
        nxt: list[str] = []
        for manager_id in frontier:
            for report in direct_reports_of.get(manager_id, []):
                if report.id in seen:
                    continue
                seen.add(report.id)
                subtree.append(report)
                nxt.append(report.id)
        frontier = nxt
    return subtree


@app.get("/api/v1/manager/dashboard")
def manager_dashboard(user: User = Depends(current_user), db: Session = Depends(get_db)):
    if user.role not in ("manager", "admin"):
        raise HTTPException(403, "Manager permission required.")
    subtree = _team_subtree(db, user.org_id, user.id)
    dept_by_id = {d.id: d.name for d in db.scalars(select(Department).where(Department.org_id == user.org_id)).all()}
    team_dept_ids = sorted({m.department_id for m in subtree if m.department_id})
    team_departments = [{"id": did, "name": dept_by_id.get(did, "Unknown")} for did in team_dept_ids]
    team_dept_names = [d["name"] for d in team_departments]
    total_modules = db.scalar(select(func.count()).select_from(TrainingModule).where(TrainingModule.org_id == user.org_id, TrainingModule.status == "published")) or 0
    today = date.today()
    # BUILD PROMPT v5 item B2: last nudge time per member, reusing
    # notification_outbox (kind='learning_reminder') as the record rather
    # than a separate nudge-log table.
    subtree_ids = [m.id for m in subtree]
    last_nudged_by_user: dict[str, datetime] = {}
    if subtree_ids:
        nudge_rows = db.scalars(select(Notification).where(Notification.org_id == user.org_id, Notification.user_id.in_(subtree_ids), Notification.kind == "learning_reminder").order_by(Notification.created_at.desc())).all()
        for n in nudge_rows:
            last_nudged_by_user.setdefault(n.user_id, n.created_at)
    members = []
    for member in subtree:
        rows = db.scalars(select(Enrollment).where(Enrollment.org_id == user.org_id, Enrollment.user_id == member.id)).all()
        completed = sum(1 for r in rows if r.status == "completed")
        overdue = sum(1 for r in rows if r.due_date and r.due_date < today and r.status != "completed")
        percent = _round_half_up(completed / total_modules * 100) if total_modules else 0
        last_nudged = last_nudged_by_user.get(member.id)
        members.append({"id": member.id, "name": member.full_name, "email": member.email, "department": dept_by_id.get(member.department_id), "training_percent": percent, "completed": completed, "total": total_modules, "overdue_count": overdue, "last_nudged_at": last_nudged.isoformat() if last_nudged else None})
    team_total = sum(m["total"] for m in members)
    team_completed = sum(m["completed"] for m in members)
    team_percent = _round_half_up(team_completed / team_total * 100) if team_total else 0
    team_readiness = _score_from_components([{"key": "training", "label": "Team training completion", "percent": team_percent}])
    activities = db.scalars(select(Activity).where(Activity.org_id == user.org_id, Activity.department.in_(team_dept_names))).all() if team_dept_names else []
    return {
        "departments": team_departments,
        "team_readiness": team_readiness,
        "members": members,
        "overdue_total": sum(m["overdue_count"] for m in members),
        "activities": [activity_dict(a) for a in activities],
        "has_reports": len(members) > 0,
    }


# BUILD PROMPT v5 item B2 — mirrors the Edge Function's nudge route:
# manager (or admin) sends an immediate reminder instead of waiting for
# the nightly enqueue, scoped to the caller's real reports-to subtree,
# capped at one per person per 24h.
@app.post("/api/v1/manager/nudge/{target_id}")
def nudge_employee(target_id: str, user: User = Depends(current_user), db: Session = Depends(get_db)):
    if user.role not in ("manager", "admin"):
        raise HTTPException(403, "Manager permission required.")
    if user.role != "admin":
        subtree_ids = {m.id for m in _team_subtree(db, user.org_id, user.id)}
        if target_id not in subtree_ids:
            raise HTTPException(403, "This person doesn't report to you.")
    cutoff = datetime.utcnow() - timedelta(hours=24)
    recent = db.scalar(select(Notification).where(Notification.org_id == user.org_id, Notification.user_id == target_id, Notification.kind == "learning_reminder", Notification.created_at >= cutoff).order_by(Notification.created_at.desc()))
    if recent:
        return {"ok": True, "already_nudged": True, "last_nudged_at": recent.created_at.isoformat()}
    today = date.today()
    overdue = db.scalars(select(Enrollment).where(Enrollment.org_id == user.org_id, Enrollment.user_id == target_id, Enrollment.due_date.isnot(None), Enrollment.due_date < today, Enrollment.status != "completed")).all()
    if not overdue:
        raise HTTPException(409, "No overdue training to nudge about.")
    modules_by_id = {m.id: m for m in db.scalars(select(TrainingModule).where(TrainingModule.org_id == user.org_id)).all()}
    for e in overdue:
        module = modules_by_id.get(e.module_id)
        db.add(Notification(org_id=user.org_id, user_id=target_id, kind="learning_reminder", subject="Continue your required OneWork training", payload={"module_id": e.module_id, "module_code": module.code if module else None, "module_title": module.title if module else None, "status": e.status, "nudged_by": user.id}))
    audit(db, user, "manager.nudge", "app_user", target_id, {"count": len(overdue)})
    db.commit()
    return {"ok": True, "already_nudged": False, "nudged_count": len(overdue)}


def _notification_dict(item: Notification) -> dict:
    return {"id": item.id, "kind": item.kind, "subject": item.subject, "payload": item.payload, "created_at": item.created_at.isoformat(), "read_at": item.read_at.isoformat() if item.read_at else None}


@app.get("/api/v1/notifications")
def list_notifications(user: User = Depends(current_user), db: Session = Depends(get_db)):
    _enqueue_reminders(db, user.org_id)
    db.commit()
    rows = db.scalars(select(Notification).where(Notification.org_id == user.org_id, Notification.user_id == user.id).order_by(Notification.created_at.desc()).limit(30)).all()
    return {"notifications": [_notification_dict(n) for n in rows], "unread_count": sum(1 for n in rows if not n.read_at)}


@app.post("/api/v1/notifications/{notification_id}/read")
def mark_notification_read(notification_id: str, user: User = Depends(current_user), db: Session = Depends(get_db)):
    notif = db.get(Notification, notification_id)
    if not notif or notif.org_id != user.org_id or notif.user_id != user.id:
        raise HTTPException(404, "Notification not found.")
    notif.read_at = datetime.utcnow()
    db.commit()
    return {"ok": True}


@app.post("/api/v1/notifications/read-all")
def mark_all_notifications_read(user: User = Depends(current_user), db: Session = Depends(get_db)):
    rows = db.scalars(select(Notification).where(Notification.org_id == user.org_id, Notification.user_id == user.id, Notification.read_at.is_(None))).all()
    for n in rows:
        n.read_at = datetime.utcnow()
    db.commit()
    return {"ok": True, "marked": len(rows)}


@app.get("/api/v1/activities")
def list_activities(q: str | None = None, department: str | None = None, user: User = Depends(current_user), db: Session = Depends(get_db)):
    stmt = select(Activity).where(Activity.org_id == user.org_id)
    if q:
        needle = f"%{q}%"; stmt = stmt.where(or_(Activity.name.ilike(needle), Activity.department.ilike(needle), Activity.responsible_role.ilike(needle)))
    if department:
        stmt = stmt.where(Activity.department == department)
    return [activity_dict(item) for item in db.scalars(stmt.order_by(Activity.department, Activity.name)).all()]


@app.get("/api/v1/activities/{activity_id}")
def get_activity(activity_id: str, user: User = Depends(current_user), db: Session = Depends(get_db)):
    item = db.scalar(select(Activity).where(Activity.id == activity_id, Activity.org_id == user.org_id))
    if not item: raise HTTPException(404, "Activity not found")
    return activity_dict(item)


@app.post("/api/v1/admin/activities", status_code=status.HTTP_201_CREATED)
def create_activity(payload: ActivityCreate, user: User = Depends(admin_user), db: Session = Depends(get_db)):
    if db.scalar(select(Activity).where(Activity.org_id == user.org_id, Activity.name == payload.name)):
        raise HTTPException(409, "An activity with this name already exists.")
    item = Activity(org_id=user.org_id, **payload.model_dump()); db.add(item); db.flush(); audit(db, user, "activity.create", "activity", item.id); db.commit(); return activity_dict(item)


# BUILD PROMPT v5 item B3 — mirrors the Edge Function's activities/import:
# client-mapped CSV rows in, per-row created/error report out.
_ACTIVITY_IMPORT_REQUIRED = ["name", "department", "responsible_role", "contact_details", "sla", "escalation_level_1", "escalation_level_2"]


@app.post("/api/v1/admin/activities/import")
def import_activities(payload: dict, user: User = Depends(admin_user), db: Session = Depends(get_db)):
    rows = payload.get("rows") or []
    if not rows:
        raise HTTPException(400, "No rows to import.")
    if len(rows) > 500:
        raise HTTPException(400, "Import is capped at 500 rows at a time.")
    created, errors = [], []
    for i, r in enumerate(rows):
        row_num, name = i + 1, str(r.get("name") or "").strip()
        missing = next((f for f in _ACTIVITY_IMPORT_REQUIRED if not str(r.get(f) or "").strip()), None)
        if missing:
            errors.append({"row": row_num, "name": name, "message": f"{missing.replace('_', ' ')} is required."})
            continue
        if db.scalar(select(Activity).where(Activity.org_id == user.org_id, Activity.name == name)):
            errors.append({"row": row_num, "name": name, "message": "An activity with this name already exists."})
            continue
        item = Activity(
            org_id=user.org_id, name=name, department=str(r["department"]).strip(), responsible_role=str(r["responsible_role"]).strip(),
            current_person=str(r.get("current_person") or "").strip() or "Organisation to confirm", backup_person=str(r.get("backup_person") or "").strip() or "Department backup",
            contact_details=str(r["contact_details"]).strip(), sla=str(r["sla"]).strip(), escalation_level_1=str(r["escalation_level_1"]).strip(), escalation_level_2=str(r["escalation_level_2"]).strip(),
            sop_link=r.get("sop_link") or None, training_module_link=r.get("training_module_link") or None,
        )
        db.add(item); db.flush(); created.append(item)
    if created:
        audit(db, user, "activity.bulk_import", "activity", None, {"created": len(created), "errors": len(errors)})
    db.commit()
    return {"created": len(created), "errors": errors}


@app.patch("/api/v1/admin/activities/{activity_id}")
def update_activity(activity_id: str, payload: ActivityUpdate, user: User = Depends(admin_user), db: Session = Depends(get_db)):
    item = db.scalar(select(Activity).where(Activity.id == activity_id, Activity.org_id == user.org_id))
    if not item: raise HTTPException(404, "Activity not found.")
    require_status(payload.status, {"draft", "confirmed", "archived"}, "status")
    for field, value in payload.model_dump(exclude_unset=True).items(): setattr(item, field, value)
    db.flush(); audit(db, user, "activity.update", "activity", item.id); db.commit(); return activity_dict(item)


# SOP documents live in SOPGalaxy (https://app.sopgalaxy.com/), not here —
# no editor, no approval workflow, no status tracking. Activity.sop_link is
# the only trace of SOPs this backend keeps: a plain URL, not an owned
# record.


@app.get("/api/v1/training/modules")
def list_modules(user: User = Depends(current_user), db: Session = Depends(get_db)):
    modules = db.scalars(select(TrainingModule).where(TrainingModule.org_id == user.org_id).order_by(TrainingModule.sequence)).all()
    enrolled = {item.module_id: item for item in db.scalars(select(Enrollment).where(Enrollment.org_id == user.org_id, Enrollment.user_id == user.id)).all()}
    return [module_dict(item, enrolled.get(item.id)) for item in modules]


@app.post("/api/v1/admin/training/modules", status_code=201)
def create_module(payload: ModuleCreate, user: User = Depends(admin_user), db: Session = Depends(get_db)):
    if db.scalar(select(TrainingModule).where(TrainingModule.org_id == user.org_id, TrainingModule.code == payload.code)):
        raise HTTPException(409, "A module with this code already exists.")
    max_sequence = db.scalar(select(func.max(TrainingModule.sequence)).where(TrainingModule.org_id == user.org_id)) or 0
    item = TrainingModule(org_id=user.org_id, sequence=max_sequence + 1, status="draft", **payload.model_dump())
    db.add(item); db.flush()
    employees = db.scalars(select(User).where(User.org_id == user.org_id, User.role == "employee", User.is_active == True)).all()  # noqa: E712
    for employee in employees:
        db.add(Enrollment(org_id=user.org_id, user_id=employee.id, module_id=item.id, status="locked", assigned_by=user.id, assigned_at=datetime.utcnow()))
    audit(db, user, "module.create", "training_module", item.id); db.commit(); return module_dict(item)


@app.patch("/api/v1/admin/training/modules/{module_id}")
def update_module(module_id: str, payload: ModuleUpdate, user: User = Depends(admin_user), db: Session = Depends(get_db)):
    item = db.scalar(select(TrainingModule).where(TrainingModule.id == module_id, TrainingModule.org_id == user.org_id))
    if not item: raise HTTPException(404, "Module not found.")
    require_status(payload.status, {"draft", "published", "archived"}, "status")
    for field, value in payload.model_dump(exclude_unset=True).items(): setattr(item, field, value)
    db.flush(); audit(db, user, "module.update", "training_module", item.id); db.commit(); return module_dict(item)


@app.get("/api/v1/admin/training/modules/{module_id}/questions")
def list_questions(module_id: str, user: User = Depends(admin_user), db: Session = Depends(get_db)):
    return [row_dict(q) for q in db.scalars(select(QuizQuestion).where(QuizQuestion.org_id == user.org_id, QuizQuestion.module_id == module_id).order_by(QuizQuestion.created_at)).all()]


@app.post("/api/v1/admin/training/modules/{module_id}/questions", status_code=201)
def create_question(module_id: str, payload: QuestionCreate, user: User = Depends(admin_user), db: Session = Depends(get_db)):
    if payload.correct_index >= len(payload.options):
        raise HTTPException(400, {"detail": "Select which option is correct.", "field": "correct_index"})
    item = QuizQuestion(org_id=user.org_id, module_id=module_id, **payload.model_dump())
    db.add(item); db.flush(); audit(db, user, "question.create", "quiz_question", item.id); db.commit(); return row_dict(item)


@app.patch("/api/v1/admin/training/questions/{question_id}")
def update_question(question_id: str, payload: QuestionUpdate, user: User = Depends(admin_user), db: Session = Depends(get_db)):
    item = db.scalar(select(QuizQuestion).where(QuizQuestion.id == question_id, QuizQuestion.org_id == user.org_id))
    if not item: raise HTTPException(404, "Question not found.")
    for field, value in payload.model_dump(exclude_unset=True).items(): setattr(item, field, value)
    db.flush(); audit(db, user, "question.update", "quiz_question", item.id); db.commit(); return row_dict(item)


@app.delete("/api/v1/admin/training/questions/{question_id}")
def delete_question(question_id: str, user: User = Depends(admin_user), db: Session = Depends(get_db)):
    item = db.scalar(select(QuizQuestion).where(QuizQuestion.id == question_id, QuizQuestion.org_id == user.org_id))
    if not item: raise HTTPException(404, "Question not found.")
    db.delete(item); audit(db, user, "question.delete", "quiz_question", question_id); db.commit(); return {"deleted": True}


@app.get("/api/v1/training/modules/{module_id}/quiz")
def get_quiz(module_id: str, user: User = Depends(current_user), db: Session = Depends(get_db)):
    module = db.scalar(select(TrainingModule).where(TrainingModule.id == module_id, TrainingModule.org_id == user.org_id))
    if not module: raise HTTPException(404, "Module not found")
    questions = db.scalars(select(QuizQuestion).where(QuizQuestion.org_id == user.org_id, QuizQuestion.module_id == module_id)).all()
    return {"module_id": module.id, "title": module.title, "passing_score": module.passing_score, "questions": [{"id": q.id, "prompt": q.prompt, "options": q.options} for q in questions]}


@app.post("/api/v1/training/modules/{module_id}/attempt")
def submit_quiz(module_id: str, payload: QuizSubmission, user: User = Depends(current_user), db: Session = Depends(get_db)):
    module = db.scalar(select(TrainingModule).where(TrainingModule.id == module_id, TrainingModule.org_id == user.org_id))
    if not module: raise HTTPException(404, "Module not found")
    questions = db.scalars(select(QuizQuestion).where(QuizQuestion.org_id == user.org_id, QuizQuestion.module_id == module_id).order_by(QuizQuestion.created_at)).all()
    if not questions or len(payload.answers) != len(questions): raise HTTPException(400, "Submit one answer for every question")
    correct = sum(answer == question.correct_index for answer, question in zip(payload.answers, questions)); score = round(correct / len(questions) * 100); passed = score >= module.passing_score
    db.add(QuizAttempt(org_id=user.org_id, user_id=user.id, module_id=module.id, score=score, passed=passed, answers=payload.answers))
    enrollment = db.scalar(select(Enrollment).where(Enrollment.org_id == user.org_id, Enrollment.user_id == user.id, Enrollment.module_id == module.id))
    if enrollment:
        enrollment.best_score = max(enrollment.best_score or 0, score)
        if passed:
            enrollment.status = "completed"; enrollment.progress_percent = 100; enrollment.completed_at = datetime.utcnow()
            existing = db.scalar(select(Certificate).where(Certificate.org_id == user.org_id, Certificate.user_id == user.id, Certificate.module_id == module.id))
            if not existing: db.add(Certificate(org_id=user.org_id, user_id=user.id, module_id=module.id, certificate_number=f"OW-{module.code}-{datetime.utcnow().strftime('%Y%m%d%H%M%S')}", issued_at=date.today(), expires_at=date.today() + timedelta(days=module.refresher_months * 30)))
            next_module = db.scalar(select(TrainingModule).where(TrainingModule.org_id == user.org_id, TrainingModule.sequence == module.sequence + 1))
            if next_module:
                next_enrollment = db.scalar(select(Enrollment).where(Enrollment.org_id == user.org_id, Enrollment.user_id == user.id, Enrollment.module_id == next_module.id))
                if next_enrollment and next_enrollment.status == "locked": next_enrollment.status = "assigned"
    audit(db, user, "quiz.submit", "training_module", module.id, {"score": score, "passed": passed}); db.commit()
    return {"score": score, "passed": passed, "passing_score": module.passing_score, "correct": correct, "total": len(questions), "explanations": [q.explanation for q in questions]}


@app.get("/api/v1/certificates")
def certificates(user: User = Depends(current_user), db: Session = Depends(get_db)):
    rows = db.execute(select(Certificate, TrainingModule).join(TrainingModule, Certificate.module_id == TrainingModule.id).where(Certificate.org_id == user.org_id, Certificate.user_id == user.id)).all()
    return [{"id": cert.id, "certificate_number": cert.certificate_number, "module": module.title, "issued_at": cert.issued_at, "expires_at": cert.expires_at} for cert, module in rows]


@app.get("/api/v1/mistakes")
def list_mistakes(q: str | None = None, user: User = Depends(current_user), db: Session = Depends(get_db)):
    stmt = select(MistakeRegisterEntry).where(MistakeRegisterEntry.org_id == user.org_id, MistakeRegisterEntry.status == "active")
    if q: stmt = stmt.where(or_(MistakeRegisterEntry.title.ilike(f"%{q}%"), MistakeRegisterEntry.description.ilike(f"%{q}%"), MistakeRegisterEntry.category.ilike(f"%{q}%")))
    return [row_dict(item) for item in db.scalars(stmt.order_by(MistakeRegisterEntry.code)).all()]


async def claude_summary(query: str, context: str) -> str | None:
    if not settings.anthropic_api_key: return None
    prompt = f"Answer the employee question only from the verified organisational context. Be concise. If context is insufficient, say it must be escalated.\nQuestion: {query}\nContext:\n{context}"
    try:
        async with httpx.AsyncClient(timeout=20) as client:
            response = await client.post("https://api.anthropic.com/v1/messages", headers={"x-api-key": settings.anthropic_api_key, "anthropic-version": "2023-06-01", "content-type": "application/json"}, json={"model": settings.anthropic_model, "max_tokens": 500, "messages": [{"role": "user", "content": prompt}]})
            response.raise_for_status(); data = response.json(); return "\n".join(block.get("text", "") for block in data.get("content", []) if block.get("type") == "text")
    except (httpx.HTTPError, KeyError, TypeError):
        # Verified deterministic retrieval remains available when the optional
        # AI provider is unavailable, rate limited or misconfigured.
        return None


_SEARCH_STOP_WORDS = {"a", "an", "and", "can", "do", "does", "for", "how", "i", "is", "my", "of", "process", "request", "the", "to", "what", "where", "who"}


# Extracts real keywords from a natural-language question instead of
# ILIKE-matching the whole raw sentence (which the Edge Function this
# backend mirrors never did either — a mismatch caught while wiring the AI
# assistant into every screen: "who do I ask about leave" matched zero rows
# here because no activity name literally contains that whole phrase, while
# the Edge Function already stripped it down to the single term "leave").
def _search_terms(query: str) -> list[str]:
    words = [re.sub(r"[^a-z0-9-]", "", w) for w in query.lower().split()]
    terms = [w for w in words if len(w) > 2 and w not in _SEARCH_STOP_WORDS][:6]
    return terms or [query.lower()]


@app.post("/api/v1/search")
async def knowledge_search(payload: SearchRequest, user: User = Depends(current_user), db: Session = Depends(get_db)):
    terms = _search_terms(payload.query)
    activity_clause = or_(*[or_(Activity.name.ilike(f"%{t}%"), Activity.department.ilike(f"%{t}%"), Activity.responsible_role.ilike(f"%{t}%")) for t in terms])
    module_clause = or_(*[or_(TrainingModule.title.ilike(f"%{t}%"), TrainingModule.objective.ilike(f"%{t}%"), TrainingModule.code.ilike(f"%{t}%")) for t in terms])
    mistake_clause = or_(*[or_(MistakeRegisterEntry.title.ilike(f"%{t}%"), MistakeRegisterEntry.description.ilike(f"%{t}%"), MistakeRegisterEntry.category.ilike(f"%{t}%")) for t in terms])
    activities = db.scalars(select(Activity).where(Activity.org_id == user.org_id, activity_clause).limit(5)).all()
    modules = db.scalars(select(TrainingModule).where(TrainingModule.org_id == user.org_id, module_clause).limit(5)).all()
    mistakes = db.scalars(select(MistakeRegisterEntry).where(MistakeRegisterEntry.org_id == user.org_id, MistakeRegisterEntry.status == "active", mistake_clause).limit(3)).all()
    # SOP documents live in SOPGalaxy, not a table this backend queries — the
    # only SOP-related signal in context is each activity's own sop_link.
    context = "\n".join([f"Activity: {a.name}; owner {a.responsible_role}; contact {a.contact_details}; SLA {a.sla}; escalation {a.escalation_level_1} then {a.escalation_level_2}; steps {a.process_steps}" + (f"; SOP: {a.sop_link}" if a.sop_link else "") for a in activities] + [f"Training: {m.code} {m.title}; {m.objective}" for m in modules] + [f"Common mistake {mk.code}: {mk.title}. {mk.description} Correct practice: {mk.correct_practice}" for mk in mistakes])
    ai_answer = await claude_summary(payload.query, context) if context else None
    audit(db, user, "knowledge.search", "search", details={"query": payload.query, "result_count": len(activities) + len(modules) + len(mistakes), "ai_used": bool(ai_answer)}); db.commit()
    return {"query": payload.query, "answer": ai_answer or (f"Verified results found for {payload.query}. Use the official owner, channel and SLA below." if context else "No confirmed answer was found. Report this question for owner review."), "confidence": 0.93 if activities else 0.72 if context else 0.0, "ai_used": bool(ai_answer), "activities": [activity_dict(a) for a in activities], "modules": [module_dict(m) for m in modules], "mistakes": [row_dict(mk) for mk in mistakes], "unresolved": not bool(context)}


@app.post("/api/v1/feedback", status_code=201)
def create_feedback(payload: FeedbackRequest, user: User = Depends(current_user), db: Session = Depends(get_db)):
    item = KnowledgeFeedback(org_id=user.org_id, user_id=user.id, query=payload.query, reason=payload.reason, routed_to="Knowledge governance queue"); db.add(item); db.flush(); audit(db, user, "feedback.create", "knowledge_feedback", item.id); db.commit(); return {"id": item.id, "status": item.status, "routed_to": item.routed_to}


@app.get("/api/v1/admin/analytics")
def analytics(user: User = Depends(admin_user), db: Session = Depends(get_db)):
    # Counts every org member (matches the Employees list, which also
    # includes admins) — matches the same fix already shipped in the
    # Supabase Edge Function this backend mirrors.
    employees = db.scalar(select(func.count()).select_from(User).where(User.org_id == user.org_id)) or 0
    total_enrollments = db.scalar(select(func.count()).select_from(Enrollment).where(Enrollment.org_id == user.org_id)) or 0
    complete = db.scalar(select(func.count()).select_from(Enrollment).where(Enrollment.org_id == user.org_id, Enrollment.status == "completed")) or 0
    average = db.scalar(select(func.avg(QuizAttempt.score)).where(QuizAttempt.org_id == user.org_id)) or 0
    training_percent = round(complete / total_enrollments * 100) if total_enrollments else 0
    certificates = db.scalars(select(Certificate).where(Certificate.org_id == user.org_id)).all()
    activities = db.scalars(select(Activity).where(Activity.org_id == user.org_id)).all()
    raci_coverage = None
    if activities:
        named = sum(1 for a in activities if (a.current_person or "").strip().lower() != "organisation to confirm")
        raci_coverage = _round_half_up(named / len(activities) * 100)
    readiness_components = [{"key": "training", "label": "Org-wide training completion", "percent": training_percent}]
    currency = _certificate_currency(certificates)
    if currency is not None:
        readiness_components.append({"key": "cert_currency", "label": "Certificates current (not expired)", "percent": currency})
    if raci_coverage is not None:
        readiness_components.append({"key": "raci_coverage", "label": "Responsibilities with a named owner", "percent": raci_coverage})
    readiness = _score_from_components(readiness_components)
    _capture_readiness_snapshot(db, user.org_id, readiness)
    db.commit()
    return {"employees": employees, "training_completion": training_percent, "certificates": len(certificates), "average_quiz_score": round(float(average), 1), "open_feedback": db.scalar(select(func.count()).select_from(KnowledgeFeedback).where(KnowledgeFeedback.org_id == user.org_id, KnowledgeFeedback.status == "open")) or 0, "activities": len(activities), "readiness": readiness}


@app.get("/api/v1/admin/exec")
def exec_health(user: User = Depends(admin_user), db: Session = Depends(get_db)):
    # Most recent 30 days, oldest first for the chart — mirrors the Edge
    # Function's fix (descending + limit, then reversed) so this can't
    # regress the same way if a limit is added here later.
    trend = list(reversed(db.scalars(select(ReadinessSnapshot).where(ReadinessSnapshot.org_id == user.org_id).order_by(ReadinessSnapshot.captured_at.desc()).limit(30)).all()))
    departments = db.scalars(select(Department).where(Department.org_id == user.org_id).order_by(Department.name)).all()
    dept_users = db.scalars(select(User).where(User.org_id == user.org_id)).all()
    enrollments = db.scalars(select(Enrollment).where(Enrollment.org_id == user.org_id)).all()
    activities = db.scalars(select(Activity).where(Activity.org_id == user.org_id)).all()
    users_by_dept: dict[str, list[str]] = {}
    for u in dept_users:
        if u.department_id:
            users_by_dept.setdefault(u.department_id, []).append(u.id)
    enrollments_by_user: dict[str, list[Enrollment]] = {}
    for e in enrollments:
        enrollments_by_user.setdefault(e.user_id, []).append(e)
    activities_by_dept: dict[str, list[Activity]] = {}
    for a in activities:
        activities_by_dept.setdefault(a.department, []).append(a)
    department_comparison = []
    for d in departments:
        user_ids = users_by_dept.get(d.id, [])
        rows = [e for uid in user_ids for e in enrollments_by_user.get(uid, [])]
        total, complete = len(rows), sum(1 for e in rows if e.status == "completed")
        dept_activities = activities_by_dept.get(d.name, [])
        owned = sum(1 for a in dept_activities if (a.current_person or "").strip().lower() != "organisation to confirm")
        department_comparison.append({
            "id": d.id, "name": d.name, "employee_count": len(user_ids),
            "readiness_score": _round_half_up(complete / total * 100) if total else None,
            "ownership_coverage": _round_half_up(owned / len(dept_activities) * 100) if dept_activities else None,
            "activity_count": len(dept_activities),
        })
    return {"trend": [{"score": s.score, "captured_at": s.captured_at.isoformat()} for s in trend], "departments": department_comparison}


@app.get("/api/v1/admin/audit")
def audit_log(page: int = Query(default=1, ge=1), page_size: int = Query(default=20), user: User = Depends(admin_user), db: Session = Depends(get_db)):
    stmt = select(AuditEvent).where(AuditEvent.org_id == user.org_id).order_by(AuditEvent.created_at.desc())
    rows, meta = paginate_query(stmt, db, page, page_size)
    actors = {a.id: a.full_name for a in db.scalars(select(User).where(User.org_id == user.org_id)).all()}
    return {"items": [{**row_dict(item), "actor": actors.get(item.actor_user_id, "System")} for item in rows], **meta}


# ---------------------------------------------------------------------------
# Administrator: departments
# ---------------------------------------------------------------------------
@app.get("/api/v1/admin/departments")
def list_departments(user: User = Depends(admin_user), db: Session = Depends(get_db)):
    departments = db.scalars(select(Department).where(Department.org_id == user.org_id).order_by(Department.name)).all()
    dept_users = db.scalars(select(User).where(User.org_id == user.org_id)).all()
    enrollments = db.scalars(select(Enrollment).where(Enrollment.org_id == user.org_id)).all()
    users_by_dept: dict[str, list[str]] = {}
    for u in dept_users:
        if u.department_id:
            users_by_dept.setdefault(u.department_id, []).append(u.id)
    enrollments_by_user: dict[str, list[Enrollment]] = {}
    for e in enrollments:
        enrollments_by_user.setdefault(e.user_id, []).append(e)
    result = []
    for d in departments:
        user_ids = users_by_dept.get(d.id, [])
        rows = [e for uid in user_ids for e in enrollments_by_user.get(uid, [])]
        total, complete = len(rows), sum(1 for e in rows if e.status == "completed")
        result.append({**row_dict(d), "employee_count": len(user_ids), "readiness_score": _round_half_up(complete / total * 100) if total else None})
    return result


@app.post("/api/v1/admin/departments", status_code=201)
def create_department(payload: DepartmentCreate, user: User = Depends(admin_user), db: Session = Depends(get_db)):
    if db.scalar(select(Department).where(Department.org_id == user.org_id, or_(Department.name == payload.name.strip(), Department.code == payload.code.strip().upper()))):
        raise HTTPException(409, "A department with this name or code already exists.")
    item = Department(org_id=user.org_id, name=payload.name.strip(), code=payload.code.strip().upper())
    db.add(item); db.flush(); audit(db, user, "department.create", "department", item.id); db.commit(); return row_dict(item)


@app.patch("/api/v1/admin/departments/{department_id}")
def update_department(department_id: str, payload: DepartmentUpdate, user: User = Depends(admin_user), db: Session = Depends(get_db)):
    item = db.scalar(select(Department).where(Department.id == department_id, Department.org_id == user.org_id))
    if not item: raise HTTPException(404, "Department not found.")
    if payload.name: item.name = payload.name.strip()
    if payload.code: item.code = payload.code.strip().upper()
    db.flush(); audit(db, user, "department.update", "department", item.id); db.commit(); return row_dict(item)


# ---------------------------------------------------------------------------
# Administrator: employees
# ---------------------------------------------------------------------------
def employee_dict(item: User) -> dict:
    return {"id": item.id, "email": item.email, "full_name": item.full_name, "role": item.role, "is_active": item.is_active, "department_id": item.department_id, "manager_id": item.manager_id, "created_at": item.created_at}


# Unpaginated id+name lookup for the manager-picker dropdown (BUILD PROMPT
# v5 item A3) — the main employees list is paginated and a manager can be
# on any page, so the dropdown needs its own full-roster source.
@app.get("/api/v1/admin/employees/lookup")
def employees_lookup(user: User = Depends(admin_user), db: Session = Depends(get_db)):
    rows = db.scalars(select(User).where(User.org_id == user.org_id, User.is_active == True).order_by(User.full_name)).all()  # noqa: E712
    return [{"id": u.id, "full_name": u.full_name} for u in rows]


# ---------------------------------------------------------------------------
# BUILD PROMPT v5 BLOCK A: admin side — invite candidates, see who's
# acknowledged, edit the preview page's content blocks.
# ---------------------------------------------------------------------------
@app.get("/api/v1/admin/candidates")
def list_candidates(user: User = Depends(admin_user), db: Session = Depends(get_db)):
    rows = db.scalars(select(Candidate).where(Candidate.org_id == user.org_id).order_by(Candidate.created_at.desc())).all()
    dept_by_id = {d.id: d.name for d in db.scalars(select(Department).where(Department.org_id == user.org_id)).all()}
    acks = {a.candidate_id: a.acknowledged_at for a in db.scalars(select(PreboardingAcknowledgment)).all()}
    return [
        {"id": c.id, "full_name": c.full_name, "email": c.email, "department_id": c.department_id, "department_name": dept_by_id.get(c.department_id) if c.department_id else None,
         "invite_token": c.invite_token, "status": c.status, "created_at": c.created_at.isoformat(), "acknowledged_at": acks[c.id].isoformat() if c.id in acks else None}
        for c in rows
    ]


@app.post("/api/v1/admin/candidates", status_code=201)
def create_candidate(payload: dict, user: User = Depends(admin_user), db: Session = Depends(get_db)):
    full_name = str(payload.get("full_name") or "").strip()
    email = str(payload.get("email") or "").strip().lower()
    if not full_name:
        raise HTTPException(400, {"detail": "Full Name is required.", "field": "full_name"})
    if not email or "@" not in email:
        raise HTTPException(400, {"detail": "Enter a valid Email ID.", "field": "email"})
    if db.scalar(select(Candidate).where(Candidate.org_id == user.org_id, Candidate.email == email)):
        raise HTTPException(409, "A candidate with this Email ID has already been invited.")
    candidate = Candidate(org_id=user.org_id, full_name=full_name, email=email, department_id=payload.get("department_id") or None, created_by=user.id)
    db.add(candidate); db.flush()
    audit(db, user, "candidate.invite", "candidate", candidate.id, {"email": candidate.email}); db.commit()
    return {"id": candidate.id, "full_name": candidate.full_name, "email": candidate.email, "invite_token": candidate.invite_token, "status": candidate.status}


@app.get("/api/v1/admin/preboarding-content")
def get_preboarding_content(user: User = Depends(admin_user), db: Session = Depends(get_db)):
    rows = db.scalars(select(OrgPreboardingContent).where(OrgPreboardingContent.org_id == user.org_id)).all()
    return {r.block_key: r.body for r in rows}


@app.patch("/api/v1/admin/preboarding-content")
def update_preboarding_content(payload: dict, user: User = Depends(admin_user), db: Session = Depends(get_db)):
    allowed = {"welcome", "expectations_from_you", "expectations_from_us"}
    keys = [k for k in payload if k in allowed]
    if not keys:
        raise HTTPException(400, "Nothing to update.")
    for key in keys:
        row = db.get(OrgPreboardingContent, (user.org_id, key))
        if row:
            row.body = str(payload[key])
        else:
            db.add(OrgPreboardingContent(org_id=user.org_id, block_key=key, body=str(payload[key])))
    audit(db, user, "preboarding_content.update", "organization", user.org_id, {"blocks": keys}); db.commit()
    return {"ok": True}


@app.get("/api/v1/admin/employees")
def list_employees(page: int = Query(default=1, ge=1), page_size: int = Query(default=20), q: str | None = None, user: User = Depends(admin_user), db: Session = Depends(get_db)):
    stmt = select(User).where(User.org_id == user.org_id)
    if q: stmt = stmt.where(or_(User.full_name.ilike(f"%{q}%"), User.email.ilike(f"%{q}%")))
    rows, meta = paginate_query(stmt.order_by(User.full_name), db, page, page_size)
    departments = {d.id: d.name for d in db.scalars(select(Department).where(Department.org_id == user.org_id)).all()}
    managers = {m.id: m.full_name for m in db.scalars(select(User).where(User.org_id == user.org_id)).all()}
    return {"items": [{**employee_dict(item), "department_name": departments.get(item.department_id), "manager_name": managers.get(item.manager_id)} for item in rows], **meta}


@app.post("/api/v1/admin/employees", status_code=201)
def create_employee(payload: EmployeeCreate, user: User = Depends(admin_user), db: Session = Depends(get_db)):
    if payload.role not in {"employee", "manager", "content_admin", "admin"}:
        raise HTTPException(400, {"detail": "Select a valid role.", "field": "role"})
    if db.scalar(select(User).where(User.org_id == user.org_id, func.lower(User.email) == payload.email.lower())):
        raise HTTPException(409, "An employee with this Email ID already exists.")
    item = User(org_id=user.org_id, department_id=payload.department_id, manager_id=payload.manager_id, email=payload.email.lower(), full_name=payload.full_name.strip(), role=payload.role, password_hash=hash_password(payload.password))
    db.add(item); db.flush()
    modules = db.scalars(select(TrainingModule).where(TrainingModule.org_id == user.org_id).order_by(TrainingModule.sequence)).all()
    for module in modules:
        db.add(Enrollment(org_id=user.org_id, user_id=item.id, module_id=module.id, status="assigned" if module.sequence == 1 else "locked", assigned_by=user.id, assigned_at=datetime.utcnow()))
    audit(db, user, "employee.create", "app_user", item.id, {"role": item.role}); db.commit(); return employee_dict(item)


# BUILD PROMPT v5 item B3 — mirrors the Edge Function's employees/import.
# Passwords are randomly generated (no invite-email pipeline exists yet,
# same deliberate gap as the Edge Function's version) — an imported
# account needs an admin-issued password reset before first sign-in.
@app.post("/api/v1/admin/employees/import")
def import_employees(payload: dict, user: User = Depends(admin_user), db: Session = Depends(get_db)):
    rows = payload.get("rows") or []
    if not rows:
        raise HTTPException(400, "No rows to import.")
    if len(rows) > 500:
        raise HTTPException(400, "Import is capped at 500 rows at a time.")
    departments = {d.name.lower(): d.id for d in db.scalars(select(Department).where(Department.org_id == user.org_id)).all()}
    users_by_email = {u.email.lower(): u.id for u in db.scalars(select(User).where(User.org_id == user.org_id)).all()}
    modules = db.scalars(select(TrainingModule).where(TrainingModule.org_id == user.org_id).order_by(TrainingModule.sequence)).all()
    created, errors = [], []
    for i, r in enumerate(rows):
        row_num = i + 1
        full_name = str(r.get("full_name") or "").strip()
        email = str(r.get("email") or "").strip().lower()
        role = (str(r.get("role") or "employee").strip().lower()) or "employee"
        dept_name = str(r.get("department") or "").strip()
        manager_email = str(r.get("manager_email") or "").strip().lower()
        if not full_name:
            errors.append({"row": row_num, "email": email, "message": "Full Name is required."}); continue
        if not email or "@" not in email or "." not in email.split("@")[-1]:
            errors.append({"row": row_num, "email": email, "message": "Invalid Email ID."}); continue
        if email in users_by_email:
            errors.append({"row": row_num, "email": email, "message": "An employee with this Email ID already exists."}); continue
        if role not in {"employee", "manager", "content_admin", "admin"}:
            errors.append({"row": row_num, "email": email, "message": f'Unknown role "{role}".'}); continue
        department_id = None
        if dept_name:
            department_id = departments.get(dept_name.lower())
            if not department_id:
                errors.append({"row": row_num, "email": email, "message": f'Unknown department "{dept_name}".'}); continue
        manager_id = None
        if manager_email:
            manager_id = users_by_email.get(manager_email)
            if not manager_id:
                errors.append({"row": row_num, "email": email, "message": f'Manager email "{manager_email}" not found — import the manager first, or leave this blank and set it afterwards.'}); continue
        item = User(org_id=user.org_id, department_id=department_id, manager_id=manager_id, email=email, full_name=full_name, role=role, password_hash=hash_password(secrets.token_urlsafe(12)))
        db.add(item); db.flush()
        for module in modules:
            db.add(Enrollment(org_id=user.org_id, user_id=item.id, module_id=module.id, status="assigned" if module.sequence == 1 else "locked", assigned_by=user.id, assigned_at=datetime.utcnow()))
        users_by_email[email] = item.id  # so a later row can reference this one as its manager
        created.append(item)
    if created:
        audit(db, user, "employee.bulk_import", "app_user", None, {"created": len(created), "errors": len(errors)})
    db.commit()
    return {"created": len(created), "errors": errors}


@app.patch("/api/v1/admin/employees/{employee_id}")
def update_employee(employee_id: str, payload: EmployeeUpdate, user: User = Depends(admin_user), db: Session = Depends(get_db)):
    item = db.scalar(select(User).where(User.id == employee_id, User.org_id == user.org_id))
    if not item: raise HTTPException(404, "Employee not found.")
    if payload.role is not None:
        if payload.role not in {"employee", "manager", "content_admin", "admin"}: raise HTTPException(400, {"detail": "Select a valid role.", "field": "role"})
        item.role = payload.role
    if payload.full_name is not None: item.full_name = payload.full_name.strip()
    if payload.department_id is not None: item.department_id = payload.department_id or None
    if payload.manager_id is not None:
        if payload.manager_id == item.id: raise HTTPException(400, {"detail": "An employee cannot be their own manager.", "field": "manager_id"})
        item.manager_id = payload.manager_id or None
    if payload.is_active is not None: item.is_active = payload.is_active
    if payload.password:
        item.password_hash = hash_password(payload.password)
        audit(db, user, "employee.reset_password", "app_user", item.id)
    db.flush(); audit(db, user, "employee.update", "app_user", item.id); db.commit(); return employee_dict(item)


# ---------------------------------------------------------------------------
# Administrator: assignment and due-date management
# ---------------------------------------------------------------------------
@app.get("/api/v1/admin/enrollments")
def list_enrollments(page: int = Query(default=1, ge=1), page_size: int = Query(default=20), module_id: str | None = None, user: User = Depends(admin_user), db: Session = Depends(get_db)):
    stmt = select(Enrollment).where(Enrollment.org_id == user.org_id)
    if module_id: stmt = stmt.where(Enrollment.module_id == module_id)
    rows, meta = paginate_query(stmt.order_by(Enrollment.due_date.is_(None), Enrollment.due_date), db, page, page_size)
    employees = {u.id: {"id": u.id, "full_name": u.full_name, "email": u.email} for u in db.scalars(select(User).where(User.org_id == user.org_id)).all()}
    modules = {m.id: {"id": m.id, "title": m.title, "code": m.code} for m in db.scalars(select(TrainingModule).where(TrainingModule.org_id == user.org_id)).all()}
    return {"items": [{"id": r.id, "status": r.status, "progress_percent": r.progress_percent, "best_score": r.best_score, "due_date": r.due_date, "completed_at": r.completed_at, "employee": employees.get(r.user_id), "module": modules.get(r.module_id)} for r in rows], **meta}


@app.patch("/api/v1/admin/enrollments/{enrollment_id}")
def update_enrollment(enrollment_id: str, payload: EnrollmentUpdate, user: User = Depends(admin_user), db: Session = Depends(get_db)):
    item = db.scalar(select(Enrollment).where(Enrollment.id == enrollment_id, Enrollment.org_id == user.org_id))
    if not item: raise HTTPException(404, "Assignment not found.")
    require_status(payload.status, {"locked", "assigned", "in_progress", "completed", "waived"}, "status")
    if payload.status is not None: item.status = payload.status
    if payload.due_date is not None: item.due_date = date.fromisoformat(payload.due_date) if payload.due_date else None
    db.flush(); audit(db, user, "enrollment.update", "enrollment", item.id); db.commit(); return row_dict(item)


@app.post("/api/v1/admin/enrollments/assign", status_code=201)
def assign_module(payload: AssignRequest, user: User = Depends(admin_user), db: Session = Depends(get_db)):
    due = date.fromisoformat(payload.due_date) if payload.due_date else None
    assigned = 0
    for employee_id in payload.employee_ids:
        item = db.scalar(select(Enrollment).where(Enrollment.org_id == user.org_id, Enrollment.user_id == employee_id, Enrollment.module_id == payload.module_id))
        if item:
            item.status = "assigned"; item.due_date = due; item.assigned_by = user.id; item.assigned_at = datetime.utcnow()
        else:
            db.add(Enrollment(org_id=user.org_id, user_id=employee_id, module_id=payload.module_id, status="assigned", due_date=due, assigned_by=user.id, assigned_at=datetime.utcnow()))
        assigned += 1
    audit(db, user, "enrollment.assign", "training_module", payload.module_id, {"employee_count": assigned, "due_date": payload.due_date}); db.commit(); return {"assigned": assigned}


# ---------------------------------------------------------------------------
# Administrator: unresolved-question governance queue
# ---------------------------------------------------------------------------
@app.get("/api/v1/admin/feedback")
def list_feedback(page: int = Query(default=1, ge=1), page_size: int = Query(default=20), status_filter: str = Query(default="open", alias="status"), user: User = Depends(admin_user), db: Session = Depends(get_db)):
    stmt = select(KnowledgeFeedback).where(KnowledgeFeedback.org_id == user.org_id, KnowledgeFeedback.status == status_filter).order_by(KnowledgeFeedback.created_at.desc())
    rows, meta = paginate_query(stmt, db, page, page_size)
    employees = {u.id: u.full_name for u in db.scalars(select(User).where(User.org_id == user.org_id)).all()}
    return {"items": [{**row_dict(item), "employee": employees.get(item.user_id, "Unknown")} for item in rows], **meta}


@app.patch("/api/v1/admin/feedback/{feedback_id}")
def resolve_feedback(feedback_id: str, payload: FeedbackResolve, user: User = Depends(admin_user), db: Session = Depends(get_db)):
    item = db.scalar(select(KnowledgeFeedback).where(KnowledgeFeedback.id == feedback_id, KnowledgeFeedback.org_id == user.org_id))
    if not item: raise HTTPException(404, "Feedback item not found.")
    if payload.status not in {"resolved", "dismissed", "in_review"}: raise HTTPException(400, {"detail": "Select a valid status.", "field": "status"})
    if payload.status != "in_review" and not payload.resolution: raise HTTPException(400, {"detail": "Resolution notes are required.", "field": "resolution"})
    item.status = payload.status
    if payload.status != "in_review":
        item.resolution = payload.resolution; item.resolved_by = user.id; item.resolved_at = datetime.utcnow()
    db.flush(); audit(db, user, "feedback.resolve", "knowledge_feedback", item.id, {"status": payload.status}); db.commit(); return row_dict(item)


# ---------------------------------------------------------------------------
# Administrator: common-mistake register
# ---------------------------------------------------------------------------
@app.get("/api/v1/admin/mistakes")
def admin_list_mistakes(page: int = Query(default=1, ge=1), page_size: int = Query(default=20), q: str | None = None, user: User = Depends(admin_user), db: Session = Depends(get_db)):
    stmt = select(MistakeRegisterEntry).where(MistakeRegisterEntry.org_id == user.org_id)
    if q: stmt = stmt.where(or_(MistakeRegisterEntry.title.ilike(f"%{q}%"), MistakeRegisterEntry.category.ilike(f"%{q}%")))
    rows, meta = paginate_query(stmt.order_by(MistakeRegisterEntry.code), db, page, page_size)
    return {"items": [row_dict(item) for item in rows], **meta}


@app.post("/api/v1/admin/mistakes", status_code=201)
def create_mistake(payload: MistakeCreate, user: User = Depends(admin_user), db: Session = Depends(get_db)):
    if db.scalar(select(MistakeRegisterEntry).where(MistakeRegisterEntry.org_id == user.org_id, MistakeRegisterEntry.code == payload.code)):
        raise HTTPException(409, "A register entry with this code already exists.")
    item = MistakeRegisterEntry(org_id=user.org_id, is_seed=False, **payload.model_dump())
    db.add(item); db.flush(); audit(db, user, "mistake.create", "mistake_register", item.id); db.commit(); return row_dict(item)


@app.patch("/api/v1/admin/mistakes/{mistake_id}")
def update_mistake(mistake_id: str, payload: MistakeUpdate, user: User = Depends(admin_user), db: Session = Depends(get_db)):
    item = db.scalar(select(MistakeRegisterEntry).where(MistakeRegisterEntry.id == mistake_id, MistakeRegisterEntry.org_id == user.org_id))
    if not item: raise HTTPException(404, "Register entry not found.")
    for field, value in payload.model_dump(exclude_unset=True).items(): setattr(item, field, value)
    db.flush(); audit(db, user, "mistake.update", "mistake_register", item.id); db.commit(); return row_dict(item)


@app.delete("/api/v1/admin/mistakes/{mistake_id}")
def delete_mistake(mistake_id: str, user: User = Depends(admin_user), db: Session = Depends(get_db)):
    item = db.scalar(select(MistakeRegisterEntry).where(MistakeRegisterEntry.id == mistake_id, MistakeRegisterEntry.org_id == user.org_id))
    if not item: raise HTTPException(404, "Register entry not found.")
    db.delete(item); audit(db, user, "mistake.delete", "mistake_register", mistake_id); db.commit(); return {"deleted": True}
