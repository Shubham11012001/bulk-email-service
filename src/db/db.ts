import { Pool } from "pg";
import dotenv from "dotenv";

dotenv.config();

const connectionString =
  process.env.DATABASE_URL ||
  "postgresql://postgres:postgres@localhost:5432/bulk_email_agent";

const sslConfig =
  process.env.DATABASE_SSL === "true" ||
  connectionString.includes("sslmode=require")
    ? { rejectUnauthorized: false }
    : false;

export const pool = new Pool({
  connectionString,
  ssl: sslConfig,
});

pool.on("error", (err) => {
  console.error("Unexpected error on idle PostgreSQL client", err);
});
