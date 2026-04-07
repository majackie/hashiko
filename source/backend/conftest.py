import os
import pytest

# Set env vars before importing main so get_config() succeeds.
# sslmode=disable because CI uses a plain local Postgres, not Supabase.
os.environ.setdefault("DATABASE_URL", "postgresql://test:test@localhost:5432/hashiko_test?sslmode=disable")
os.environ.setdefault("ADMIN_USERNAME", "admin")
os.environ.setdefault("ADMIN_PASSWORD", "testpassword")
os.environ.setdefault("SECRET_KEY", "test-secret-key")
os.environ.setdefault("AGENT_API_KEY", "test-agent-key")
os.environ.setdefault("REGISTER_TOKEN", "test-register-token")

from main import app, init_db, execute_query


@pytest.fixture(scope="session", autouse=True)
def setup_db():
    init_db()


@pytest.fixture
def client():
    app.config["TESTING"] = True
    with app.test_client() as c:
        yield c


@pytest.fixture(autouse=True)
def clean_db():
    yield
    execute_query("DELETE FROM hash_records")
    execute_query("DELETE FROM watch_config")


@pytest.fixture
def auth_client(client):
    """A test client already logged in as admin."""
    client.post("/api/login", json={"username": "admin", "password": "testpassword"})
    return client


@pytest.fixture
def agent_headers():
    return {"Authorization": "Bearer test-agent-key"}
