// Run with: npm run test:boundary   (Node 22.18+ / 24, which can import .ts files directly)
// End-of-session action plan: date resolution (Europe/London), plan normalising + safety exclusion,
// .ics validity (parsed back), Google Calendar links and recipient validation.
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  buildPlanIcs,
  extractPlanItemsFromPlanText,
  googleCalendarUrl,
  isRecipientAllowed,
  isSafetySignpostingText,
  isValidRecipientEmail,
  londonToday,
  normalisePlanItems,
  parseDurationMinutes,
  parseTimeOfDay,
  resolveDueDate
} from "../lib/action-plan.ts";
import { CLINICAL_REPLY, CONDUCT_REPLY, RISK_REPLY } from "../lib/server/boundary.ts";

const SAT = "2026-11-14"; // Saturday
const MON = "2026-11-16"; // Monday

test("today is the Europe/London calendar date (GMT and BST)", () => {
  assert.equal(londonToday(new Date("2026-11-14T23:30:00Z")), "2026-11-14"); // GMT: same day
  assert.equal(londonToday(new Date("2026-06-14T23:30:00Z")), "2026-06-15"); // BST: already tomorrow
  assert.equal(londonToday(new Date("2026-03-29T00:30:00Z")), "2026-03-29");
});

test("relative dates resolve against today (Saturday 14 Nov 2026)", () => {
  const cases = {
    today: SAT, tonight: SAT, tomorrow: "2026-11-15", "day after tomorrow": "2026-11-16",
    Friday: "2026-11-20", "by Friday": "2026-11-20", "this Friday": "2026-11-20", "next Friday": "2026-11-20",
    "on Monday": "2026-11-16", "next Monday": "2026-11-16", "Saturday": SAT,
    "within 24 hours": "2026-11-15", "within a week": "2026-11-21", "in 2 weeks": "2026-11-28", "in three days": "2026-11-17",
    "in a fortnight": "2026-11-28", "end of the week": "2026-11-20", "end of next week": "2026-11-20", "next week": "2026-11-16",
    "end of the month": "2026-11-30", "next month": "2026-12-14", "end of next month": "2026-12-31",
    "20 November": "2026-11-20", "Nov 20th": "2026-11-20", "20/11": "2026-11-20", "Fri 20 Nov": "2026-11-20",
    "3 Jan": "2027-01-03", "1 January 2027": "2027-01-01", "2026-12-01": "2026-12-01", "Monday 23 November": "2026-11-23",
    "within the next 24 hours": "2026-11-15", "next 24 hours": "2026-11-15", "in the next week": "2026-11-21",
    "within the next 2 days": "2026-11-16", "over the next few days": "2026-11-17", "in the next month": "2026-12-14"
  };
  for (const [text, expected] of Object.entries(cases)) assert.equal(resolveDueDate(text, SAT), expected, text);
});

test("relative dates resolve against a Monday (next Friday = Friday of next week)", () => {
  assert.equal(resolveDueDate("Friday", MON), "2026-11-20");
  assert.equal(resolveDueDate("next Friday", MON), "2026-11-27");
  assert.equal(resolveDueDate("end of the week", MON), "2026-11-20");
  assert.equal(resolveDueDate("next week", MON), "2026-11-23");
  assert.equal(resolveDueDate("Monday", MON), MON);
});

test("unreadable or invalid dates give null", () => {
  for (const text of ["before your next presentation", "in your next live opportunity", "ongoing", "", "31 February", "soon"]) {
    assert.equal(resolveDueDate(text, SAT), null, text);
  }
});

test("times and durations", () => {
  assert.equal(parseTimeOfDay("Friday at 9am"), "09:00");
  assert.equal(parseTimeOfDay("at 2:30 pm"), "14:30");
  assert.equal(parseTimeOfDay("16:45"), "16:45");
  assert.equal(parseTimeOfDay("12am"), "00:00");
  assert.equal(parseTimeOfDay("noon"), "12:00");
  assert.equal(parseTimeOfDay("next Friday"), null);
  assert.equal(parseDurationMinutes("30 minutes"), 30);
  assert.equal(parseDurationMinutes("a 1 hour slot"), 60);
  assert.equal(parseDurationMinutes("half an hour"), 30);
  assert.equal(parseDurationMinutes("90-min"), 90);
  assert.equal(parseDurationMinutes("next week"), null);
});

