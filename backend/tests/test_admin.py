import os
from pathlib import Path

TEST_DB = Path("/tmp/onework_api_admin_test.db")
if TEST_DB.exists():
    TEST_DB.unlink()
os.environ["DATABASE_URL"] = f"sqlite:///{TEST_DB}"
os.environ["JWT_SECRET"] = "test-secret"
os.environ.pop("ANTHROPIC_API_KEY", None)

from fastapi.testclient import TestClient

from app.main import app


def login(client: TestClient, email="admin@company.com", password="Admin123!") -> str:
    response = client.post("/api/v1/auth/login", json={"email": email, "password": password, "organization": "example-organisation"})
    assert response.status_code == 200
    return response.json()["access_token"]


def auth(token: str) -> dict:
    return {"Authorization": f"Bearer {token}"}


def test_employee_cannot_reach_admin_routes():
    with TestClient(app) as client:
        token = login(client, "employee@company.com", "Demo123!")
        assert client.get("/api/v1/admin/employees", headers=auth(token)).status_code == 403
        assert client.get("/api/v1/admin/departments", headers=auth(token)).status_code == 403


def test_department_and_employee_lifecycle():
    with TestClient(app) as client:
        token = login(client)

        dept = client.post("/api/v1/admin/departments", headers=auth(token), json={"name": "Customer Success", "code": "CS"})
        assert dept.status_code == 201
        department_id = dept.json()["id"]

        duplicate = client.post("/api/v1/admin/departments", headers=auth(token), json={"name": "Customer Success", "code": "CS2"})
        assert duplicate.status_code == 409

        renamed = client.patch(f"/api/v1/admin/departments/{department_id}", headers=auth(token), json={"name": "Customer Success & Support"})
        assert renamed.status_code == 200
        assert renamed.json()["name"] == "Customer Success & Support"

        created = client.post("/api/v1/admin/employees", headers=auth(token), json={
            "full_name": "Priya Nair", "email": "priya.nair@company.com", "password": "StrongPass1",
            "role": "employee", "department_id": department_id,
        })
        assert created.status_code == 201
        employee_id = created.json()["id"]

        dup_employee = client.post("/api/v1/admin/employees", headers=auth(token), json={
            "full_name": "Priya Nair", "email": "priya.nair@company.com", "password": "StrongPass1", "role": "employee",
        })
        assert dup_employee.status_code == 409

        # A new employee is auto-enrolled: module 1 assigned, the rest locked.
        new_employee_token = login(client, "priya.nair@company.com", "StrongPass1")
        modules = client.get("/api/v1/training/modules", headers=auth(new_employee_token)).json()
        assert modules[0]["progress"]["status"] == "assigned"
        assert modules[1]["progress"]["status"] == "locked"

        updated = client.patch(f"/api/v1/admin/employees/{employee_id}", headers=auth(token), json={"role": "manager", "is_active": True})
        assert updated.status_code == 200
        assert updated.json()["role"] == "manager"

        reset = client.patch(f"/api/v1/admin/employees/{employee_id}", headers=auth(token), json={"password": "AnotherStrongPass1"})
        assert reset.status_code == 200
        relogin = client.post("/api/v1/auth/login", json={"email": "priya.nair@company.com", "password": "AnotherStrongPass1", "organization": "example-organisation"})
        assert relogin.status_code == 200

        listing = client.get("/api/v1/admin/employees?page=1&page_size=10", headers=auth(token))
        assert listing.status_code == 200
        assert listing.json()["total"] >= 3
        assert listing.json()["page_size"] == 10


