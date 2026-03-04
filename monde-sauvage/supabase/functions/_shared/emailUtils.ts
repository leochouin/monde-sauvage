/**
 * Email utilities for booking confirmations
 *
 * - Invoice HTML generation (mobile-friendly)
 * - ICS calendar file generation
 * - Universal calendar links (Google, Outlook, Apple)
 * - Email sending via Resend API
 */

// ─────────────────────────────────────────────────────────────────────────────
// TYPES
// ─────────────────────────────────────────────────────────────────────────────

export interface BookingEmailData {
  // Booking identifiers
  bookingId: string;
  bookingType: "chalet" | "guide";

  // Customer
  customerName: string;
  customerEmail: string;

  // Event details
  eventTitle: string;
  startTime: string; // ISO string
  endTime: string;   // ISO string
  location?: string;
  description?: string;

  // Guide (if applicable)
  guideName?: string;
  guideEmail?: string;

  // Chalet (if applicable)
  chaletName?: string;
  establishmentName?: string;

  // Pricing
  subtotal: number;
  total: number;
  currency: string;
  // Breakdown details
  unitLabel?: string;     // e.g. "75,00 $/h × 3h" or "150,00 $ × 2 nuits"
  numberOfPeople?: number;
  duration?: string;      // e.g. "3h" or "2 nuits"

  // Payment
  paymentIntentId?: string;
  paymentMethod?: string;

  // Trip
  tripType?: string;
}

// ─────────────────────────────────────────────────────────────────────────────
// ICS CALENDAR FILE GENERATION
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Format a Date to ICS DTSTART/DTEND format (UTC): 20260301T140000Z
 */
function toIcsDate(isoString: string): string {
  const d = new Date(isoString);
  return d.toISOString().replace(/[-:]/g, "").replace(/\.\d{3}/, "");
}

/**
 * Escape text for ICS fields (fold lines, escape chars)
 */
function escapeIcs(text: string): string {
  return text.replace(/\\/g, "\\\\").replace(/;/g, "\\;").replace(/,/g, "\\,").replace(/\n/g, "\\n");
}

/**
 * Generate a .ics calendar file content
 */
export function generateIcsCalendarEvent(data: BookingEmailData): string {
  const uid = `${data.bookingId}@mondesauvage.ca`;
  const now = toIcsDate(new Date().toISOString());
  const dtStart = toIcsDate(data.startTime);
  const dtEnd = toIcsDate(data.endTime);

  const summary = escapeIcs(data.eventTitle);
  const location = data.location ? escapeIcs(data.location) : "";
  const description = escapeIcs(
    [
      `Réservation #${data.bookingId.slice(0, 8)}`,
      data.bookingType === "guide" ? `Guide: ${data.guideName || ""}` : `Chalet: ${data.chaletName || ""}`,
      data.tripType ? `Type: ${data.tripType}` : "",
      data.numberOfPeople ? `Participants: ${data.numberOfPeople}` : "",
      `Total: ${formatPricePlain(data.total, data.currency)}`,
      "",
      "Monde Sauvage",
      "https://monde-sauvage.vercel.app",
    ]
      .filter(Boolean)
      .join("\\n")
  );

  const attendee = data.customerEmail
    ? `ATTENDEE;CN=${escapeIcs(data.customerName)};RSVP=FALSE:mailto:${data.customerEmail}`
    : "";

  return [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//Monde Sauvage//Booking//FR",
    "CALSCALE:GREGORIAN",
    "METHOD:PUBLISH",
    "BEGIN:VEVENT",
    `UID:${uid}`,
    `DTSTAMP:${now}`,
    `DTSTART:${dtStart}`,
    `DTEND:${dtEnd}`,
    `SUMMARY:${summary}`,
    location ? `LOCATION:${location}` : "",
    `DESCRIPTION:${description}`,
    attendee,
    `STATUS:CONFIRMED`,
    "END:VEVENT",
    "END:VCALENDAR",
  ]
    .filter(Boolean)
    .join("\r\n");
}

