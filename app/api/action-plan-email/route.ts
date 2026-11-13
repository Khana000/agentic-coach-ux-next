import { NextResponse } from "next/server";
import { DELIVERY_LIMITS, requireAccess } from "../../../lib/server/access";

type ActionPlanEmailRequest = {
  toEmail?: string;
  coacheeName?: string;
  subject?: string;
  summary?: string;
  actions?: string[];
};

export async function POST(request: Request) {
  const access = requireAccess(request, DELIVERY_LIMITS());
  if (!access.ok) {
    return access.response;
  }

  let payload: ActionPlanEmailRequest;

  try {
    payload = await request.json();
  } catch (error) {
    return NextResponse.json({ error: "Invalid JSON payload." }, { status: 400 });
  }

  const toEmail = payload.toEmail?.trim();
  const coacheeName = payload.coacheeName?.trim() || "Coachee";
  const summary = payload.summary?.trim() || "";
  const actions = Array.isArray(payload.actions)
    ? payload.actions.map((item) => String(item).trim()).filter(Boolean)
    : [];

  if (!toEmail) {
    return NextResponse.json({ error: "Missing toEmail." }, { status: 400 });
  }

  if (!summary && actions.length === 0) {
    return NextResponse.json({ error: "No action-plan content to email." }, { status: 400 });
  }

  const resendApiKey = process.env.RESEND_API_KEY;
  const fromEmail = process.env.ACTION_PLAN_FROM_EMAIL || process.env.CALENDAR_FROM_EMAIL;

  if (!resendApiKey || !fromEmail) {
    // Configuration details are for operators only: log them, keep the client message generic.
    console.error(
      "[action-plan-email] Not configured: set RESEND_API_KEY and ACTION_PLAN_FROM_EMAIL (or CALENDAR_FROM_EMAIL)."
    );
    return NextResponse.json(
      { error: "Email delivery is not available right now.", code: "not_configured" },
      { status: 503 }
    );
  }

  const subject = payload.subject?.trim() || "Your Agentic Coach action plan";
  const actionsBlock =
    actions.length > 0
      ? actions.map((item, index) => `${index + 1}. ${item}`).join("\n")
      : "No explicit action bullets were provided.";

  const text = [
    `Hi ${coacheeName},`,
    "",
    "Here is your action plan from the coaching session:",
    "",
    summary || "(No summary provided)",
    "",
    "Actions:",
    actionsBlock,
    "",
    "Best,",
    "Agentic Coach"
  ].join("\n");

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
      text
    })
  });

  if (!emailResponse.ok) {
    const errorText = await emailResponse.text();
    console.error(`[action-plan-email] Resend responded ${emailResponse.status}: ${errorText.slice(0, 500)}`);
    return NextResponse.json(
      { error: "Action plan email failed.", code: "delivery_failed" },
      { status: 502 }
    );
  }

  return NextResponse.json({ ok: true });
}
