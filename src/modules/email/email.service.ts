import nodemailer from "nodemailer";
import type { Transporter } from "nodemailer";

interface EmailTicketData {
  ticketNumber: string;
  type: string;
  name: string;
  email: string;
  subject: string;
  message?: string;
  status: string;
  adminNotes?: string | null;
  createdAt: Date | string;
  resolvedAt?: Date | string | null;
}

const HOSTINGER_MAIL_API_TOKEN = process.env.HOSTINGER_MAIL_API_TOKEN || "";
const HOSTINGER_MAILBOX_ID = process.env.HOSTINGER_MAILBOX_ID || "AC6f992e3f778a3d0fd3a6533f5b7d";
const SMTP_HOST = process.env.SMTP_HOST || "smtp.hostinger.com";
const SMTP_PORT = parseInt(process.env.SMTP_PORT || "465", 10);
const SMTP_SECURE = process.env.SMTP_SECURE !== "false"; // true for 465, false for 587
const SMTP_USER = process.env.SMTP_USER || "nishantbhardwaj@nvit.space";
const SMTP_PASS = process.env.SMTP_PASS || "";
const SMTP_FROM_INFO = process.env.SMTP_FROM_INFO || '"NVIT.SPACE Studio" <info@nvit.space>';
const SMTP_FROM_SUPPORT = process.env.SMTP_FROM_SUPPORT || '"NVIT.SPACE Client Support" <support@nvit.space>';
const PUBLIC_APP_URL = process.env.PUBLIC_APP_URL || "https://nvit.space";
const SMTP_ENABLED = process.env.SMTP_ENABLED === "true";

// Initialize nodemailer transporter (fallback)
let transporter: Transporter | null = null;

function getTransporter(): Transporter {
  if (!transporter) {
    transporter = nodemailer.createTransport({
      host: SMTP_HOST,
      port: SMTP_PORT,
      secure: SMTP_SECURE,
      auth: {
        user: SMTP_USER,
        pass: SMTP_PASS,
      },
      tls: {
        rejectUnauthorized: false,
      },
    });
  }
  return transporter;
}

/**
 * Universal safe email dispatcher
 * Prioritizes Hostinger Official REST Mail API (Fastest, HTTPS port 443).
 * Falls back to SMTP if token is missing.
 */