// ─────────────────────────────────────────────────────────────────────────────
// CALENDAR LINKS (GOOGLE / OUTLOOK / APPLE)
// ─────────────────────────────────────────────────────────────────────────────

function toGoogleDate(isoString: string): string {
  return new Date(isoString).toISOString().replace(/[-:]/g, "").replace(/\.\d{3}/, "");
}

export function generateCalendarLinks(data: BookingEmailData) {
  const dtStart = toGoogleDate(data.startTime);
  const dtEnd = toGoogleDate(data.endTime);
  const title = encodeURIComponent(data.eventTitle);
  const details = encodeURIComponent(
    `Réservation #${data.bookingId.slice(0, 8)}\n${data.bookingType === "guide" ? `Guide: ${data.guideName || ""}` : `Chalet: ${data.chaletName || ""}`}\nTotal: ${formatPricePlain(data.total, data.currency)}`
  );
  const location = encodeURIComponent(data.location || "");

  const google = `https://www.google.com/calendar/render?action=TEMPLATE&text=${title}&dates=${dtStart}/${dtEnd}&details=${details}&location=${location}`;

  // Outlook Web
  const start = new Date(data.startTime).toISOString();
  const end = new Date(data.endTime).toISOString();
  const outlook = `https://outlook.live.com/calendar/0/action/compose?rru=addevent&startdt=${start}&enddt=${end}&subject=${title}&body=${details}&location=${location}`;

  return { google, outlook };
}

// ─────────────────────────────────────────────────────────────────────────────
// PRICE FORMATTING
// ─────────────────────────────────────────────────────────────────────────────

function formatPricePlain(amount: number, currency = "CAD"): string {
  return new Intl.NumberFormat("fr-CA", { style: "currency", currency }).format(amount);
}

// ─────────────────────────────────────────────────────────────────────────────
// HTML INVOICE / EMAIL TEMPLATE
// ─────────────────────────────────────────────────────────────────────────────

