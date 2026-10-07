import net from "net";
import tls from "tls";
import crypto from "crypto";
import fs from "fs";
import { EmailProvider, ProviderResult, SendInput } from "./emailProvider";
import { buildRawMimeEmail } from "./mimeBuilder";

export interface SmtpConfig {
  host: string;
  port: number;
  secure?: boolean;
  user: string;
  pass: string;
}

class SmtpSession {
  private socket: net.Socket | tls.TLSSocket;
  private buffer: string = "";
  private linesAccumulator: string[] = [];
  private pendingResolve: ((res: { code: number; text: string }) => void) | null = null;
  private pendingReject: ((err: Error) => void) | null = null;

  constructor(socket: net.Socket | tls.TLSSocket) {
    this.socket = socket;
    this.socket.setEncoding("utf8");
    this.socket.on("data", (chunk: string) => this.onData(chunk));
  }

  private onData(chunk: string) {
    this.buffer += chunk;
    const lines = this.buffer.split(/\r?\n/);
    this.buffer = lines.pop() ?? "";

    for (const raw of lines) {
      const line = raw.trim();
      if (!line) continue;
      this.linesAccumulator.push(line);
      // Final line of an SMTP reply has space or nothing after the 3-digit code
      if (/^\d{3}(?:$|\s)/.test(line)) {
        const code = parseInt(line.slice(0, 3), 10);
        const fullText = this.linesAccumulator.join(" ");
        this.linesAccumulator = [];
        if (this.pendingResolve) {
          const resolver = this.pendingResolve;
          this.pendingResolve = null;
          this.pendingReject = null;
          resolver({ code, text: fullText });
        }
      }
    }
  }

  readResponse(): Promise<{ code: number; text: string }> {
    return new Promise((resolve, reject) => {
      this.pendingResolve = resolve;
      this.pendingReject = reject;
    });
  }

  async command(cmd: string, expectedCode: number | number[]): Promise<{ code: number; text: string }> {
    const p = this.readResponse();
    this.socket.write(cmd + "\r\n");
    const res = await p;
    const expected = Array.isArray(expectedCode) ? expectedCode : [expectedCode];
    if (!expected.includes(res.code)) {
      throw new Error(`SMTP command "${cmd.length > 20 ? cmd.slice(0, 10) + '...' : cmd}" failed with code ${res.code}: ${res.text}`);
    }
    return res;
  }

  async sendData(data: string, expectedCode: number): Promise<{ code: number; text: string }> {
    const p = this.readResponse();
    this.socket.write(data);
    const res = await p;
    if (res.code !== expectedCode) {
      throw new Error(`SMTP DATA transfer failed with code ${res.code}: ${res.text}`);
    }
    return res;
  }

  async init(isSecure: boolean, host: string, port: number, user: string, pass: string) {
    // 1. Read greeting banner (220)
    const greeting = await this.readResponse();
    if (greeting.code !== 220) {
      throw new Error(`SMTP server did not greet with code 220: ${greeting.text}`);
    }

    if (!isSecure && port === 587) {
      // STARTTLS negotiation
      await this.command("EHLO localhost", 250);
      await this.command("STARTTLS", 220);
      await new Promise<void>((resolve, reject) => {
        const tlsSocket = tls.connect({
          socket: this.socket as net.Socket,
          host,
          rejectUnauthorized: false,
          servername: host
        });
        tlsSocket.on("secureConnect", () => {
          this.socket = tlsSocket;
          tlsSocket.setEncoding("utf8");
          tlsSocket.on("data", (chunk: string) => this.onData(chunk));
          resolve();
        });
        tlsSocket.on("error", reject);
      });
    }

    // 2. Send EHLO
    await this.command("EHLO localhost", 250);

    // 3. AUTH LOGIN if credentials provided
    if (user && pass) {
      await this.command("AUTH LOGIN", 334);
      await this.command(Buffer.from(user).toString("base64"), 334);
      await this.command(Buffer.from(pass).toString("base64"), 235);
    }
  }
}

