export type RecipientRow = { email: string; name?: string; company?: string };

export function normalizeEmail(value: unknown): string {
  return String(value ?? "").trim().toLowerCase();
}

export function isValidEmail(email: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

export function validateRecipients(rows: RecipientRow[]) {
  const seen = new Set<string>();
  const valid: RecipientRow[] = [];
  const invalid: RecipientRow[] = [];
  const duplicates: RecipientRow[] = [];

  for (const row of rows) {
    const email = normalizeEmail(row.email);
    const normalized = { ...row, email };
    if (!isValidEmail(email)) {
      invalid.push(normalized);
    } else if (seen.has(email)) {
      duplicates.push(normalized);
    } else {
      seen.add(email);
      valid.push(normalized);
    }
  }
  return { valid, invalid, duplicates };
}

export function personalize(template: string, data: Record<string, unknown>): string {
  return template.replace(/\{\{\s*([a-zA-Z0-9_]+)\s*\}\}/gi, (_, key) => {
    const lowerKey = key.toLowerCase();
    for (const [k, v] of Object.entries(data)) {
      if (k.toLowerCase() === lowerKey) return String(v ?? "");
    }
    return String(data[key] ?? "");
  });
}

export function decodeHtmlEntities(str: string): string {
  if (!str) return "";
  if (/&lt;\/?(html|head|body|p|div|span|h[1-6]|table|thead|tbody|tr|td|th|ul|ol|li|br|hr|b|i|strong|em|a|img|style|blockquote|pre|code|button|section)[^&]*&gt;/i.test(str)) {
    return str
      .replace(/&lt;/g, "<")
      .replace(/&gt;/g, ">")
      .replace(/&quot;/g, '"')
      .replace(/&#39;/g, "'")
      .replace(/&amp;/g, "&");
  }
  return str;
}

export function formatEmailBody(body: string): string {
  if (!body) return "";
  const decoded = decodeHtmlEntities(body.trim());
  const hasHtml = /<\/?(html|head|body|p|div|span|h[1-6]|table|thead|tbody|tr|td|th|ul|ol|li|br|hr|b|i|strong|em|a|img|style|blockquote|pre|code|button|section|header|footer)[^>]*>/i.test(decoded) ||
                  /<!DOCTYPE\s+html/i.test(decoded);
  if (hasHtml) {
    return decoded;
  }
  return decoded
    .split(/\r?\n\r?\n/)
    .map(para => `<p style="margin: 0 0 1em 0; line-height: 1.6;">${para.replace(/\r?\n/g, "<br>")}</p>`)
    .join("");
}

