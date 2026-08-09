"""
QA REMEDIATION BLOCKER 3: attempt-cap actually stops onward progress, and
the flag is surfaced to a manager, not just Admin.

Management: "if he's failing on say two or three occasions, we won't
basically move ahead with him." The attempt-limit block on resubmission
already worked correctly before this fix (not touched here). What was
missing: (1) confirming the NEXT module genuinely stays locked once a
mandatory module is permanently failed — closed by Blocker 1/9's
server-side assertModuleUnlocked, re-verified here in the exhausted-
attempts scenario specifically; (2) a manager had no way to see which of
their reports had an exhausted-attempts flag — Admin's Assignments panel
already showed it, but /api/v1/manager/dashboard never selected
onboarding_blocked at all.
"""

import os
from pathlib import Path

TEST_DB = Path("/tmp/onework_api_manager_attempts_test.db")
if TEST_DB.exists():
    TEST_DB.unlink()
os.environ["DATABASE_URL"] = f"sqlite:///{TEST_DB}"
os.environ["JWT_SECRET"] = "test-secret"
os.environ.pop("ANTHROPIC_API_KEY", None)

from fastapi.testclient import TestClient

from app.main import app


def login(client: TestClient, email, password) -> str:
    response = client.post("/api/v1/auth/login", json={"email": email, "password": password, "organization": "example-organisation"})
    assert response.status_code == 200
    return response.json()["access_token"]


def auth(token: str) -> dict:
    return {"Authorization": f"Bearer {token}"}


def test_exhausted_attempts_locks_next_module_and_surfaces_to_manager():
    with TestClient(app) as client:
        admin_token = login(client, "admin@company.com", "Admin123!")

        dept = client.post("/api/v1/admin/departments", headers=auth(admin_token), json={"name": "Attempts Verify Dept", "code": "ATTVFY"})
        assert dept.status_code == 201
        department_id = dept.json()["id"]

        manager = client.post("/api/v1/admin/employees", headers=auth(admin_token), json={
            "full_name": "Attempts Verify Manager", "email": "attempts.verify.manager@company.com", "password": "StrongPass1",
            "role": "manager", "department_id": department_id,
        })
        assert manager.status_code == 201
        manager_id = manager.json()["id"]

        report = client.post("/api/v1/admin/employees", headers=auth(admin_token), json={
            "full_name": "Attempts Verify Report", "email": "attempts.verify.report@company.com", "password": "StrongPass1",
            "role": "employee", "department_id": department_id, "manager_id": manager_id,
        })
        assert report.status_code == 201
        report_token = login(client, "attempts.verify.report@company.com", "StrongPass1")

        # employee@company.com's seed org already has modules; this new
        # employee gets the standard sequential enrollment (module 1
        # assigned, everything after it locked).
        modules = client.get("/api/v1/training/modules", headers=auth(report_token)).json()
        modules.sort(key=lambda m: m["sequence"])
        module_1, module_2 = modules[0], modules[1]
        assert module_1["progress"]["status"] != "locked"
        assert module_2["progress"]["status"] == "locked"

        # Cap module 1 to a single attempt so one wrong answer exhausts it.
        cap = client.patch(f"/api/v1/admin/training/modules/{module_1['id']}", headers=auth(admin_token), json={"max_attempts": 1})
        assert cap.status_code == 200

        quiz = client.get(f"/api/v1/training/modules/{module_1['id']}/quiz", headers=auth(report_token)).json()
        # Every seeded question's correct_index is 0 (see onework_core.sql's
        # templated seed question) — answering 1 on every question is
        # reliably wrong without needing to know the correct answer.
        wrong_answers = [1] * len(quiz["questions"])
        attempt = client.post(f"/api/v1/training/modules/{module_1['id']}/attempt", headers=auth(report_token), json={"answers": wrong_answers})
        assert attempt.status_code == 200
        assert attempt.json()["passed"] is False
        assert attempt.json()["onboarding_blocked"] is True

        # The next module must still be genuinely locked — both via the
        # module list AND the server-side attempt gate, not just the UI.
        modules_after = client.get("/api/v1/training/modules", headers=auth(report_token)).json()
        module_2_after = next(m for m in modules_after if m["id"] == module_2["id"])
        assert module_2_after["progress"]["status"] == "locked"
        blocked_attempt = client.post(f"/api/v1/training/modules/{module_2['id']}/attempt", headers=auth(report_token), json={"answers": [0]})
        assert blocked_attempt.status_code == 403

        # The manager must see this without going to Admin.
        manager_token = login(client, "attempts.verify.manager@company.com", "StrongPass1")
        dashboard = client.get("/api/v1/manager/dashboard", headers=auth(manager_token))
        assert dashboard.status_code == 200
        body = dashboard.json()
        report_row = next(m for m in body["members"] if m["email"] == "attempts.verify.report@company.com")
        assert report_row["attempts_exhausted_count"] == 1
        assert body["attempts_exhausted_total"] >= 1
