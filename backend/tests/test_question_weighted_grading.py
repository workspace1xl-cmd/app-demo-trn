"""
QA REMEDIATION BLOCKER 2: per-question weighted grading, actually
evaluated at grading time — not a schema field nobody reads.

Management: "some questions may be required 100% pass marks, some may
be required 75%, some might be required 50%."

Single-select MCQ answers are binary per question, so the sound reading
is WEIGHT: a heavier question that's missed hurts the overall score more
than a lighter one. This test proves the two-question extreme case —
missing the heavy question fails, missing only the light one still
passes — so the weight is genuinely read at grading time, not just
stored and ignored.
"""

import os
from pathlib import Path

TEST_DB = Path("/tmp/onework_api_weighted_grading_test.db")
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


def _make_weighted_module(client: TestClient, admin_token: str, code: str) -> str:
    module = client.post("/api/v1/admin/training/modules", headers=auth(admin_token), json={
        "code": code, "title": "Weighted Grading Verify", "objective": "Verify per-question weight.",
        "duration_minutes": 5, "passing_score": 50,
    })
    assert module.status_code == 201
    module_id = module.json()["id"]

    heavy = client.post(f"/api/v1/admin/training/modules/{module_id}/questions", headers=auth(admin_token), json={
        "prompt": "Heavy question", "options": ["Right", "Wrong"], "correct_index": 0,
        "explanation": "Right is right.", "weight_percent": 100,
    })
    assert heavy.status_code == 201

    light = client.post(f"/api/v1/admin/training/modules/{module_id}/questions", headers=auth(admin_token), json={
        "prompt": "Light question", "options": ["Right", "Wrong"], "correct_index": 0,
        "explanation": "Right is right.", "weight_percent": 20,
    })
    assert light.status_code == 201
    return module_id


def test_missing_the_heavy_question_fails_even_if_light_question_is_correct():
    with TestClient(app) as client:
        admin_token = login(client)
        module_id = _make_weighted_module(client, admin_token, "QA-W1")

        # Heavy question (weight 100) wrong, light question (weight 20)
        # right: earned = 20 of 120 total weight = 17%, below the 50%
        # passing_score — must fail, proving the heavy miss actually cost
        # more than a flat "1 of 2 wrong = 50%" count-based grade would.
        attempt = client.post(f"/api/v1/training/modules/{module_id}/attempt", headers=auth(admin_token), json={"answers": [1, 0]})
        assert attempt.status_code == 200
        body = attempt.json()
        assert body["score"] == 17
        assert body["passed"] is False


def test_missing_only_the_light_question_still_passes():
    with TestClient(app) as client:
        admin_token = login(client)
        module_id = _make_weighted_module(client, admin_token, "QA-W2")

        # Heavy question (weight 100) right, light question (weight 20)
        # wrong: earned = 100 of 120 total weight = 83%, comfortably
        # above the 50% passing_score.
        attempt = client.post(f"/api/v1/training/modules/{module_id}/attempt", headers=auth(admin_token), json={"answers": [0, 1]})
        assert attempt.status_code == 200
        body = attempt.json()
        assert body["score"] == 83
        assert body["passed"] is True


def test_quiz_view_exposes_weight_percent_upfront():
    with TestClient(app) as client:
        admin_token = login(client)
        module_id = _make_weighted_module(client, admin_token, "QA-W3")
        quiz = client.get(f"/api/v1/training/modules/{module_id}/quiz", headers=auth(admin_token))
        assert quiz.status_code == 200
        weights = sorted(q["weight_percent"] for q in quiz.json()["questions"])
        assert weights == [20, 100]
