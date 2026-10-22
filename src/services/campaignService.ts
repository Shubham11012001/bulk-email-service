import { pool } from "../db/db";
import crypto from "crypto";
import { getEmailProvider } from "../providers/emailProvider";
import { personalize, formatEmailBody } from "./validation";

export async function createCampaign(input: {
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

  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    await client.query(
      `INSERT INTO campaigns
        (campaign_id, campaign_name, subject, body, created_at, total_recipients, valid_recipients, invalid_recipients, duplicate_recipients, attachments)
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
      [
        campaignId,
        input.name,
        input.subject,
        formattedBody,
        now,
        input.recipients.length + input.invalidCount + input.duplicateCount,
        input.recipients.length,
        input.invalidCount,
        input.duplicateCount,
        attachmentsJson,
      ]
    );

    for (const r of input.recipients) {
      const recRes = await client.query(
        `INSERT INTO recipients(email, name, company)
         VALUES ($1, $2, $3)
         ON CONFLICT (email) DO UPDATE SET name = EXCLUDED.name, company = EXCLUDED.company
         RETURNING id`,
        [r.email, r.name || null, r.company || null]
      );
      const recipientId = recRes.rows[0].id;

      await client.query(
        `INSERT INTO campaign_recipients(campaign_id, recipient_id, created_at)
         VALUES ($1, $2, $3)`,
        [campaignId, recipientId, now]
      );
    }

    await client.query("COMMIT");
    return campaignId;
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
  }
}

export async function startCampaign(campaignId: string) {
  const res = await pool.query(
    `SELECT * FROM campaigns WHERE campaign_id = $1`,
    [campaignId]
  );
  const campaign = res.rows[0];
  if (!campaign) throw new Error("Campaign not found");
  if (campaign.started_at) throw new Error("Campaign has already been started");

  const now = new Date().toISOString();
  await pool.query(
    `UPDATE campaigns SET started_at = $1 WHERE campaign_id = $2`,
    [now, campaignId]
  );
  return { campaignId, startedAt: now };
}

export async function processOne(campaignId: string) {
  const res = await pool.query(
    `
    SELECT cr.*, r.email, r.name, r.company, c.subject, c.body, c.attachments
    FROM campaign_recipients cr
    JOIN recipients r ON r.id=cr.recipient_id
    JOIN campaigns c ON c.campaign_id=cr.campaign_id
    WHERE cr.campaign_id=$1 AND cr.status='PENDING'
    ORDER BY cr.id LIMIT 1
  `,
    [campaignId]
  );
  const row = res.rows[0];

  if (!row) return false;

  const suppRes = await pool.query(
    `SELECT 1 FROM suppressions WHERE email=$1`,
    [row.email]
  );
  if (suppRes.rows.length > 0) {
    await pool.query(
      `UPDATE campaign_recipients SET status='UNSUBSCRIBED', failed_at=$1 WHERE id=$2`,
      [new Date().toISOString(), row.id]
    );
    return true;
  }

  let attachmentsList: any[] = [];
  try {
    if (row.attachments) {
      attachmentsList =
        typeof row.attachments === "string"
          ? JSON.parse(row.attachments)
          : row.attachments;
    }
  } catch {}

  const provider = getEmailProvider();
  const queuedAt = new Date().toISOString();
  await pool.query(
    `UPDATE campaign_recipients SET status='QUEUED', queued_at=$1 WHERE id=$2`,
    [queuedAt, row.id]
  );

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
    trackingUrl,
  });

  if (!result.accepted || !result.messageId) {
    await pool.query(
      `UPDATE campaign_recipients SET status='FAILED',failed_at=$1,error_message=$2,provider_response=$3 WHERE id=$4`,
      [
        new Date().toISOString(),
        result.error || "Provider rejected request",
        JSON.stringify(result.response ?? {}),
        row.id,
      ]
    );
    return true;
  }

  if (result.delivered) {
    const now = new Date().toISOString();
    await pool.query(
      `UPDATE campaign_recipients SET status='DELIVERED',message_id=$1,sent_at=$2,delivered_at=$3,provider_response=$4 WHERE id=$5`,
      [
        result.messageId,
        now,
        now,
        JSON.stringify(result.response ?? {}),
        row.id,
      ]
    );
  } else {
    await pool.query(
      `UPDATE campaign_recipients SET status='SENT',message_id=$1,sent_at=$2,provider_response=$3 WHERE id=$4`,
      [
        result.messageId,
        new Date().toISOString(),
        JSON.stringify(result.response ?? {}),
        row.id,
      ]
    );
  }
  return true;
}

export async function applyEvent(event: {
  eventId: string;
  campaignId: string;
  recipientId: number;
  messageId: string;
  type: string;
  payload: unknown;
}) {
  const now = new Date().toISOString();
  const insertRes = await pool.query(
    `INSERT INTO email_events(event_id,campaign_id,recipient_id,message_id,event_type,payload,created_at)
     VALUES($1,$2,$3,$4,$5,$6,$7)
     ON CONFLICT (event_id) DO NOTHING`,
    [
      event.eventId,
      event.campaignId,
      event.recipientId,
      event.messageId,
      event.type,
      JSON.stringify(event.payload),
      now,
    ]
  );
  if (insertRes.rowCount === 0) return false;

  const map: Record<string, string> = {
    delivered: "DELIVERED",
    opened: "OPENED",
    clicked: "CLICKED",
    failed: "FAILED",
    bounced: "BOUNCED",
    rejected: "REJECTED",
    unsubscribed: "UNSUBSCRIBED",
  };
  const status = map[event.type];
  if (!status) return true;

  const timeCol: Record<string, string> = {
    delivered: "delivered_at",
    opened: "opened_at",
    clicked: "clicked_at",
    failed: "failed_at",
  };
  const col = timeCol[event.type];
  if (col) {
    await pool.query(
      `UPDATE campaign_recipients SET status=$1, ${col}=$2 WHERE campaign_id=$3 AND recipient_id=$4`,
      [status, now, event.campaignId, event.recipientId]
    );
  } else {
    await pool.query(
      `UPDATE campaign_recipients SET status=$1 WHERE campaign_id=$2 AND recipient_id=$3`,
      [status, event.campaignId, event.recipientId]
    );
  }
  return true;
}