async function sendMailSafe(options: {
  from: string;
  displayName: string;
  to: string;
  subject: string;
  html: string;
  text?: string;
}): Promise<{ success: boolean; mocked?: boolean; error?: string }> {
  // Priority 1: Hostinger Official REST Mail API (Token-based)
  if (HOSTINGER_MAIL_API_TOKEN && HOSTINGER_MAILBOX_ID) {
    try {
      const res = await fetch(`https://api.mail.hostinger.com/api/v1/mailboxes/${HOSTINGER_MAILBOX_ID}/send`, {
        method: "POST",
        headers: {
          "Authorization": `Bearer ${HOSTINGER_MAIL_API_TOKEN}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          to: [options.to],
          displayName: options.displayName,
          subject: options.subject,
          html: options.html,
          text: options.text || "",
        }),
      });

      if (res.status === 204 || res.ok) {
        console.log(`[EmailService (Hostinger API)] Email dispatched to ${options.to} via mailbox ${HOSTINGER_MAILBOX_ID} (${options.displayName})`);
        return { success: true };
      } else {
        const errText = await res.text();
        console.error(`[EmailService (Hostinger API Error)] Status ${res.status}:`, errText);
      }
    } catch (apiErr: any) {
      console.error(`[EmailService (Hostinger API)] Request failed:`, apiErr.message);
    }
  }

  // Priority 2: Standard SMTP Fallback
  if (SMTP_ENABLED && SMTP_PASS) {
    try {
      const client = getTransporter();
      const info = await client.sendMail({
        from: options.from,
        to: options.to,
        subject: options.subject,
        html: options.html,
        text: options.text,
      });
      console.log(`[EmailService (SMTP)] Dispatched email to ${options.to}: MessageId=${info.messageId}`);
      return { success: true };
    } catch (error: any) {
      console.error(`[EmailService (SMTP)] Failed to send email to ${options.to}:`, error.message);
      return { success: false, error: error.message };
    }
  }

  // Simulation mode fallback
  console.log(
    `[EmailService (Simulation Mode)] Message ready for dispatch:`,
    `\n  DisplayName: ${options.displayName}`,
    `\n  From: ${options.from}`,
    `\n  To: ${options.to}`,
    `\n  Subject: ${options.subject}`
  );
  return { success: true, mocked: true };
}

/**
 * Common HTML email header
 */
function renderEmailHeader(subtitle: string): string {
  return `
    <table width="100%" cellpadding="0" cellspacing="0" border="0" style="background: linear-gradient(135deg, #090f24 0%, #030712 100%); border-radius: 16px 16px 0 0; padding: 32px 28px; text-align: left;">
      <tr>
        <td>
          <table cellpadding="0" cellspacing="0" border="0">
            <tr>
              <td style="vertical-align: middle; padding-right: 12px;">
                <div style="width: 36px; height: 36px; background: linear-gradient(135deg, #2563eb, #7c3aed); border-radius: 10px; text-align: center; line-height: 36px; color: #ffffff; font-size: 18px; font-weight: 900; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;">
                  N
                </div>
              </td>
              <td style="vertical-align: middle;">
                <div style="color: #ffffff; font-size: 18px; font-weight: 900; letter-spacing: 1px; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;">
                  NVIT.SPACE
                </div>
                <div style="color: #93c5fd; font-size: 11px; font-weight: 700; text-transform: uppercase; letter-spacing: 1.5px; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; margin-top: 2px;">
                  ${subtitle}
                </div>
              </td>
            </tr>
          </table>
        </td>
      </tr>
    </table>
  `;
}

/**
 * Common HTML email footer
 */
function renderEmailFooter(): string {
  return `
    <table width="100%" cellpadding="0" cellspacing="0" border="0" style="background: #f8fafc; border-radius: 0 0 16px 16px; padding: 24px 28px; border-top: 1px solid #e2e8f0; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;">
      <tr>
        <td style="text-align: center; color: #64748b; font-size: 11px; line-height: 1.6;">
          <p style="margin: 0 0 8px 0; font-weight: 600; color: #334155;">
            NVIT.SPACE • Digital Engineering &amp; Technology Studio
          </p>
          <p style="margin: 0 0 8px 0;">
            Direct lines: <a href="mailto:info@nvit.space" style="color: #2563eb; text-decoration: none;">info@nvit.space</a> (Enquiries) • <a href="mailto:support@nvit.space" style="color: #7c3aed; text-decoration: none;">support@nvit.space</a> (Client Support Desk)
          </p>
          <p style="margin: 0; color: #94a3b8; font-size: 10px;">
            This is an automated operational notification. You received this email because an enquiry or ticket was registered with your address.
          </p>
        </td>
      </tr>
    </table>
  `;
}

// ─────────────────────────────────────────────────────────────────────────────
// 1. PROJECT ENQUIRY CONFIRMATION EMAIL (FROM: info@nvit.space)
// ─────────────────────────────────────────────────────────────────────────────
export async function sendEnquiryConfirmationEmail(ticket: EmailTicketData) {
  const trackingUrl = `${PUBLIC_APP_URL}/check-status?ticket=${encodeURIComponent(ticket.ticketNumber)}`;

  const html = `
    <!DOCTYPE html>
    <html>
    <head>
      <meta charset="utf-8">
      <meta name="viewport" content="width=device-width, initial-scale=1.0">
      <title>Project Enquiry Received: ${ticket.ticketNumber}</title>
    </head>
    <body style="margin: 0; padding: 20px; background-color: #f1f5f9; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif;">
      <table width="100%" cellpadding="0" cellspacing="0" border="0" style="max-width: 600px; margin: 0 auto; background: #ffffff; border-radius: 16px; box-shadow: 0 10px 25px rgba(0,0,0,0.06); overflow: hidden; border: 1px solid #e2e8f0;">
        <tr>
          <td>
            ${renderEmailHeader("Digital Engineering Studio")}

            <div style="padding: 32px 28px;">
              <h1 style="color: #0f172a; font-size: 20px; font-weight: 800; margin: 0 0 12px 0;">
                Project Consultation Inquiry Received
              </h1>
              <p style="color: #475569; font-size: 14px; line-height: 1.6; margin: 0 0 24px 0;">
                Dear <strong>${ticket.name}</strong>,<br>
                Thank you for contacting NVIT.SPACE. Your software architecture and project consultation request has been officially registered and queued for technical feasibility review by our engineering leads.
              </p>

              <!-- Reference ID Card -->
              <table width="100%" cellpadding="0" cellspacing="0" border="0" style="background: #f8fafc; border: 1px solid #cbd5e1; border-radius: 12px; margin-bottom: 24px; padding: 18px 20px;">
                <tr>
                  <td>
                    <div style="color: #64748b; font-size: 10px; font-weight: 800; text-transform: uppercase; letter-spacing: 1px; margin-bottom: 4px;">
                      Official Enquiry Reference Number
                    </div>
                    <div style="color: #2563eb; font-size: 18px; font-weight: 900; font-family: monospace; letter-spacing: 1px;">
                      ${ticket.ticketNumber}
                    </div>
                    <div style="color: #0f172a; font-size: 13px; font-weight: 700; margin-top: 8px;">
                      Scope: ${ticket.subject}
                    </div>
                  </td>
                </tr>
              </table>

              <!-- Stepper Preview -->
              <div style="margin-bottom: 28px;">
                <div style="color: #64748b; font-size: 11px; font-weight: 800; text-transform: uppercase; letter-spacing: 1px; margin-bottom: 12px;">
                  What Happens Next (24-Hour Protocol)
                </div>
                <table width="100%" cellpadding="0" cellspacing="0" border="0">
                  <tr>
                    <td style="padding-bottom: 12px;">
                      <table cellpadding="0" cellspacing="0" border="0">
                        <tr>
                          <td style="width: 24px; height: 24px; background: #2563eb; color: #ffffff; border-radius: 50%; text-align: center; font-size: 11px; font-weight: 800; line-height: 24px;">1</td>
                          <td style="padding-left: 12px; color: #0f172a; font-size: 13px; font-weight: 700;">Inquiry Logged &amp; Assigned (Completed)</td>
                        </tr>
                      </table>
                    </td>
                  </tr>
                  <tr>
                    <td style="padding-bottom: 12px;">
                      <table cellpadding="0" cellspacing="0" border="0">
                        <tr>
                          <td style="width: 24px; height: 24px; background: #f59e0b; color: #ffffff; border-radius: 50%; text-align: center; font-size: 11px; font-weight: 800; line-height: 24px;">2</td>
                          <td style="padding-left: 12px; color: #475569; font-size: 13px; font-weight: 600;">Engineering Feasibility &amp; Tech Stack Scoping</td>
                        </tr>
                      </table>
                    </td>
                  </tr>
                  <tr>
                    <td>
                      <table cellpadding="0" cellspacing="0" border="0">
                        <tr>
                          <td style="width: 24px; height: 24px; background: #e2e8f0; color: #64748b; border-radius: 50%; text-align: center; font-size: 11px; font-weight: 800; line-height: 24px;">3</td>
                          <td style="padding-left: 12px; color: #475569; font-size: 13px; font-weight: 600;">Roadmap, Timeline &amp; Architecture Proposal Dispatched</td>
                        </tr>
                      </table>
                    </td>
                  </tr>
                </table>
              </div>

              <!-- CTA Button -->
              <table width="100%" cellpadding="0" cellspacing="0" border="0" style="text-align: center; margin-bottom: 24px;">
                <tr>
                  <td align="center">
                    <a href="${trackingUrl}" style="display: inline-block; background: #2563eb; color: #ffffff; text-decoration: none; font-size: 13px; font-weight: 800; padding: 14px 28px; border-radius: 12px; box-shadow: 0 4px 12px rgba(37, 99, 235, 0.25);">
                      Track Your Enquiry Status Online &rarr;
                    </a>
                  </td>
                </tr>
              </table>

              <p style="color: #64748b; font-size: 12px; line-height: 1.6; margin: 0;">
                If you have additional architecture documents or deliverables to share, simply reply directly to this email (<a href="mailto:info@nvit.space" style="color: #2563eb; font-weight: 600;">info@nvit.space</a>) with your reference number in the subject.
              </p>
            </div>

            ${renderEmailFooter()}
          </td>
        </tr>
      </table>
    </body>
    </html>
  `;

  return sendMailSafe({
    from: SMTP_FROM_INFO,
    displayName: "NVIT.SPACE Studio (info@nvit.space)",
    to: ticket.email,
    subject: `[NVIT.SPACE] Project Enquiry Received: ${ticket.ticketNumber} - ${ticket.subject}`,
    html,
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// 2. SUPPORT TICKET / COMPLAINT CONFIRMATION EMAIL (FROM: support@nvit.space)
// ─────────────────────────────────────────────────────────────────────────────
export async function sendTicketConfirmationEmail(ticket: EmailTicketData) {
  const trackingUrl = `${PUBLIC_APP_URL}/check-status?ticket=${encodeURIComponent(ticket.ticketNumber)}`;

  const html = `
    <!DOCTYPE html>
    <html>
    <head>
      <meta charset="utf-8">
      <meta name="viewport" content="width=device-width, initial-scale=1.0">
      <title>Ticket Registered: ${ticket.ticketNumber}</title>
    </head>
    <body style="margin: 0; padding: 20px; background-color: #f1f5f9; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif;">
      <table width="100%" cellpadding="0" cellspacing="0" border="0" style="max-width: 600px; margin: 0 auto; background: #ffffff; border-radius: 16px; box-shadow: 0 10px 25px rgba(0,0,0,0.06); overflow: hidden; border: 1px solid #e2e8f0;">
        <tr>
          <td>
            ${renderEmailHeader("Client Oversight & Support Desk")}

            <div style="padding: 32px 28px;">
              <h1 style="color: #0f172a; font-size: 20px; font-weight: 800; margin: 0 0 12px 0;">
                Support Ticket / Grievance Registered
              </h1>
              <p style="color: #475569; font-size: 14px; line-height: 1.6; margin: 0 0 24px 0;">
                Dear <strong>${ticket.name}</strong>,<br>
                Your submission has been securely received by our executive resolution desk. Every ticket is subject to our mandatory 24-hour investigation and response protocol.
              </p>

              <!-- Reference ID Card -->
              <table width="100%" cellpadding="0" cellspacing="0" border="0" style="background: #fdf2f8; border: 1px solid #fbcfe8; border-radius: 12px; margin-bottom: 24px; padding: 18px 20px;">
                <tr>
                  <td>
                    <table width="100%" cellpadding="0" cellspacing="0" border="0">
                      <tr>
                        <td>
                          <div style="color: #9d174d; font-size: 10px; font-weight: 800; text-transform: uppercase; letter-spacing: 1px; margin-bottom: 4px;">
                            Ticket Reference ID
                          </div>
                          <div style="color: #be185d; font-size: 18px; font-weight: 900; font-family: monospace; letter-spacing: 1px;">
                            ${ticket.ticketNumber}
                          </div>
                        </td>
                        <td align="right">
                          <span style="background: #be185d; color: #ffffff; font-size: 10px; font-weight: 800; text-transform: uppercase; padding: 4px 10px; border-radius: 20px;">
                            ${ticket.type}
                          </span>
                        </td>
                      </tr>
                    </table>
                    <div style="color: #0f172a; font-size: 13px; font-weight: 700; margin-top: 10px;">
                      Subject: ${ticket.subject}
                    </div>
                  </td>
                </tr>
              </table>

              <!-- CTA Button -->
              <table width="100%" cellpadding="0" cellspacing="0" border="0" style="text-align: center; margin-bottom: 24px;">
                <tr>
                  <td align="center">
                    <a href="${trackingUrl}" style="display: inline-block; background: #be185d; color: #ffffff; text-decoration: none; font-size: 13px; font-weight: 800; padding: 14px 28px; border-radius: 12px; box-shadow: 0 4px 12px rgba(190, 24, 93, 0.25);">
                      Track Ticket Resolution Status &rarr;
                    </a>
                  </td>
                </tr>
              </table>

              <p style="color: #64748b; font-size: 12px; line-height: 1.6; margin: 0;">
                If you have supporting logs or screenshots, you can reply directly to this email (<a href="mailto:support@nvit.space" style="color: #be185d; font-weight: 600;">support@nvit.space</a>) with your reference ID in the subject.
              </p>
            </div>

            ${renderEmailFooter()}
          </td>
        </tr>
      </table>
    </body>
    </html>
  `;

  return sendMailSafe({
    from: SMTP_FROM_SUPPORT,
    displayName: "NVIT.SPACE Client Support (support@nvit.space)",
    to: ticket.email,
    subject: `[NVIT.SPACE Support] Ticket Registered: ${ticket.ticketNumber} - ${ticket.subject}`,
    html,
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// 3. STATUS UPDATE NOTIFICATION EMAIL (FROM: support@nvit.space / info@nvit.space)
// ─────────────────────────────────────────────────────────────────────────────
export async function sendStatusUpdateEmail(ticket: EmailTicketData, previousStatus?: string) {
  const trackingUrl = `${PUBLIC_APP_URL}/check-status?ticket=${encodeURIComponent(ticket.ticketNumber)}`;
  const isInquiry = ticket.type.toUpperCase() === "INQUIRY" || ticket.type.toUpperCase() === "ENQUIRY";
  const fromAddress = isInquiry ? SMTP_FROM_INFO : SMTP_FROM_SUPPORT;

  const st = (ticket.status || "IN_REVIEW").toUpperCase();
  const isResolved = st === "RESOLVED";
  const badgeColor = isResolved ? "#16a34a" : "#d97706";
  const badgeBg = isResolved ? "#f0fdf4" : "#fffbeb";
  const badgeBorder = isResolved ? "#bbf7d0" : "#fde68a";
  const statusLabel = isResolved
    ? isInquiry ? "PROPOSAL DISPATCHED / RESOLVED" : "RESOLVED"
    : "UNDER ACTIVE ENGINEERING REVIEW";

  const html = `
    <!DOCTYPE html>
    <html>
    <head>
      <meta charset="utf-8">
      <meta name="viewport" content="width=device-width, initial-scale=1.0">
      <title>Status Update: ${ticket.ticketNumber}</title>
    </head>
    <body style="margin: 0; padding: 20px; background-color: #f1f5f9; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif;">
      <table width="100%" cellpadding="0" cellspacing="0" border="0" style="max-width: 600px; margin: 0 auto; background: #ffffff; border-radius: 16px; box-shadow: 0 10px 25px rgba(0,0,0,0.06); overflow: hidden; border: 1px solid #e2e8f0;">
        <tr>
          <td>
            ${renderEmailHeader(isInquiry ? "Enquiry Status Update" : "Support Resolution Update")}

            <div style="padding: 32px 28px;">
              <h1 style="color: #0f172a; font-size: 20px; font-weight: 800; margin: 0 0 12px 0;">
                Your ${isInquiry ? "Project Enquiry" : "Ticket"} Status Has Been Updated
              </h1>
              <p style="color: #475569; font-size: 14px; line-height: 1.6; margin: 0 0 24px 0;">
                Dear <strong>${ticket.name}</strong>,<br>
                Our team has made progress on your request regarding <strong>${ticket.subject}</strong>.
              </p>

              <!-- Status Change Card -->
              <table width="100%" cellpadding="0" cellspacing="0" border="0" style="background: ${badgeBg}; border: 1px solid ${badgeBorder}; border-radius: 12px; margin-bottom: 24px; padding: 18px 20px;">
                <tr>
                  <td>
                    <div style="color: #64748b; font-size: 10px; font-weight: 800; text-transform: uppercase; letter-spacing: 1px; margin-bottom: 4px;">
                      Reference ID: #${ticket.ticketNumber}
                    </div>
                    <div style="color: ${badgeColor}; font-size: 16px; font-weight: 900; letter-spacing: 0.5px;">
                      &bull; Current Status: ${statusLabel}
                    </div>
                    ${
                      previousStatus && previousStatus !== ticket.status
                        ? `<div style="color: #94a3b8; font-size: 11px; margin-top: 4px;">Previous Status: ${previousStatus}</div>`
                        : ""
                    }
                  </td>
                </tr>
              </table>

              <!-- Staff Notes if available -->
              ${
                ticket.adminNotes
                  ? `
                  <div style="background: #f8fafc; border-left: 4px solid ${badgeColor}; padding: 16px 20px; border-radius: 0 12px 12px 0; margin-bottom: 24px;">
                    <div style="color: #334155; font-size: 11px; font-weight: 800; text-transform: uppercase; letter-spacing: 1px; margin-bottom: 6px;">
                      Official Staff Message:
                    </div>
                    <div style="color: #1e293b; font-size: 13px; line-height: 1.6; white-space: pre-wrap; font-weight: 500;">
                      ${ticket.adminNotes}
                    </div>
                  </div>
                `
                  : ""
              }

              <!-- CTA Button -->
              <table width="100%" cellpadding="0" cellspacing="0" border="0" style="text-align: center; margin-bottom: 24px;">
                <tr>
                  <td align="center">
                    <a href="${trackingUrl}" style="display: inline-block; background: #0f172a; color: #ffffff; text-decoration: none; font-size: 13px; font-weight: 800; padding: 14px 28px; border-radius: 12px; box-shadow: 0 4px 12px rgba(15, 23, 42, 0.25);">
                      View Detailed Telemetry Online &rarr;
                    </a>
                  </td>
                </tr>
              </table>

              <p style="color: #64748b; font-size: 12px; line-height: 1.6; margin: 0;">
                If you have questions or wish to reply, you can contact us at <a href="mailto:${isInquiry ? "info@nvit.space" : "support@nvit.space"}" style="color: #2563eb; font-weight: 600;">${isInquiry ? "info@nvit.space" : "support@nvit.space"}</a> quoting <strong>#${ticket.ticketNumber}</strong>.
              </p>
            </div>

            ${renderEmailFooter()}
          </td>
        </tr>
      </table>
    </body>
    </html>
  `;

  return sendMailSafe({
    from: fromAddress,
    displayName: isInquiry
      ? "NVIT.SPACE Studio (info@nvit.space)"
      : "NVIT.SPACE Client Support (support@nvit.space)",
    to: ticket.email,
    subject: `[NVIT.SPACE Update] #${ticket.ticketNumber} Status Changed: ${statusLabel}`,
    html,
  });
}
