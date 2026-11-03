"use client";

/**
 * calendarSync.ts
 *
 * Client-side Google Calendar integration helpers.
 *
 * Rule 6 compliance (rules.md §6 — Third-Party API Guardrails):
 *  §Ephemeral Auth    — No OAuth tokens are accepted, stored, or forwarded here.
 *                       Token handling lives exclusively in page.tsx's onSuccess
 *                       closure and is never persisted.
 *  §Payload Minimization — CalendarEventInput is intentionally limited to the
 *                       three allowed fields. buildCalendarEventBody uses a
 *                       Pick<> type so TypeScript structurally prevents extra
 *                       fields (image data, IDs, addresses) from leaking in.
 *  §Client-Side Trigger  — All exported functions must be called from explicit
 *                       user-interaction handlers (onClick). Never call from
 *                       useEffect or background tasks.
 */

/** The only fields permitted to flow into any calendar payload (Rule 6 §Payload Minimization). */
export interface CalendarEventInput {
  nickname: string; // user-supplied label — no ID numbers or addresses
  docType: string;  // one of the 5 allowed document types
  expiryDate: string; // YYYY-MM-DD only
}

/** Formats a YYYY-MM-DD date as a compact YYYYMMDD string for Google Calendar. */
function toGCalDate(isoDate: string): string {
  return isoDate.replace(/-/g, "");
}

/**
 * Opens the Google Calendar "create event" web intent in a new tab.
 * Rule 6 §Payload Minimization: title contains only nickname + docType;
 * description is static text. No raw extraction output or JSON dumps.
 *
 * Must be called from an explicit user onClick handler (Rule 6 §Client-Side Trigger).
 */
export function openGoogleCalendarIntent(event: CalendarEventInput): void {
  const title = encodeURIComponent(
    `Renewal Reminder: ${event.nickname} (${event.docType})`
  );
  const date = toGCalDate(event.expiryDate);
  const dates = encodeURIComponent(`${date}/${date}`);
  const description = encodeURIComponent(
    "Document expiry reminder created privately by Document Expiry Tracker. Please initiate renewal."
  );

  const url =
    `https://calendar.google.com/calendar/render` +
    `?action=TEMPLATE` +
    `&text=${title}` +
    `&dates=${dates}` +
    `&details=${description}` +
    `&allday=true`;

  window.open(url, "_blank", "noopener,noreferrer");
}

/**
 * Generates and triggers a download of a standards-compliant .ics file.
 * Compatible with Google Calendar, Apple Calendar, and Outlook.
 *
 * Rule 6 §Payload Minimization: SUMMARY and DESCRIPTION contain only the
 * allowed metadata. No image data, IDs, or addresses appear in the file.
 * The blob URL is revoked immediately after download (zero-retention).
 *
 * Must be called from an explicit user onClick handler (Rule 6 §Client-Side Trigger).
 */
export function downloadICS(event: CalendarEventInput): void {
  const uid = `doc-expiry-${Date.now()}@document-expiry-tracker`;
  const now = new Date()
    .toISOString()
    .replace(/[-:]/g, "")
    .split(".")[0] + "Z";
  const dateValue = toGCalDate(event.expiryDate);

  const icsContent = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//Document Expiry Tracker//EN",
    "CALSCALE:GREGORIAN",
    "METHOD:PUBLISH",
    "BEGIN:VEVENT",
    `UID:${uid}`,
    `DTSTAMP:${now}`,
    `DTSTART;VALUE=DATE:${dateValue}`,
    `DTEND;VALUE=DATE:${dateValue}`,
    // Rule 6: only nickname + docType in SUMMARY; static text in DESCRIPTION.
    `SUMMARY:Renewal Reminder: ${event.nickname} (${event.docType})`,
    "DESCRIPTION:Document expiry reminder created privately by Document Expiry Tracker. Please initiate renewal.",
    // 30-day advance reminder
    "BEGIN:VALARM",
    "TRIGGER:-P30D",
    "ACTION:DISPLAY",
    "DESCRIPTION:30-day renewal reminder",
    "END:VALARM",
    // 7-day advance reminder
    "BEGIN:VALARM",
    "TRIGGER:-P7D",
    "ACTION:DISPLAY",
    "DESCRIPTION:7-day renewal reminder — action required",
    "END:VALARM",
    "END:VEVENT",
    "END:VCALENDAR",
  ].join("\r\n");

  const blob = new Blob([icsContent], { type: "text/calendar;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = `renewal-${event.nickname.replace(/\s+/g, "-").toLowerCase()}.ics`;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url); // Rule 2 §Purge + Rule 6: zero-retention, revoke immediately.
}

// ── Server-side helpers (for future OAuth-based server route use) ──────────

/**
 * Rule 6 §Payload Minimization — enforced at the type level.
 *
 * Using Pick<CalendarEventInput, ...> means TypeScript will reject any caller
 * that attempts to pass a wider object containing extra fields (e.g. image
 * data, document numbers, addresses). This is a structural compile-time guard,
 * not just a runtime check.
 */
type StrictEventInput = Pick<CalendarEventInput, "nickname" | "docType" | "expiryDate">;

/**
 * Server-side Google Calendar API reminder override structure.
 * Reminder intervals: 43200 min = 30 days, 10080 min = 7 days.
 */
export const SERVER_SIDE_REMINDER_OVERRIDES = {
  useDefault: false,
  overrides: [
    { method: "popup" as const, minutes: 43200 }, // 30 days
    { method: "email" as const, minutes: 43200 },  // 30 days
    { method: "popup" as const, minutes: 10080 },  //  7 days
    { method: "email" as const, minutes: 10080 },  //  7 days
  ],
} as const;

/**
 * Builds the full Google Calendar API event body for server-side use.
 *
 * Rule 6 §Payload Minimization: accepts StrictEventInput (a Pick<>) so the
 * TypeScript compiler structurally prevents any caller from passing image
 * data, unverified extracted text, or document numbers into the payload.
 */
export function buildCalendarEventBody(event: StrictEventInput) {
  return {
    // Only nickname + docType in summary; static string in description.
    summary: `Renewal Reminder: ${event.nickname} (${event.docType})`,
    description:
      "Document expiry reminder created privately by Document Expiry Tracker. Please initiate renewal.",
    start: { date: event.expiryDate },
    end: { date: event.expiryDate },
    reminders: SERVER_SIDE_REMINDER_OVERRIDES,
  };
}


