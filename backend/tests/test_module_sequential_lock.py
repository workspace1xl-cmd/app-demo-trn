"""
QA REMEDIATION BLOCKER 1 + 9: sequential module locking, enforced
server-side.

Before this fix, `enrollments.status == "locked"` was checked only by the
frontend (a disabled button) — GET .../quiz and POST .../attempt happily
served/graded a module the employee hadn't reached yet if called directly.
This is the exact scenario management and QA described: "directly taking
me to assessment" / "attempt to open module 3's assessment directly by
URL without completing 1-2 — confirm it's blocked."

The seed employee (employee@company.com) starts at 0/22 with only module
sequence 1 "assigned" and everything else "locked" — the real starting
state for a fresh hire, not a contrived fixture.
"""

import os
from pathlib import Path

TEST_DB = Path("/tmp/onework_api_module_lock_test.db")
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


def test_locked_module_quiz_and_attempt_are_rejected_server_side():
    with TestClient(app) as client:
        token = login(client)
        modules = client.get("/api/v1/training/modules", headers=auth(token)).json()
        modules.sort(key=lambda m: m["sequence"])
        locked_modules = [m for m in modules if m["progress"]["status"] == "locked"]
        open_modules = [m for m in modules if m["progress"]["status"] != "locked"]

        # Sanity: the seed data actually gives us both a locked and an
        # open module to test against — otherwise this test would prove
        # nothing either way.
        assert locked_modules, "seed data has no locked module to test against"
        assert open_modules, "seed data has no open module to test against"
        locked_module, open_module = locked_modules[0], open_modules[0]

        # Direct GET of a locked module's quiz — this is the "attempt to
        # open a later module's assessment directly by URL" scenario.
        # Must be rejected before any question content is returned.
        quiz_response = client.get(f"/api/v1/training/modules/{locked_module['id']}/quiz", headers=auth(token))
        assert quiz_response.status_code == 403
        assert "questions" not in quiz_response.json()

        # Direct POST attempt against the same locked module — must be
        # rejected before any scoring happens, same as the quiz view.
        attempt_response = client.post(
            f"/api/v1/training/modules/{locked_module['id']}/attempt",
            headers=auth(token),
            json={"answers": [0, 0, 0, 0, 0]},
        )
        assert attempt_response.status_code == 403

        # An open module must be completely unaffected by the new check —
        # the fix must not lock out modules that are genuinely available.
        open_quiz_response = client.get(f"/api/v1/training/modules/{open_module['id']}/quiz", headers=auth(token))
        assert open_quiz_response.status_code == 200
        assert "questions" in open_quiz_response.json()
