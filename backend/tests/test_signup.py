import os
from pathlib import Path

TEST_DB = Path("/tmp/onework_api_signup_test.db")
if TEST_DB.exists():
    TEST_DB.unlink()
os.environ["DATABASE_URL"] = f"sqlite:///{TEST_DB}"
os.environ["JWT_SECRET"] = "test-secret"
os.environ.pop("ANTHROPIC_API_KEY", None)

from fastapi.testclient import TestClient

from app.main import app


def auth(token: str) -> dict:
    return {"Authorization": f"Bearer {token}"}


def test_new_organization_signup_provisions_a_working_tenant():
    with TestClient(app) as client:
        response = client.post("/api/v1/organizations", json={
            "organization_name": "Acme Robotics",
            "organization_slug": "acme-robotics",
            "full_name": "Jordan Lee",
            "email": "jordan@acme-robotics.com",
            "password": "FoundingAdmin1",
        })
        assert response.status_code == 201
        body = response.json()
        assert body["user"]["role"] == "admin"
        token = body["access_token"]

        # The new admin can immediately manage their own tenant.
        me = client.get("/api/v1/me", headers=auth(token))
        assert me.status_code == 200
        assert me.json()["email"] == "jordan@acme-robotics.com"

        departments = client.get("/api/v1/admin/departments", headers=auth(token)).json()
        assert {d["code"] for d in departments} == {"HR", "IT", "FIN", "OPS", "ADM"}

        modules = client.get("/api/v1/training/modules", headers=auth(token)).json()
        assert len(modules) == 22
        assert modules[0]["code"] == "TRN-01"

        # A brand-new tenant starts with no company-specific data of its own.
        activities = client.get("/api/v1/activities", headers=auth(token)).json()
        assert activities == []

        # Sign back in normally afterwards, same as any other account.
        relogin = client.post("/api/v1/auth/login", json={"email": "jordan@acme-robotics.com", "password": "FoundingAdmin1", "organization": "acme-robotics"})
        assert relogin.status_code == 200


def test_signup_rejects_duplicate_organization_and_weak_input():
    with TestClient(app) as client:
        first = client.post("/api/v1/organizations", json={
            "organization_name": "Northwind Traders", "organization_slug": "northwind",
            "full_name": "Sam Rivera", "email": "sam@northwind.example", "password": "GoodPassword1",
        })
        assert first.status_code == 201

        duplicate_slug = client.post("/api/v1/organizations", json={
            "organization_name": "A Different Name", "organization_slug": "northwind",
            "full_name": "Someone Else", "email": "someone@northwind.example", "password": "GoodPassword1",
        })
        assert duplicate_slug.status_code == 400

        bad_slug = client.post("/api/v1/organizations", json={
            "organization_name": "Another Company", "organization_slug": "Not A Valid Slug!",
            "full_name": "Someone Else", "email": "another@example.com", "password": "GoodPassword1",
        })
        assert bad_slug.status_code == 400
        assert bad_slug.json()["detail"]["field"] == "organization_slug"

        short_password = client.post("/api/v1/organizations", json={
            "organization_name": "Yet Another Co", "organization_slug": "yet-another-co",
            "full_name": "Someone Else", "email": "yetanother@example.com", "password": "short",
        })
        assert short_password.status_code == 422


def test_organizations_stay_isolated_from_each_other():
    with TestClient(app) as client:
        alpha = client.post("/api/v1/organizations", json={
            "organization_name": "Alpha Co", "organization_slug": "alpha-co",
            "full_name": "Alpha Admin", "email": "admin@alpha.example", "password": "AlphaPassword1",
        }).json()
        beta = client.post("/api/v1/organizations", json={
            "organization_name": "Beta Co", "organization_slug": "beta-co",
            "full_name": "Beta Admin", "email": "admin@beta.example", "password": "BetaPassword1",
        }).json()

        alpha_dept = client.post("/api/v1/admin/departments", headers=auth(alpha["access_token"]), json={"name": "Alpha Only Team", "code": "AOT"})
        assert alpha_dept.status_code == 201

        beta_departments = client.get("/api/v1/admin/departments", headers=auth(beta["access_token"])).json()
        assert "Alpha Only Team" not in [d["name"] for d in beta_departments]
