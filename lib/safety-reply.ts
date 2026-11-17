// Shared (client + server) helpers for recognising safety replies: the fixed crisis/self-harm ("risk"),
// HR referral ("conduct") and medical/therapy ("clinical") boundary replies.
// Safety replies are never coaching content, so their bullets (helplines, HR, GP...) must not be offered
// as Action Hub actions or swept into transcript action extraction.
//
// Primary signal: the `boundary` kind the chat API returns with every boundary reply, stored on the message
// as `safety`. Fallback (no flag available): voice-agent replies, which follow the same safety rules in the
// ElevenLabs prompt, and older restored transcripts. These are recognised by the fixed phrases both the text
// replies and the voice prompt use. Keep the two markers in step with lib/server/boundary.ts
// (tests/boundary.test.mjs checks they match).

export type SafetyKind = "risk" | "conduct" | "clinical";

export const SAFETY_BOUNDARY_MARKER = "I'm not a medical or therapy service";
export const SAFETY_CONDUCT_MARKER = "I can't investigate what happened or give legal advice";

export const isSafetyKind = (value: unknown): value is SafetyKind =>
  value === "risk" || value === "conduct" || value === "clinical";

const normalise = (text: string) =>
  text
    .replace(/[\u2018\u2019\u02bc]/g, "'")
    .replace(/\s+/g, " ")
    .toLowerCase();

const MARKERS = [SAFETY_BOUNDARY_MARKER, SAFETY_CONDUCT_MARKER].map(normalise);

/** True when the text reads as one of the fixed safety replies (used when no explicit flag is present). */
export const looksLikeSafetyReply = (text: string): boolean => {
  const value = normalise(String(text ?? ""));
  if (!value) return false;
  if (MARKERS.some((marker) => value.includes(marker))) return true;
  // UK crisis signposting (voice replies may paraphrase the opener but always give these).
  return /\bsamaritans\b/.test(value) && /116 ?123/.test(value);
};

/** True for an assistant message that is a safety reply (explicit flag first, then the text fallback). */
export const isSafetyReplyMessage = (message: { role?: string; content?: string; safety?: unknown }): boolean =>
  Boolean(message) &&
  message.role === "assistant" &&
  (isSafetyKind(message.safety) || looksLikeSafetyReply(message.content ?? ""));
