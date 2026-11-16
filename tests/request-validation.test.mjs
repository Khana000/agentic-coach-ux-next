// Run with: npm run test:boundary
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  MAX_TEXT_CHARS,
  parseChatMessages,
  parseJsonObject,
  parsePrompt,
  parseSessionMessages
} from "../lib/server/request-validation.ts";

test("parseJsonObject rejects null, primitives, arrays and invalid JSON", () => {
  assert.equal(parseJsonObject("null").ok, false);
  assert.equal(parseJsonObject("null").status, 400);
  assert.match(parseJsonObject("null").error, /JSON object/);
  assert.equal(parseJsonObject('"bad"').status, 400);
  assert.equal(parseJsonObject("42").status, 400);
  assert.equal(parseJsonObject("[]").status, 400);
  assert.equal(parseJsonObject("{not-json").status, 400);
  assert.equal(parseJsonObject("{not-json").error, "Invalid JSON payload.");
  assert.equal(parseJsonObject("").status, 400);
  assert.deepEqual(parseJsonObject('{"a":1}'), { ok: true, value: { a: 1 } });
});

test("parseChatMessages requires an array of messages with string content", () => {
  assert.equal(parseChatMessages(undefined).error, "Missing chat messages.");
  assert.equal(parseChatMessages("bad").error, "Chat messages must be an array.");
  assert.equal(parseChatMessages([]).error, "Missing chat messages.");
  assert.equal(parseChatMessages([{ role: "user", content: 42 }]).error, "Each chat message must have string content.");
  assert.equal(parseChatMessages([{ role: "user", content: 42 }]).status, 400);
  assert.equal(parseChatMessages([{ role: "user", content: "A".repeat(MAX_TEXT_CHARS + 1) }]).status, 413);
  const ok = parseChatMessages([{ role: "user", content: "  Hello  " }]);
  assert.equal(ok.ok, true);
  assert.deepEqual(ok.messages, [{ role: "user", content: "Hello" }]);
});

test("parsePrompt requires a non-empty string and caps length", () => {
  assert.equal(parsePrompt(undefined).error, "Missing prompt text.");
  assert.equal(parsePrompt({}).error, "Prompt must be a string.");
  assert.equal(parsePrompt(42).error, "Prompt must be a string.");
  assert.equal(parsePrompt("").error, "Missing prompt text.");
  assert.equal(parsePrompt("   ").error, "Missing prompt text.");
  assert.equal(parsePrompt("A".repeat(MAX_TEXT_CHARS + 1)).status, 413);
  assert.deepEqual(parsePrompt("  Focus  "), { ok: true, prompt: "Focus" });
});

test("parseSessionMessages rejects empty or invalid session payloads", () => {
  assert.equal(parseSessionMessages(undefined).error, "Session messages are required.");
  assert.equal(parseSessionMessages("bad").error, "Session messages must be an array.");
  assert.equal(parseSessionMessages([]).error, "Session messages are required.");
  assert.equal(parseSessionMessages([{ role: "user", content: 42 }]).error, "Each session message must have string content.");
  const ok = parseSessionMessages([{ role: "user", content: "Plan the update" }]);
  assert.equal(ok.ok, true);
  assert.equal(ok.messages[0].content, "Plan the update");
  const optional = parseSessionMessages(undefined, { required: false });
  assert.deepEqual(optional, { ok: true, messages: [] });
});
