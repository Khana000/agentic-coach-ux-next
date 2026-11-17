import { readObject, validateStrings } from "../../../lib/server/request-validation";
import { NextResponse } from "next/server";
import { DELIVERY_LIMITS, requireAccess } from "../../../lib/server/access";
import { buildPlanIcs, isRecipientAllowed, isValidRecipientEmail } from "../../../lib/action-plan";

type CalendarInviteRequest = {
  toEmail?: string;
  coacheeName?: string;
  actionText?: string;
  startAt?: string;
  endAt?: string;
};

// Wall-clock date/time in Europe/London for an instant (the invite is written in that timezone).
const toLondonParts = (date: Date) => {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: "Europe/London",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23"
  }).formatToParts(date);
  const get = (type: string) => parts.find((part) => part.type === type)?.value ?? "00";
  return { date: `${get("year")}-${get("month")}-${get("day")}`, time: `${get("hour")}:${get("minute")}` };
};

export async function POST(request: Request) {
  const access = requireAccess(request, DELIVERY_LIMITS());
  if (!access.ok) {
    return access.response;
  }

  const parsed = await readObject(request);
  if (parsed.response) return parsed.response;
  const fieldsError = validateStrings(parsed.data!, ["toEmail", "coacheeName", "actionText", "startAt", "endAt"]);
  if (fieldsError) return fieldsError;
  const payload = parsed.data as CalendarInviteRequest;

  const toEmail = payload.toEmail?.trim();
  const actionText = payload.actionText?.trim();
  const coacheeName = payload.coacheeName?.trim() || "Coachee";
  const resendApiKey = process.env.RESEND_API_KEY;
  const fromEmail = process.env.CALENDAR_FROM_EMAIL;

  if (!toEmail || !actionText) {
    return NextResponse.json({ error: "Missing toEmail or actionText." }, { status: 400 });
  }

  // Server-side recipient checks (the browser check can be bypassed): one well-formed address, no header
  // injection, optional domain allow-list via CALENDAR_ALLOWED_RECIPIENT_DOMAINS. Runs before any email is sent.
  if (!isValidRecipientEmail(toEmail)) {
    return NextResponse.json({ error: "Enter a single valid email address.", code: "invalid_recipient" }, { status: 400 });
  }
  if (!isRecipientAllowed(toEmail, process.env.CALENDAR_ALLOWED_RECIPIENT_DOMAINS)) {
    return NextResponse.json(
      { error: "Invites can only be sent to approved email domains.", code: "recipient_not_allowed" },
      { status: 403 }
    );
  }
  if (actionText.length > 300 || /[\r\n]/.test(coacheeName) || coacheeName.length > 100) {
    return NextResponse.json({ error: "Invalid invite details.", code: "invalid_payload" }, { status: 400 });
  }

  if (!resendApiKey || !fromEmail) {
    console.error("[calendar-invite] Not configured: set RESEND_API_KEY and CALENDAR_FROM_EMAIL.");
    return NextResponse.json(
      { error: "Calendar invites are not available right now.", code: "not_configured" },
      { status: 503 }
    );
  }

  const start = payload.startAt ? new Date(payload.startAt) : new Date();
  if (Number.isNaN(start.getTime())) {
    return NextResponse.json({ error: "Invalid startAt date." }, { status: 400 });
  }

  const end = payload.endAt ? new Date(payload.endAt) : new Date(start.getTime() + 30 * 60 * 1000);
  if (Number.isNaN(end.getTime())) {
    return NextResponse.json({ error: "Invalid endAt date." }, { status: 400 });
  }

  const londonStart = toLondonParts(start);
  const durationMinutes = Math.max(5, Math.min(480, Math.round((end.getTime() - start.getTime()) / 60000) || 30));
  const ics = buildPlanIcs(
    [{ id: "a1", activity: actionText, dueDate: londonStart.date, time: londonStart.time, durationMinutes }],
    { method: "REQUEST", attendeeEmail: toEmail, attendeeName: coacheeName }
  );
  const subject = `Coaching calendar invite: ${actionText}`;

  const emailResponse = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${resendApiKey}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      from: fromEmail,
      to: [toEmail],
      subject,
      text: `Hi ${coacheeName},\n\nAttached is your coaching calendar invite for: ${actionText}\n\nBest,\nAgentic Coach`,
      attachments: [
        {
          filename: "agentic-coach-action.ics",
          content: Buffer.from(ics, "utf8").toString("base64")
        }
      ]
    })
  });

  if (!emailResponse.ok) {
    const errorText = await emailResponse.text();
    console.error(`[calendar-invite] Resend responded ${emailResponse.status}: ${errorText.slice(0, 500)}`);
    return NextResponse.json(
      { error: "Calendar invite email failed.", code: "delivery_failed" },
      { status: 502 }
    );
  }

  return NextResponse.json({ ok: true });
}
