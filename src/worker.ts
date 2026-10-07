import dotenv from "dotenv";
dotenv.config();
import { db } from "./db/db";
import { processOne } from "./services/campaignService";
import { refreshKpis } from "./services/reports";

const interval = Number(process.env.WORKER_INTERVAL_MS || 1000);
const maxPerMinute = Number(process.env.MAX_EMAILS_PER_MINUTE || 60);
const delay = Math.max(1000, Math.ceil(60000 / maxPerMinute));

async function tick() {
  const campaigns = db.prepare(`SELECT campaign_id FROM campaigns WHERE started_at IS NOT NULL AND completed_at IS NULL`).all() as any[];
  for (const c of campaigns) {
    const did = await processOne(c.campaign_id);
    refreshKpis(c.campaign_id);
    const pending = db.prepare(`SELECT COUNT(*) n FROM campaign_recipients WHERE campaign_id=? AND status IN ('PENDING','QUEUED')`).get(c.campaign_id) as any;
    if (!pending.n) {
      db.prepare(`UPDATE campaigns SET completed_at=COALESCE(completed_at,?) WHERE campaign_id=?`).run(new Date().toISOString(), c.campaign_id);
    }
    if (did) await new Promise(r => setTimeout(r, delay));
  }
}

console.log("Worker running...");
setInterval(() => tick().catch(err => console.error(err)), interval);
tick().catch(err => console.error(err));
