import re
from contextlib import asynccontextmanager
from datetime import date, datetime, timedelta

import httpx
from fastapi import Depends, FastAPI, HTTPException, Query, status
from fastapi.middleware.cors import CORSMiddleware
from sqlalchemy import func, or_, select
from sqlalchemy.orm import Session

from .config import get_settings
from .db import Base, SessionLocal, engine, get_db
from .deps import admin_user, current_user
from .models import Activity, AuditEvent, Certificate, Department, Enrollment, KnowledgeFeedback, MistakeRegisterEntry, Organization, QuizAttempt, QuizQuestion, TrainingModule, User
from .schemas import ActivityCreate, ActivityUpdate, AssignRequest, DepartmentCreate, DepartmentUpdate, EmployeeCreate, EmployeeUpdate, EnrollmentUpdate, FeedbackRequest, FeedbackResolve, LoginRequest, MistakeCreate, MistakeUpdate, ModuleCreate, ModuleUpdate, OrganizationSignup, QuestionCreate, QuestionUpdate, QuizSubmission, SearchRequest, TokenResponse
from .security import create_token, hash_password, verify_password
from .seed import MODULES, seed_database


settings = get_settings()


def audit(db: Session, user: User, action: str, entity_type: str, entity_id: str | None = None, details: dict | None = None) -> None:
    db.add(AuditEvent(org_id=user.org_id, actor_user_id=user.id, action=action, entity_type=entity_type, entity_id=entity_id, details=details or {}))


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


@app.get("/api/v1/me")
def me(user: User = Depends(current_user), db: Session = Depends(get_db)):
    org = db.get(Organization, user.org_id)
    return {"id": user.id, "org_id": user.org_id, "org_name": org.name if org else None, "name": user.full_name, "email": user.email, "role": user.role, "department_id": user.department_id}


@app.get("/api/v1/dashboard")
def dashboard(user: User = Depends(current_user), db: Session = Depends(get_db)):
    enrollments = db.scalars(select(Enrollment).where(Enrollment.org_id == user.org_id, Enrollment.user_id == user.id)).all()
    certificates = db.scalars(select(Certificate).where(Certificate.org_id == user.org_id, Certificate.user_id == user.id)).all()
    complete = sum(item.status == "completed" for item in enrollments)
    total = len(enrollments)
    return {"user": {"name": user.full_name, "role": user.role}, "training": {"completed": complete, "total": total, "percent": round(complete / total * 100) if total else 0}, "certificates": len(certificates), "points": sum((item.best_score or 0) * 5 for item in enrollments), "open_actions": sum(item.status in {"in_progress", "assigned"} for item in enrollments)}


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


@app.post("/api/v1/search")
async def knowledge_search(payload: SearchRequest, user: User = Depends(current_user), db: Session = Depends(get_db)):
    needle = f"%{payload.query}%"
    activities = db.scalars(select(Activity).where(Activity.org_id == user.org_id, or_(Activity.name.ilike(needle), Activity.department.ilike(needle), Activity.responsible_role.ilike(needle))).limit(5)).all()
    modules = db.scalars(select(TrainingModule).where(TrainingModule.org_id == user.org_id, or_(TrainingModule.title.ilike(needle), TrainingModule.objective.ilike(needle))).limit(5)).all()
    mistakes = db.scalars(select(MistakeRegisterEntry).where(MistakeRegisterEntry.org_id == user.org_id, MistakeRegisterEntry.status == "active", or_(MistakeRegisterEntry.title.ilike(needle), MistakeRegisterEntry.description.ilike(needle))).limit(3)).all()
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
    return {"employees": employees, "training_completion": round(complete / total_enrollments * 100) if total_enrollments else 0, "certificates": db.scalar(select(func.count()).select_from(Certificate).where(Certificate.org_id == user.org_id)) or 0, "average_quiz_score": round(float(average), 1), "open_feedback": db.scalar(select(func.count()).select_from(KnowledgeFeedback).where(KnowledgeFeedback.org_id == user.org_id, KnowledgeFeedback.status == "open")) or 0, "activities": db.scalar(select(func.count()).select_from(Activity).where(Activity.org_id == user.org_id)) or 0}


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
    return [row_dict(d) for d in db.scalars(select(Department).where(Department.org_id == user.org_id).order_by(Department.name)).all()]


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
    return {"id": item.id, "email": item.email, "full_name": item.full_name, "role": item.role, "is_active": item.is_active, "department_id": item.department_id, "created_at": item.created_at}


@app.get("/api/v1/admin/employees")
def list_employees(page: int = Query(default=1, ge=1), page_size: int = Query(default=20), q: str | None = None, user: User = Depends(admin_user), db: Session = Depends(get_db)):
    stmt = select(User).where(User.org_id == user.org_id)
    if q: stmt = stmt.where(or_(User.full_name.ilike(f"%{q}%"), User.email.ilike(f"%{q}%")))
    rows, meta = paginate_query(stmt.order_by(User.full_name), db, page, page_size)
    departments = {d.id: d.name for d in db.scalars(select(Department).where(Department.org_id == user.org_id)).all()}
    return {"items": [{**employee_dict(item), "department_name": departments.get(item.department_id)} for item in rows], **meta}


@app.post("/api/v1/admin/employees", status_code=201)
def create_employee(payload: EmployeeCreate, user: User = Depends(admin_user), db: Session = Depends(get_db)):
    if payload.role not in {"employee", "manager", "content_admin", "admin"}:
        raise HTTPException(400, {"detail": "Select a valid role.", "field": "role"})
    if db.scalar(select(User).where(User.org_id == user.org_id, func.lower(User.email) == payload.email.lower())):
        raise HTTPException(409, "An employee with this Email ID already exists.")
    item = User(org_id=user.org_id, department_id=payload.department_id, email=payload.email.lower(), full_name=payload.full_name.strip(), role=payload.role, password_hash=hash_password(payload.password))
    db.add(item); db.flush()
    modules = db.scalars(select(TrainingModule).where(TrainingModule.org_id == user.org_id).order_by(TrainingModule.sequence)).all()
    for module in modules:
        db.add(Enrollment(org_id=user.org_id, user_id=item.id, module_id=module.id, status="assigned" if module.sequence == 1 else "locked", assigned_by=user.id, assigned_at=datetime.utcnow()))
    audit(db, user, "employee.create", "app_user", item.id, {"role": item.role}); db.commit(); return employee_dict(item)


@app.patch("/api/v1/admin/employees/{employee_id}")
def update_employee(employee_id: str, payload: EmployeeUpdate, user: User = Depends(admin_user), db: Session = Depends(get_db)):
    item = db.scalar(select(User).where(User.id == employee_id, User.org_id == user.org_id))
    if not item: raise HTTPException(404, "Employee not found.")
    if payload.role is not None:
        if payload.role not in {"employee", "manager", "content_admin", "admin"}: raise HTTPException(400, {"detail": "Select a valid role.", "field": "role"})
        item.role = payload.role
    if payload.full_name is not None: item.full_name = payload.full_name.strip()
    if payload.department_id is not None: item.department_id = payload.department_id or None
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