def test_responsibility_matrix_editor():
    with TestClient(app) as client:
        token = login(client)
        created = client.post("/api/v1/admin/activities", headers=auth(token), json={
            "name": "New Vendor Payment", "department": "Finance", "responsible_role": "AP Specialist",
            "contact_details": "ap@company.com", "sla": "3 business days",
            "escalation_level_1": "Finance Manager", "escalation_level_2": "CFO",
        })
        assert created.status_code == 201
        activity_id = created.json()["id"]

        updated = client.patch(f"/api/v1/admin/activities/{activity_id}", headers=auth(token), json={"sla": "2 business days", "status": "confirmed"})
        assert updated.status_code == 200
        assert updated.json()["sla"] == "2 business days"

        bad_status = client.patch(f"/api/v1/admin/activities/{activity_id}", headers=auth(token), json={"status": "not-a-status"})
        assert bad_status.status_code == 400

        listing = client.get("/api/v1/activities", headers=auth(token)).json()
        assert any(a["id"] == activity_id for a in listing)


def test_sop_approval_workflow():
    with TestClient(app) as client:
        token = login(client)
        created = client.post("/api/v1/admin/sops", headers=auth(token), json={
            "code": "SOP-99", "title": "Remote Work Equipment", "department": "Information Technology",
            "owner_role": "IT Manager", "approver_role": "Head of IT", "summary": "Controls remote equipment issuance.",
        })
        assert created.status_code == 201
        sop_id = created.json()["id"]
        assert created.json()["status"] == "draft"

        cannot_approve_yet = client.post(f"/api/v1/admin/sops/{sop_id}/approve", headers=auth(token))
        assert cannot_approve_yet.status_code == 409

        submitted = client.post(f"/api/v1/admin/sops/{sop_id}/submit", headers=auth(token))
        assert submitted.status_code == 200
        assert submitted.json()["status"] == "in_review"

        approved = client.post(f"/api/v1/admin/sops/{sop_id}/approve", headers=auth(token))
        assert approved.status_code == 200
        assert approved.json()["status"] == "effective"
        assert approved.json()["approved_by"]

        retired = client.post(f"/api/v1/admin/sops/{sop_id}/retire", headers=auth(token))
        assert retired.status_code == 200
        assert retired.json()["status"] == "archived"


def test_module_and_quiz_builder_creates_locked_enrollments():
    with TestClient(app) as client:
        token = login(client)
        module = client.post("/api/v1/admin/training/modules", headers=auth(token), json={
            "code": "TRN-99", "title": "Customer Escalation Handling", "objective": "Handle escalated customer issues correctly.",
            "duration_minutes": 15,
        })
        assert module.status_code == 201
        module_id = module.json()["id"]
        assert module.json()["status"] == "draft"
        assert module.json()["sequence"] == 23  # appended after the 22 seeded modules

        # The existing seeded employee must not be able to take an unpublished, unassigned module.
        employee_token = login(client, "employee@company.com", "Demo123!")
        modules = client.get("/api/v1/training/modules", headers=auth(employee_token)).json()
        new_module = next(m for m in modules if m["id"] == module_id)
        assert new_module["progress"]["status"] == "locked"

        question = client.post(f"/api/v1/admin/training/modules/{module_id}/questions", headers=auth(token), json={
            "prompt": "What should you do first when a customer escalates an issue?",
            "options": ["Log it through the official channel", "Ignore it", "Reply from a personal account", "Wait a week"],
            "correct_index": 0, "explanation": "Always log escalations through the official channel first.",
        })
        assert question.status_code == 201
        question_id = question.json()["id"]

        bad_question = client.post(f"/api/v1/admin/training/modules/{module_id}/questions", headers=auth(token), json={
            "prompt": "Bad", "options": ["A", "B"], "correct_index": 5, "explanation": "x",
        })
        assert bad_question.status_code == 400

        updated_question = client.patch(f"/api/v1/admin/training/questions/{question_id}", headers=auth(token), json={"explanation": "Updated explanation."})
        assert updated_question.status_code == 200
        assert updated_question.json()["explanation"] == "Updated explanation."

        published = client.patch(f"/api/v1/admin/training/modules/{module_id}", headers=auth(token), json={"status": "published"})
        assert published.status_code == 200
        assert published.json()["status"] == "published"

        deleted = client.delete(f"/api/v1/admin/training/questions/{question_id}", headers=auth(token))
        assert deleted.status_code == 200
        assert deleted.json()["deleted"] is True


