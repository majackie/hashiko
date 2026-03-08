# Hashiko
## Requirements
Python 3.14
```
https://www.python.org/
```
Go 1.24.8
```
https://go.dev/
```

## How to Run

### 1) Create `.env` for the backend
```
cd source/backend
touch .env
```

Add the following to `.env`:
```
# PostgreSQL connection string
DATABASE_URL=postgresql://<user>:<password>@<host>:<port>/<db>

# Admin credentials for the web UI login
ADMIN_USERNAME=your-username
ADMIN_PASSWORD=your-password

# Secret key for Flask session signing (use a long random string)
SECRET_KEY=your-random-secret-key

# API key agents use to authenticate with the backend (shared secret)
AGENT_API_KEY=your-agent-api-key

# One-time registration token
REGISTER_TOKEN=your-register-token

# (Optional) If this backend also reports to a remote Hashiko server, set these:
HASHIKO_API_URL=https://<remote-hashiko-host>/api
HASHIKO_REGISTER_TOKEN=your-register-token
```

### 2) Run backend
```
cd source/backend
pip install -r requirements.txt
python main.py
```

### 3) Run agent
```
cd source/agent
sudo go run *.go
```

On first run the agent sends `HASHIKO_REGISTER_TOKEN` to the backend, which checks it against `REGISTER_TOKEN`. If they match, the backend returns the `AGENT_API_KEY`, which is saved to `/etc/hashiko/api_key`. Subsequent runs use the saved key automatically.

### 5) Open the web UI
```
http://127.0.0.1:8899
```
Log in with the `ADMIN_USERNAME` and `ADMIN_PASSWORD` from your backend `.env`.

# Authour
Jackie Ma | A00889988