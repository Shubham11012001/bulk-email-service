# EC2 Direct Docker Deployment Guide

A streamlined guide to deploying the **Bulk Email Agent** directly on an **AWS EC2 instance** using Docker — **without pushing to any external container registry (Docker Hub, ECR, etc.)**.

---

## 📋 Overview of the Workflow

Everything builds and runs directly on your EC2 instance:

```
[ Your Local Machine ]
        │
        ▼ (Git Clone or rsync / scp)
[ AWS EC2 Instance (Docker Installed) ]
        │
        ├── 1. Configure .env file (SMTP / SES credentials & DB URL)
        │
        ├── 2. Build Docker Image locally on EC2 (no remote push)
        │
        └── 3. Launch via Docker Compose (or Standalone Docker Run)
                  │
                  ├── Auto-waits for PostgreSQL connection
                  ├── Auto-executes DB migrations (creates tables & indexes)
                  ├── Starts background email worker (worker.js)
                  └── Starts Fastify web server (server.js)
```

---

## Step 1: Open Port 3000 in EC2 Security Group

Before testing in the browser, ensure your EC2 instance allows incoming traffic on port `3000`.

1. Go to **AWS Management Console** → **EC2** → **Instances**.
2. Select your instance and click the **Security** tab.
3. Click on the attached **Security Group** → **Edit inbound rules**.
4. Add the following rule and click **Save rules**:

| Type | Protocol | Port Range | Source | Description |
| :--- | :--- | :--- | :--- | :--- |
| **Custom TCP** | TCP | `3000` | `0.0.0.0/0` (or your company IP / VPC) | Bulk Email Web UI & API |
| **SSH** | TCP | `22` | `My IP` | Terminal access |

---

## Step 2: Copy the Project Code to EC2

Log in to your EC2 instance via SSH:
```bash
ssh -i /path/to/your-key.pem ubuntu@<EC2_PUBLIC_IP>
# Or for Amazon Linux:
# ssh -i /path/to/your-key.pem ec2-user@<EC2_PUBLIC_IP>
```

### Option A: Via Git (Recommended)
```bash
cd ~
git clone <YOUR_GIT_REPOSITORY_URL> bulk-email-agent
cd bulk-email-agent
```

### Option B: Via SCP from your Local Machine
If your code is only stored locally, run this command **from your local computer**:
```bash
scp -i /path/to/your-key.pem -r /path/to/bulk-email-agent ubuntu@<EC2_PUBLIC_IP>:~/bulk-email-agent
```

Then switch back to your EC2 terminal:
```bash
cd ~/bulk-email-agent
```

---

## Step 3: Configure Environment Variables (`.env`)

Create the production `.env` file from the example:
```bash
cp .env.example .env
nano .env   # or vim .env
```

Set your configuration values:

```env
# Server
PORT=3000
NODE_ENV=production
APP_URL=http://<EC2_PUBLIC_IP>:3000

# Active Email Provider: 'gmail', 'ses', or 'mock'
EMAIL_PROVIDER=mock

# ==========================================
# IF USING GMAIL SMTP:
# ==========================================
SMTP_HOST=smtp.gmail.com
SMTP_PORT=465
SMTP_USER=your_email@gmail.com
SMTP_PASS=your_16_char_google_app_password
EMAIL_FROM=your_email@gmail.com
EMAIL_FROM_NAME="Bulk Email Agent"

# ==========================================
# IF USING AMAZON SES:
# ==========================================
# Option 1: AWS API Keys
AWS_ACCESS_KEY_ID=your_access_key
AWS_SECRET_ACCESS_KEY=your_secret_key
AWS_REGION=us-east-1

# Option 2: SES SMTP Credentials
# SES_SMTP_USER=your_ses_smtp_user
# SES_SMTP_PASS=your_ses_smtp_password
# SES_SMTP_HOST=email-smtp.us-east-1.amazonaws.com
# SES_SMTP_PORT=465
```

Save and exit (`Ctrl+O`, `Enter`, `Ctrl+X` in nano).

---

## Step 4: Run the Application with Docker

Choose the scenario matching your PostgreSQL setup:

---

### Scenario A: Full Stack with Docker Compose (Recommended)
*Use this if you want Docker to run both PostgreSQL and the application container with persistent storage on EC2.*

```bash
# Build the image locally and start PostgreSQL + App in the background
docker compose up -d --build
```

