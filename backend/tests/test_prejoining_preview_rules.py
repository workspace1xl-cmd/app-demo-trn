"""
QA REMEDIATION BLOCKER 7 (+ Step 0a): the pre-joining preview shows real
mandatory rules content, not a hardcoded "not published yet" note.

Management: "the pre-joining formalities that are going to be there, the
rules and regulations... so that he is clear... if he is not willing to
join post that, he can then not join."

Step 0a found this was the one real, confirmed defect in an otherwise
fully-working Pre-Joining Portal: rules_available was hardcoded False
forever, a leftover from before Block D (Rules & Regulations) existed.

Re-verify (literal): "as Admin, generate a candidate invite; open the
resulting link in a fresh unauthenticated browser; confirm it shows real
rules/expectations content... using real tenant data, not placeholder
stats."
"""

import os
from pathlib import Path

TEST_DB = Path("/tmp/onework_api_prejoining_rules_test.db")
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


def test_candidate_preview_shows_real_mandatory_rules_org_wide_and_department():
    with TestClient(app) as client:
        admin_token = login(client)

        dept = client.post("/api/v1/admin/departments", headers=auth(admin_token), json={"name": "Preview Verify Dept", "code": "PVDEPT"})
        assert dept.status_code == 201
        department_id = dept.json()["id"]

        # An org-wide mandatory rule, a department-specific mandatory
        # rule for a DIFFERENT department, and a non-mandatory rule — only
        # the first should ever reach a candidate in this department; the
        # second is intentionally excluded (visibility test); the third
        # is excluded because a pre-join preview is mandatory-only.
        org_wide = client.post("/api/v1/admin/rules", headers=auth(admin_token), json={"title": "Preview Verify Org-Wide Rule", "body": "Applies everywhere.", "category": "conduct", "is_mandatory": True})
        assert org_wide.status_code == 201

        other_dept = client.post("/api/v1/admin/departments", headers=auth(admin_token), json={"name": "Preview Verify Other Dept", "code": "PVOTHER"})
        other_dept_id = other_dept.json()["id"]
        other_dept_rule = client.post("/api/v1/admin/rules", headers=auth(admin_token), json={"title": "Preview Verify Other-Department Rule", "body": "Applies elsewhere.", "category": "security", "is_mandatory": True, "department_id": other_dept_id})
        assert other_dept_rule.status_code == 201

        dept_rule = client.post("/api/v1/admin/rules", headers=auth(admin_token), json={"title": "Preview Verify Department Rule", "body": "Applies to this department.", "category": "conduct", "is_mandatory": True, "department_id": department_id})
        assert dept_rule.status_code == 201

        non_mandatory = client.post("/api/v1/admin/rules", headers=auth(admin_token), json={"title": "Preview Verify Optional Rule", "body": "Optional.", "category": "misc", "is_mandatory": False})
        assert non_mandatory.status_code == 201

        candidate = client.post("/api/v1/admin/candidates", headers=auth(admin_token), json={"full_name": "Preview Rules Candidate", "email": "preview.rules.candidate@example.com", "department_id": department_id})
        assert candidate.status_code == 201
        invite_token = candidate.json()["invite_token"]

        # No auth header at all — this is the genuinely public route a
        # fresh unauthenticated browser hits.
        preview = client.get(f"/api/v1/public/preview/{invite_token}")
        assert preview.status_code == 200
        body = preview.json()
        assert body["rules_available"] is True
        titles = {r["title"] for r in body["rules"]}
        assert "Preview Verify Org-Wide Rule" in titles
        assert "Preview Verify Department Rule" in titles
        assert "Preview Verify Other-Department Rule" not in titles
        assert "Preview Verify Optional Rule" not in titles
