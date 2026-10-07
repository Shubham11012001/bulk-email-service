import dotenv from "dotenv";
dotenv.config();
import Fastify from "fastify";
import cors from "@fastify/cors";
import multipart from "@fastify/multipart";
import fastifyStatic from "@fastify/static";
import fs from "fs";
import path from "path";
import * as XLSX from "xlsx";
import { db } from "./db/db";
import { getEmailProvider, getActiveProviderName, setActiveProviderName, getProviderConfigStatus } from "./providers/emailProvider";
import { validateRecipients, formatEmailBody } from "./services/validation";
import { createCampaign, startCampaign, applyEvent } from "./services/campaignService";
import { getCampaign, getRecipients, csvReport, xlsxReport, refreshKpis } from "./services/reports";

const app = Fastify({ logger: true });
app.register(cors, { origin: true });
app.register(multipart);
app.register(fastifyStatic, { root: path.join(process.cwd(), "public") });

app.get("/api/health", async () => ({ ok: true, provider: getActiveProviderName() }));

app.get("/api/provider", async () => {
  return getProviderConfigStatus();
});

app.post("/api/provider/select", async (req, reply) => {
  const body = req.body as any;
  const target = body?.provider;
  if (!target) return reply.code(400).send({ error: "Missing 'provider' field" });
  try {
    const active = setActiveProviderName(target);
    return { ok: true, active, status: getProviderConfigStatus() };
  } catch (err: any) {
    return reply.code(400).send({ error: err.message });
  }
});

app.post("/api/provider/verify", async (req, reply) => {
  const body = req.body as any;
  const targetProvider = body?.provider ? String(body.provider).toLowerCase() : getActiveProviderName();
  try {
    const provider = getEmailProvider(targetProvider);
    if ("verify" in provider && typeof (provider as any).verify === "function") {
      const res = await (provider as any).verify();
      return { ...res, provider: targetProvider };
    }
    return { ok: true, provider: targetProvider, message: "Provider does not require connection verification" };
  } catch (err: any) {
    return reply.code(400).send({ ok: false, provider: targetProvider, error: err.message });
  }
});

app.post("/api/smtp/verify", async () => {
  const provider = getEmailProvider();
  if ("verify" in provider && typeof (provider as any).verify === "function") {
    return await (provider as any).verify();
  }
  return { ok: true, message: "Provider does not require connection verification" };
});

app.post("/api/test-email", async (req, reply) => {
  const body = req.body as any;
  const to = body?.to;
  if (!to) return reply.code(400).send({ error: "Recipient email 'to' is required" });
  const provider = getEmailProvider();
  const testSubject = body?.subject || "Test Email from Bulk Email Agent";
  const rawTestBody = body?.body || "<h3>Bulk Email Agent Test</h3><p>Your email provider integration is working properly and ready to deliver campaigns!</p>";
  const testBody = formatEmailBody(rawTestBody);
  const res = await provider.sendEmail({
    to,
    from: process.env.EMAIL_FROM || process.env.SMTP_USER || "test@example.com",
    fromName: process.env.EMAIL_FROM_NAME || "Bulk Email Agent",
    subject: testSubject,
    body: testBody,
    attachments: body?.attachments || [],
    idempotencyKey: `test_${Date.now()}`
  });
  return res;
});

app.post("/api/upload-attachment", async (req, reply) => {
  const data = await (req as any).file();
  if (!data) return reply.code(400).send({ error: "No file provided" });

  const uploadDir = path.join(process.cwd(), "data", "attachments");
  fs.mkdirSync(uploadDir, { recursive: true });

  const safeFilename = path.basename(data.filename).replace(/[^a-zA-Z0-9._-]/g, "_");
  const uniqueName = `${Date.now()}_${safeFilename}`;
  const filePath = path.join(uploadDir, uniqueName);

  const buf = await data.toBuffer();
  fs.writeFileSync(filePath, buf);

  return {
    filename: data.filename,
    storedName: uniqueName,
    path: filePath,
    contentType: data.mimetype || "application/octet-stream",
    size: buf.length
  };
});

// Open tracking pixel
app.get("/api/track/open/:campaignId/:recipientId", async (req, reply) => {
  const { campaignId, recipientId } = req.params as any;
  const numRecipientId = Number(recipientId);

  try {
    const row = db.prepare(`SELECT * FROM campaign_recipients WHERE campaign_id=? AND recipient_id=?`).get(campaignId, numRecipientId) as any;
    if (row) {
      const now = new Date().toISOString();
      const nextStatus = (row.status === 'CLICKED' || row.status === 'UNSUBSCRIBED') ? row.status : 'OPENED';
      db.prepare(`UPDATE campaign_recipients SET status=?, opened_at=COALESCE(opened_at,?) WHERE campaign_id=? AND recipient_id=?`)
        .run(nextStatus, now, campaignId, numRecipientId);

      const eventId = `open_${campaignId}_${numRecipientId}_${Date.now()}`;
      db.prepare(`INSERT OR IGNORE INTO email_events(event_id,campaign_id,recipient_id,message_id,event_type,payload,created_at)
        VALUES(?,?,?,?,?,?,?)`).run(eventId, campaignId, numRecipientId, row.message_id || null, 'opened', JSON.stringify({ ip: req.ip, userAgent: req.headers['user-agent'] }), now);

      refreshKpis(campaignId);
    }
  } catch (e) {
    req.log.error(e);
  }

  const TRANSPARENT_1PX_PNG = Buffer.from(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=",
    "base64"
  );
  reply.header("Content-Type", "image/png");
  reply.header("Cache-Control", "no-store, no-cache, must-revalidate, proxy-revalidate");
  reply.header("Pragma", "no-cache");
  reply.header("Expires", "0");
  return reply.send(TRANSPARENT_1PX_PNG);
});