test("plan items are normalised: wording first, past dates dropped, labels cleaned, capped", () => {
  const items = normalisePlanItems(
    [
      { activity: "**Book a 1:1 with Sam**, owner: you, timeline: next Friday", dateText: "next Friday", dueDate: "2026-11-27" },
      { activity: "Share the project summary with my director", dateText: "Monday at 10am for 30 minutes" },
      { activity: "Ask a peer for feedback", dueDate: "2026-11-10" }, // past -> null
      { activity: "Ask a peer for feedback" }, // duplicate
      { activity: "x" }, // too short
      { action: "Draft the agenda", when: "tomorrow", time: "25:00", durationMinutes: 9999 }
    ],
    SAT
  );
  assert.deepEqual(
    items.map(({ activity, dueDate, time, durationMinutes }) => ({ activity, dueDate, time, durationMinutes })),
    [
      { activity: "Book a 1:1 with Sam", dueDate: "2026-11-20", time: null, durationMinutes: null },
      { activity: "Share the project summary with my director", dueDate: "2026-11-16", time: "10:00", durationMinutes: 30 },
      { activity: "Ask a peer for feedback", dueDate: null, time: null, durationMinutes: null },
      { activity: "Draft the agenda", dueDate: "2026-11-15", time: null, durationMinutes: null }
    ]
  );
  assert.deepEqual(items.map((item) => item.id), ["a1", "a2", "a3", "a4"]);
  // Regression (live run): deadline wording inside the activity gives a date, never a 24-hour duration.
  const [deadline] = normalisePlanItems(
    [{ activity: "Set a calendar invite for the first check-in within the next 24 hours", dateText: "null", dueDate: "null", durationMinutes: null }],
    SAT
  );
  assert.equal(deadline.dueDate, "2026-11-15");
  assert.equal(deadline.durationMinutes, null);
  const many = normalisePlanItems(Array.from({ length: 10 }, (_, i) => ({ activity: `Action number ${i + 1}` })), SAT);
  assert.equal(many.length, 6);
  assert.deepEqual(normalisePlanItems("not an array", SAT), []);
});

test("safety signposting is never a plan item", () => {
  const signposting = [
    "Call Samaritans on 116 123", "Raise it with HR or your People team", "Contact Acas for advice", "Book an appointment with your GP",
    "Call NHS 111", "Use the speak-up line", "Text SHOUT to 85258", "Report your manager to HR", "Contact your Employee Assistance Programme"
  ];
  for (const text of signposting) assert.equal(isSafetySignpostingText(text), true, text);
  const coaching = ["Book a 1:1 with Sam to agree deadlines", "Share the summary with your director", "Ask HR for the headcount plan template", "Prepare three questions for the team meeting"];
  for (const text of coaching) assert.equal(isSafetySignpostingText(text), false, text);
  assert.deepEqual(normalisePlanItems(signposting.map((activity) => ({ activity, dateText: "tomorrow" })), SAT), []);
  // Bullets of the fixed safety replies never become items.
  for (const reply of [RISK_REPLY, CONDUCT_REPLY, CLINICAL_REPLY]) assert.deepEqual(extractPlanItemsFromPlanText(reply, SAT), [], reply.slice(0, 40));
});

test("plan text fallback reads the Focus Plan bullets and their dates", () => {
  const text = [
    "## Reflection", "You want a calmer way to raise missed deadlines.", "",
    "## Focus Plan",
    "- Book a 20-minute 1:1 with Sam, due: Mon 16 Nov",
    "- Agree one clear deadline and check-in point with Sam, owner: you, timeline: by Friday",
    "- Note what worked and adjust your approach, due: end of next week", "",
    "## First Step", "- Today, write the opening sentence you will use.", "",
    "Does this action plan work for you?"
  ].join("\n");
  const items = extractPlanItemsFromPlanText(text, SAT);
  assert.deepEqual(items.map((item) => [item.activity, item.dueDate]), [
    ["Book a 20-minute 1:1 with Sam", "2026-11-16"],
    ["Agree one clear deadline and check-in point with Sam", "2026-11-20"],
    ["Note what worked and adjust your approach", "2026-11-20"]
  ]);
});

