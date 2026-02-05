import os
import uuid
from datetime import datetime, timedelta
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
        "PORT": int(os.getenv("PORT", 8899)),
    }

    for key, value in config.items():
        if not value and key != "PORT":
            raise ValueError(f"{key} environment variable is not set")

    return config


CONFIG = get_config()

# in-memory session storage
SESSIONS = {}


# session management helpers
def create_session(username):
    session_id = str(uuid.uuid4())
    SESSIONS[session_id] = {"username": username, "created_at": datetime.now(), "last_activity": datetime.now()}
    return session_id


def get_session(session_id):
    if session_id in SESSIONS:
        # update last activity
        SESSIONS[session_id]["last_activity"] = datetime.now()
        return SESSIONS[session_id]
    return None


def remove_session(session_id):
    if session_id in SESSIONS:
        del SESSIONS[session_id]


def cleanup_expired_sessions(max_age_hours=24):
    cutoff = datetime.now() - timedelta(hours=max_age_hours)
    expired = [sid for sid, data in SESSIONS.items() if data["last_activity"] < cutoff]
    for sid in expired:
        del SESSIONS[sid]


# flask app setup
app = Flask(__name__, static_folder="../frontend", static_url_path="")
app.secret_key = CONFIG["SECRET_KEY"]


# context manager for database connections
@contextmanager
def get_db():
    conn = connect(CONFIG["DATABASE_URL"])
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
        execute_query(
            """
            CREATE TABLE IF NOT EXISTS hash_records (
                id SERIAL PRIMARY KEY,
                timestamp TIMESTAMP NOT NULL,
                agent_id TEXT NOT NULL,
                event_type TEXT NOT NULL,
                hash_boot TEXT NOT NULL,
                hash_bin TEXT NOT NULL,
                hash_sbin TEXT NOT NULL,
                hash_etc TEXT NOT NULL,
                hash_root TEXT NOT NULL
            );
            """
        )

        execute_query(
            """
            CREATE INDEX IF NOT EXISTS idx_timestamp_agent_event
            ON hash_records (timestamp, agent_id, event_type);
            """
        )

        print("Database initialized successfully!")
    except Exception as e:
        print(f"Failed to initialize database: {e}")


# insert a hash record into the database
def insert_hash_record(timestamp, agent_id, event_type, hashes):
    execute_query(
        """
        INSERT INTO hash_records 
        (timestamp, agent_id, event_type, hash_boot, hash_bin, hash_sbin, hash_etc, hash_root)
        VALUES (%s, %s, %s, %s, %s, %s, %s, %s)
        """,
        (
            timestamp,
            agent_id,
            event_type,
            hashes.get("/boot", ""),
            hashes.get("/usr/bin", ""),
            hashes.get("/usr/sbin", ""),
            hashes.get("/etc", ""),
            hashes.get("/root", ""),
        ),
    )


# retrieve all hash records from the database
def get_all_hash_records():
    return execute_query(
        """
        SELECT id, timestamp, agent_id, event_type, 
               hash_boot, hash_bin, hash_sbin, hash_etc, hash_root 
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
        current_hashes = {
            "boot": row["hash_boot"],
            "bin": row["hash_bin"],
            "sbin": row["hash_sbin"],
            "etc": row["hash_etc"],
            "root": row["hash_root"],
        }

        # detect changes
        changed = {}
        if agent_id in prev_hashes_by_agent:
            prev = prev_hashes_by_agent[agent_id]
            changed = {key: current_hashes[key] != prev[key] for key in current_hashes}

        prev_hashes_by_agent[agent_id] = current_hashes

        result.append(
            {
                "id": str(row["id"]),
                "timestamp": row["timestamp"],
                "agent_id": agent_id,
                "event_type": row["event_type"],
                **current_hashes,
                "changed": changed,
            }
        )

    return list(reversed(result))


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
def handle_store():
    data = request.get_json()
    if not data:
        return jsonify({"success": False, "error": "No data provided"}), 400

    # validate required fields
    required = ["timestamp", "agent_id", "event_type", "hashes"]
    missing = [field for field in required if not data.get(field)]
    if missing:
        return jsonify({"success": False, "error": f"Missing fields: {', '.join(missing)}"}), 400

    try:
        # log request
        client_ip = "127.0.0.1" if request.remote_addr == "::1" else request.remote_addr
        print(f"[{data['agent_id']}] Received hash report from {client_ip}")

        # store record
        insert_hash_record(data["timestamp"], data["agent_id"], data["event_type"], data["hashes"])
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
    return send_from_directory("../frontend", "index.html")


# static files
@app.route("/<path:path>")
def serve_static(path):
    return send_from_directory("../frontend", path)


# server startup
if __name__ == "__main__":
    init_db()
    port = CONFIG["PORT"]
    print(f"Server running on http://localhost:{port}/")
    app.run(host="0.0.0.0", port=port, debug=False)
