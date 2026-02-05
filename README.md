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
### 1) Create .env for PostgreSQL connection
```
cd backend
touch .env
echo "DATABASE_URL=<url>" > .env
echo "PORT=<port>" > .env
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

### 4) Live serve index.html
```
http://127.0.0.1:5500/source/frontend/index.html
```

## Milestone Progress & Project Notes
### Milestone 3 (Completed)
- User authentication: login and logout
- Hashes displayed in separate tables by agent
- Highlighting of different hashes for clarity
- Pivoted from original proposal after discussion with Ashkhan and Brian

### Milestone 4 (Planned)
- Hashing of individual files
- Replace agent ID with MAC address or computer name
- Deploy backend to production
- Deploy frontend to production

# Authour
Jackie Ma | A00889988