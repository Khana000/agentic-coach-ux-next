// Run with: npm run test:boundary   (Node 22.18+ / 24, which can import .ts files directly)
// Safety replies (crisis, HR referral, medical) must never feed the Action Hub import or transcript extraction.
import { test } from "node:test";
import assert from "node:assert/strict";
import { BOUNDARY_MARKER, CLINICAL_REPLY, CONDUCT_MARKER, CONDUCT_REPLY, RISK_REPLY } from "../lib/server/boundary.ts";
import {
  SAFETY_BOUNDARY_MARKER,
  SAFETY_CONDUCT_MARKER,
  isSafetyKind,
  isSafetyReplyMessage,
  looksLikeSafetyReply
} from "../lib/safety-reply.ts";

const COACHING_PLAN = [
  "Here's a focused plan for the next two weeks:",
  "",
  "1. Book a 20-minute check-in with Sam on Monday to agree the deadline.",
  "2. Share a one-page summary of the project status with your director by Friday.",
  "3. Ask one peer for feedback on your update style after the next stand-up.",
  "",
  "Does this action plan work for you?"
].join("\n");

// Real voice-agent replies captured from the ElevenLabs tests on 14 Nov 2026 (no flag is available for voice).
const VOICE = {
  conduct:
    "Thank you for telling me. Nobody should be treated that way at work. This needs to be raised with HR or your People team, or a manager you trust. I can't investigate what happened or give legal advice, but I can help you prepare for that conversation. Would you like help preparing?",
  risk:
    "Thank you for telling me this. I hear you. I'm not a medical or therapy service, so I can't provide that kind of help. Samaritans: call 116 123, free, 24/7. Is there someone you can contact right now?",
  clinical:
    "Thank you for sharing that with me. I'm not a medical or therapy service, so I can't diagnose, or advise on treatment or medication. For advice today, contact your GP or NHS 111."
};

test("markers stay in step with the server boundary replies", () => {
  assert.equal(SAFETY_BOUNDARY_MARKER, BOUNDARY_MARKER);
  assert.equal(SAFETY_CONDUCT_MARKER, CONDUCT_MARKER);
});

test("flagged assistant messages are safety replies, whatever the text", () => {
  for (const kind of ["risk", "conduct", "clinical"]) {
    assert.equal(isSafetyKind(kind), true);
    assert.equal(isSafetyReplyMessage({ role: "assistant", content: "anything", safety: kind }), true, kind);
  }
  assert.equal(isSafetyKind("other"), false);
  assert.equal(isSafetyReplyMessage({ role: "assistant", content: COACHING_PLAN, safety: "other" }), false);
});

test("the three fixed text replies are recognised even without a flag", () => {
  for (const [name, text] of Object.entries({ RISK_REPLY, CONDUCT_REPLY, CLINICAL_REPLY })) {
    assert.equal(looksLikeSafetyReply(text), true, name);
    assert.equal(isSafetyReplyMessage({ role: "assistant", content: text }), true, name);
  }
});

test("voice-agent safety replies are recognised by the text fallback", () => {
  for (const [kind, text] of Object.entries(VOICE)) assert.equal(looksLikeSafetyReply(text), true, kind);
  // Curly apostrophes, as transcripts sometimes have them.
  assert.equal(looksLikeSafetyReply("I\u2019m not a medical or therapy service, so please call NHS 111."), true);
  // Crisis signposting with Samaritans and its number, without the opener.
  assert.equal(looksLikeSafetyReply("Please call Samaritans on 116 123, free, any time."), true);
});

test("ordinary coaching replies are not safety replies", () => {
  const normal = [
    COACHING_PLAN,
    "It sounds like you're navigating a challenging dynamic with your manager's blunt feedback. What outcome would you like?",
    "Before you speak to HR about the restructure, list the three questions you most want answered.",
    "Samaritans-style listening is a great model: give your full attention and don't rush to fix.",
    "I can't tell you what your director is thinking, but we can plan how to ask.",
    "That's a great medical-device launch plan. What's the first milestone?"
  ];
  for (const text of normal) {
    assert.equal(looksLikeSafetyReply(text), false, text);
    assert.equal(isSafetyReplyMessage({ role: "assistant", content: text }), false, text);
  }
});

test("user messages are never treated as safety replies", () => {
  assert.equal(isSafetyReplyMessage({ role: "user", content: RISK_REPLY }), false);
  assert.equal(isSafetyReplyMessage({ role: "user", content: "x", safety: "risk" }), false);
});

test("mixed conversation: coaching messages stay importable, safety replies are left out", () => {
  const conversation = [
    { role: "assistant", content: "Welcome. What outcome would make this coaching session most valuable?" },
    { role: "user", content: "I am being bullied by a colleague." },
    { role: "assistant", content: CONDUCT_REPLY, safety: "conduct" },
    { role: "user", content: "Thanks. Can we also plan my project update?" },
    { role: "assistant", content: COACHING_PLAN },
    { role: "user", content: "I've had chest pains at work." },
    { role: "assistant", content: VOICE.clinical }, // voice turn, no flag
    { role: "user", content: "I don't want to be alive anymore." },
    { role: "assistant", content: RISK_REPLY, safety: "risk" }
  ];
  const importable = conversation.filter((m) => m.role === "assistant" && !isSafetyReplyMessage(m));
  assert.deepEqual(
    importable.map((m) => m.content),
    [conversation[0].content, COACHING_PLAN]
  );
  const joined = importable.map((m) => m.content).join("\n");
  for (const leaked of ["Acas", "116 123", "NHS 111", "speak-up", "GP"]) assert.equal(joined.includes(leaked), false, leaked);
});
