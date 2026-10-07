import { db } from "./db";

db.exec(`
CREATE TABLE IF NOT EXISTS campaigns (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  campaign_id TEXT UNIQUE NOT NULL,
  campaign_name TEXT NOT NULL,
  subject TEXT NOT NULL,
  body TEXT NOT NULL,
  created_at TEXT NOT NULL,
  started_at TEXT,
  completed_at TEXT,
  total_recipients INTEGER NOT NULL DEFAULT 0,
  valid_recipients INTEGER NOT NULL DEFAULT 0,
  invalid_recipients INTEGER NOT NULL DEFAULT 0,
  duplicate_recipients INTEGER NOT NULL DEFAULT 0,
  sent_count INTEGER NOT NULL DEFAULT 0,
  delivered_count INTEGER NOT NULL DEFAULT 0,
  failed_count INTEGER NOT NULL DEFAULT 0,
  bounced_count INTEGER NOT NULL DEFAULT 0,
  rejected_count INTEGER NOT NULL DEFAULT 0,
  opened_count INTEGER NOT NULL DEFAULT 0,
  clicked_count INTEGER NOT NULL DEFAULT 0,
  attachments TEXT DEFAULT '[]'
);

CREATE TABLE IF NOT EXISTS recipients (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  email TEXT NOT NULL,
  name TEXT,
  company TEXT,
  UNIQUE(email)
);

CREATE TABLE IF NOT EXISTS campaign_recipients (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  campaign_id TEXT NOT NULL,
  recipient_id INTEGER NOT NULL,
  status TEXT NOT NULL DEFAULT 'PENDING',
  message_id TEXT,
  created_at TEXT NOT NULL,
  queued_at TEXT,
  sent_at TEXT,
  delivered_at TEXT,
  opened_at TEXT,
  clicked_at TEXT,
  failed_at TEXT,
  error_message TEXT,
  provider_response TEXT,
  retry_count INTEGER NOT NULL DEFAULT 0,
  last_retry_at TEXT,
  next_retry_at TEXT,
  failure_type TEXT,
  UNIQUE(campaign_id, recipient_id)
);

CREATE TABLE IF NOT EXISTS email_events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  event_id TEXT UNIQUE NOT NULL,
  campaign_id TEXT NOT NULL,
  recipient_id INTEGER NOT NULL,
  message_id TEXT,
  event_type TEXT NOT NULL,
  payload TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS webhook_events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  provider TEXT NOT NULL,
  event_id TEXT UNIQUE NOT NULL,
  payload TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS suppressions (
  email TEXT PRIMARY KEY,
  reason TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_cr_campaign ON campaign_recipients(campaign_id);
CREATE INDEX IF NOT EXISTS idx_cr_status ON campaign_recipients(status);
CREATE INDEX IF NOT EXISTS idx_cr_message ON campaign_recipients(message_id);
CREATE INDEX IF NOT EXISTS idx_events_campaign ON email_events(campaign_id);
`);

try {
  db.exec(`ALTER TABLE campaigns ADD COLUMN attachments TEXT DEFAULT '[]'`);
} catch {}

console.log("Database migrated.");
db.close();
