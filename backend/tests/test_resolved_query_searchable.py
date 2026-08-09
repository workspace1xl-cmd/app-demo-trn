"""
QA REMEDIATION BLOCKER 5: a resolved query becomes real, searchable
knowledge — not just delivered back to the original submitter.

Management: "when the query is answered, he is able to know things...
he knows all the knowledge that is there."

Re-verify (literal): "resolve a test query with a distinctive answer,
then search that exact query text in Knowledge Search — confirm it now
returns the resolved answer instead of 'NO VERIFIED MATCH.'"
"""

import os
from pathlib import Path

TEST_DB = Path("/tmp/onework_api_resolved_query_search_test.db")
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


def test_resolved_query_becomes_searchable_by_a_different_employee():
    with TestClient(app) as client:
        admin_token = login(client, "admin@company.com", "Admin123!")
        submitter_token = login(client)  # employee@company.com

        distinctive_query = "zzqvorx flimwuggle nexcarto quombaz"
        submit = client.post("/api/v1/feedback", headers=auth(submitter_token), json={
            "query": distinctive_query, "reason": "Not sure where to get a parking pass.",
        })
        assert submit.status_code == 201
        feedback_id = submit.json()["id"]

        # Before resolution: searching the exact query text finds nothing.
        before = client.post("/api/v1/search", headers=auth(submitter_token), json={"query": distinctive_query})
        assert before.status_code == 200
        assert before.json()["unresolved"] is True
        assert before.json().get("resolved_queries") == []

        distinctive_resolution = "Collect your zzqvorx parking pass from Facilities on floor 2, desk F-14."
        resolve = client.patch(f"/api/v1/admin/feedback/{feedback_id}", headers=auth(admin_token), json={
            "status": "resolved", "resolution": distinctive_resolution,
        })
        assert resolve.status_code == 200

        # After resolution: ANY employee (not just the original submitter)
        # searching that exact query text finds the resolved answer.
        admin_search = client.post("/api/v1/search", headers=auth(admin_token), json={"query": distinctive_query})
        assert admin_search.status_code == 200
        body = admin_search.json()
        assert body["unresolved"] is False
        resolved = body["resolved_queries"]
        assert len(resolved) == 1
        assert resolved[0]["query"] == distinctive_query
        assert resolved[0]["resolution"] == distinctive_resolution
