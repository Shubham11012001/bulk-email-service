import dotenv from "dotenv";
dotenv.config();
import { pool } from "./db/db";
import { processOne } from "./services/campaignService";
import { refreshKpis } from "./services/reports";

const interval = Number(process.env.WORKER_INTERVAL_MS || 1000);
const maxPerMinute = Number(process.env.MAX_EMAILS_PER_MINUTE || 60);
const delay = Math.max(1000, Math.ceil(60000 / maxPerMinute));

let isRunning = false;

async function tick() {
  if (isRunning) return;
  isRunning = true;
  try {
    const res = await pool.query(
      `SELECT campaign_id FROM campaigns WHERE started_at IS NOT NULL AND completed_at IS NULL`
    );
    const campaigns = res.rows as any[];
    for (const c of campaigns) {
      const did = await processOne(c.campaign_id);
      await refreshKpis(c.campaign_id);
      const pendingRes = await pool.query(
        `SELECT COUNT(*)::integer AS n FROM campaign_recipients WHERE campaign_id=$1 AND status IN ('PENDING','QUEUED')`,
        [c.campaign_id]
      );
      const pending = pendingRes.rows[0];
      if (!pending?.n) {
        await pool.query(
          `UPDATE campaigns SET completed_at=COALESCE(completed_at,$1) WHERE campaign_id=$2`,
          [new Date().toISOString(), c.campaign_id]
        );
      }
      if (did) await new Promise((r) => setTimeout(r, delay));
    }
  } finally {
    isRunning = false;
  }
}

console.log("Worker running...");
setInterval(() => tick().catch((err) => console.error(err)), interval);
tick().catch((err) => console.error(err));
