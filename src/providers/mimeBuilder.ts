import crypto from "crypto";
import fs from "fs";
import { SendInput } from "./emailProvider";

export function buildRawMimeEmail(input: SendInput, fromHeader: string, messageId: string, dotStuffing: boolean = false): string {
  let fullHtml = input.body;
  const hasFullHtmlDoc = /<html/i.test(fullHtml);
  if (!hasFullHtmlDoc) {
    fullHtml = `<!DOCTYPE html>\n<html>\n<head>\n<meta charset="utf-8">\n<meta name="viewport" content="width=device-width, initial-scale=1.0">\n</head>\n<body style="margin:0; padding:16px; font-family:-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; font-size:15px; color:#1e293b; line-height:1.6;">\n${fullHtml}\n</body>\n</html>`;
  }

  if (input.trackingUrl) {
    const pixelTag = `<img src="${input.trackingUrl}" width="1" height="1" style="display:none !important;" alt="" />`;
    if (fullHtml.includes("</body>")) {
      fullHtml = fullHtml.replace("</body>", `${pixelTag}</body>`);
    } else {
      fullHtml += pixelTag;
    }
  }

  const safeBody = dotStuffing ? fullHtml.replace(/\r?\n\./g, "\r\n..") : fullHtml;

  if (input.attachments && input.attachments.length > 0) {
    const boundary = `boundary_${Date.now()}_${crypto.randomBytes(8).toString("hex")}`;
    const headerPart = [
      `From: ${fromHeader}`,
      `To: <${input.to}>`,
      `Subject: =?UTF-8?B?${Buffer.from(input.subject).toString("base64")}?=`,
      `Date: ${new Date().toUTCString()}`,
      `Message-ID: ${messageId}`,
      `MIME-Version: 1.0`,
      `Content-Type: multipart/mixed; boundary="${boundary}"`,
      ``,
      `--${boundary}`,
      `Content-Type: text/html; charset=UTF-8`,
      `Content-Transfer-Encoding: 8bit`,
      ``,
      safeBody,
      ``
    ].join("\r\n");

    const attachmentParts: string[] = [];
    for (const att of input.attachments) {
      let fileBuffer: Buffer | null = null;
      if (att.path && fs.existsSync(att.path)) {
        try {
          fileBuffer = fs.readFileSync(att.path);
        } catch {}
      } else if (att.content) {
        try {
          fileBuffer = Buffer.from(att.content, "base64");
        } catch {}
      }

      if (!fileBuffer) continue;

      const base64Content = fileBuffer.toString("base64");
      const wrappedContent = base64Content.match(/.{1,76}/g)?.join("\r\n") || base64Content;
      const safeFilename = (att.filename || "attachment").replace(/["\r\n]/g, "_");
      const mime = att.contentType || "application/octet-stream";

      attachmentParts.push([
        `--${boundary}`,
        `Content-Type: ${mime}; name="${safeFilename}"`,
        `Content-Disposition: attachment; filename="${safeFilename}"`,
        `Content-Transfer-Encoding: base64`,
        ``,
        wrappedContent,
        ``
      ].join("\r\n"));
    }

    const endSuffix = dotStuffing ? `\r\n--${boundary}--\r\n.\r\n` : `\r\n--${boundary}--\r\n`;
    return headerPart + "\r\n" + attachmentParts.join("\r\n") + endSuffix;
  } else {
    const lines = [
      `From: ${fromHeader}`,
      `To: <${input.to}>`,
      `Subject: =?UTF-8?B?${Buffer.from(input.subject).toString("base64")}?=`,
      `Date: ${new Date().toUTCString()}`,
      `Message-ID: ${messageId}`,
      `MIME-Version: 1.0`,
      `Content-Type: text/html; charset=UTF-8`,
      `Content-Transfer-Encoding: 8bit`,
      ``,
      safeBody
    ];
    if (dotStuffing) {
      lines.push(`.`);
    }
    return lines.join("\r\n") + "\r\n";
  }
}
