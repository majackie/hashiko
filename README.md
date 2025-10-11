# Hashiko
# Requirements
Go 1.24.8
```
https://go.dev/
```

# How to Run
## 1) Create .env for PostgreSQL connection
```
cd backend
touch .env
echo "DATABASE_URL=<url>" > .env
echo "PORT=<port>" > .env
```

## 2) Run backend.go
```
cd source
cd backend
sudo go run *.go
```

## 3) Run agent.go
```
cd source
cd agent
sudo go run *.go
```

## 4) Live serve index.html
```
http://127.0.0.1:5500/source/frontend/index.html
```

# Authour
Jackie Ma
</br>
A00889988