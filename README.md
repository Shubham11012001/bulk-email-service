# Bulk Email Automation & KPI Reporting Agent

A local, production-oriented foundation based on the supplied specification.

## Included

- `.xlsx` / `.csv` recipient import
- Email-column selection
- Email validation and duplicate detection
- Personalization with `{{name}}` and `{{company}}`
- Campaign creation and preview
- Explicit `START CAMPAIGN` approval
- Background worker
- Provider abstraction with a safe `mock` provider
- Per-recipient status tracking
- Idempotent event processing
- Suppression / unsubscribe support
- Retry metadata and rate limiting
- KPI dashboard
- Recipient status table
- CSV and XLSX campaign reports
- SQLite persistence for easy local startup
- CLI commands
- Automated tests
- No credentials stored in source code

## Requirements

- Node.js 20+
- npm

## Run

```bash
npm install
copy .env.example .env
npm run migrate
npm run dev
```

Open http://localhost:3000

In a second terminal:

```bash
npm run worker
```

The default provider is `mock`. It does **not** send real emails. This is intentional.

## CLI

```bash
npm run dev
npm run worker
npm run build
npm run test
npm run lint
npm run migrate
```

## Email Providers & Toggling (Amazon SES vs Gmail SMTP)

You can toggle between **Amazon SES**, **Gmail SMTP**, and **Mock** simulation either:
1. Directly from the **Web Dashboard header** in real time (`[ ✉️ Gmail SMTP ]  [ ⚡ Amazon SES ]`).
2. Via the `EMAIL_PROVIDER` variable in [.env](file:///Users/shubhammishra1101/Downloads/bulk-email-agent/.env) (`gmail`, `ses`, or `mock`).

### Amazon SES Configuration Options
Configure either of the following in [.env](file:///Users/shubhammishra1101/Downloads/bulk-email-agent/.env):
- **Option A (AWS IAM API Keys)**:
  ```env
  EMAIL_PROVIDER=ses
  AWS_ACCESS_KEY_ID=your_access_key
  AWS_SECRET_ACCESS_KEY=your_secret_key
  AWS_REGION=us-east-1
  EMAIL_FROM=verified_sender@yourdomain.com
  ```
- **Option B (SES SMTP Credentials)**:
  ```env
  EMAIL_PROVIDER=ses
  SES_SMTP_USER=your_ses_smtp_user
  SES_SMTP_PASS=your_ses_smtp_password
  SES_SMTP_HOST=email-smtp.us-east-1.amazonaws.com
  SES_SMTP_PORT=465
  SES_REGION=us-east-1
  EMAIL_FROM=verified_sender@yourdomain.com
  ```

### Gmail SMTP Configuration
```env
EMAIL_PROVIDER=gmail
SMTP_HOST=smtp.gmail.com
SMTP_PORT=465
SMTP_USER=your_email@gmail.com
SMTP_PASS=your_16_char_google_app_password
EMAIL_FROM=your_email@gmail.com
```

## API

- `GET /api/health`
- `POST /api/import`
- `POST /api/campaigns`
- `GET /api/campaigns`
- `GET /api/campaigns/:id`
- `POST /api/campaigns/:id/start`
- `GET /api/campaigns/:id/recipients`
- `GET /api/campaigns/:id/report.csv`
- `GET /api/campaigns/:id/report.xlsx`
- `POST /api/webhooks/:provider`

## Safety

Uploading a file never sends email. A campaign only enters the sending queue after the user explicitly presses `START CAMPAIGN`.

The mock provider generates provider-style events locally, allowing the complete workflow to be tested without sending mail.
