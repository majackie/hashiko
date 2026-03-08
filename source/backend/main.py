import hmac
import os
import uuid
from datetime import datetime, timedelta, timezone
from contextlib import contextmanager
from functools import wraps
from dotenv import load_dotenv
from flask import Flask, request, jsonify, send_from_directory, session
from psycopg2 import connect
from psycopg2.extras import RealDictCursor

# load environment variables from .env file
load_dotenv()


# get and validate required environment variables
def get_config():
    config = {
        "DATABASE_URL": os.getenv("DATABASE_URL"),
        "ADMIN_USERNAME": os.getenv("ADMIN_USERNAME"),
        "ADMIN_PASSWORD": os.getenv("ADMIN_PASSWORD"),
        "SECRET_KEY": os.getenv("SECRET_KEY"),
        "AGENT_API_KEY": os.getenv("AGENT_API_KEY"),
        "REGISTER_TOKEN": os.getenv("REGISTER_TOKEN"),
        "PORT": int(os.getenv("PORT", 8899)),
    }

    for key, value in config.items():
        if not value and key not in ("PORT", "REGISTER_TOKEN"):
            raise ValueError(f"{key} environment variable is not set")

    return config


CONFIG = get_config()

# in-memory session storage
SESSIONS = {}


# session management helpers
def create_session(username):
    session_id = str(uuid.uuid4())
    SESSIONS[session_id] = {"username": username, "created_at": datetime.now(timezone.utc), "last_activity": datetime.now(timezone.utc)}
    return session_id


def get_session(session_id):
    if session_id in SESSIONS:
        # update last activity
        SESSIONS[session_id]["last_activity"] = datetime.now(timezone.utc)
        return SESSIONS[session_id]
    return None


def remove_session(session_id):
    if session_id in SESSIONS:
        del SESSIONS[session_id]


def cleanup_expired_sessions(max_age_hours=24):
    cutoff = datetime.now(timezone.utc) - timedelta(hours=max_age_hours)
    expired = [sid for sid, data in SESSIONS.items() if data["last_activity"] < cutoff]
    for sid in expired:
        del SESSIONS[sid]


# flask app setup
app = Flask(__name__, static_folder="../frontend", static_url_path="")
app.secret_key = CONFIG["SECRET_KEY"]
app.config["SESSION_COOKIE_SECURE"] = True
app.config["SESSION_COOKIE_HTTPONLY"] = True
app.config["SESSION_COOKIE_SAMESITE"] = "Strict"


@app.after_request
def add_security_headers(response):
    response.headers["Strict-Transport-Security"] = "max-age=31536000; includeSubDomains"
    return response


# context manager for database connections
@contextmanager
def get_db():
    url = CONFIG["DATABASE_URL"]
    if "sslmode" not in url:
        url += ("&" if "?" in url else "?") + "sslmode=require"
    conn = connect(url)
    try:
        yield conn
    finally:
        conn.close()


# execute a database query with automatic connection handling
def execute_query(query, params=None, fetch=False):
    with get_db() as conn:
        cursor = conn.cursor(cursor_factory=RealDictCursor if fetch else None)
        cursor.execute(query, params or ())
        result = cursor.fetchall() if fetch else None
        conn.commit()
        cursor.close()
        return result