// Manual open trigger (for testing / simulation)
app.post("/api/campaigns/:id/recipients/:recipientId/open", async (req, reply) => {
  const { id: campaignId, recipientId } = req.params as any;
  const numRecipientId = Number(recipientId);
  const row = db.prepare(`SELECT * FROM campaign_recipients WHERE campaign_id=? AND recipient_id=?`).get(campaignId, numRecipientId) as any;
  if (!row) return reply.code(404).send({ error: "Recipient not found in campaign" });

  const now = new Date().toISOString();
  db.prepare(`UPDATE campaign_recipients SET status='OPENED', opened_at=COALESCE(opened_at,?) WHERE campaign_id=? AND recipient_id=?`)
    .run(now, campaignId, numRecipientId);
  refreshKpis(campaignId);
  return { ok: true, campaignId, recipientId: numRecipientId, openedAt: now };
});

app.post("/api/import", async (req, reply) => {
  const file = await (req as any).file();
  if (!file) return reply.code(400).send({ error: "File required" });
  const ext = path.extname(file.filename).toLowerCase();
  if (![".xlsx",".csv"].includes(ext)) return reply.code(400).send({ error: "Only .xlsx and .csv are accepted" });
  const buf = await file.toBuffer();
  const wb = XLSX.read(buf, { type: "buffer" });
  const sheet = wb.Sheets[wb.SheetNames[0]];
  const rows = XLSX.utils.sheet_to_json<any>(sheet, { defval: "" });
  const keys = rows[0] ? Object.keys(rows[0]) : [];
  const emailKey = keys.find(k => k.toLowerCase() === "email") || keys.find(k => k.toLowerCase().includes("mail"));
  if (!emailKey) return reply.code(400).send({ error: "Could not find an email column", columns: keys });
  const mapped = rows.map(r => ({ email: r[emailKey], name: r.name ?? r.Name, company: r.company ?? r.Company }));
  const result = validateRecipients(mapped);
  return {
    total: rows.length,
    valid: result.valid.length,
    invalid: result.invalid.length,
    duplicates: result.duplicates.length,
    readyToSend: result.valid.length,
    invalidRows: result.invalid,
    duplicateRows: result.duplicates,
    recipients: result.valid
  };
});

app.post("/api/campaigns", async (req, reply) => {
  const body = req.body as any;
  if (!body?.name || !body?.subject || !body?.body || !Array.isArray(body?.recipients))
    return reply.code(400).send({ error: "name, subject, body and recipients are required" });
  const checked = validateRecipients(body.recipients);
  const campaignId = createCampaign({
    name: body.name, subject: body.subject, body: body.body,
    recipients: checked.valid, invalidCount: checked.invalid.length, duplicateCount: checked.duplicates.length,
    attachments: body.attachments || []
  });
  return { campaignId, validation: { valid: checked.valid.length, invalid: checked.invalid.length, duplicates: checked.duplicates.length } };
});

app.get("/api/campaigns", async () => db.prepare(`SELECT * FROM campaigns ORDER BY created_at DESC`).all());

app.get("/api/campaigns/:id", async (req, reply) => {
  const id = (req.params as any).id;
  const campaign = getCampaign(id);
  if (!campaign) return reply.code(404).send({ error: "Campaign not found" });
  refreshKpis(id);
  return getCampaign(id);
});

app.post("/api/campaigns/:id/start", async (req, reply) => {
  try { return startCampaign((req.params as any).id); }
  catch (e: any) { return reply.code(400).send({ error: e.message }); }
});

app.get("/api/campaigns/:id/recipients", async (req) => getRecipients((req.params as any).id));

app.get("/api/campaigns/:id/report.csv", async (req, reply) => {
  reply.header("Content-Type","text/csv");
  reply.header("Content-Disposition", `attachment; filename="${(req.params as any).id}.csv"`);
  return csvReport((req.params as any).id);
});

app.get("/api/campaigns/:id/report.xlsx", async (req, reply) => {
  reply.header("Content-Type","application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
  reply.header("Content-Disposition", `attachment; filename="${(req.params as any).id}.xlsx"`);
  return xlsxReport((req.params as any).id);
});

app.post("/api/webhooks/:provider", async (req) => {
  const body = req.body as any;
  const events = Array.isArray(body) ? body : [body];
  const results = [];
  for (const e of events) {
    const eventId = e.eventId || e.id;
    if (!eventId) continue;
    db.prepare(`INSERT OR IGNORE INTO webhook_events(provider,event_id,payload,created_at) VALUES(?,?,?,?)`)
      .run((req.params as any).provider,eventId,JSON.stringify(e),new Date().toISOString());
    const row = db.prepare(`SELECT campaign_id,recipient_id FROM campaign_recipients WHERE message_id=?`).get(e.messageId) as any;
    if (row) results.push(applyEvent({ eventId, campaignId: row.campaign_id, recipientId: row.recipient_id, messageId: e.messageId, type: e.type, payload: e }));
  }
  return { processed: results.filter(Boolean).length };
});

app.post("/api/suppressions", async (req) => {
  const b = req.body as any;
  db.prepare(`INSERT OR REPLACE INTO suppressions(email,reason,created_at) VALUES(?,?,?)`)
    .run(String(b.email).toLowerCase().trim(), b.reason || "manual", new Date().toISOString());
  return { ok: true };
});

app.get("/", async (_, reply) => reply.sendFile("index.html"));

const port = Number(process.env.PORT || 3000);
app.listen({ port, host: "0.0.0.0" }).then(() => console.log(`http://localhost:${port}`));
