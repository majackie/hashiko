# Hashiko
# Requirements
Python 3.14
```
https://www.python.org/
```
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

## 2) Run backend
```
cd source
cd backend
pip install -r requirements.txt
python main.py
```

## 3) Run agent
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