// Minimal RFC 5545 reader used to parse the generated file back.
const parseIcs = (ics) => {
  assert.ok(ics.endsWith("\r\n"), "ends with CRLF");
  assert.ok(!/[^\r]\n/.test(ics), "every line break is CRLF");
  const rawLines = ics.slice(0, -2).split("\r\n");
  for (const line of rawLines) assert.ok(Buffer.byteLength(line, "utf8") <= 75, `line <= 75 octets: ${line}`);
  const lines = [];
  for (const line of rawLines) {
    if (line.startsWith(" ")) lines[lines.length - 1] += line.slice(1);
    else lines.push(line);
  }
  const root = { name: "ROOT", props: [], children: [] };
  const stack = [root];
  for (const line of lines) {
    const colon = line.indexOf(":");
    assert.ok(colon > 0, `property line: ${line}`);
    const left = line.slice(0, colon);
    const value = line.slice(colon + 1);
    const [name, ...params] = left.split(";");
    if (name === "BEGIN") {
      const node = { name: value, props: [], children: [] };
      stack[stack.length - 1].children.push(node);
      stack.push(node);
    } else if (name === "END") {
      assert.equal(stack.pop().name, value, `END:${value} matches BEGIN`);
    } else {
      stack[stack.length - 1].props.push({ name, params, value });
    }
  }
  assert.equal(stack.length, 1, "all components closed");
  assert.equal(root.children.length, 1);
  return root.children[0];
};
const prop = (node, name) => node.props.find((p) => p.name === name);

test(".ics: valid VCALENDAR with Europe/London VTIMEZONE, one VEVENT + VALARM per dated action", () => {
  const items = normalisePlanItems(
    [
      { activity: "Book a 1:1 with Sam; agree deadlines, then follow up", dateText: "next Friday" },
      { activity: "Share the summary with my director", dateText: "Monday at 10am for 45 minutes" },
      { activity: "Ask a peer for feedback" } // undated -> skipped
    ],
    SAT
  );
  const ics = buildPlanIcs(items, { now: new Date("2026-11-14T12:00:00Z") });
  const cal = parseIcs(ics);
  assert.equal(cal.name, "VCALENDAR");
  assert.equal(prop(cal, "VERSION").value, "2.0");
  assert.ok(prop(cal, "PRODID").value);
  assert.equal(prop(cal, "METHOD").value, "PUBLISH");
  const tz = cal.children.find((c) => c.name === "VTIMEZONE");
  assert.equal(prop(tz, "TZID").value, "Europe/London");
  assert.deepEqual(tz.children.map((c) => c.name).sort(), ["DAYLIGHT", "STANDARD"]);
  const events = cal.children.filter((c) => c.name === "VEVENT");
  assert.equal(events.length, 2);

  const [allDay, timed] = events;
  assert.deepEqual(prop(allDay, "DTSTART").params, ["VALUE=DATE"]);
  assert.equal(prop(allDay, "DTSTART").value, "20261120");
  assert.equal(prop(allDay, "DTEND").value, "20261121");
  assert.equal(prop(allDay, "SUMMARY").value, "Coaching action: Book a 1:1 with Sam\\; agree deadlines\\, then follow up");
  assert.match(prop(allDay, "DTSTAMP").value, /^\d{8}T\d{6}Z$/);
  assert.match(prop(allDay, "UID").value, /@agentic-coach$/);
  assert.deepEqual(prop(timed, "DTSTART").params, ["TZID=Europe/London"]);
  assert.equal(prop(timed, "DTSTART").value, "20261116T100000");
  assert.equal(prop(timed, "DTEND").value, "20261116T104500");
  assert.notEqual(prop(allDay, "UID").value, prop(timed, "UID").value);
  for (const event of events) {
    const alarm = event.children.find((c) => c.name === "VALARM");
    assert.ok(alarm, "VALARM present");
    assert.equal(prop(alarm, "ACTION").value, "DISPLAY");
    assert.ok(prop(alarm, "DESCRIPTION").value);
    assert.match(prop(alarm, "TRIGGER").value, /^-PT\d+[HM]$/);
  }
  assert.equal(prop(events[0].children[0], "TRIGGER").value, "-PT15H"); // 09:00 the day before an all-day action
  assert.equal(prop(events[1].children[0], "TRIGGER").value, "-PT30M");
});

