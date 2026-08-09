"""
QA REMEDIATION BLOCKER 4: editing a rule through the Edit dialog — not
just the standalone "New Version" action — must version and reset reads.

Management: "how do I change an existing rule?" The Edit dialog
previously had no body-text field at all, and editing title/category via
PATCH silently left published_version_id untouched, so a title
correction looked identical to a no-op to every employee's read status.

Re-verify (literal): "edit a rule's title. Confirm version increments
(v1 -> v2). As the employee who already acknowledged it, confirm the
green checkmark clears and a re-acknowledgment prompt appears" — i.e.
the employee stops seeing it as read.
"""

import os
from pathlib import Path

TEST_DB = Path("/tmp/onework_api_rule_versioning_test.db")
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


def test_editing_title_only_still_versions_and_clears_read_status():
    with TestClient(app) as client:
        admin_token = login(client, "admin@company.com", "Admin123!")
        employee_token = login(client)

        create = client.post("/api/v1/admin/rules", headers=auth(admin_token), json={
            "title": "Blocker 4 Verify Rule", "body": "Original rule content.", "category": "general", "is_mandatory": True,
        })
        assert create.status_code == 201
        rule_id = create.json()["id"]
        version_1_id = create.json()["published_version_id"]

        # Employee reads and acknowledges version 1.
        rules = client.get("/api/v1/rules", headers=auth(employee_token)).json()
        my_rule = next(r for r in rules if r["id"] == rule_id)
        assert my_rule["version_id"] == version_1_id
        ack = client.post(f"/api/v1/rules/versions/{version_1_id}/read", headers=auth(employee_token))
        assert ack.status_code == 200
        rules_after_ack = client.get("/api/v1/rules", headers=auth(employee_token)).json()
        assert next(r for r in rules_after_ack if r["id"] == rule_id)["read"] is True

        # Admin edits ONLY the title through the Edit dialog's PATCH route
        # (body carried forward unchanged, exactly as the Edit dialog now
        # always sends it pre-filled) — this alone must bump the version.
        edit = client.patch(f"/api/v1/admin/rules/{rule_id}", headers=auth(admin_token), json={
            "title": "Blocker 4 Verify Rule — Renamed", "body": "Original rule content.",
        })
        assert edit.status_code == 200
        version_2_id = edit.json()["published_version_id"]
        assert version_2_id != version_1_id, "editing the title alone must publish a new version"

        # The employee's read status must have reset — the checkmark
        # clears and a re-acknowledgment prompt appears.
        rules_after_edit = client.get("/api/v1/rules", headers=auth(employee_token)).json()
        my_rule_after = next(r for r in rules_after_edit if r["id"] == rule_id)
        assert my_rule_after["version_id"] == version_2_id
        assert my_rule_after["read"] is False
        assert my_rule_after["title"] == "Blocker 4 Verify Rule — Renamed"


def test_editing_metadata_without_body_field_does_not_version():
    """A PATCH that genuinely omits `body` (e.g. a programmatic caller
    that only wants to flip is_mandatory) must not be forced to publish a
    version it never provided content for — confirms the new logic keys
    off the presence of `body` in the payload, not "any edit at all"."""
    with TestClient(app) as client:
        admin_token = login(client, "admin@company.com", "Admin123!")
        create = client.post("/api/v1/admin/rules", headers=auth(admin_token), json={
            "title": "Blocker 4 No-Body Edit Verify", "body": "Content.", "category": "general", "is_mandatory": True,
        })
        assert create.status_code == 201
        rule_id = create.json()["id"]
        version_1_id = create.json()["published_version_id"]

        edit = client.patch(f"/api/v1/admin/rules/{rule_id}", headers=auth(admin_token), json={"is_mandatory": False})
        assert edit.status_code == 200
        assert edit.json()["published_version_id"] == version_1_id
