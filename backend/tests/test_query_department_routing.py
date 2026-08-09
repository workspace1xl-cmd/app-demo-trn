"""
QA REMEDIATION BLOCKER 6: query auto-routing / manual assignment to a
department.

Management: "that query goes to the particular department automatically
or someone can then assign it to a particular department."

Re-verify (literal): "submit queries on two different topics, confirm
each either auto-routes to a plausible department or can be manually
assigned to one before resolution."
"""

import os
from pathlib import Path

TEST_DB = Path("/tmp/onework_api_query_department_routing_test.db")
if TEST_DB.exists():
    TEST_DB.unlink()
os.environ["DATABASE_URL"] = f"sqlite:///{TEST_DB}"
os.environ["JWT_SECRET"] = "test-secret"
os.environ.pop("ANTHROPIC_API_KEY", None)

from fastapi.testclient import TestClient

from app.main import app


def login(client: TestClient, email="employee@company.com", password="Demo123!") -> str:
    response = client.post("/api/v1/auth/login", json={"email": email, "password": password, "organization": "example-organisation"})
    assert response.status_code == 200
    return response.json()["access_token"]


def auth(token: str) -> dict:
    return {"Authorization": f"Bearer {token}"}


def test_query_matching_a_known_activity_auto_routes_to_that_department():
    with TestClient(app) as client:
        employee_token = login(client)

        # The seed data's "Password / Email Issue" activity belongs to
        # Information Technology — a query on that exact topic should
        # auto-route there without any admin action.
        submit = client.post("/api/v1/feedback", headers=auth(employee_token), json={
            "query": "I forgot my password and need it reset",
            "reason": "Locked out of my account.",
        })
        assert submit.status_code == 201
        assert submit.json()["department_id"] is not None

        admin_token = login(client, "admin@company.com", "Admin123!")
        depts = {d["name"]: d["id"] for d in client.get("/api/v1/admin/departments", headers=auth(admin_token)).json()}
        assert submit.json()["department_id"] == depts["Information Technology"]


def test_unmatched_query_can_be_manually_assigned_before_resolution():
    with TestClient(app) as client:
        employee_token = login(client)
        admin_token = login(client, "admin@company.com", "Admin123!")

        # Nonsense words match nothing — genuinely unrouted at submission.
        submit = client.post("/api/v1/feedback", headers=auth(employee_token), json={
            "query": "zzqvorx flimwuggle nexcarto department routing verify",
            "reason": "Testing manual assignment.",
        })
        assert submit.status_code == 201
        feedback_id = submit.json()["id"]
        assert submit.json()["department_id"] is None

        depts = {d["name"]: d["id"] for d in client.get("/api/v1/admin/departments", headers=auth(admin_token)).json()}
        finance_id = depts["Finance"]

        # An admin assigns it to a department BEFORE resolving — a pure
        # reassignment, no status change, and the submitter should not be
        # notified about it (that's not news to them).
        assign = client.patch(f"/api/v1/admin/feedback/{feedback_id}", headers=auth(admin_token), json={"department_id": finance_id})
        assert assign.status_code == 200
        assert assign.json()["department_id"] == finance_id
        assert assign.json()["status"] == "open", "a pure department reassignment must not change status"

        # The queue can now be filtered to just that department.
        filtered = client.get(f"/api/v1/admin/feedback?department_id={finance_id}", headers=auth(admin_token)).json()
        assert any(item["id"] == feedback_id for item in filtered["items"])

        # It can still be resolved normally afterwards.
        resolve = client.patch(f"/api/v1/admin/feedback/{feedback_id}", headers=auth(admin_token), json={"status": "resolved", "resolution": "Handled by Finance."})
        assert resolve.status_code == 200
        assert resolve.json()["department_id"] == finance_id
