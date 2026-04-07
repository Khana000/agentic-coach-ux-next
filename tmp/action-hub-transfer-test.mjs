import fs from "node:fs/promises";
import path from "node:path";

const BASE_URL = process.env.BASE_URL || "http://127.0.0.1:3000";
const INITIAL = "Welcome. What outcome would make this coaching session most valuable for you today?";

const report = {
  baseUrl: BASE_URL,
  startedAt: new Date().toISOString(),
  checks: [],
  summary: {
    passed: 0,
    failed: 0
  }
};

function addCheck(name, ok, details = {}) {
  report.checks.push({ name, ok, ...details });
  if (ok) {
    report.summary.passed += 1;
  } else {
    report.summary.failed += 1;
  }
}

function contains(text, pattern) {
  return new RegExp(pattern, "i").test(text || "");
}

async function chat(messages) {
  const started = performance.now();
  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      const response = await fetch(`${BASE_URL}/api/chat`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          context: "visibility",
          coachGender: "female",
          style: "balanced",
          messages
        })
      });
      const payload = await response.json().catch(() => ({}));
      if (response.status === 404 && attempt === 0) {
        await new Promise((resolve) => setTimeout(resolve, 500));
        continue;
      }
      return {
        status: response.status,
        ok: response.ok,
        json: payload,
        ms: Number((performance.now() - started).toFixed(1))
      };
    } catch (error) {
      if (attempt === 0) {
        await new Promise((resolve) => setTimeout(resolve, 500));
        continue;
      }
      return {
        status: 0,
        ok: false,
        json: {},
        ms: Number((performance.now() - started).toFixed(1)),
        error: error instanceof Error ? error.message : String(error)
      };
    }
  }

  return {
    status: 0,
    ok: false,
    json: {},
    ms: Number((performance.now() - started).toFixed(1)),
    error: "Unable to reach /api/chat."
  };
}

async function runChatFlowChecks() {
  const planRequestMessages = [
    { role: "assistant", content: INITIAL },
    { role: "user", content: "I need to improve my influence in senior leadership presentations." },
    { role: "assistant", content: "What pattern is most holding you back right now?" },
    { role: "user", content: "Please create an action plan for me." }
  ];

  const plan = await chat(planRequestMessages);
  const planText = String(plan.json?.text || "");
  const hasStructure =
    contains(planText, "^\\s*##\\s*(reflection|focus plan|first step)") ||
    contains(planText, "^\\s*[-*]\\s+");

  addCheck(
    "Plan request returns structured plan with feasibility confirmation",
    plan.status === 200 && hasStructure && contains(planText, "does this action plan work for you\\?"),
    {
      status: plan.status,
      ms: plan.ms,
      preview: planText.slice(0, 180),
      error: plan.error
    }
  );

  const approval = await chat([
    ...planRequestMessages,
    { role: "assistant", content: planText || "Does this action plan work for you?" },
    { role: "user", content: "Yes, I agree. Please proceed." }
  ]);
  const approvalText = String(approval.json?.text || "");

  addCheck(
    "Approval turn transitions after plan confirmation",
    approval.status === 200 &&
      (contains(approvalText, "would you like to end the coaching session now\\?") ||
        contains(approvalText, "manager") ||
        contains(approvalText, "support")),
    {
      status: approval.status,
      ms: approval.ms,
      preview: approvalText.slice(0, 180),
      error: approval.error
    }
  );
}

async function runUiContractChecks() {
  const pagePath = path.resolve(process.cwd(), "app/page.tsx");
  const pageSource = await fs.readFile(pagePath, "utf8");

  addCheck(
    "Action Hub has coachee reminder email field",
    pageSource.includes("coachee-reminder-email") &&
      pageSource.includes("Coachee reminder email (future integration)")
  );

  addCheck(
    "Each action has calendar agreement dropdown",
    pageSource.includes("Calendar agreement") &&
      pageSource.includes("action-calendar-agreement-") &&
      pageSource.includes("Not agreed yet") &&
      pageSource.includes("Agreed for calendar") &&
      pageSource.includes("Skip calendar")
  );

  addCheck(
    "Calendar send is gated by agreement",
    pageSource.includes("Set Calendar agreement to 'Agreed for calendar' before sending this invite.")
  );

  addCheck(
    "Plan transfer auto-import fallback is enabled for execution mode",
    pageSource.includes("minimumPlanItemCount = executionToolsEnabled ? 1 : 3") &&
      pageSource.includes("canAutoImportFromExecutionMode")
  );

  addCheck(
    "Text mode approval path finalizes pending plan into Action Hub",
    pageSource.includes("finalizeActionPlan(pendingPlanItemsRef.current, pendingPlanSignatureRef.current)")
  );

  addCheck(
    "Voice mode approval path finalizes pending plan into Action Hub",
    pageSource.includes("if (pendingPlanSignatureRef.current && pendingPlanItemsRef.current.length > 0)") &&
      pageSource.includes("finalizeActionPlan(") &&
      pageSource.includes("{ autoImported: true }")
  );
}

async function main() {
  await runChatFlowChecks();
  await runUiContractChecks();
  report.finishedAt = new Date().toISOString();
  console.log(JSON.stringify(report, null, 2));

  if (report.summary.failed > 0) {
    process.exitCode = 1;
  }
}

main().catch((error) => {
  report.finishedAt = new Date().toISOString();
  report.fatal = error instanceof Error ? error.message : String(error);
  report.summary.failed += 1;
  console.log(JSON.stringify(report, null, 2));
  process.exitCode = 1;
});
