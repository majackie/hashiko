from main import detect_hash_changes


# ---------------------------------------------------------------------------
# detect_hash_changes — pure logic, no DB needed
# ---------------------------------------------------------------------------

def test_detect_hash_changes_no_changes():
    records = [
        {"id": 1, "timestamp": "2024-01-01T00:00:00Z", "agent_id": "agent1",
         "hashes": {"/etc/passwd": "aaa", "/boot/vmlinuz": "bbb"}},
        {"id": 2, "timestamp": "2024-01-02T00:00:00Z", "agent_id": "agent1",
         "hashes": {"/etc/passwd": "aaa", "/boot/vmlinuz": "bbb"}},
    ]
    result = detect_hash_changes(records)
    # most recent first
    assert result[0]["changed"] == {"/etc/passwd": False, "/boot/vmlinuz": False}


def test_detect_hash_changes_detects_modification():
    records = [
        {"id": 1, "timestamp": "2024-01-01T00:00:00Z", "agent_id": "agent1",
         "hashes": {"/etc/passwd": "aaa"}},
        {"id": 2, "timestamp": "2024-01-02T00:00:00Z", "agent_id": "agent1",
         "hashes": {"/etc/passwd": "bbb"}},
    ]
    result = detect_hash_changes(records)
    assert result[0]["changed"]["/etc/passwd"] is True


def test_detect_hash_changes_detects_new_file():
    records = [
        {"id": 1, "timestamp": "2024-01-01T00:00:00Z", "agent_id": "agent1",
         "hashes": {"/etc/passwd": "aaa"}},
        {"id": 2, "timestamp": "2024-01-02T00:00:00Z", "agent_id": "agent1",
         "hashes": {"/etc/passwd": "aaa", "/etc/newfile": "ccc"}},
    ]
    result = detect_hash_changes(records)
    assert result[0]["changed"]["/etc/newfile"] is True
    assert result[0]["changed"]["/etc/passwd"] is False


def test_detect_hash_changes_detects_deleted_file():
    records = [
        {"id": 1, "timestamp": "2024-01-01T00:00:00Z", "agent_id": "agent1",
         "hashes": {"/etc/passwd": "aaa", "/etc/gone": "zzz"}},
        {"id": 2, "timestamp": "2024-01-02T00:00:00Z", "agent_id": "agent1",
         "hashes": {"/etc/passwd": "aaa"}},
    ]
    result = detect_hash_changes(records)
    assert result[0]["changed"]["/etc/gone"] is True


def test_detect_hash_changes_baseline_has_no_changed():
    records = [
        {"id": 1, "timestamp": "2024-01-01T00:00:00Z", "agent_id": "agent1",
         "hashes": {"/etc/passwd": "aaa"}},
    ]
    result = detect_hash_changes(records)
    # first record ever has no previous to compare against
    assert result[0]["changed"] == {}


def test_detect_hash_changes_independent_agents():
    records = [
        {"id": 1, "timestamp": "2024-01-01T00:00:00Z", "agent_id": "agent1",
         "hashes": {"/etc/passwd": "aaa"}},
        {"id": 2, "timestamp": "2024-01-01T00:00:00Z", "agent_id": "agent2",
         "hashes": {"/etc/passwd": "aaa"}},
        {"id": 3, "timestamp": "2024-01-02T00:00:00Z", "agent_id": "agent1",
         "hashes": {"/etc/passwd": "bbb"}},
        {"id": 4, "timestamp": "2024-01-02T00:00:00Z", "agent_id": "agent2",
         "hashes": {"/etc/passwd": "aaa"}},
    ]
    result = detect_hash_changes(records)
    by_agent = {}
    for r in result:
        by_agent.setdefault(r["agent_id"], []).append(r)

    # agent1's second record should show a change
    assert any(r["changed"].get("/etc/passwd") is True for r in by_agent["agent1"])
    # agent2's second record should show no change
    assert all(r["changed"].get("/etc/passwd") is not True for r in by_agent["agent2"])


# ---------------------------------------------------------------------------
# /api/login
# ---------------------------------------------------------------------------

def test_login_success(client):
    resp = client.post("/api/login", json={"username": "admin", "password": "testpassword"})
    assert resp.status_code == 200
    assert resp.get_json()["success"] is True


def test_login_wrong_password(client):
    resp = client.post("/api/login", json={"username": "admin", "password": "wrong"})
    assert resp.status_code == 401


def test_login_missing_fields(client):
    resp = client.post("/api/login", json={})
    assert resp.status_code == 401


# ---------------------------------------------------------------------------
# /api/store
# ---------------------------------------------------------------------------

def test_store_valid(client, agent_headers):
    payload = {
        "timestamp": "2024-01-01T00:00:00Z",
        "agent_id": "user@host (abc123)",
        "hashes": {"/etc/passwd": "deadbeef", "/etc/shadow": "cafebabe"},
    }
    resp = client.post("/api/store", json=payload, headers=agent_headers)
    assert resp.status_code == 200
    assert resp.get_json()["success"] is True


