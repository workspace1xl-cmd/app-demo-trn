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
from .models import Activity, AuditEvent, Certificate, Enrollment, KnowledgeFeedback, Organization, QuizAttempt, QuizQuestion, SOPDocument, TrainingModule, User
from .schemas import ActivityCreate, FeedbackRequest, LoginRequest, ModuleCreate, QuizSubmission, SOPCreate, SearchRequest, TokenResponse
from .security import create_token, verify_password
from .seed import seed_database


settings = get_settings()


def audit(db: Session, user: User, action: str, entity_type: str, entity_id: str | None = None, details: dict | None = None) -> None:
    db.add(AuditEvent(org_id=user.org_id, actor_user_id=user.id, action=action, entity_type=entity_type, entity_id=entity_id, details=details or {}))


def activity_dict(item: Activity) -> dict:
    return {column.name: getattr(item, column.name) for column in item.__table__.columns}


def sop_dict(item: SOPDocument) -> dict:
    return {column.name: getattr(item, column.name) for column in item.__table__.columns}


def module_dict(item: TrainingModule, enrollment: Enrollment | None = None) -> dict:
    data = {column.name: getattr(item, column.name) for column in item.__table__.columns}
    data["progress"] = None if not enrollment else {"status": enrollment.status, "percent": enrollment.progress_percent, "best_score": enrollment.best_score}
    return data


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
    return TokenResponse(access_token=create_token(user.id, user.org_id, user.role), user={"id": user.id, "name": user.full_name, "email": user.email, "role": user.role, "org_id": user.org_id})


@app.get("/api/v1/me")
def me(user: User = Depends(current_user)):
    return {"id": user.id, "org_id": user.org_id, "name": user.full_name, "email": user.email, "role": user.role, "department_id": user.department_id}


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


@app.post("/api/v1/activities", status_code=status.HTTP_201_CREATED)
def create_activity(payload: ActivityCreate, user: User = Depends(admin_user), db: Session = Depends(get_db)):
    item = Activity(org_id=user.org_id, **payload.model_dump()); db.add(item); db.flush(); audit(db, user, "activity.create", "activity", item.id); db.commit(); return activity_dict(item)


@app.get("/api/v1/sops")
def list_sops(q: str | None = None, user: User = Depends(current_user), db: Session = Depends(get_db)):
    stmt = select(SOPDocument).where(SOPDocument.org_id == user.org_id)
    if q: stmt = stmt.where(or_(SOPDocument.title.ilike(f"%{q}%"), SOPDocument.code.ilike(f"%{q}%"), SOPDocument.department.ilike(f"%{q}%")))
    return [sop_dict(item) for item in db.scalars(stmt.order_by(SOPDocument.code)).all()]


@app.post("/api/v1/sops", status_code=201)
def create_sop(payload: SOPCreate, user: User = Depends(admin_user), db: Session = Depends(get_db)):
    item = SOPDocument(org_id=user.org_id, **payload.model_dump()); db.add(item); db.flush(); audit(db, user, "sop.create", "sop", item.id); db.commit(); return sop_dict(item)


@app.get("/api/v1/training/modules")
def list_modules(user: User = Depends(current_user), db: Session = Depends(get_db)):
    modules = db.scalars(select(TrainingModule).where(TrainingModule.org_id == user.org_id).order_by(TrainingModule.sequence)).all()
    enrolled = {item.module_id: item for item in db.scalars(select(Enrollment).where(Enrollment.org_id == user.org_id, Enrollment.user_id == user.id)).all()}
    return [module_dict(item, enrolled.get(item.id)) for item in modules]