export class SmtpEmailProvider implements EmailProvider {
  private host: string;
  private port: number;
  private secure: boolean;
  private user: string;
  private pass: string;

  constructor(config?: Partial<SmtpConfig>) {
    this.host = config?.host || process.env.SMTP_HOST || "smtp.gmail.com";
    this.port = Number(config?.port || process.env.SMTP_PORT || 465);
    this.secure = config?.secure !== undefined
      ? config.secure
      : (process.env.SMTP_SECURE === "true" || this.port === 465);
    this.user = config?.user || process.env.SMTP_USER || "";
    // Remove all whitespace from Google App Passwords
    this.pass = (config?.pass || process.env.SMTP_PASS || "").replace(/\s+/g, "");
  }

  async verify(): Promise<{ ok: boolean; error?: string }> {
    if (!this.user || !this.pass) {
      return { ok: false, error: "SMTP_USER or SMTP_PASS is missing in .env" };
    }
    try {
      await this.withSession(async (session) => {
        await session.command("QUIT", [221, 250]).catch(() => {});
      });
      return { ok: true };
    } catch (err: any) {
      return { ok: false, error: err.message || String(err) };
    }
  }

  async sendEmail(input: SendInput): Promise<ProviderResult> {
    if (!this.user || !this.pass) {
      return {
        accepted: false,
        error: "SMTP credentials not configured. Please set SMTP_USER and SMTP_PASS in .env"
      };
    }

    const messageId = `<${Date.now()}.${crypto.randomBytes(8).toString("hex")}@${this.host}>`;
    const fromAddr = input.from || this.user;
    const fromHeader = input.fromName ? `"${input.fromName.replace(/"/g, '')}" <${fromAddr}>` : `<${fromAddr}>`;

    try {
      await this.withSession(async (session) => {
        await session.command(`MAIL FROM:<${fromAddr}>`, 250);
        await session.command(`RCPT TO:<${input.to}>`, [250, 251]);
        await session.command("DATA", 354);

        const emailData = buildRawMimeEmail(input, fromHeader, messageId, true);
        await session.sendData(emailData, 250);
        await session.command("QUIT", [221, 250]).catch(() => {});
      });

      return {
        accepted: true,
        delivered: true,
        messageId,
        response: { provider: "smtp", host: this.host, to: input.to, deliveredAt: new Date().toISOString(), attachmentsCount: input.attachments?.length || 0 }
      };
    } catch (err: any) {
      return {
        accepted: false,
        error: err.message || "SMTP transmission failed",
        response: { error: err.message }
      };
    }
  }

  private withSession(fn: (session: SmtpSession) => Promise<void>): Promise<void> {
    return new Promise((resolve, reject) => {
      let isDone = false;
      const done = (err?: Error) => {
        if (isDone) return;
        isDone = true;
        if (err) reject(err);
        else resolve();
      };

      const timeoutMs = 25000;
      let timer: NodeJS.Timeout;

      let rawSocket: net.Socket | tls.TLSSocket;
      try {
        if (this.secure) {
          rawSocket = tls.connect({
            host: this.host,
            port: this.port,
            rejectUnauthorized: false,
            servername: this.host
          });
        } else {
          rawSocket = net.connect({
            host: this.host,
            port: this.port
          });
        }
      } catch (e: any) {
        return done(e);
      }

      timer = setTimeout(() => {
        rawSocket.destroy();
        done(new Error(`SMTP connection to ${this.host}:${this.port} timed out after ${timeoutMs}ms`));
      }, timeoutMs);

      rawSocket.on("error", (err) => {
        clearTimeout(timer);
        done(err);
      });

      const session = new SmtpSession(rawSocket);

      session.init(this.secure, this.host, this.port, this.user, this.pass)
        .then(() => fn(session))
        .then(() => {
          clearTimeout(timer);
          rawSocket.end();
          done();
        })
        .catch((err) => {
          clearTimeout(timer);
          rawSocket.destroy();
          done(err);
        });
    });
  }
}