#### What happens automatically:
1. Docker builds the application image directly on your EC2 instance.
2. PostgreSQL 16 container starts up and initializes `postgres_data` volume.
3. The app container waits for PostgreSQL to pass the health check (`pg_isready`).
4. **Auto-Migration:** The container automatically executes `node dist/db/migrate.js` to create all 6 tables and indexes.
5. Starts the **background email worker** (`worker.js`).
6. Starts the **Fastify API & Dashboard** (`server.js`) on port `3000`.

---

### Scenario B: Connect to an Existing Database (AWS RDS or External PG)
*Use this if you already have an existing PostgreSQL database on RDS or installed on EC2.*

1. In your `.env` file, point `DATABASE_URL` to your database:
   ```env
   DATABASE_URL=postgresql://dbuser:dbpassword@your-rds-endpoint.rds.amazonaws.com:5432/bulk_email_agent
   ```

2. Build the Docker image locally on EC2:
   ```bash
   docker build -t bulk-email-agent:latest .
   ```

3. Run the container:
   ```bash
   docker run -d \
     --name bulk-email-agent \
     --restart unless-stopped \
     -p 3000:3000 \
     --env-file .env \
     -v email_agent_attachments:/app/data/attachments \
     bulk-email-agent:latest
   ```

*(The container entrypoint will still automatically ping your database, run all migrations, and start both the worker and web server).*

---

## Step 5: Verify Deployment

### 1. Check Container Status
```bash
docker ps
```
You should see `bulk-email-agent` and `bulk-email-postgres` with `STATUS: Up (healthy)`.

### 2. View Live Startup & Migration Logs
```bash
docker compose logs -f bulk-email-agent
# Or for standalone docker:
# docker logs -f bulk-email-agent
```

You should see:
```text
==========================================================
 🚀 Starting Bulk Email Agent Services
==========================================================
==> Step 1: Waiting for PostgreSQL connection...
✅ Database connection established!
==> Step 2: Executing database migrations...
PostgreSQL database migrated successfully.
✅ Migrations completed successfully!
==> Step 3: Starting background email worker queue...
    Worker running (PID: 18)
==> Step 4: Starting Fastify server on port 3000...
    Server running (PID: 23)
==========================================================
 Application is online at http://0.0.0.0:3000
==========================================================
Worker running...
{"level":30,"time":...,"msg":"Server listening at http://0.0.0.0:3000"}
```

### 3. Test Health Endpoint Locally on EC2
```bash
curl http://localhost:3000/api/health
```
Expected output:
```json
{"ok":true,"provider":"mock"}
```

### 4. Access the Dashboard in your Browser
Open your browser and navigate to:
```text
http://<EC2_PUBLIC_IP>:3000
```

---

## Step 6: Verify Database Tables (Optional)

If you want to inspect the generated schema inside the PostgreSQL container:

```bash
docker exec -it bulk-email-postgres psql -U postgres -d bulk_email_agent -c "\dt"
```

Output:
```text
               List of relations
 Schema |        Name         | Type  |  Owner   
--------+---------------------+-------+----------
 public | campaign_recipients | table | postgres
 public | campaigns           | table | postgres
 public | email_events        | table | postgres
 public | recipients          | table | postgres
 public | suppressions        | table | postgres
 public | webhook_events      | table | postgres
(6 rows)
```

---

## 🛠️ Common Operations & Maintenance

### How to Stop the Application
```bash
docker compose down
```
*(Your database data and uploaded attachments are preserved in Docker named volumes).*

### How to Restart Services
```bash
docker compose restart
```

### How to Apply Code Changes / Rebuild on EC2
Whenever you update code on EC2 (e.g. after `git pull`):
```bash
# Rebuild image locally and restart containers with zero downtime
docker compose up -d --build
```
The entrypoint will rerun migrations automatically (any new columns or indexes will be added safely via `IF NOT EXISTS`), and the new server and worker will spin up immediately.

### View Real-Time Worker Logs
To watch emails being processed in real time:
```bash
docker compose logs -f bulk-email-agent | grep -E "(Worker|campaign|sent|failed)"
```

### Backup Database
To dump the PostgreSQL database to a `.sql` file:
```bash
docker exec bulk-email-postgres pg_dump -U postgres bulk_email_agent > backup_$(date +%F).sql
```