@app.post("/api/v1/training/modules", status_code=201)
def create_module(payload: ModuleCreate, user: User = Depends(admin_user), db: Session = Depends(get_db)):
    item = TrainingModule(org_id=user.org_id, **payload.model_dump()); db.add(item); db.flush(); audit(db, user, "module.create", "training_module", item.id); db.commit(); return module_dict(item)


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
    sops = db.scalars(select(SOPDocument).where(SOPDocument.org_id == user.org_id, or_(SOPDocument.title.ilike(needle), SOPDocument.summary.ilike(needle))).limit(5)).all()
    modules = db.scalars(select(TrainingModule).where(TrainingModule.org_id == user.org_id, or_(TrainingModule.title.ilike(needle), TrainingModule.objective.ilike(needle))).limit(5)).all()
    context = "\n".join([f"Activity: {a.name}; owner {a.responsible_role}; contact {a.contact_details}; SLA {a.sla}; escalation {a.escalation_level_1} then {a.escalation_level_2}; steps {a.process_steps}" for a in activities] + [f"SOP: {s.code} {s.title}; {s.summary}" for s in sops] + [f"Training: {m.code} {m.title}; {m.objective}" for m in modules])
    ai_answer = await claude_summary(payload.query, context) if context else None
    audit(db, user, "knowledge.search", "search", details={"query": payload.query, "result_count": len(activities) + len(sops) + len(modules), "ai_used": bool(ai_answer)}); db.commit()
    return {"query": payload.query, "answer": ai_answer or (f"Verified results found for {payload.query}. Use the official owner, channel and SLA below." if context else "No confirmed answer was found. Report this question for owner review."), "confidence": 0.93 if activities else 0.72 if context else 0.0, "ai_used": bool(ai_answer), "activities": [activity_dict(a) for a in activities], "sops": [sop_dict(s) for s in sops], "modules": [module_dict(m) for m in modules], "unresolved": not bool(context)}


@app.post("/api/v1/feedback", status_code=201)
def create_feedback(payload: FeedbackRequest, user: User = Depends(current_user), db: Session = Depends(get_db)):
    item = KnowledgeFeedback(org_id=user.org_id, user_id=user.id, query=payload.query, reason=payload.reason, routed_to="Knowledge governance queue"); db.add(item); db.flush(); audit(db, user, "feedback.create", "knowledge_feedback", item.id); db.commit(); return {"id": item.id, "status": item.status, "routed_to": item.routed_to}


@app.get("/api/v1/admin/analytics")
def analytics(user: User = Depends(admin_user), db: Session = Depends(get_db)):
    employees = db.scalar(select(func.count()).select_from(User).where(User.org_id == user.org_id, User.role == "employee")) or 0
    total_enrollments = db.scalar(select(func.count()).select_from(Enrollment).where(Enrollment.org_id == user.org_id)) or 0
    complete = db.scalar(select(func.count()).select_from(Enrollment).where(Enrollment.org_id == user.org_id, Enrollment.status == "completed")) or 0
    average = db.scalar(select(func.avg(QuizAttempt.score)).where(QuizAttempt.org_id == user.org_id)) or 0
    return {"employees": employees, "training_completion": round(complete / total_enrollments * 100) if total_enrollments else 0, "certificates": db.scalar(select(func.count()).select_from(Certificate).where(Certificate.org_id == user.org_id)) or 0, "average_quiz_score": round(float(average), 1), "open_feedback": db.scalar(select(func.count()).select_from(KnowledgeFeedback).where(KnowledgeFeedback.org_id == user.org_id, KnowledgeFeedback.status == "open")) or 0, "activities": db.scalar(select(func.count()).select_from(Activity).where(Activity.org_id == user.org_id)) or 0, "sops": db.scalar(select(func.count()).select_from(SOPDocument).where(SOPDocument.org_id == user.org_id)) or 0}


@app.get("/api/v1/admin/audit")
def audit_log(limit: int = Query(default=50, ge=1, le=200), user: User = Depends(admin_user), db: Session = Depends(get_db)):
    rows = db.scalars(select(AuditEvent).where(AuditEvent.org_id == user.org_id).order_by(AuditEvent.created_at.desc()).limit(limit)).all()
    return [{column.name: getattr(item, column.name) for column in item.__table__.columns} for item in rows]
