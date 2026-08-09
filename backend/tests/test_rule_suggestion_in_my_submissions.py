"""
QA REMEDIATION MEDIUM 14: per-rule "Suggest a change" visible to the
submitter, via the same unified My Submissions view the generic flow
already uses.

Management: "how will I know that if my suggestion is accepted or
rejected."

The generic suggestion flow already handles this correctly (untouched
here). Per-rule suggestions live in their own table
(rule_change_suggestions) and never showed up in /api/v1/submissions/mine
at all — the only place their status was visible was the separate
/api/v1/rules/my-suggestions endpoint (still exists, unchanged), not the
one unified view an employee actually checks.

Re-verify (literal): "submit via 'Suggest a change' on a specific rule —
confirm it appears in that employee's My Submissions before and after
the Admin decision, same as the generic flow."
"""

import os
from pathlib import Path

TEST_DB = Path("/tmp/onework_api_rule_suggestion_submissions_test.db")
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


def test_per_rule_suggestion_appears_in_my_submissions_before_and_after_decision():
    with TestClient(app) as client:
        admin_token = login(client, "admin@company.com", "Admin123!")
        employee_token = login(client)

        rule = client.post("/api/v1/admin/rules", headers=auth(admin_token), json={
            "title": "Medium 14 Verify Rule", "body": "Original content.", "category": "general", "is_mandatory": False,
        })
        assert rule.status_code == 201
        rule_id = rule.json()["id"]

        suggest = client.post(f"/api/v1/rules/{rule_id}/suggest", headers=auth(employee_token), json={
            "suggestion_text": "This rule should mention the remote-work exception.",
        })
        assert suggest.status_code == 201
        suggestion_id = suggest.json()["id"]

        # Before the Admin decision: appears in My Submissions as a real,
        # distinguishable "rule_suggestion" entry, not merged away or
        # dropped.
        before = client.get("/api/v1/submissions/mine", headers=auth(employee_token)).json()
        before_entry = next((s for s in before if s["id"] == suggestion_id), None)
        assert before_entry is not None, "rule suggestion did not appear in My Submissions before the decision"
        assert before_entry["type"] == "rule_suggestion"
        assert before_entry["status"] == "submitted"
        assert "Medium 14 Verify Rule" in before_entry["reason"]

        # Admin makes a decision.
        decide = client.patch(f"/api/v1/admin/rule-suggestions/{suggestion_id}", headers=auth(admin_token), json={"status": "accepted"})
        assert decide.status_code == 200

        # After the decision: same entry, updated status, still visible
        # in the same view.
        after = client.get("/api/v1/submissions/mine", headers=auth(employee_token)).json()
        after_entry = next((s for s in after if s["id"] == suggestion_id), None)
        assert after_entry is not None, "rule suggestion disappeared from My Submissions after the decision"
        assert after_entry["status"] == "accepted"

        # The generic flow's own submissions must be completely
        # unaffected by this merge.
        generic_submit = client.post("/api/v1/submissions", headers=auth(employee_token), json={
            "description": "A generic suggestion, unrelated to any rule.", "category": "process",
        })
        assert generic_submit.status_code == 201
        final = client.get("/api/v1/submissions/mine", headers=auth(employee_token)).json()
        generic_entry = next((s for s in final if s["id"] == generic_submit.json()["id"]), None)
        assert generic_entry is not None
        assert generic_entry["type"] == "suggestion"
