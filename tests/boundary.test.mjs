// Run with: npm run test:boundary   (Node 22.18+ / 24, which can import .ts files directly)
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  BOUNDARY_MARKER,
  CLINICAL_REPLY,
  RISK_REPLY,
  detectBoundary,
  getBoundaryReply,
  normaliseForBoundary
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

// Indirect / passive suicidal ideation: must get the urgent crisis reply every time.
const INDIRECT_RISK = [
  "Everyone would be fine if I just disappeared.",
  "Lately I feel like there's no point to anything and everyone would be fine if I just disappeared.",
  "I've started giving my things away.",
  "I've been giving away my stuff to friends this week.",
  "Life would be easier for everyone if I wasn\u2019t here.",
  "No one would even notice if I was gone.",
  "My family would be happier without me.",
  "I just want to disappear forever.",
  "I feel like such a burden to everyone.",
  "I'm just a burden on my family.",
  "There's no way out.",
  "I can\u2019t see a way out of this.",
  "I cant go on anymore.",
  "What's the point of living?",
  "There is no point in going on.",
  "I wrote goodbye letters to my kids last night.",
  "I've been saying goodbye to the people I love.",
  "Sometimes I wish I could go to sleep and not wake up.",
  "I hope I don't wake up tomorrow.",
  "I've been stockpiling my tablets.",
  "I have a plan to end it all.",
  "I've worked out how I would kill myself.",
  "I keep thinking about jumping off a bridge.",
  "I wish I was dead.",
  "I'm tired of being alive.",
  "I don't see a future for myself anymore.",
  "I won't be around much longer.",
  "I want to die.",
  "IM SO TIRED, EVERYONE'D BE BETTER OFF WITHOUT ME",
  "I have the means to end my life.",
  "I've given away most of my possessions.",
  "I feel like I'm done with life.",
  "I can't keep living like this.",
  "I just want it all to stop.",
  "I don\u2019t think I can do this anymore, everyone would be better off."
];

// Ordinary work phrases that must NOT trigger the crisis reply (or any boundary reply).
const WORK_NEGATIVES = [
  "I want to disappear from this meeting.",
  "The project is dead.",
  "I'm killing it at work.",
  "We're giving away tickets to the conference.",
  "There's no point in this meeting.",
  "The deadline is killing me.",
  "I wish I could disappear for a week on holiday.",
  "I want to vanish into the background in big meetings.",
  "I feel like a burden has been lifted now the launch is done.",
  "The admin burden on my team is too high.",
  "I'm saying goodbye to everyone at my leaving do on Friday.",
  "I'm writing a farewell message for a colleague who's leaving.",
  "There's no way out of the contract until March.",
  "I can't go on with this project unless we get more budget.",
  "I could sleep for a week after this release.",
  "I never wake up on time for the 8am stand-up.",
  "My plan is to end the meeting early.",
  "We need a plan for how to end the pilot.",
  "I've been collecting feedback from my team.",
  "I need to give away some of my responsibilities.",
  "This idea is dead in the water.",
  "I'm dying to get that promotion.",
  "My laptop died again during the demo.",
  "I'm tired of living out of a suitcase for work travel.",
  "No one would notice if I left the meeting early.",
  "Everyone would be fine without me in the Friday meeting.",
  "I won't be around much longer at this company, I've handed in my notice.",
  "I can't see a way out of this restructure.",
  "What's the point of this report if nobody reads it?",
  "I don't see a future for me at this company.",
  "I'm tired of life admin.",
  "Our team is better off without the old process.",
  "I want to disappear under my desk when the CEO walks in.",
  "We're saying goodbye to the legacy system.",
  "I'd rather die than present to the board.",
  "I can't go on leave until the audit is done.",
  "I want all these meetings to stop."
];

test("indirect / passive suicidal ideation is detected as risk", () => {
  for (const text of INDIRECT_RISK) assert.equal(detectBoundary(text), "risk", text);
});
test("work figures of speech are not flagged", () => {
  for (const text of WORK_NEGATIVES) assert.equal(detectBoundary(text), null, text);
});
test("indirect risk gets the urgent crisis reply every time", () => {
  for (const text of INDIRECT_RISK) {
    const reply = getBoundaryReply(text, [RISK_REPLY, CLINICAL_REPLY]);
    assert.equal(reply?.kind, "risk", text);
    assert.equal(reply?.text, RISK_REPLY);
  }
});
test("normalisation handles case, curly apostrophes and contractions", () => {
  assert.equal(normaliseForBoundary("I\u2019m  FINE, I can\u2019t, won't, wasn't"), "i am fine, i cannot, will not, was not");
  assert.equal(normaliseForBoundary("im ok, dont worry, cant stop, ive got it"), "i am ok, do not worry, cannot stop, i have got it");
  assert.equal(normaliseForBoundary("Everyone\u2019d be fine"), "everyone would be fine");
});