# initialize database tables and indexes
def init_db():
    try:
        # create hash_records with JSONB hashes column
        execute_query(
            """
            CREATE TABLE IF NOT EXISTS hash_records (
                id SERIAL PRIMARY KEY,
                timestamp TIMESTAMPTZ NOT NULL,
                agent_id TEXT NOT NULL,
                hashes JSONB NOT NULL
            );
            """
        )

        # migrate old schema (individual hash columns) to JSONB if needed
        execute_query(
            """
            DO $$
            BEGIN
                IF EXISTS (
                    SELECT 1 FROM information_schema.columns
                    WHERE table_name='hash_records' AND column_name='hash_boot'
                ) THEN
                    ALTER TABLE hash_records ADD COLUMN IF NOT EXISTS hashes JSONB;
                    UPDATE hash_records SET hashes = jsonb_build_object(
                        '/boot', hash_boot,
                        '/usr/bin', hash_bin,
                        '/usr/sbin', hash_sbin,
                        '/etc', hash_etc,
                        '/root', hash_root
                    ) WHERE hashes IS NULL;
                    ALTER TABLE hash_records DROP COLUMN IF EXISTS hash_boot;
                    ALTER TABLE hash_records DROP COLUMN IF EXISTS hash_bin;
                    ALTER TABLE hash_records DROP COLUMN IF EXISTS hash_sbin;
                    ALTER TABLE hash_records DROP COLUMN IF EXISTS hash_etc;
                    ALTER TABLE hash_records DROP COLUMN IF EXISTS hash_root;
                END IF;
            END $$;
            """
        )

        execute_query(
            """
            CREATE INDEX IF NOT EXISTS idx_timestamp_agent
            ON hash_records (timestamp, agent_id);
            """
        )

        # migration: convert old single-row watch_config to per-agent schema
        execute_query(
            """
            DO $$ BEGIN
                IF EXISTS (
                    SELECT 1 FROM information_schema.columns
                    WHERE table_name = 'watch_config' AND column_name = 'id'
                ) THEN
                    DROP TABLE watch_config;
                END IF;
            END $$;
            """
        )

        # create per-agent watch_config table (stores only custom paths)
        execute_query(
            """
            CREATE TABLE IF NOT EXISTS watch_config (
                agent_id TEXT PRIMARY KEY,
                paths JSONB NOT NULL DEFAULT '[]'
            );
            """
        )

        # migrate: strip default paths from existing rows, delete rows that become empty
        execute_query(
            """
            UPDATE watch_config
            SET paths = COALESCE(
                (
                    SELECT jsonb_agg(p)
                    FROM jsonb_array_elements_text(paths) AS p
                    WHERE p NOT IN ('/boot', '/usr/bin', '/usr/sbin', '/etc', '/root')
                ),
                '[]'::jsonb
            );
            """
        )
        execute_query("DELETE FROM watch_config WHERE paths = '[]'::jsonb;")

        print("Database initialized successfully!")
    except Exception as e:
        print(f"Failed to initialize database: {e}")


# insert a hash record into the database
def insert_hash_record(timestamp, agent_id, hashes):
    import json

    execute_query(
        """
        INSERT INTO hash_records
        (timestamp, agent_id, hashes)
        VALUES (%s, %s, %s)
        """,
        (
            timestamp,
            agent_id,
            json.dumps(hashes),
        ),
    )


# retrieve all hash records from the database
def get_all_hash_records():
    return execute_query(
        """
        SELECT id, timestamp, agent_id, hashes
        FROM hash_records
        ORDER BY agent_id, timestamp ASC
        """,
        fetch=True,
    )


# add change detection to hash records
def detect_hash_changes(records):
    prev_hashes_by_agent = {}
    result = []

    for row in records:
        agent_id = row["agent_id"]
        hashes = row["hashes"] if isinstance(row["hashes"], dict) else {}

        # detect changes against previous record for this agent
        changed = {}
        if agent_id in prev_hashes_by_agent:
            prev = prev_hashes_by_agent[agent_id]
            all_keys = set(hashes) | set(prev)
            changed = {key: hashes.get(key) != prev.get(key) for key in all_keys}

        prev_hashes_by_agent[agent_id] = hashes

        result.append(
            {
                "id": str(row["id"]),
                "timestamp": row["timestamp"],
                "agent_id": agent_id,
                "hashes": hashes,
                "changed": changed,
            }
        )

    return list(reversed(result))