export function generateInvoiceHtml(data: BookingEmailData, calendarLinks: { google: string; outlook: string }): string {
  const refNumber = data.bookingId.slice(0, 8).toUpperCase();
  const startDate = new Date(data.startTime);
  const endDate = new Date(data.endTime);

  const dateFormatter = new Intl.DateTimeFormat("fr-CA", {
    weekday: "long",
    year: "numeric",
    month: "long",
    day: "numeric",
  });
  const timeFormatter = new Intl.DateTimeFormat("fr-CA", {
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });

  const formattedStartDate = dateFormatter.format(startDate);
  const formattedStartTime = timeFormatter.format(startDate);
  const formattedEndTime = timeFormatter.format(endDate);

  // For chalet bookings, show date range; for guide, show date + times
  let dateDisplay: string;
  if (data.bookingType === "chalet") {
    const formattedEndDate = dateFormatter.format(endDate);
    dateDisplay = `${formattedStartDate} → ${formattedEndDate}`;
  } else {
    dateDisplay = `${formattedStartDate}, ${formattedStartTime} – ${formattedEndTime}`;
  }

  const serviceType = data.bookingType === "guide" ? "Réservation Guide" : "Planifiez séjour";

  const taxes = data.total - data.subtotal;
  const hasTaxes = Math.abs(taxes) > 0.01;

  return `<!DOCTYPE html>
<html lang="fr">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>Confirmation de réservation — Monde Sauvage</title>
</head>
<body style="margin:0;padding:0;background-color:#f4f7f6;font-family:'Helvetica Neue',Helvetica,Arial,sans-serif;-webkit-font-smoothing:antialiased;">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background-color:#f4f7f6;padding:32px 16px;">
    <tr>
      <td align="center">
        <table role="presentation" width="600" cellpadding="0" cellspacing="0" style="max-width:600px;width:100%;background-color:#ffffff;border-radius:12px;overflow:hidden;box-shadow:0 2px 8px rgba(0,0,0,0.06);">
          
          <!-- HEADER -->
          <tr>
            <td style="background:linear-gradient(135deg,#059669 0%,#047857 100%);padding:32px 40px;text-align:center;">
              <h1 style="margin:0;color:#ffffff;font-size:24px;font-weight:700;letter-spacing:-0.5px;">
                🌿 Monde Sauvage
              </h1>
              <p style="margin:8px 0 0;color:#d1fae5;font-size:14px;">
                Confirmation de réservation
              </p>
            </td>
          </tr>

          <!-- SUCCESS BANNER -->
          <tr>
            <td style="padding:24px 40px 0;">
              <div style="background-color:#ecfdf5;border:1px solid #a7f3d0;border-radius:8px;padding:16px 20px;text-align:center;">
                <span style="font-size:28px;">✅</span>
                <p style="margin:8px 0 0;color:#065f46;font-size:16px;font-weight:600;">
                  Paiement confirmé
                </p>
              </div>
            </td>
          </tr>

          <!-- GREETING -->
          <tr>
            <td style="padding:24px 40px 0;">
              <p style="margin:0;color:#374151;font-size:16px;line-height:1.5;">
                Bonjour <strong>${escapeHtml(data.customerName)}</strong>,
              </p>
              <p style="margin:8px 0 0;color:#6b7280;font-size:14px;line-height:1.5;">
                Merci pour votre réservation! Voici le récapitulatif et votre facture.
              </p>
            </td>
          </tr>

          <!-- BOOKING DETAILS -->
          <tr>
            <td style="padding:24px 40px 0;">
              <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border:1px solid #e5e7eb;border-radius:8px;overflow:hidden;">
                <tr>
                  <td style="background-color:#f9fafb;padding:12px 16px;border-bottom:1px solid #e5e7eb;">
                    <strong style="color:#111827;font-size:14px;">📋 Détails de la réservation</strong>
                  </td>
                </tr>
                <tr>
                  <td style="padding:16px;">
                    <table role="presentation" width="100%" cellpadding="0" cellspacing="0">
                      <tr>
                        <td style="padding:6px 0;color:#6b7280;font-size:13px;width:40%;">Référence</td>
                        <td style="padding:6px 0;color:#111827;font-size:13px;font-weight:600;">#${refNumber}</td>
                      </tr>
                      <tr>
                        <td style="padding:6px 0;color:#6b7280;font-size:13px;">Type</td>
                        <td style="padding:6px 0;color:#111827;font-size:13px;">${serviceType}</td>
                      </tr>
                      ${data.guideName ? `<tr>
                        <td style="padding:6px 0;color:#6b7280;font-size:13px;">Guide</td>
                        <td style="padding:6px 0;color:#111827;font-size:13px;">${escapeHtml(data.guideName)}</td>
                      </tr>` : ""}
                      ${data.chaletName ? `<tr>
                        <td style="padding:6px 0;color:#6b7280;font-size:13px;">Chalet</td>
                        <td style="padding:6px 0;color:#111827;font-size:13px;">${escapeHtml(data.chaletName)}</td>
                      </tr>` : ""}
                      ${data.establishmentName ? `<tr>
                        <td style="padding:6px 0;color:#6b7280;font-size:13px;">Établissement</td>
                        <td style="padding:6px 0;color:#111827;font-size:13px;">${escapeHtml(data.establishmentName)}</td>
                      </tr>` : ""}
                      <tr>
                        <td style="padding:6px 0;color:#6b7280;font-size:13px;">Date</td>
                        <td style="padding:6px 0;color:#111827;font-size:13px;">${dateDisplay}</td>
                      </tr>
                      ${data.duration ? `<tr>
                        <td style="padding:6px 0;color:#6b7280;font-size:13px;">Durée</td>
                        <td style="padding:6px 0;color:#111827;font-size:13px;">${escapeHtml(data.duration)}</td>
                      </tr>` : ""}
                      ${data.tripType ? `<tr>
                        <td style="padding:6px 0;color:#6b7280;font-size:13px;">Activité</td>
                        <td style="padding:6px 0;color:#111827;font-size:13px;">${escapeHtml(data.tripType)}</td>
                      </tr>` : ""}
                      ${data.numberOfPeople ? `<tr>
                        <td style="padding:6px 0;color:#6b7280;font-size:13px;">Participants</td>
                        <td style="padding:6px 0;color:#111827;font-size:13px;">${data.numberOfPeople}</td>
                      </tr>` : ""}
                      <tr>
                        <td style="padding:6px 0;color:#6b7280;font-size:13px;">Client</td>
                        <td style="padding:6px 0;color:#111827;font-size:13px;">${escapeHtml(data.customerName)}</td>
                      </tr>
                      <tr>
                        <td style="padding:6px 0;color:#6b7280;font-size:13px;">Email</td>
                        <td style="padding:6px 0;color:#111827;font-size:13px;">${escapeHtml(data.customerEmail)}</td>
                      </tr>
                    </table>
                  </td>
                </tr>
              </table>
            </td>
          </tr>

          <!-- INVOICE -->
          <tr>
            <td style="padding:24px 40px 0;">
              <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border:1px solid #e5e7eb;border-radius:8px;overflow:hidden;">
                <tr>
                  <td style="background-color:#f9fafb;padding:12px 16px;border-bottom:1px solid #e5e7eb;">
                    <strong style="color:#111827;font-size:14px;">💰 Facture</strong>
                  </td>
                </tr>
                <tr>
                  <td style="padding:16px;">
                    <table role="presentation" width="100%" cellpadding="0" cellspacing="0">
                      ${data.unitLabel ? `<tr>
                        <td style="padding:8px 0;color:#374151;font-size:14px;">${escapeHtml(data.unitLabel)}</td>
                        <td style="padding:8px 0;color:#374151;font-size:14px;text-align:right;">${formatPricePlain(data.subtotal, data.currency)}</td>
                      </tr>` : `<tr>
                        <td style="padding:8px 0;color:#374151;font-size:14px;">Sous-total</td>
                        <td style="padding:8px 0;color:#374151;font-size:14px;text-align:right;">${formatPricePlain(data.subtotal, data.currency)}</td>
                      </tr>`}
                      ${hasTaxes ? `<tr>
                        <td style="padding:8px 0;color:#6b7280;font-size:13px;">Taxes</td>
                        <td style="padding:8px 0;color:#6b7280;font-size:13px;text-align:right;">${formatPricePlain(taxes, data.currency)}</td>
                      </tr>` : ""}
                      <tr>
                        <td colspan="2" style="padding:0;"><hr style="border:none;border-top:1px solid #e5e7eb;margin:8px 0;" /></td>
                      </tr>
                      <tr>
                        <td style="padding:8px 0;color:#111827;font-size:16px;font-weight:700;">Total payé</td>
                        <td style="padding:8px 0;color:#059669;font-size:16px;font-weight:700;text-align:right;">${formatPricePlain(data.total, data.currency)}</td>
                      </tr>
                    </table>
                  </td>
                </tr>
                <tr>
                  <td style="padding:0 16px 16px;">
                    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background-color:#f9fafb;border-radius:6px;padding:12px;">
                      <tr>
                        <td style="padding:4px 12px;color:#6b7280;font-size:12px;">Mode de paiement</td>
                        <td style="padding:4px 12px;color:#374151;font-size:12px;text-align:right;">${escapeHtml(data.paymentMethod || "Carte bancaire")}</td>
                      </tr>
                      ${data.paymentIntentId ? `<tr>
                        <td style="padding:4px 12px;color:#6b7280;font-size:12px;">Confirmation</td>
                        <td style="padding:4px 12px;color:#374151;font-size:12px;text-align:right;font-family:monospace;">${data.paymentIntentId.slice(0, 20)}…</td>
                      </tr>` : ""}
                    </table>
                  </td>
                </tr>
              </table>
            </td>
          </tr>

          <!-- ADD TO CALENDAR -->
          <tr>
            <td style="padding:24px 40px 0;text-align:center;">
              <p style="margin:0 0 16px;color:#374151;font-size:14px;font-weight:600;">
                📅 Ajouter à votre calendrier
              </p>
              <table role="presentation" cellpadding="0" cellspacing="0" style="margin:0 auto;">
                <tr>
                  <td style="padding:0 6px;">
                    <a href="${calendarLinks.google}" target="_blank" rel="noopener" style="display:inline-block;padding:10px 20px;background-color:#059669;color:#ffffff;text-decoration:none;border-radius:6px;font-size:13px;font-weight:600;">
                      Google Calendar
                    </a>
                  </td>
                  <td style="padding:0 6px;">
                    <a href="${calendarLinks.outlook}" target="_blank" rel="noopener" style="display:inline-block;padding:10px 20px;background-color:#0078d4;color:#ffffff;text-decoration:none;border-radius:6px;font-size:13px;font-weight:600;">
                      Outlook
                    </a>
                  </td>
                </tr>
              </table>
              <p style="margin:12px 0 0;color:#9ca3af;font-size:12px;">
                Un fichier .ics est aussi joint à cet email pour Apple Calendar / autres.
              </p>
            </td>
          </tr>

          <!-- FOOTER -->
          <tr>
            <td style="padding:32px 40px;text-align:center;border-top:1px solid #e5e7eb;margin-top:24px;">
              <p style="margin:0;color:#9ca3af;font-size:12px;line-height:1.5;">
                Monde Sauvage<br />
                Questions? Contactez-nous à info@mondesauvage.ca
              </p>
              <p style="margin:8px 0 0;color:#d1d5db;font-size:11px;">
                Ce courriel a été envoyé automatiquement suite à votre réservation.
              </p>
            </td>
          </tr>

        </table>
      </td>
    </tr>
  </table>
</body>
</html>`;
}

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

