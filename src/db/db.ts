import Database from "better-sqlite3";
import dotenv from "dotenv";
dotenv.config();

const path = process.env.DATABASE_PATH || "./data/email-agent.db";
import fs from "fs";
import pathLib from "path";
fs.mkdirSync(pathLib.dirname(path), { recursive: true });

export const db = new Database(path);
db.pragma("journal_mode = WAL");
db.pragma("foreign_keys = ON");
