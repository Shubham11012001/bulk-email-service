import { db } from "../db/db";
import * as XLSX from "xlsx";

export function getCampaign(campaignId: string) {
  return db.prepare(`SELECT * FROM campaigns WHERE campaign_id=?`).get(campaignId);
}

export function getRecipients(campaignId: string) {
  return db.prepare(`
    SELECT cr.recipient_id,r.email,r.name,r.company,cr.status,cr.message_id,cr.sent_at,cr.delivered_at,
           cr.opened_at,cr.clicked_at,cr.failed_at,cr.error_message
    FROM campaign_recipients cr JOIN recipients r ON r.id=cr.recipient_id
    WHERE cr.campaign_id=? ORDER BY r.email
  `).all(campaignId);
}

export function csvReport(campaignId: string) {
  const rows = getRecipients(campaignId) as any[];
  const headers = ["email","name","company","status","message_id","sent_at","delivered_at","opened_at","clicked_at","failed_at","error_message"];
  const esc = (v: unknown) => `"${String(v ?? "").replaceAll('"','""')}"`;
  return [headers.join(","), ...rows.map(r => headers.map(h => esc(r[h])).join(","))].join("\n");
}

export function xlsxReport(campaignId: string): Buffer {
  const campaign = getCampaign(campaignId);
  const recipients = getRecipients(campaignId);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet([campaign]), "Campaign Summary");
  XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(recipients), "Recipients");
  return XLSX.write(wb, { type: "buffer", bookType: "xlsx" }) as Buffer;
}

export function refreshKpis(campaignId: string) {
  const counts = db.prepare(`
    SELECT
      SUM(CASE WHEN status IN ('SENT','DELIVERED','OPENED','CLICKED') THEN 1 ELSE 0 END) sent_count,
      SUM(CASE WHEN status IN ('DELIVERED','OPENED','CLICKED') THEN 1 ELSE 0 END) delivered_count,
      SUM(CASE WHEN status='FAILED' THEN 1 ELSE 0 END) failed_count,
      SUM(CASE WHEN status='BOUNCED' THEN 1 ELSE 0 END) bounced_count,
      SUM(CASE WHEN status='REJECTED' THEN 1 ELSE 0 END) rejected_count,
      SUM(CASE WHEN status IN ('OPENED','CLICKED') THEN 1 ELSE 0 END) opened_count,
      SUM(CASE WHEN status='CLICKED' THEN 1 ELSE 0 END) clicked_count
    FROM campaign_recipients WHERE campaign_id=?
  `).get(campaignId) as any;
  db.prepare(`UPDATE campaigns SET sent_count=?,delivered_count=?,failed_count=?,bounced_count=?,rejected_count=?,opened_count=?,clicked_count=? WHERE campaign_id=?`)
    .run(counts.sent_count||0,counts.delivered_count||0,counts.failed_count||0,counts.bounced_count||0,counts.rejected_count||0,counts.opened_count||0,counts.clicked_count||0,campaignId);
}
