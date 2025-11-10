import os

from dotenv import load_dotenv
from flask import Flask, request, jsonify, send_from_directory
from psycopg2 import connect
from psycopg2.extras import RealDictCursor


# load environment variables from .env file
load_dotenv()

# get database URL from environment variable
DATABASE_URL = os.getenv("DATABASE_URL")

# ensure DATABASE_URL is set
if not DATABASE_URL:
    raise ValueError("DATABASE_URL environment variable is not set")

# create Flask app
app = Flask(__name__, static_folder="../frontend", static_url_path="")


# function to get a new database connection
def get_db_connection():
    return connect(DATABASE_URL)


# initialize database
def init_db():
    try:
        conn = get_db_connection()
        cursor = conn.cursor()

        cursor.execute(
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

        cursor.execute(
            """
            CREATE INDEX IF NOT EXISTS idx_timestamp_agent_event
            ON hash_records (timestamp, agent_id, event_type);
            """
        )

        conn.commit()
        cursor.close()
        conn.close()
        print("Database initialized successfully!")

    except Exception as e:
        print(f"Failed to initialize database: {e}")


# API endpoint to store hash records
@app.route("/api/store", methods=["POST"])
def handle_store():
    try:
        # get JSON data from request
        data = request.get_json()

        if not data:
            return jsonify({"success": False, "error": "No data provided"}), 400

        # extract timestamp, agent_id, event_type, and hashes
        timestamp = data.get("timestamp")
        agent_id = data.get("agent_id")
        event_type = data.get("event_type")
        hashes = data.get("hashes", {})

        if not timestamp or not hashes or not agent_id or not event_type:
            return jsonify({"success": False, "error": "Missing timestamp, agent_id, event_type, or hashes"}), 400

        # get client IP
        client_ip = request.remote_addr
        if client_ip == "::1":
            client_ip = "127.0.0.1"

        # log the received API call with client IP
        print(f"Received API call from {client_ip}")

        # insert into database
        conn = get_db_connection()
        cursor = conn.cursor()

        cursor.execute(
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

        conn.commit()
        cursor.close()
        conn.close()

        print("Inserted record successfully")

        return jsonify({"success": True})

    except Exception as e:
        print(f"Error storing data: {e}")
        return jsonify({"success": False, "error": str(e)}), 500


# API endpoint to retrieve hash records
@app.route("/api/view", methods=["GET"])
def handle_view():
    try:
        conn = get_db_connection()
        cursor = conn.cursor(cursor_factory=RealDictCursor)
        cursor.execute(
            """
            SELECT id, timestamp, agent_id, event_type, hash_boot, hash_bin, hash_sbin, hash_etc, hash_root 
            FROM hash_records 
            ORDER BY id DESC
            """
        )

        rows = cursor.fetchall()
        cursor.close()
        conn.close()

        # convert to list of dicts with proper naming
        records = []
        for row in rows:
            records.append(
                {
                    "id": str(row["id"]),
                    "timestamp": row["timestamp"],
                    "agent_id": row["agent_id"],
                    "event_type": row["event_type"],
                    "boot": row["hash_boot"],
                    "bin": row["hash_bin"],
                    "sbin": row["hash_sbin"],
                    "etc": row["hash_etc"],
                    "root": row["hash_root"],
                }
            )

        return jsonify(records)

    except Exception as e:
        print(f"Error retrieving data: {e}")
        return jsonify({"success": False, "error": str(e)}), 500


# serve frontend static files
@app.route("/")
def serve_frontend():
    return send_from_directory("../frontend", "index.html")


# serve other static files
@app.route("/<path:path>")
def serve_static(path):
    return send_from_directory("../frontend", path)


if __name__ == "__main__":
    # initialize database on startup
    init_db()

    # get port from environment or use default
    port = int(os.getenv("PORT", 8800))
    print(f"Server running on http://localhost:{port}/")

    # run the Flask server
    app.run(host="0.0.0.0", port=port, debug=False)