def test_assignment_and_due_date_management():
    with TestClient(app) as client:
        token = login(client)
        modules = client.get("/api/v1/training/modules", headers=auth(token)).json()
        # admin has no enrollments; use the seeded employee instead via admin listing
        employee = client.get("/api/v1/admin/employees", headers=auth(token)).json()["items"]
        employee_id = next(e["id"] for e in employee if e["email"] == "employee@company.com")
        target_module = next(m for m in modules if m["sequence"] == 22)

        assign = client.post("/api/v1/admin/enrollments/assign", headers=auth(token), json={
            "module_id": target_module["id"], "employee_ids": [employee_id], "due_date": "2026-12-31",
        })
        assert assign.status_code == 201
        assert assign.json()["assigned"] == 1

        listing = client.get(f"/api/v1/admin/enrollments?module_id={target_module['id']}", headers=auth(token))
        assert listing.status_code == 200
        row = listing.json()["items"][0]
        assert row["status"] == "assigned"
        assert row["due_date"] == "2026-12-31"

        updated = client.patch(f"/api/v1/admin/enrollments/{row['id']}", headers=auth(token), json={"due_date": "2027-01-15"})
        assert updated.status_code == 200
        assert updated.json()["due_date"] == "2027-01-15"


def test_unresolved_question_governance_queue():
    with TestClient(app) as client:
        employee_token = login(client, "employee@company.com", "Demo123!")
        client.post("/api/v1/feedback", headers=auth(employee_token), json={"query": "How do I get a company credit card?", "reason": "No approved answer found"})

        admin_token = login(client)
        queue = client.get("/api/v1/admin/feedback?status=open", headers=auth(admin_token))
        assert queue.status_code == 200
        item = queue.json()["items"][0]
        assert item["employee"] == "Asha Sharma"

        missing_resolution = client.patch(f"/api/v1/admin/feedback/{item['id']}", headers=auth(admin_token), json={"status": "resolved"})
        assert missing_resolution.status_code == 400

        resolved = client.patch(f"/api/v1/admin/feedback/{item['id']}", headers=auth(admin_token), json={
            "status": "resolved", "resolution": "Corporate cards are issued via the Finance request channel.",
        })
        assert resolved.status_code == 200
        assert resolved.json()["status"] == "resolved"
        assert resolved.json()["resolved_by"]


def test_mistake_register_crud_and_search():
    with TestClient(app) as client:
        token = login(client)
        seeded = client.get("/api/v1/admin/mistakes", headers=auth(token))
        assert seeded.status_code == 200
        assert seeded.json()["total"] == 10

        created = client.post("/api/v1/admin/mistakes", headers=auth(token), json={
            "code": "MIS-100", "title": "Forwarding client data to a personal drive", "description": "Client data copied outside approved systems.",
            "correct_practice": "Store client data only inside approved company systems.", "category": "Information Security", "severity": "critical",
        })
        assert created.status_code == 201

        employee_token = login(client, "employee@company.com", "Demo123!")
        findable = client.get("/api/v1/mistakes?q=personal+email", headers=auth(employee_token))
        assert findable.status_code == 200
        assert any(m["code"] == "MIS-001" for m in findable.json())

        searched = client.post("/api/v1/search", headers=auth(employee_token), json={"query": "personal email"})
        assert searched.status_code == 200
        assert searched.json()["mistakes"]


def test_audit_log_is_paginated_and_admin_only():
    with TestClient(app) as client:
        employee_token = login(client, "employee@company.com", "Demo123!")
        assert client.get("/api/v1/admin/audit", headers=auth(employee_token)).status_code == 403

        admin_token = login(client)
        log = client.get("/api/v1/admin/audit?page=1&page_size=10", headers=auth(admin_token))
        assert log.status_code == 200
        assert log.json()["page_size"] == 10
        assert log.json()["total"] >= 1
        assert log.json()["items"][0]["actor"]
