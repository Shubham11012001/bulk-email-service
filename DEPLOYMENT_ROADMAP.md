# End-to-End Docker Deployment Roadmap: AWS EC2

This guide walks you through containerizing the **Bulk Email Agent**, pushing the image to a container registry, deploying it onto an **AWS Linux EC2 instance**, and accessing it via its **Public** or **Private IP**.

---

## 🗺️ High-Level Deployment Workflow

```
[ Local Machine / CI ]
  │
  ├── 1. Build Docker image (with --platform linux/amd64 for EC2)
  │
  └── 2. Push to Docker Hub or AWS ECR
            │
            ▼
[ Container Registry (Docker Hub / AWS ECR) ]
            │
            ▼ (docker pull)
[ AWS EC2 Linux Instance ]
  │
  ├── 3. Install Docker & configure Security Group (Open Port 3000)
  ├── 4. Create persistent volume & .env file
  └── 5. Run container (Auto-migrates SQLite + starts Server & Worker)
            │
            ▼
[ Access Application ]
  ├── Public IP:  http://<EC2_PUBLIC_IP>:3000
  └── Private IP: http://<EC2_PRIVATE_IP>:3000
```

---

## Phase 1: Build the Docker Image

Run these commands in your project root on your local machine:

```bash
# 1. Define your Docker Hub username and image tag
DOCKER_USERNAME="your-dockerhub-username"
IMAGE_NAME="bulk-email-agent"
TAG="v1.0.0"

# 2. Build the image
# IMPORTANT: If building on an Apple Silicon (M1/M2/M3) Mac for an x86 EC2 instance,
# you MUST specify --platform linux/amd64 to avoid "exec format error" on AWS.
docker build --platform linux/amd64 -t ${DOCKER_USERNAME}/${IMAGE_NAME}:${TAG} -t ${DOCKER_USERNAME}/${IMAGE_NAME}:latest .
```

---

## Phase 2: Push Image to Container Registry

### Option A: Using Docker Hub (Simplest)

```bash
# 1. Log in to Docker Hub
docker login

# 2. Push the tagged image
docker push ${DOCKER_USERNAME}/${IMAGE_NAME}:${TAG}
docker push ${DOCKER_USERNAME}/${IMAGE_NAME}:latest
```

### Option B: Using AWS ECR (Elastic Container Registry)

```bash
AWS_REGION="us-east-1"
AWS_ACCOUNT_ID="123456789012"
ECR_REPO="${AWS_ACCOUNT_ID}.dkr.ecr.${AWS_REGION}.amazonaws.com/bulk-email-agent"

# 1. Authenticate Docker with your AWS ECR registry
aws ecr get-login-password --region ${AWS_REGION} | docker login --username AWS --password-stdin ${AWS_ACCOUNT_ID}.dkr.ecr.${AWS_REGION}.amazonaws.com

# 2. Create the repository in ECR (if it does not exist)
aws ecr create-repository --repository-name bulk-email-agent --region ${AWS_REGION} || true

# 3. Tag and push
docker tag ${DOCKER_USERNAME}/${IMAGE_NAME}:latest ${ECR_REPO}:latest
docker push ${ECR_REPO}:latest
```

---

## Phase 3: Launch & Configure AWS EC2 Instance

### 1. Launch Instance in AWS Console:
- **AMI**: **Amazon Linux 2023** (or **Ubuntu 24.04 / 22.04 LTS**)
- **Architecture**: **64-bit (x86)**
- **Instance Type**: `t3.micro` or `t3.small` (Free tier eligible or low cost)
- **Key Pair**: Select or create your `.pem` key pair (e.g. `my-key.pem`)

### 2. Configure AWS Security Group (CRITICAL)
In the **Security Group Inbound Rules**, add the following rules:

| Type | Protocol | Port Range | Source | Purpose |
| :--- | :--- | :--- | :--- | :--- |
| **SSH** | TCP | `22` | `My IP` | Secure terminal access |
| **Custom TCP** | TCP | `3000` | `0.0.0.0/0` (or your VPC CIDR) | **Web UI & REST API** |

> ⚠️ **Important**: If Port `3000` is not opened in your AWS Security Group, requests to the Public IP will time out!

---

## Phase 4: Setup EC2 & Pull Image

SSH into your EC2 instance from your terminal:

```bash
# For Amazon Linux 2023:
ssh -i /path/to/my-key.pem ec2-user@<EC2_PUBLIC_IP>

# For Ubuntu:
# ssh -i /path/to/my-key.pem ubuntu@<EC2_PUBLIC_IP>
```

### 1. Install & Start Docker on the EC2 Instance

#### On Amazon Linux 2023:
```bash
sudo dnf update -y
sudo dnf install -y docker
sudo systemctl enable --now docker
sudo usermod -aG docker ec2-user

# Apply docker group changes without logging out:
newgrp docker
```

#### On Ubuntu:
```bash
sudo apt-get update -y
sudo apt-get install -y docker.io
sudo systemctl enable --now docker
sudo usermod -aG docker ubuntu
newgrp docker
```

### 2. Log in and Pull Your Image

