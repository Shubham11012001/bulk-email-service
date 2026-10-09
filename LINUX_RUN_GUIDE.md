# Linux Deployment & Run Guide

Step-by-step minimal guide to run and verify the **Bulk Email Agent** on any Linux machine (Ubuntu, Debian, CentOS, RHEL, etc.).

---

## 1. Prerequisites (Mandatory)

Ensure **Node.js 20+** and **npm** are installed:

```bash
# Ubuntu / Debian:
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
sudo apt-get install -y nodejs build-essential
```

Verify versions:
```bash
node -v   # Must be v20.x or higher
npm -v
```

---

## 2. Setup Project

Navigate into the project directory:

```bash
cd /path/to/bulk-email-agent
```

Install dependencies:
```bash
npm install
```

Create environment configuration:
```bash
cp .env.example .env
```

Configure your credentials in `.env`:
```bash
nano .env
```
*(Fill in either your Gmail App Password or your Amazon SES credentials, and set `EMAIL_FROM`)*

Initialize the SQLite database schema:
```bash
npm run migrate
```
*(Expected output: `Database migrated.`)*

---

## 3. Run the Services

The application consists of **two processes**:
1. **Web Server & UI** (`npm run dev` or `npm start` on port 3000)
2. **Background Email Queue Worker** (`npm run worker`)

### Option A: Quick Run in Background (using `nohup`)

```bash
# Start Web Server in background:
nohup npm run dev > server.log 2>&1 &

# Start Email Worker in background:
nohup npm run worker > worker.log 2>&1 &
```

### Option B: Production Run (using `pm2` - Recommended)

```bash
# Install pm2 globally if not installed:
sudo npm install -g pm2

# Start both services:
pm2 start "npm run dev" --name "email-server"
pm2 start "npm run worker" --name "email-worker"

# Save pm2 process list to auto-start on reboot:
pm2 save
pm2 startup
```

---

## 4. Mandatory Verification `curl` Commands

Run these `curl` commands to confirm everything is running properly:

### Test 1: Check Server Health
```bash
curl -s http://localhost:3000/api/health
```
**Expected Output:**
```json
{"ok":true,"provider":"gmail"}
```
*(or `"provider":"ses"` depending on your `.env` setting)*

---

### Test 2: Check Frontend UI Response
```bash
curl -s -o /dev/null -w "%{http_code}\n" http://localhost:3000/
```
**Expected Output:**
```
200
```

---

### Test 3: Check Provider Status & Settings
```bash
curl -s http://localhost:3000/api/provider
```
**Expected Output:**
JSON containing active provider and configuration statuses.

---

### Test 4: Verify Active Provider Connection / Credentials
```bash
curl -s -X POST http://localhost:3000/api/provider/verify \
  -H "Content-Type: application/json"
```
**Expected Output:**
```json
{"ok":true,"provider":"gmail"}
```
*(Returns `ok:true` if credentials/handshake succeed. If credentials are missing or wrong, it returns `ok:false` with the exact error message).*

---

### Test 5: Send a Test Verification Email (Optional)
Dispatch an actual HTML test email to verify end-to-end delivery:
```bash
curl -s -X POST http://localhost:3000/api/test-email \
  -H "Content-Type: application/json" \
  -d '{
    "to": "your_email@example.com",
    "subject": "Linux Server Verification",
    "body": "<h1>Bulk Email Agent Active!</h1><p>HTML email sent successfully from Linux.</p>"
  }'
```
**Expected Output:**
```json
{"accepted":true,"delivered":true,"messageId":"..."}
```

---

## 5. Management & Logs

If running via `nohup`:
```bash
tail -f server.log
tail -f worker.log
```

If running via `pm2`:
```bash
pm2 status
pm2 logs
pm2 restart all
pm2 stop all
```

To stop background processes running on port 3000:
```bash
fuser -k 3000/tcp
pkill -f "src/worker.ts"
```
