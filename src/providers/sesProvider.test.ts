import { describe, expect, it } from "vitest";
import { SesEmailProvider } from "./sesProvider";
import { getEmailProvider, setActiveProviderName, getActiveProviderName } from "./emailProvider";
import { SmtpEmailProvider } from "./smtpProvider";

describe("Amazon SES & Provider Switching", () => {
  it("defaults to unconfigured mode when no credentials provided", () => {
    const ses = new SesEmailProvider({ accessKeyId: "", secretAccessKey: "", smtpUser: "", smtpPass: "" });
    expect(ses.getMode()).toBe("unconfigured");
  });

  it("detects API mode when AWS access keys are supplied", () => {
    const ses = new SesEmailProvider({
      accessKeyId: "AKIAIOSFODNN7EXAMPLE",
      secretAccessKey: "wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY",
      region: "us-west-2"
    });
    expect(ses.getMode()).toBe("api");
    expect(ses.getRegion()).toBe("us-west-2");
  });

  it("detects SMTP mode when SES SMTP credentials are supplied", () => {
    const ses = new SesEmailProvider({
      smtpUser: "AKIAIOSFODNN7EXAMPLE",
      smtpPass: "exampleSmtpPassword",
      region: "eu-west-1"
    });
    expect(ses.getMode()).toBe("smtp");
    expect(ses.getRegion()).toBe("eu-west-1");
  });

  it("toggles active provider dynamically between gmail, ses, and mock", () => {
    setActiveProviderName("gmail");
    expect(getActiveProviderName()).toBe("gmail");
    expect(getEmailProvider() instanceof SmtpEmailProvider).toBe(true);

    setActiveProviderName("ses");
    expect(getActiveProviderName()).toBe("ses");
    expect(getEmailProvider() instanceof SesEmailProvider).toBe(true);

    setActiveProviderName("mock");
    expect(getActiveProviderName()).toBe("mock");

    // reset back to gmail
    setActiveProviderName("gmail");
    expect(getActiveProviderName()).toBe("gmail");
  });

  it("handles unconfigured SES sendEmail with a descriptive error", async () => {
    const ses = new SesEmailProvider({ accessKeyId: "", secretAccessKey: "", smtpUser: "", smtpPass: "" });
    const res = await ses.sendEmail({
      to: "recipient@example.com",
      from: "sender@example.com",
      subject: "Test",
      body: "Hello",
      idempotencyKey: "test_key"
    });
    expect(res.accepted).toBe(false);
    expect(res.error).toContain("Amazon SES credentials not configured");
  });
});
