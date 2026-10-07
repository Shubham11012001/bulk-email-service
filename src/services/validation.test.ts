import { describe, expect, it } from "vitest";
import { validateRecipients, personalize, formatEmailBody, decodeHtmlEntities } from "./validation";

describe("recipient validation", () => {
  it("detects invalid and duplicate addresses", () => {
    const r = validateRecipients([
      { email: "a@example.com" },
      { email: "a@example.com" },
      { email: "bad" }
    ]);
    expect(r.valid.length).toBe(1);
    expect(r.duplicates.length).toBe(1);
    expect(r.invalid.length).toBe(1);
  });
  it("personalizes templates", () => {
    expect(personalize("Hi {{name}} at {{company}}", {name:"A",company:"B"})).toBe("Hi A at B");
    expect(personalize("Hi {{Name}} at {{Company}}", {name:"Alice",company:"Acme"})).toBe("Hi Alice at Acme");
    expect(personalize("<a href='https://example.com?c={{company}}'>{{name}}</a>", {name:"Bob",company:"Corp"})).toBe("<a href='https://example.com?c={{company}}'>{{name}}</a>".replace("{{company}}", "Corp").replace("{{name}}", "Bob"));
  });
  it("preserves raw HTML code in email body", () => {
    const rawHtml = `<table style="width:100%;"><tr><td><h1>Hello {{name}}</h1><p>Welcome to <strong>{{company}}</strong>.</p></td></tr></table>`;
    expect(formatEmailBody(rawHtml)).toBe(rawHtml);
  });
  it("decodes escaped HTML entities if provided as code in text box", () => {
    const escaped = `&lt;h1 style=&quot;color:red&quot;&gt;Hello&lt;/h1&gt;`;
    expect(decodeHtmlEntities(escaped)).toBe(`<h1 style="color:red">Hello</h1>`);
    expect(formatEmailBody(escaped)).toBe(`<h1 style="color:red">Hello</h1>`);
  });
  it("formats plain text into HTML paragraphs", () => {
    const plain = "Hello there,\n\nThis is paragraph two.";
    expect(formatEmailBody(plain)).toBe("<p style=\"margin: 0 0 1em 0; line-height: 1.6;\">Hello there,</p><p style=\"margin: 0 0 1em 0; line-height: 1.6;\">This is paragraph two.</p>");
  });
});