def test_store_missing_fields(client, agent_headers):
    resp = client.post("/api/store", json={"timestamp": "2024-01-01T00:00:00Z"}, headers=agent_headers)
    assert resp.status_code == 400


def test_store_no_auth(client):
    payload = {
        "timestamp": "2024-01-01T00:00:00Z",
        "agent_id": "user@host (abc123)",
        "hashes": {"/etc/passwd": "aaa"},
    }
    resp = client.post("/api/store", json=payload)
    assert resp.status_code == 401


def test_store_wrong_key(client):
    payload = {
        "timestamp": "2024-01-01T00:00:00Z",
        "agent_id": "user@host (abc123)",
        "hashes": {"/etc/passwd": "aaa"},
    }
    resp = client.post("/api/store", json=payload, headers={"Authorization": "Bearer wrong-key"})
    assert resp.status_code == 401


# ---------------------------------------------------------------------------
# /api/hashes
# ---------------------------------------------------------------------------

def test_hashes_requires_auth(client):
    resp = client.get("/api/hashes")
    assert resp.status_code == 401


def test_hashes_returns_records(client, auth_client, agent_headers):
    client.post("/api/store", json={
        "timestamp": "2024-01-01T00:00:00Z",
        "agent_id": "user@host (abc123)",
        "hashes": {"/etc/passwd": "aaa"},
    }, headers=agent_headers)

    resp = auth_client.get("/api/hashes")
    assert resp.status_code == 200
    data = resp.get_json()
    assert isinstance(data, list)
    assert len(data) == 1
    assert data[0]["agent_id"] == "user@host (abc123)"
    assert data[0]["hashes"]["/etc/passwd"] == "aaa"


# ---------------------------------------------------------------------------
# /api/config (agent-facing GET) and /api/admin/config (admin GET)
# ---------------------------------------------------------------------------

def test_config_get_defaults(client, agent_headers):
    resp = client.get("/api/config?agent_id=user@host+(abc123)", headers=agent_headers)
    assert resp.status_code == 200
    data = resp.get_json()
    assert "/etc" in data["paths"]
    assert "/boot" in data["paths"]
    assert data["max_file_size_mb"] == 0


def test_config_get_missing_agent_id(client, agent_headers):
    resp = client.get("/api/config", headers=agent_headers)
    assert resp.status_code == 400


def test_admin_config_get_requires_auth(client):
    resp = client.get("/api/admin/config?agent_id=user@host+(abc123)")
    assert resp.status_code == 401


# ---------------------------------------------------------------------------
# /api/config POST (save watch config)
# ---------------------------------------------------------------------------

def test_config_save_custom_paths(auth_client):
    resp = auth_client.post("/api/config", json={
        "agent_id": "user@host (abc123)",
        "paths": ["/etc", "/boot", "/usr/bin", "/usr/sbin", "/root", "/srv/app"],
        "max_file_size_mb": 200,
    })
    assert resp.status_code == 200
    data = resp.get_json()
    assert "/srv/app" in data["paths"]
    assert data["max_file_size_mb"] == 200


def test_config_save_persists(client, auth_client, agent_headers):
    auth_client.post("/api/config", json={
        "agent_id": "user@host (abc123)",
        "paths": ["/etc", "/boot", "/usr/bin", "/usr/sbin", "/root", "/srv/app"],
        "max_file_size_mb": 50,
    })
    resp = client.get("/api/config?agent_id=user%40host+%28abc123%29", headers=agent_headers)
    assert resp.status_code == 200
    data = resp.get_json()
    assert "/srv/app" in data["paths"]
    assert data["max_file_size_mb"] == 50


def test_config_save_invalid_paths(auth_client):
    resp = auth_client.post("/api/config", json={
        "agent_id": "user@host (abc123)",
        "paths": "not-a-list",
        "max_file_size_mb": 100,
    })
    assert resp.status_code == 400


def test_config_save_invalid_size(auth_client):
    resp = auth_client.post("/api/config", json={
        "agent_id": "user@host (abc123)",
        "paths": ["/etc"],
        "max_file_size_mb": -1,
    })
    assert resp.status_code == 400


def test_config_save_requires_auth(client):
    resp = client.post("/api/config", json={
        "agent_id": "user@host (abc123)",
        "paths": ["/etc"],
        "max_file_size_mb": 100,
    })
    assert resp.status_code == 401


# ---------------------------------------------------------------------------
# /api/register
# ---------------------------------------------------------------------------

def test_register_valid_token(client):
    resp = client.post("/api/register", json={"register_token": "test-register-token"})
    assert resp.status_code == 200
    data = resp.get_json()
    assert data["success"] is True
    assert data["api_key"] == "test-agent-key"


def test_register_wrong_token(client):
    resp = client.post("/api/register", json={"register_token": "wrong-token"})
    assert resp.status_code == 401


def test_register_missing_token(client):
    resp = client.post("/api/register", json={})
    assert resp.status_code == 401