# decorator to require a valid agent API key (Bearer token) for agent-facing routes
def agent_key_required(f):
    @wraps(f)
    def decorated_function(*args, **kwargs):
        auth_header = request.headers.get("Authorization", "")
        if not auth_header.startswith("Bearer "):
            return jsonify({"success": False, "error": "Unauthorized"}), 401
        provided_key = auth_header[7:]
        # use compare_digest to prevent timing-based side-channel attacks
        if not hmac.compare_digest(provided_key, CONFIG["AGENT_API_KEY"]):
            return jsonify({"success": False, "error": "Unauthorized"}), 401
        return f(*args, **kwargs)

    return decorated_function


# decorator to require authentication for routes
def login_required(f):
    @wraps(f)
    def decorated_function(*args, **kwargs):
        session_id = session.get("session_id")
        if not session_id or not get_session(session_id):
            return jsonify({"success": False, "error": "Authentication required"}), 401
        return f(*args, **kwargs)

    return decorated_function


# validate credentials
def is_valid_credentials(username, password):
    return username == CONFIG["ADMIN_USERNAME"] and password == CONFIG["ADMIN_PASSWORD"]


# register endpoint - exchange a one-time registration token for the agent API key
@app.route("/api/register", methods=["POST"])
def handle_register():
    if not CONFIG["REGISTER_TOKEN"]:
        return jsonify({"success": False, "error": "Registration is not enabled"}), 403
    data = request.get_json() or {}
    token = data.get("register_token", "")
    if not hmac.compare_digest(token, CONFIG["REGISTER_TOKEN"]):
        return jsonify({"success": False, "error": "Unauthorized"}), 401
    return jsonify({"success": True, "api_key": CONFIG["AGENT_API_KEY"]})


# list known agents endpoint - used by frontend config panel
@app.route("/api/agents", methods=["GET"])
@login_required
def handle_get_agents():
    try:
        rows = execute_query(
            "SELECT DISTINCT agent_id FROM hash_records ORDER BY agent_id",
            fetch=True,
        )
        agents = [r["agent_id"] for r in rows]
        return jsonify({"agents": agents})
    except Exception as e:
        return jsonify({"success": False, "error": str(e)}), 500


# get watch config endpoint - returns monitored paths for a specific agent (used by agent)
DEFAULT_WATCH_PATHS = ["/boot", "/usr/bin", "/usr/sbin", "/etc", "/root"]


@app.route("/api/config", methods=["GET"])
@agent_key_required
def handle_get_config():
    agent_id = request.args.get("agent_id", "").strip()
    if not agent_id:
        return jsonify({"success": False, "error": "agent_id query parameter required"}), 400
    try:
        # fetch only custom paths from DB
        rows = execute_query(
            "SELECT paths FROM watch_config WHERE agent_id = %s",
            (agent_id,),
            fetch=True,
        )
        custom = rows[0]["paths"] if rows else []
        # defaults are hardcoded; merge custom on top
        paths = DEFAULT_WATCH_PATHS + [p for p in custom if p not in DEFAULT_WATCH_PATHS]
        return jsonify({"paths": paths})
    except Exception as e:
        return jsonify({"success": False, "error": str(e)}), 500


# get watch config for admin UI (session-authenticated)
@app.route("/api/admin/config", methods=["GET"])
@login_required
def handle_admin_get_config():
    agent_id = request.args.get("agent_id", "").strip()
    if not agent_id:
        return jsonify({"success": False, "error": "agent_id query parameter required"}), 400
    try:
        rows = execute_query(
            "SELECT paths FROM watch_config WHERE agent_id = %s",
            (agent_id,),
            fetch=True,
        )
        custom = rows[0]["paths"] if rows else []
        paths = DEFAULT_WATCH_PATHS + [p for p in custom if p not in DEFAULT_WATCH_PATHS]
        return jsonify({"paths": paths})
    except Exception as e:
        return jsonify({"success": False, "error": str(e)}), 500


