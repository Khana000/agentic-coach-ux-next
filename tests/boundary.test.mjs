// Run with: npm run test:boundary   (Node 22.18+ / 24, which can import .ts files directly)
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  BOUNDARY_MARKER,
  CLINICAL_REPLY,
  RISK_REPLY,
  detectBoundary,
  getBoundaryReply
} from "../lib/server/boundary.ts";

const RISK = [
  "Honestly, work has got so bad that I've been thinking about hurting myself.",
  "Sometimes I feel like I don't want to be alive anymore.",
  "I've had suicidal thoughts since the restructure.",
  "I keep thinking everyone would be better off without me.",
  "I want to end my life.",
  "I've been self-harming again."
];
const CLINICAL = [
  "I've been getting chest pains and dizzy spells at work. What do you think is causing it, and should I take something for it?",
  "I've been feeling really depressed and anxious for weeks. Can you diagnose me?",
  "I think I need therapy or medication.",
  "I keep having panic attacks before meetings.",
  "My therapist and I talk about this a lot.",
  "Should I stop taking my antidepressants?"
];
const COACHING = [
  "I want to get better at giving feedback to a team member who keeps missing deadlines.",
  "Help me diagnose the problem with my team's handover process.",
  "I need to cut myself some slack this week.",
  "What are the symptoms of a disengaged team?",
  "I'm anxious about my presentation tomorrow.",
  "We give the field team tablets for data entry.",
  "Can you help me set boundaries with my manager?",
  "Let's end the session."
];

test("risk messages are detected as risk", () => {
  for (const text of RISK) assert.equal(detectBoundary(text), "risk", text);
});
test("medical / therapy messages are detected as clinical", () => {
  for (const text of CLINICAL) assert.equal(detectBoundary(text), "clinical", text);
});
test("ordinary coaching messages are not flagged", () => {
  for (const text of COACHING) assert.equal(detectBoundary(text), null, text);
});

test("risk reply escalates urgently and says it is not a therapy service", () => {
  assert.ok(RISK_REPLY.includes(BOUNDARY_MARKER));
  for (const needle of ["999", "A&E", "116 123", "Samaritans", "NHS 111", "85258"]) assert.ok(RISK_REPLY.includes(needle), needle);
});
test("clinical reply signposts GP / NHS 111 / EAP and offers work-related coaching", () => {
  assert.ok(CLINICAL_REPLY.includes(BOUNDARY_MARKER));
  for (const needle of ["GP", "NHS 111", "Employee Assistance Programme", "116 123", "work side"]) assert.ok(CLINICAL_REPLY.includes(needle), needle);
  assert.match(CLINICAL_REPLY, /can't diagnose/);
});

test("clinical boundary is shown once per conversation, then coaching can continue", () => {
  assert.equal(getBoundaryReply(CLINICAL[1], [])?.kind, "clinical");
  assert.equal(getBoundaryReply(CLINICAL[4], [CLINICAL_REPLY]), null);
});
test("risk boundary is shown every time, even after earlier signposting", () => {
  assert.equal(getBoundaryReply(RISK[0], [CLINICAL_REPLY, RISK_REPLY])?.kind, "risk");
});
test("no boundary reply for normal coaching", () => {
  assert.equal(getBoundaryReply(COACHING[0], []), null);
});
