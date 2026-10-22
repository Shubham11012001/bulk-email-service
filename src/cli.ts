#!/usr/bin/env node
import fs from "fs";
import * as XLSX from "xlsx";
import { validateRecipients } from "./services/validation";

const [cmd, arg] = process.argv.slice(2);

async function main() {
  if (cmd === "import" || cmd === "validate") {
    const wb = XLSX.read(fs.readFileSync(arg), { type: "buffer" });
    const rows = XLSX.utils.sheet_to_json<any>(wb.Sheets[wb.SheetNames[0]], { defval: "" });
    const key = Object.keys(rows[0] || {}).find((k) => k.toLowerCase() === "email");
    if (!key) throw new Error("email column not found");
    const r = validateRecipients(rows.map((x) => ({ email: x[key], name: x.name, company: x.company })));
    console.log(
      JSON.stringify(
        {
          total: rows.length,
          valid: r.valid.length,
          invalid: r.invalid.length,
          duplicates: r.duplicates.length,
        },
        null,
        2
      )
    );
    return;
  }
  if (cmd === "campaign-status") {
    const { getCampaign } = await import("./services/reports");
    const { pool } = await import("./db/db");
    try {
      console.log(await getCampaign(arg));
    } finally {
      await pool.end();
    }
    return;
  }
  if (cmd === "report") {
    const { csvReport } = await import("./services/reports");
    const { pool } = await import("./db/db");
    try {
      console.log(await csvReport(arg));
    } finally {
      await pool.end();
    }
    return;
  }
  console.log("Commands: import <file>, validate <file>, campaign-status <id>, report <id>");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
