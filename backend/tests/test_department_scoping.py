"""
BUILD PROMPT v5 BLOCK J: Department-scoped visibility audit.

Cross-cutting audit across Blocks B, C, D and H, verified with real
per-department test accounts (not just reading the code and assuming it's
right). Findings:

  - Block D (Rules & Regulations): department_id-scoped visibility is a
    real access-control boundary — an employee must never see a rule
    scoped to a department they're not in. VERIFIED here.
  - Block H (Knowledge Search defaults): "Popular in Your Department"
    must only aggregate searches from users in the viewer's own
    department. VERIFIED here.
  - Block B (Onboarding Journey): stages/items are deliberately org-wide,
    not department-scoped — every employee in the org goes through the
    same journey. This is by design, not a gap; there is nothing to
    enforce here, so there is no test for it.
  - Block C (Content Library / Onboarding Messages): content_assets has a
    `department` column, but it has never been wired up as an access
    filter anywhere — no employee-facing route lists content_assets
    directly. Content only reaches an employee through an already-scoped
    channel an admin explicitly wired in (a Block B stage item, or a
    Block D rule attachment), each of which carries its own real
    scoping. `department` on content_assets is descriptive/organisational
    metadata for the admin's own filtering, not a security boundary — so
    there's nothing to test here either. If a direct employee-facing
    "browse content library" screen is ever built, THAT is where
    department scoping would need to be added and tested, not here.

No Edge Function test suite exists in this repo's CI (only Next.js
lint+build and these FastAPI tests) — the same department-scoping
behaviour in supabase/functions/onework-api/index.ts was verified
manually via curl against a live database during this block's local
verification pass, matching how every block in this project verifies
the Edge Function side.
"""

import os
from pathlib import Path

TEST_DB = Path("/tmp/onework_api_department_scoping_test.db")
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


def _make_department_employee(client: TestClient, admin_token: str, dept_name: str, dept_code: str, email: str) -> str:
    dept = client.post("/api/v1/admin/departments", headers=auth(admin_token), json={"name": dept_name, "code": dept_code})
    assert dept.status_code == 201
    department_id = dept.json()["id"]
    created = client.post("/api/v1/admin/employees", headers=auth(admin_token), json={
        "full_name": f"{dept_name} Employee", "email": email, "password": "StrongPass1",
        "role": "employee", "department_id": department_id,
    })
    assert created.status_code == 201
    return department_id


def test_rules_department_scoping_is_a_real_boundary():
    with TestClient(app) as client:
        admin_token = login(client)
        dept_a = _make_department_employee(client, admin_token, "Legal Ops", "LEGOPS", "legal.ops.employee@company.com")
        dept_b = _make_department_employee(client, admin_token, "Field Sales", "FLDSALES", "field.sales.employee@company.com")
        employee_a_token = login(client, "legal.ops.employee@company.com", "StrongPass1")
        employee_b_token = login(client, "field.sales.employee@company.com", "StrongPass1")

        org_wide = client.post("/api/v1/admin/rules", headers=auth(admin_token), json={"title": "Org-Wide Code of Conduct", "body": "Applies to everyone."})
        assert org_wide.status_code == 201

        dept_a_only = client.post("/api/v1/admin/rules", headers=auth(admin_token), json={"title": "Legal Ops Only Policy", "body": "Legal Ops specific.", "department_id": dept_a})
        assert dept_a_only.status_code == 201

        dept_b_only = client.post("/api/v1/admin/rules", headers=auth(admin_token), json={"title": "Field Sales Only Policy", "body": "Field Sales specific.", "department_id": dept_b})
        assert dept_b_only.status_code == 201

        a_titles = {r["title"] for r in client.get("/api/v1/rules", headers=auth(employee_a_token)).json()}
        b_titles = {r["title"] for r in client.get("/api/v1/rules", headers=auth(employee_b_token)).json()}

        # Both see the org-wide rule.
        assert "Org-Wide Code of Conduct" in a_titles
        assert "Org-Wide Code of Conduct" in b_titles
        # Each sees only their own department's rule...
        assert "Legal Ops Only Policy" in a_titles
        assert "Field Sales Only Policy" in b_titles
        # ...and never the other department's.
        assert "Field Sales Only Policy" not in a_titles
        assert "Legal Ops Only Policy" not in b_titles


def test_search_defaults_popular_in_department_is_scoped():
    with TestClient(app) as client:
        admin_token = login(client)
        dept_a = _make_department_employee(client, admin_token, "Warehouse Ops", "WHOPS", "warehouse.employee@company.com")
        dept_b = _make_department_employee(client, admin_token, "Brand Studio", "BRANDSTU", "brand.employee@company.com")
        employee_a_token = login(client, "warehouse.employee@company.com", "StrongPass1")
        employee_b_token = login(client, "brand.employee@company.com", "StrongPass1")

        for _ in range(3):
            assert client.post("/api/v1/search", headers=auth(employee_a_token), json={"query": "forklift certification"}).status_code == 200
        assert client.post("/api/v1/search", headers=auth(employee_b_token), json={"query": "logo usage guidelines"}).status_code == 200

        defaults_a = client.get("/api/v1/search/defaults", headers=auth(employee_a_token)).json()
        defaults_b = client.get("/api/v1/search/defaults", headers=auth(employee_b_token)).json()

        dept_a_queries = {row["query"] for row in defaults_a["popular_in_department"]}
        dept_b_queries = {row["query"] for row in defaults_b["popular_in_department"]}

        assert "forklift certification" in dept_a_queries
        assert "logo usage guidelines" not in dept_a_queries  # a different department's search must never leak in
        assert "logo usage guidelines" in dept_b_queries
        assert "forklift certification" not in dept_b_queries

        # Org-wide blocks are NOT department-filtered — both searches show
        # up there regardless of who searched. Confirms the two blocks are
        # deliberately different scopes, not that department-filtering is
        # silently broken everywhere.
        org_wide_queries = {row["query"] for row in defaults_a["top_searches"]}
        assert "forklift certification" in org_wide_queries
        assert "logo usage guidelines" in org_wide_queries