```bash
# If using Docker Hub:
docker pull your-dockerhub-username/bulk-email-agent:latest

# If using AWS ECR:
# aws ecr get-login-password --region us-east-1 | docker login --username AWS --password-stdin <AWS_ACCOUNT_ID>.dkr.ecr.us-east-1.amazonaws.com
# docker pull <AWS_ACCOUNT_ID>.dkr.ecr.us-east-1.amazonaws.com/bulk-email-agent:latest
```

---

## Phase 5: Run the Docker Container

### 1. Create a Project Directory & `.env` file on EC2

```bash
mkdir -p ~/email-agent && cd ~/email-agent
nano .env
```

Paste your configuration into `.env`:

```env
PORT=3000
DATABASE_PATH=/app/data/email-agent.db

# Choose active provider: 'gmail' or 'ses' (toggleable in UI)
EMAIL_PROVIDER=gmail

# Common Sender Email (Must be verified in AWS SES if using SES)
EMAIL_FROM=your_email@gmail.com
EMAIL_FROM_NAME=Bulk Email Agent

# Option A: Gmail SMTP Settings
SMTP_HOST=smtp.gmail.com
SMTP_PORT=465
SMTP_SECURE=true
SMTP_USER=your_email@gmail.com
SMTP_PASS=your_16_char_google_app_password

# Option B: Amazon SES Settings
AWS_ACCESS_KEY_ID=
AWS_SECRET_ACCESS_KEY=
AWS_REGION=us-east-1

# Rate limiting
MAX_EMAILS_PER_MINUTE=30
BATCH_SIZE=10
WORKER_INTERVAL_MS=2000
```

### 2. Run the Container with Volume Persistence

```bash
# Create local directory on EC2 host for SQLite DB and attachments
mkdir -p ~/email-agent/data

# Run the container
docker run -d \
  --name bulk-email-agent \
  --restart unless-stopped \
  -p 3000:3000 \
  --env-file .env \
  -v ~/email-agent/data:/app/data \
  your-dockerhub-username/bulk-email-agent:latest
```

> 💡 **Why `-v ~/email-agent/data:/app/data` is essential**:
> It maps the container's SQLite database and attachments to the EC2 host. If the container restarts or you update the image, **all your campaigns, recipient tables, and KPI analytics persist safely**!

---

## Phase 6: Verify & Access the Application

### 1. Verify Locally on the EC2 Instance (via curl)

```bash
# Check container status
docker ps

# Check container logs
docker logs bulk-email-agent

# Test server health
curl -s http://localhost:3000/api/health
# Expected: {"ok":true,"provider":"gmail"}
```

### 2. Access via Public IP (Browser)

Open your web browser and navigate to:
```
http://<EC2_PUBLIC_IP>:3000
```

You will see the full web dashboard:
- **Interactive Provider Switcher**: Toggle between `[ ✉️ Gmail SMTP ]` and `[ ⚡ Amazon SES ]`.
- **Recipient Import**: Upload `.xlsx` / `.csv` or paste lists.
- **Dual Mode Editor**: Write rich text or paste raw HTML code.
- **Real-time KPI Dashboard**: Track deliveries, opens, bounces, and clicks.

### 3. Access via Private IP (Within VPC / Private Subnet)

If accessing from another EC2 instance, VPN, or Bastion inside the same AWS VPC:
```bash
curl -s http://<EC2_PRIVATE_IP>:3000/api/health
```
Or open in a browser connected to your corporate AWS VPN / DirectConnect:
```
http://<EC2_PRIVATE_IP>:3000
```

---

## Phase 7: Useful Management Commands

### View Live Logs:
```bash
docker logs -f bulk-email-agent
```

### Restart Container:
```bash
docker restart bulk-email-agent
```

### Stop / Start Container:
```bash
docker stop bulk-email-agent
docker start bulk-email-agent
```

### Update to a New Image Version:
```bash
# 1. Pull the updated image
docker pull your-dockerhub-username/bulk-email-agent:latest

# 2. Stop and remove the old container
docker stop bulk-email-agent
docker rm bulk-email-agent

# 3. Launch with the new image (data remains intact in ~/email-agent/data)
docker run -d \
  --name bulk-email-agent \
  --restart unless-stopped \
  -p 3000:3000 \
  --env-file .env \
  -v ~/email-agent/data:/app/data \
  your-dockerhub-username/bulk-email-agent:latest
```

---

## 🛠️ Troubleshooting Checklist

1. **Browser times out when opening `http://<EC2_PUBLIC_IP>:3000`**:
   - Check the **AWS Security Group** attached to your EC2 instance. Ensure there is an Inbound Rule for **Custom TCP**, Port **3000**, Source **`0.0.0.0/0`**.
   - Check if your EC2 instance has an **Auto-assigned Public IP** (in VPC Subnet settings).
2. **Container exits immediately**:
   - Run `docker logs bulk-email-agent`.
   - Ensure the mounted volume directory has write permissions: `chmod 777 ~/email-agent/data`.
3. **Amazon SES fails to send**:
   - Check if your AWS account is in the **SES Sandbox**. In sandbox mode, both sender and recipient emails must be verified in the AWS Console.
   - Run `curl -s -X POST http://localhost:3000/api/provider/verify -H "Content-Type: application/json"` to test credentials.
