import crypto from "crypto";
import { SESClient, SendRawEmailCommand, GetSendQuotaCommand } from "@aws-sdk/client-ses";
import { EmailProvider, ProviderResult, SendInput } from "./emailProvider";
import { SmtpEmailProvider } from "./smtpProvider";
import { buildRawMimeEmail } from "./mimeBuilder";

export interface SesConfig {
  region?: string;
  accessKeyId?: string;
  secretAccessKey?: string;
  sessionToken?: string;
  smtpHost?: string;
  smtpPort?: number;
  smtpUser?: string;
  smtpPass?: string;
  fromEmail?: string;
}

export class SesEmailProvider implements EmailProvider {
  private region: string;
  private accessKeyId: string;
  private secretAccessKey: string;
  private sessionToken?: string;

  private smtpUser: string;
  private smtpPass: string;
  private smtpHost: string;
  private smtpPort: number;

  private client: SESClient | null = null;
  private smtpDelegate: SmtpEmailProvider | null = null;
  private mode: "api" | "smtp" | "unconfigured" = "unconfigured";

  constructor(config?: Partial<SesConfig>) {
    this.region = config?.region || process.env.SES_REGION || process.env.AWS_REGION || "us-east-1";
    this.accessKeyId = config?.accessKeyId || process.env.AWS_ACCESS_KEY_ID || "";
    this.secretAccessKey = config?.secretAccessKey || process.env.AWS_SECRET_ACCESS_KEY || "";
    this.sessionToken = config?.sessionToken || process.env.AWS_SESSION_TOKEN || undefined;

    this.smtpUser = config?.smtpUser || process.env.SES_SMTP_USER || "";
    this.smtpPass = (config?.smtpPass || process.env.SES_SMTP_PASS || "").replace(/\s+/g, "");
    this.smtpHost = config?.smtpHost || process.env.SES_SMTP_HOST || `email-smtp.${this.region}.amazonaws.com`;
    this.smtpPort = Number(config?.smtpPort || process.env.SES_SMTP_PORT || 465);

    if (this.accessKeyId && this.secretAccessKey) {
      this.mode = "api";
      this.client = new SESClient({
        region: this.region,
        credentials: {
          accessKeyId: this.accessKeyId,
          secretAccessKey: this.secretAccessKey,
          ...(this.sessionToken ? { sessionToken: this.sessionToken } : {})
        }
      });
    } else if (this.smtpUser && this.smtpPass) {
      this.mode = "smtp";
      this.smtpDelegate = new SmtpEmailProvider({
        host: this.smtpHost,
        port: this.smtpPort,
        secure: this.smtpPort === 465,
        user: this.smtpUser,
        pass: this.smtpPass
      });
    } else {
      this.mode = "unconfigured";
    }
  }

  getMode(): "api" | "smtp" | "unconfigured" {
    return this.mode;
  }

  getRegion(): string {
    return this.region;
  }

  async verify(): Promise<{ ok: boolean; error?: string; details?: unknown }> {
    if (this.mode === "api" && this.client) {
      try {
        const quota = await this.client.send(new GetSendQuotaCommand({}));
        return {
          ok: true,
          details: {
            provider: "ses",
            mode: "api",
            region: this.region,
            sentLast24Hours: quota.SentLast24Hours,
            max24HourSend: quota.Max24HourSend,
            maxSendRate: quota.MaxSendRate
          }
        };
      } catch (err: any) {
        return {
          ok: false,
          error: `Amazon SES API verification failed: ${err.message || String(err)}`
        };
      }
    }

    if (this.mode === "smtp" && this.smtpDelegate) {
      try {
        const res = await this.smtpDelegate.verify();
        return {
          ok: res.ok,
          error: res.error,
          details: {
            provider: "ses",
            mode: "smtp",
            host: this.smtpHost,
            port: this.smtpPort,
            region: this.region
          }
        };
      } catch (err: any) {
        return {
          ok: false,
          error: `Amazon SES SMTP verification failed: ${err.message || String(err)}`
        };
      }
    }

    return {
      ok: false,
      error: "Amazon SES credentials not configured. Please set AWS_ACCESS_KEY_ID & AWS_SECRET_ACCESS_KEY (API) or SES_SMTP_USER & SES_SMTP_PASS (SMTP) in .env"
    };
  }

  async sendEmail(input: SendInput): Promise<ProviderResult> {
    const fromAddr = input.from || process.env.EMAIL_FROM || "";
    const fromHeader = input.fromName ? `"${input.fromName.replace(/"/g, '')}" <${fromAddr}>` : `<${fromAddr}>`;
    const messageId = `<${Date.now()}.${crypto.randomBytes(8).toString("hex")}@email.amazonses.com>`;

    if (this.mode === "api" && this.client) {
      try {
        const rawMime = buildRawMimeEmail(input, fromHeader, messageId, false);
        const command = new SendRawEmailCommand({
          RawMessage: {
            Data: Buffer.from(rawMime, "utf-8")
          },
          Source: fromAddr,
          Destinations: [input.to]
        });

        const res = await this.client.send(command);
        const sesMessageId = res.MessageId || messageId;

        return {
          accepted: true,
          delivered: true,
          messageId: sesMessageId,
          response: {
            provider: "ses",
            mode: "api",
            region: this.region,
            to: input.to,
            sesMessageId,
            attachmentsCount: input.attachments?.length || 0
          }
        };
      } catch (err: any) {
        return {
          accepted: false,
          error: err.message || "Amazon SES API transmission failed",
          response: { provider: "ses", error: err.name || "Error", message: err.message }
        };
      }
    }

    if (this.mode === "smtp" && this.smtpDelegate) {
      return await this.smtpDelegate.sendEmail(input);
    }

    return {
      accepted: false,
      error: "Amazon SES credentials not configured. Please set AWS_ACCESS_KEY_ID & AWS_SECRET_ACCESS_KEY (API) or SES_SMTP_USER & SES_SMTP_PASS (SMTP) in .env"
    };
  }
}
