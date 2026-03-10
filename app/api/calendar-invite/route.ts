import { NextResponse } from "next/server";

type CalendarInviteRequest = {
  toEmail?: string;
  coacheeName?: string;
  actionText?: string;
  startAt?: string;
  endAt?: string;
};

const toIcsDate = (date: Date) => date.toISOString().replace(/[-:]/g, "").replace(/\.\d{3}Z$/, "Z");

const escapeIcsText = (value: string) =>
  value
    .replace(/\\/g, "\\\\")
    .replace(/\n/g, "\\n")
    .replace(/,/g, "\\,")
    .replace(/;/g, "\\;");

const buildCalendarInvite = (actionText: string, start: Date, end: Date, toEmail: string, name: string) => {
  const uid = `${Date.now()}-${Math.random().toString(36).slice(2)}@agenticcoach`;

  return [
    "BEGIN:VCALENDAR",
    "PRODID:-//Agentic Coach//Calendar Invite//EN",
    "VERSION:2.0",
    "CALSCALE:GREGORIAN",
    "METHOD:REQUEST",
    "BEGIN:VEVENT",
    `UID:${uid}`,
    `DTSTAMP:${toIcsDate(new Date())}`,
    `DTSTART:${toIcsDate(start)}`,
    `DTEND:${toIcsDate(end)}`,
    `SUMMARY:${escapeIcsText(`Coaching Action: ${actionText}`)}`,
    `DESCRIPTION:${escapeIcsText("Time-bound coaching action reminder from Agentic Coach.")}`,
    `ATTENDEE;CN=${escapeIcsText(name)}:mailto:${toEmail}`,
    "END:VEVENT",
    "END:VCALENDAR"
  ].join("\r\n");
};

export async function POST(request: Request) {
  let payload: CalendarInviteRequest;

  try {
    payload = await request.json();
  } catch (error) {
    return NextResponse.json({ error: "Invalid JSON payload." }, { status: 400 });
  }

  const toEmail = payload.toEmail?.trim();
  const actionText = payload.actionText?.trim();
  const coacheeName = payload.coacheeName?.trim() || "Coachee";
  const resendApiKey = process.env.RESEND_API_KEY;
  const fromEmail = process.env.CALENDAR_FROM_EMAIL || process.env.ACTION_PLAN_FROM_EMAIL;

  if (!toEmail || !actionText) {
    return NextResponse.json({ error: "Missing toEmail or actionText." }, { status: 400 });
  }

  if (!resendApiKey || !fromEmail) {
    return NextResponse.json(
      {
        error:
          "Email invite is not configured. Set RESEND_API_KEY and CALENDAR_FROM_EMAIL (or ACTION_PLAN_FROM_EMAIL)."
      },
      { status: 500 }
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

  const ics = buildCalendarInvite(actionText, start, end, toEmail, coacheeName);
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
    return NextResponse.json(
      { error: "Calendar invite email failed.", details: errorText },
      { status: 502 }
    );
  }

  return NextResponse.json({ ok: true });
}
