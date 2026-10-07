import { db } from "../db/db";
import crypto from "crypto";
import { getEmailProvider } from "../providers/emailProvider";
import { personalize, formatEmailBody } from "./validation";

export function createCampaign(input: {
  name: string;
  subject: string;
  body: string;
  recipients: Array<{ email: string; name?: string; company?: string }>;
  invalidCount: number;
  duplicateCount: number;
  attachments?: any[];
}) {
  const campaignId = crypto.randomUUID();
  const now = new Date().toISOString();
  const attachmentsJson = JSON.stringify(input.attachments || []);
  const formattedBody = formatEmailBody(input.body);
  const tx = db.transaction(() => {
    db.prepare(`INSERT INTO campaigns
      (campaign_id,campaign_name,subject,body,created_at,total_recipients,valid_recipients,invalid_recipients,duplicate_recipients,attachments)
      VALUES (?,?,?,?,?,?,?,?,?,?)`).run(
      campaignId, input.name, input.subject, formattedBody, now,
      input.recipients.length + input.invalidCount + input.duplicateCount,
      input.recipients.length, input.invalidCount, input.duplicateCount,
      attachmentsJson
    );

    const recipientStmt = db.prepare(`INSERT INTO recipients(email,name,company)
      VALUES(?,?,?) ON CONFLICT(email) DO UPDATE SET name=excluded.name, company=excluded.company`);
    const getRecipient = db.prepare(`SELECT id FROM recipients WHERE email=?`);
    const crStmt = db.prepare(`INSERT INTO campaign_recipients(campaign_id,recipient_id,created_at)
      VALUES(?,?,?)`);

    for (const r of input.recipients) {
      recipientStmt.run(r.email, r.name || null, r.company || null);
      const row = getRecipient.get(r.email) as { id: number };
      crStmt.run(campaignId, row.id, now);
    }
  });
  tx();
  return campaignId;
}

export function startCampaign(campaignId: string) {
  const campaign = db.prepare(`SELECT * FROM campaigns WHERE campaign_id=?`).get(campaignId) as any;
  if (!campaign) throw new Error("Campaign not found");
  if (campaign.started_at) throw new Error("Campaign has already been started");

  const now = new Date().toISOString();
  db.prepare(`UPDATE campaigns SET started_at=? WHERE campaign_id=?`).run(now, campaignId);
  return { campaignId, startedAt: now };
}

export async function processOne(campaignId: string) {
  const row = db.prepare(`
    SELECT cr.*, r.email, r.name, r.company, c.subject, c.body, c.attachments
    FROM campaign_recipients cr
    JOIN recipients r ON r.id=cr.recipient_id
    JOIN campaigns c ON c.campaign_id=cr.campaign_id
    WHERE cr.campaign_id=? AND cr.status='PENDING'
    ORDER BY cr.id LIMIT 1
  `).get(campaignId) as any;

  if (!row) return false;

  const suppressed = db.prepare(`SELECT 1 FROM suppressions WHERE email=?`).get(row.email);
  if (suppressed) {
    db.prepare(`UPDATE campaign_recipients SET status='UNSUBSCRIBED', failed_at=? WHERE id=?`)
      .run(new Date().toISOString(), row.id);
    return true;
  }

  let attachmentsList: any[] = [];
  try {
    if (row.attachments) attachmentsList = JSON.parse(row.attachments);
  } catch {}

  const provider = getEmailProvider();
  const queuedAt = new Date().toISOString();
  db.prepare(`UPDATE campaign_recipients SET status='QUEUED', queued_at=? WHERE id=?`).run(queuedAt, row.id);

  const appUrl = process.env.APP_URL || "http://localhost:3000";
  const trackingUrl = `${appUrl}/api/track/open/${campaignId}/${row.recipient_id}`;

  const result = await provider.sendEmail({
    to: row.email,
    from: process.env.EMAIL_FROM || "sender@example.com",
    fromName: process.env.EMAIL_FROM_NAME || "Bulk Email Agent",
    subject: personalize(row.subject, row),
    body: formatEmailBody(personalize(row.body, row)),
    idempotencyKey: `${campaignId}:${row.recipient_id}`,
    attachments: attachmentsList,
    trackingUrl
  });

  if (!result.accepted || !result.messageId) {
    db.prepare(`UPDATE campaign_recipients SET status='FAILED',failed_at=?,error_message=?,provider_response=? WHERE id=?`)
      .run(new Date().toISOString(), result.error || "Provider rejected request", JSON.stringify(result.response ?? {}), row.id);
    return true;
  }

  if (result.delivered) {
    const now = new Date().toISOString();
    db.prepare(`UPDATE campaign_recipients SET status='DELIVERED',message_id=?,sent_at=?,delivered_at=?,provider_response=? WHERE id=?`)
      .run(result.messageId, now, now, JSON.stringify(result.response ?? {}), row.id);
  } else {
    db.prepare(`UPDATE campaign_recipients SET status='SENT',message_id=?,sent_at=?,provider_response=? WHERE id=?`)
      .run(result.messageId, new Date().toISOString(), JSON.stringify(result.response ?? {}), row.id);
  }
  return true;
}

export function applyEvent(event: {
  eventId: string; campaignId: string; recipientId: number; messageId: string; type: string; payload: unknown;
}) {
  const now = new Date().toISOString();
  const inserted = db.prepare(`INSERT OR IGNORE INTO email_events(event_id,campaign_id,recipient_id,message_id,event_type,payload,created_at)
    VALUES(?,?,?,?,?,?,?)`).run(event.eventId,event.campaignId,event.recipientId,event.messageId,event.type,JSON.stringify(event.payload),now);
  if (inserted.changes === 0) return false;

  const map: Record<string,string> = {
    delivered: "DELIVERED", opened: "OPENED", clicked: "CLICKED",
    failed: "FAILED", bounced: "BOUNCED", rejected: "REJECTED", unsubscribed: "UNSUBSCRIBED"
  };
  const status = map[event.type];
  if (!status) return true;

  const timeCol: Record<string,string> = {
    delivered: "delivered_at", opened: "opened_at", clicked: "clicked_at", failed: "failed_at"
  };
  const col = timeCol[event.type];
  if (col) {
    db.prepare(`UPDATE campaign_recipients SET status=?, ${col}=? WHERE campaign_id=? AND recipient_id=?`).run(status, now, event.campaignId, event.recipientId);
  } else {
    db.prepare(`UPDATE campaign_recipients SET status=? WHERE campaign_id=? AND recipient_id=?`).run(status, event.campaignId, event.recipientId);
  }
  return true;
}
