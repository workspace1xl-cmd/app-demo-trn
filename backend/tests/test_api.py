import os
from pathlib import Path

TEST_DB = Path("/tmp/onework_api_test.db")
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


def test_complete_employee_journey():
    with TestClient(app) as client:
        assert client.get("/health").status_code == 200
        token = login(client)
        dashboard = client.get("/api/v1/dashboard", headers=auth(token))
        assert dashboard.status_code == 200
        assert dashboard.json()["training"]["total"] == 22

        activities = client.get("/api/v1/activities", headers=auth(token)).json()
        assert len(activities) == 22
        assert {"responsible_role", "backup_person", "sla", "escalation_level_1", "sop_link"} <= activities[0].keys()

        search = client.post("/api/v1/search", headers=auth(token), json={"query": "leave"})
        assert search.status_code == 200
        assert search.json()["activities"]

        modules = client.get("/api/v1/training/modules", headers=auth(token)).json()
        quiz = client.get(f"/api/v1/training/modules/{modules[2]['id']}/quiz", headers=auth(token)).json()
        result = client.post(f"/api/v1/training/modules/{modules[2]['id']}/attempt", headers=auth(token), json={"answers": [0]})
        assert result.status_code == 200
        assert result.json()["passed"] is True

        certificates = client.get("/api/v1/certificates", headers=auth(token)).json()
        assert len(certificates) >= 2


def test_role_protection_and_admin_analytics():
    with TestClient(app) as client:
        employee = login(client)
        assert client.get("/api/v1/admin/analytics", headers=auth(employee)).status_code == 403
        admin = login(client, "admin@company.com", "Admin123!")
        response = client.get("/api/v1/admin/analytics", headers=auth(admin))
        assert response.status_code == 200
        assert response.json()["activities"] == 22


def test_unresolved_question_can_be_reported():
    with TestClient(app) as client:
        token = login(client)
        search = client.post("/api/v1/search", headers=auth(token), json={"query": "interplanetary relocation allowance"}).json()
        assert search["unresolved"] is True
        feedback = client.post("/api/v1/feedback", headers=auth(token), json={"query": "interplanetary relocation allowance", "reason": "No approved answer found"})
        assert feedback.status_code == 201
        assert feedback.json()["status"] == "open"