# set watch config endpoint - admin updates custom paths for a specific agent
@app.route("/api/config", methods=["POST"])
@login_required
def handle_set_config():
    import json
    data = request.get_json() or {}
    agent_id = data.get("agent_id", "").strip()
    paths = data.get("paths", [])
    if not agent_id:
        return jsonify({"success": False, "error": "agent_id required"}), 400
    if not isinstance(paths, list) or not all(isinstance(p, str) for p in paths):
        return jsonify({"success": False, "error": "paths must be a list of strings"}), 400
    # store only custom (non-default) paths
    custom = [p.strip() for p in paths if p.strip() and p.strip() not in DEFAULT_WATCH_PATHS]
    try:
        if custom:
            execute_query(
                """
                INSERT INTO watch_config (agent_id, paths) VALUES (%s, %s)
                ON CONFLICT (agent_id) DO UPDATE SET paths = EXCLUDED.paths
                """,
                (agent_id, json.dumps(custom)),
            )
        else:
            # no custom paths — remove the row entirely
            execute_query("DELETE FROM watch_config WHERE agent_id = %s", (agent_id,))
        return jsonify({"success": True, "paths": DEFAULT_WATCH_PATHS + custom})
    except Exception as e:
        return jsonify({"success": False, "error": str(e)}), 500


# login endpoint
@app.route("/api/login", methods=["POST"])
def handle_login():
    data = request.get_json() or {}
    username = data.get("username")
    password = data.get("password")

    if is_valid_credentials(username, password):
        cleanup_expired_sessions()
        session_id = create_session(username)
        session["session_id"] = session_id
        return jsonify({"success": True, "message": "Login successful"})

    return jsonify({"success": False, "error": "Invalid credentials"}), 401


# logout endpoint
@app.route("/api/logout", methods=["POST"])
def handle_logout():
    session_id = session.get("session_id")
    if session_id:
        remove_session(session_id)
    session.clear()
    return jsonify({"success": True, "message": "Logged out successfully"})


# check authentication status
@app.route("/api/auth/status", methods=["GET"])
def auth_status():
    session_id = session.get("session_id")
    if session_id:
        session_data = get_session(session_id)
        if session_data:
            return jsonify({"logged_in": True, "username": session_data["username"]})
    return jsonify({"logged_in": False, "username": None})


# store hash data endpoint
@app.route("/api/store", methods=["POST"])
@agent_key_required
def handle_store():
    data = request.get_json()
    if not data:
        return jsonify({"success": False, "error": "No data provided"}), 400

    # validate required fields
    required = ["timestamp", "agent_id", "hashes"]
    missing = [field for field in required if not data.get(field)]
    if missing:
        return jsonify({"success": False, "error": f"Missing fields: {', '.join(missing)}"}), 400

    try:
        # log request
        client_ip = "127.0.0.1" if request.remote_addr == "::1" else request.remote_addr
        print(f"[{data['agent_id']}] Received hash report from {client_ip}")

        # store record
        insert_hash_record(data["timestamp"], data["agent_id"], data["hashes"])
        return jsonify({"success": True})

    except Exception as e:
        print(f"Error storing data: {e}")
        return jsonify({"success": False, "error": str(e)}), 500


# view hash records endpoint
@app.route("/api/hashes", methods=["GET"])
@login_required
def handle_view():
    try:
        records = get_all_hash_records()
        return jsonify(detect_hash_changes(records))
    except Exception as e:
        print(f"Error retrieving data: {e}")
        return jsonify({"success": False, "error": str(e)}), 500


# static files
@app.route("/")
def serve_frontend():
    return send_from_directory("../frontend", "login.html")


# static files
@app.route("/<path:path>")
def serve_static(path):
    return send_from_directory("../frontend", path)


# server startup
if __name__ == "__main__":
    init_db()
    port = CONFIG["PORT"]
    print(f"Server running on port {port}")
    app.run(host="0.0.0.0", port=port, debug=False)
