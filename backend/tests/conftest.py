"""Backend tests run against an in-memory fake MongoDB, so no database, network or secrets are needed.

The fake client replaces motor's real one before the app is imported."""
import os
import sys

os.environ.setdefault("SECRET_KEY", "test-secret-not-for-production")
os.environ.setdefault("ALLOWED_ORIGINS", "http://localhost:3000")
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

import motor.motor_asyncio  # noqa: E402
from mongomock_motor import AsyncMongoMockClient  # noqa: E402

motor.motor_asyncio.AsyncIOMotorClient = AsyncMongoMockClient

import pytest  # noqa: E402
from fastapi.testclient import TestClient  # noqa: E402

import database  # noqa: E402
from main import app  # noqa: E402


@pytest.fixture(autouse=True)
def clean_db():
    """Empty every collection before each test."""
    import asyncio
    names = ["recipes", "users", "mealPlans", "groceryLists", "follows", "comments", "ratings", "images"]

    async def wipe():
        for n in names:
            await database.db[n].delete_many({})
    asyncio.get_event_loop_policy().new_event_loop().run_until_complete(wipe())


@pytest.fixture
def client():
    with TestClient(app) as c:
        yield c


@pytest.fixture
def user(client):
    """A signed-up, logged-in user: returns (id, auth headers)."""
    r = client.post("/users/", json={"name": "Test", "email": "Test@Example.com", "password": "password123"})
    assert r.status_code == 200, r.text
    r = client.post("/users/login", json={"email": "test@example.com", "password": "password123"})
    assert r.status_code == 200, r.text
    body = r.json()
    return body["user"]["id"], {"Authorization": f"Bearer {body['access_token']}"}
