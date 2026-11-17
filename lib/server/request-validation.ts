/** Shared request limits, applied before model calls or database writes. */
export const MAX_MESSAGE_CHARS = 10_000;
export const MAX_CONVERSATION_CHARS = 50_000;
export const MAX_MESSAGES = 100;
export const MAX_BODY_BYTES = 256 * 1024;

export const isRecord = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === "object" && !Array.isArray(value);

export const invalidInput = (error = "Please check the information you sent.", status = 400) =>
  Response.json({ error, code: status === 413 ? "payload_too_large" : "invalid_payload" }, { status });

export async function readObject(request: Request): Promise<{
  data?: Record<string, unknown>; response?: Response;
}> {
  if (Number(request.headers.get("content-length")) > MAX_BODY_BYTES) {
    return { response: invalidInput("This request is too large. Please shorten it.", 413) };
  }
  const reader = request.body?.getReader();
  if (!reader) return { response: invalidInput("Send a JSON object.") };
  let bytes = 0;
  let text = "";
  const decoder = new TextDecoder();
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      bytes += value.byteLength;
      if (bytes > MAX_BODY_BYTES) {
        await reader.cancel();
        return { response: invalidInput("This request is too large. Please shorten it.", 413) };
      }
      text += decoder.decode(value, { stream: true });
    }
    const data: unknown = JSON.parse(text + decoder.decode());
    return isRecord(data) ? { data } : { response: invalidInput("Send a JSON object.") };
  } catch {
    return { response: invalidInput("Invalid JSON payload.") };
  } finally {
    reader.releaseLock();
  }
}

export function validateStrings(data: Record<string, unknown>, fields: string[]): Response | null {
  for (const field of fields) {
    if (data[field] !== undefined && typeof data[field] !== "string") {
      return invalidInput(`${field} must be text.`);
    }
    if (typeof data[field] === "string" && (data[field] as string).length > MAX_MESSAGE_CHARS) {
      return invalidInput(`${field} is too long. Use at most ${MAX_MESSAGE_CHARS} characters.`, 413);
    }
  }
  return null;
}

export function validateMessages(messages: unknown): Response | null {
  if (!Array.isArray(messages) || messages.length === 0) return invalidInput("Send at least one chat message.");
  if (messages.length > MAX_MESSAGES) return invalidInput(`Send at most ${MAX_MESSAGES} messages.`, 413);
  let total = 0;
  for (const message of messages) {
    if (!isRecord(message) || (message.role !== "user" && message.role !== "assistant") ||
        typeof message.content !== "string" || !message.content.trim()) {
      return invalidInput("Each message needs a user or assistant role and non-empty text.");
    }
    total += message.content.length;
    if (message.content.length > MAX_MESSAGE_CHARS || total > MAX_CONVERSATION_CHARS) {
      return invalidInput(`Please shorten your conversation. Each message may contain at most ${MAX_MESSAGE_CHARS} characters.`, 413);
    }
  }
  return null;
}
