import { SmtpEmailProvider } from "./smtpProvider";
import { SesEmailProvider } from "./sesProvider";

export type EmailAttachment = {
  filename: string;
  contentType?: string;
  path?: string;
  content?: string;
  size?: number;
};

export type SendInput = {
  to: string;
  from: string;
  fromName?: string;
  subject: string;
  body: string;
  idempotencyKey: string;
  attachments?: EmailAttachment[];
  trackingUrl?: string;
};

export type ProviderResult = {
  accepted: boolean;
  messageId?: string;
  response?: unknown;
  error?: string;
  delivered?: boolean;
};

export type ProviderEvent = {
  eventId: string;
  messageId: string;
  type: "delivered" | "failed" | "bounced" | "rejected" | "opened" | "clicked" | "unsubscribed";
  payload: unknown;
};

export interface EmailProvider {
  sendEmail(input: SendInput): Promise<ProviderResult>;
  getDeliveryStatus?(messageId: string): Promise<ProviderEvent[]>;
}

export class MockEmailProvider implements EmailProvider {
  async sendEmail(input: SendInput): Promise<ProviderResult> {
    const messageId = `mock_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`;
    const shouldDeliver = process.env.MOCK_SIMULATE_DELIVERY !== "false";
    return {
      accepted: true,
      delivered: shouldDeliver,
      messageId,
      response: { provider: "mock", to: input.to, idempotencyKey: input.idempotencyKey, attachmentsCount: input.attachments?.length || 0 }
    };
  }
}

let runtimeProvider: string = (process.env.EMAIL_PROVIDER || "gmail").toLowerCase().trim();

export function getActiveProviderName(): string {
  return runtimeProvider;
}

export function setActiveProviderName(provider: string): string {
  const norm = provider.toLowerCase().trim();
  if (!["mock", "gmail", "smtp", "ses", "amazon_ses", "amazonses"].includes(norm)) {
    throw new Error(`Unsupported provider "${provider}". Supported: gmail, ses, mock, smtp.`);
  }
  runtimeProvider = (norm === "amazon_ses" || norm === "amazonses") ? "ses" : norm;
  return runtimeProvider;
}

export function getProviderConfigStatus() {
  const hasGmail = Boolean(
    (process.env.SMTP_USER || process.env.EMAIL_FROM) &&
    (process.env.SMTP_PASS)
  );

  const hasSesApi = Boolean(
    process.env.AWS_ACCESS_KEY_ID && process.env.AWS_SECRET_ACCESS_KEY
  );

  const hasSesSmtp = Boolean(
    process.env.SES_SMTP_USER && process.env.SES_SMTP_PASS
  );

  const sesRegion = process.env.SES_REGION || process.env.AWS_REGION || "us-east-1";

  return {
    active: runtimeProvider,
    providers: {
      gmail: {
        id: "gmail",
        name: "Gmail SMTP",
        configured: hasGmail,
        host: process.env.SMTP_HOST || "smtp.gmail.com",
        port: Number(process.env.SMTP_PORT || 465),
        user: process.env.SMTP_USER || process.env.EMAIL_FROM || ""
      },
      ses: {
        id: "ses",
        name: "Amazon SES",
        configured: hasSesApi || hasSesSmtp,
        mode: hasSesApi ? "api" : (hasSesSmtp ? "smtp" : "unconfigured"),
        region: sesRegion,
        fromEmail: process.env.EMAIL_FROM || ""
      },
      mock: {
        id: "mock",
        name: "Mock Simulation",
        configured: true
      }
    }
  };
}

export function getEmailProvider(overrideProvider?: string): EmailProvider {
  const provider = (overrideProvider || runtimeProvider || process.env.EMAIL_PROVIDER || "gmail").toLowerCase().trim();
  if (provider === "mock") return new MockEmailProvider();
  if (provider === "smtp" || provider === "gmail") return new SmtpEmailProvider();
  if (provider === "ses" || provider === "amazon_ses" || provider === "amazonses") return new SesEmailProvider();
  throw new Error(`Unsupported EMAIL_PROVIDER=${provider}. Supported providers: gmail, ses, mock, smtp.`);
}

export { SmtpEmailProvider, SesEmailProvider };

