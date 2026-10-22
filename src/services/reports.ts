import { pool } from "../db/db";
import * as XLSX from "xlsx";

export async function getCampaign(campaignId: string) {
  const res = await pool.query(
    `SELECT * FROM campaigns WHERE campaign_id=$1`,
    [campaignId]
  );
  return res.rows[0] || null;
}

export async function getRecipients(campaignId: string) {
  const res = await pool.query(
    `
    SELECT cr.recipient_id,r.email,r.name,r.company,cr.status,cr.message_id,cr.sent_at,cr.delivered_at,
           cr.opened_at,cr.clicked_at,cr.failed_at,cr.error_message
    FROM campaign_recipients cr JOIN recipients r ON r.id=cr.recipient_id
    WHERE cr.campaign_id=$1 ORDER BY r.email
  `,
    [campaignId]
  );
  return res.rows;
}

export async function csvReport(campaignId: string): Promise<string> {
  const rows = (await getRecipients(campaignId)) as any[];
  const headers = [
    "email",
    "name",
    "company",
    "status",
    "message_id",
    "sent_at",
    "delivered_at",
    "opened_at",
    "clicked_at",
    "failed_at",
    "error_message",
  ];
  const esc = (v: unknown) => `"${String(v ?? "").replaceAll('"', '""')}"`;
  return [
    headers.join(","),
    ...rows.map((r) => headers.map((h) => esc(r[h])).join(",")),
  ].join("\n");
}

export async function xlsxReport(campaignId: string): Promise<Buffer> {
  const campaign = await getCampaign(campaignId);
  const recipients = await getRecipients(campaignId);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(
    wb,
    XLSX.utils.json_to_sheet([campaign || {}]),
    "Campaign Summary"
  );
  XLSX.utils.book_append_sheet(
    wb,
    XLSX.utils.json_to_sheet(recipients),
    "Recipients"
  );
  return XLSX.write(wb, { type: "buffer", bookType: "xlsx" }) as Buffer;
}

export async function refreshKpis(campaignId: string) {
  const res = await pool.query(
    `
    SELECT
      COALESCE(SUM(CASE WHEN status IN ('SENT','DELIVERED','OPENED','CLICKED') THEN 1 ELSE 0 END), 0)::integer sent_count,
      COALESCE(SUM(CASE WHEN status IN ('DELIVERED','OPENED','CLICKED') THEN 1 ELSE 0 END), 0)::integer delivered_count,
      COALESCE(SUM(CASE WHEN status='FAILED' THEN 1 ELSE 0 END), 0)::integer failed_count,
      COALESCE(SUM(CASE WHEN status='BOUNCED' THEN 1 ELSE 0 END), 0)::integer bounced_count,
      COALESCE(SUM(CASE WHEN status='REJECTED' THEN 1 ELSE 0 END), 0)::integer rejected_count,
      COALESCE(SUM(CASE WHEN status IN ('OPENED','CLICKED') THEN 1 ELSE 0 END), 0)::integer opened_count,
      COALESCE(SUM(CASE WHEN status='CLICKED' THEN 1 ELSE 0 END), 0)::integer clicked_count
    FROM campaign_recipients WHERE campaign_id=$1
  `,
    [campaignId]
  );
  const counts = res.rows[0] || {};
  await pool.query(
    `UPDATE campaigns SET sent_count=$1,delivered_count=$2,failed_count=$3,bounced_count=$4,rejected_count=$5,opened_count=$6,clicked_count=$7 WHERE campaign_id=$8`,
    [
      Number(counts.sent_count) || 0,
      Number(counts.delivered_count) || 0,
      Number(counts.failed_count) || 0,
      Number(counts.bounced_count) || 0,
      Number(counts.rejected_count) || 0,
      Number(counts.opened_count) || 0,
      Number(counts.clicked_count) || 0,
      campaignId,
    ]
  );
}