// ─────────────────────────────────────────────────────────────────────────────
// EMAIL SENDING VIA RESEND
// ─────────────────────────────────────────────────────────────────────────────

export interface SendEmailResult {
  success: boolean;
  emailId?: string;
  error?: string;
}

/**
 * Send the booking confirmation email with invoice + .ics attachment.
 *
 * Requires RESEND_API_KEY env variable.
 * Set BOOKING_EMAIL_FROM to customize the sender (default: Monde Sauvage <bookings@mondesauvage.ca>).
 */
export async function sendBookingConfirmationEmail(data: BookingEmailData): Promise<SendEmailResult> {
  const RESEND_API_KEY = Deno.env.get("RESEND_API_KEY");
  if (!RESEND_API_KEY) {
    console.error("❌ RESEND_API_KEY not configured — cannot send confirmation email");
    return { success: false, error: "RESEND_API_KEY not configured" };
  }

  const fromAddress = Deno.env.get("BOOKING_EMAIL_FROM") || "Monde Sauvage <bookings@mondesauvage.ca>";

  try {
    // Generate calendar data
    const calendarLinks = generateCalendarLinks(data);
    const icsContent = generateIcsCalendarEvent(data);
    const htmlContent = generateInvoiceHtml(data, calendarLinks);

    // Base64 encode the .ics file for attachment
    const icsBase64 = btoa(unescape(encodeURIComponent(icsContent)));

    const refNumber = data.bookingId.slice(0, 8).toUpperCase();
    const subject = `Confirmation de réservation #${refNumber} — Monde Sauvage`;

    // Send via Resend API
    const response = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${RESEND_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        from: fromAddress,
        to: [data.customerEmail],
        subject,
        html: htmlContent,
        attachments: [
          {
            filename: `monde-sauvage-reservation-${refNumber}.ics`,
            content: icsBase64,
            content_type: "text/calendar",
          },
        ],
        tags: [
          { name: "booking_type", value: data.bookingType },
          { name: "booking_id", value: data.bookingId },
        ],
      }),
    });

    const result = await response.json();

    if (!response.ok) {
      console.error(`❌ Resend API error (${response.status}):`, JSON.stringify(result));
      return { success: false, error: result.message || `Resend error ${response.status}` };
    }

    console.log(`📧 Confirmation email sent to ${data.customerEmail} (Resend ID: ${result.id})`);
    return { success: true, emailId: result.id };

  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    console.error("❌ Email sending failed:", message);
    return { success: false, error: message };
  }
}
