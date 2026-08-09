"""
QA REMEDIATION MEDIUM 13: department-scoped rule access, server-side —
"he should have that visibility of that particular department only and
not all the other things."

List-level filtering already worked (confirmed, Block D and Block J's
regression tests) — untouched here. This item asked specifically:
"since no per-rule permalink currently exists in the UI, first confirm
at the API/RLS layer directly (not just the UI) that a cross-department
fetch is rejected."

Investigating that surfaced a real, more serious version of the same
gap while verifying: POST /api/v1/rules/versions/{id}/read never checked
org_id at all — an employee could mark ANY real rule_version_id,
including one belonging to a COMPLETELY DIFFERENT organisation, as
"read" with zero authorization check. Confirmed live against production
before this fix (a second org's rule, marked read by an unrelated
employee, returned 200 ok:true). No rule content was ever disclosed by
that route, but it was still an arbitrary cross-tenant write.

Re-verify (literal): "attempt a direct API call for a rule outside the
requester's department [org, in this concretely-found case] — confirm
it's rejected server-side regardless of what the UI shows."
"""

import os
from pathlib import Path

TEST_DB = Path("/tmp/onework_api_rule_read_org_isolation_test.db")
if TEST_DB.exists():
    TEST_DB.unlink()
os.environ["DATABASE_URL"] = f"sqlite:///{TEST_DB}"
os.environ["JWT_SECRET"] = "test-secret"
os.environ.pop("ANTHROPIC_API_KEY", None)

from fastapi.testclient import TestClient

from app.main import app


def auth(token: str) -> dict:
    return {"Authorization": f"Bearer {token}"}


def test_employee_cannot_mark_another_orgs_rule_as_read():
    with TestClient(app) as client:
        # Org A: the existing seed tenant.
        org_a_admin = client.post("/api/v1/auth/login", json={"email": "admin@company.com", "password": "Admin123!", "organization": "example-organisation"}).json()["access_token"]
        org_a_employee = client.post("/api/v1/auth/login", json={"email": "employee@company.com", "password": "Demo123!", "organization": "example-organisation"}).json()["access_token"]

        # Org B: a genuinely separate tenant, created fresh via signup.
        signup = client.post("/api/v1/organizations", json={
            "organization_name": "Rule Read Isolation Verify Org", "organization_slug": "rule-read-isolation-verify",
            "full_name": "Org B Admin", "email": "orgb.admin@example.com", "password": "OrgBPass1",
        })
        assert signup.status_code == 201
        org_b_admin = signup.json()["access_token"]

        rule = client.post("/api/v1/admin/rules", headers=auth(org_b_admin), json={
            "title": "Org B Confidential Rule", "body": "Belongs only to Org B.", "category": "general", "is_mandatory": True,
        })
        assert rule.status_code == 201
        version_id = rule.json()["published_version_id"]

        # An Org A employee must not be able to mark Org B's rule as read.
        cross_org_attempt = client.post(f"/api/v1/rules/versions/{version_id}/read", headers=auth(org_a_employee))
        assert cross_org_attempt.status_code == 404

        # Sanity: the same employee marking their OWN org's rule as read
        # still works normally — this fix must not break the real path.
        own_rule = client.post("/api/v1/admin/rules", headers=auth(org_a_admin), json={
            "title": "Org A Own Rule", "body": "Belongs to Org A.", "category": "general", "is_mandatory": True,
        })
        assert own_rule.status_code == 201
        own_version_id = own_rule.json()["published_version_id"]
        own_org_attempt = client.post(f"/api/v1/rules/versions/{own_version_id}/read", headers=auth(org_a_employee))
        assert own_org_attempt.status_code == 200