test(".ics: long and non-ASCII text is folded and escaped correctly", () => {
  const activity = "Prepare a clear, calm opening for the conversation with Zoë about the café project; include \\ and two examples ".repeat(2).trim();
  const ics = buildPlanIcs(normalisePlanItems([{ activity, dateText: "tomorrow" }], SAT));
  const cal = parseIcs(ics);
  const summary = prop(cal.children.find((c) => c.name === "VEVENT"), "SUMMARY").value;
  const unescaped = summary.replace(/\\([\\;,nN])/g, (_, ch) => (ch.toLowerCase() === "n" ? "\n" : ch));
  assert.equal(unescaped, `Coaching action: ${activity.slice(0, 200).replace(/[\s,;:.-]+$/, "")}`);
});

test(".ics: invite form carries the attendee and REQUEST method", () => {
  const ics = buildPlanIcs([{ id: "a1", activity: "Send the update", dueDate: "2026-11-20", time: "09:30", durationMinutes: 30 }], {
    method: "REQUEST",
    attendeeEmail: "test.user@example.com",
    attendeeName: "Test User"
  });
  const cal = parseIcs(ics);
  assert.equal(prop(cal, "METHOD").value, "REQUEST");
  const attendee = prop(cal.children.find((c) => c.name === "VEVENT"), "ATTENDEE");
  assert.equal(attendee.value, "mailto:test.user@example.com");
});

test("Google Calendar link", () => {
  const allDay = new URL(googleCalendarUrl({ id: "a1", activity: "Book a 1:1", dueDate: "2026-11-20", time: null, durationMinutes: null }));
  assert.equal(allDay.hostname, "calendar.google.com");
  assert.equal(allDay.searchParams.get("action"), "TEMPLATE");
  assert.equal(allDay.searchParams.get("dates"), "20261120/20261121");
  assert.equal(allDay.searchParams.get("ctz"), "Europe/London");
  assert.equal(allDay.searchParams.get("text"), "Coaching action: Book a 1:1");
  const timed = new URL(googleCalendarUrl({ id: "a1", activity: "Call", dueDate: "2026-11-20", time: "23:30", durationMinutes: 60 }));
  assert.equal(timed.searchParams.get("dates"), "20261120T233000/20261121T003000");
  assert.equal(googleCalendarUrl({ id: "a1", activity: "x", dueDate: null, time: null, durationMinutes: null }), null);
});

test("recipient validation (server-side)", () => {
  for (const ok of ["asif@example.com", "first.last+coach@sub.example.co.uk", "o'brien@example.org"]) assert.equal(isValidRecipientEmail(ok), true, ok);
  for (const bad of [
    "", "plainaddress", "a@b", "a@b.c", "two@@example.com", "a@example.com, b@example.com", "a@example.com;b@example.com",
    "Name <a@example.com>", "a@example.com\r\nBcc: x@evil.com", " a b@example.com", ".a@example.com", "a..b@example.com",
    "a@-example.com", "a@example..com", `${"x".repeat(65)}@example.com`, 42, null
  ]) assert.equal(isValidRecipientEmail(bad), false, String(bad));
  assert.equal(isRecipientAllowed("a@company.com", ""), true);
  assert.equal(isRecipientAllowed("a@company.com", "company.com, partner.co.uk"), true);
  assert.equal(isRecipientAllowed("a@team.company.com", "company.com"), true);
  assert.equal(isRecipientAllowed("a@gmail.com", "company.com"), false);
  assert.equal(isRecipientAllowed("a@evilcompany.com", "company.com"), false);
});
