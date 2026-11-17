/** Per-message / per-prompt character cap (D9). */
export const MAX_TEXT_CHARS = 8_000;
/** Total JSON body cap, including overhead around messages. */
export const MAX_JSON_BODY_BYTES = 100_000;

const SAFETY_KINDS = new Set(["risk", "conduct", "clinical"]);

export type RequestFailure = { ok: false; error: string; status: number };
export type ChatMessage = { role: "user" | "assistant"; content: string };
export type SessionMessage = ChatMessage & { safety?: "risk" | "conduct" | "clinical" };

export const isPlainObject = (value: unknown): value is Record<string, unknown> =>
  Boolean(value) && typeof value === "object" && !Array.isArray(value);

const fail = (status: number, error: string): RequestFailure => ({ ok: false, error, status });

/** Flatten a failed request result (strict mode is off, so unions are not narrowed by `if (!ok)`). */
export const errorPayload = (
  result: RequestFailure | { ok: true; [key: string]: unknown }
): { error: string; status: number } | null =>
  result.ok ? null : { error: (result as RequestFailure).error, status: (result as RequestFailure).status };

/** After a failed result has already been returned, read the success fields. */
export const successOf = <T>(result: ({ ok: true } & T) | RequestFailure): T => result as T;



/** Parse a raw request body as a JSON object. Rejects null, arrays, primitives and invalid JSON. */
export const parseJsonObject = (
  raw: string
): { ok: true; value: Record<string, unknown> } | RequestFailure => {
  let parsed: unknown;
  try {
    parsed = String(raw ?? "").trim() ? JSON.parse(raw) : null;
  } catch {
    return fail(400, "Invalid JSON payload.");
  }
  if (!isPlainObject(parsed)) {
    return fail(400, "Request body must be a JSON object.");
  }
  return { ok: true, value: parsed };
};

/** Read and validate a JSON object body, including a total size cap. */
export const readJsonBody = async (
  request: Request
): Promise<{ ok: true; value: Record<string, unknown> } | RequestFailure> => {
  const contentLength = request.headers.get("content-length");
  if (contentLength) {
    const length = Number(contentLength);
    if (Number.isFinite(length) && length > MAX_JSON_BODY_BYTES) {
      return fail(413, "Request body is too large.");
    }
  }

  let raw: string;
  try {
    raw = await request.text();
  } catch {
    return fail(400, "Invalid JSON payload.");
  }

  if (Buffer.byteLength(raw, "utf8") > MAX_JSON_BODY_BYTES) {
    return fail(413, "Request body is too large.");
  }

  return parseJsonObject(raw);
};

const readStringContent = (
  record: Record<string, unknown>,
  label: string
): { ok: true; content: string } | RequestFailure => {
  if (typeof record.content !== "string") {
    return fail(400, `Each ${label} must have string content.`);
  }
  if (record.content.length > MAX_TEXT_CHARS) {
    return fail(413, `${label.charAt(0).toUpperCase()}${label.slice(1)} is too long.`);
  }
  return { ok: true, content: record.content.trim() };
};

export const parseChatMessages = (
  raw: unknown
): { ok: true; messages: ChatMessage[] } | RequestFailure => {
  if (raw === undefined) {
    return fail(400, "Missing chat messages.");
  }
  if (!Array.isArray(raw)) {
    return fail(400, "Chat messages must be an array.");
  }

  const messages: ChatMessage[] = [];
  let totalChars = 0;
  for (const entry of raw) {
    if (!isPlainObject(entry)) {
      return fail(400, "Each chat message must be an object with string content.");
    }
    const content = readStringContent(entry, "chat message");
    const contentError = errorPayload(content);
    if (contentError) return fail(contentError.status, contentError.error);
    const text = successOf(content).content;
    totalChars += typeof entry.content === "string" ? entry.content.length : 0;
    if (totalChars > MAX_JSON_BODY_BYTES) {
      return fail(413, "Chat messages are too large.");
    }
    if (!text) continue;
    if (entry.role !== "user" && entry.role !== "assistant") {
      return fail(400, "Each chat message must have a user or assistant role.");
    }
    messages.push({ role: entry.role, content: text });
  }

  if (messages.length === 0) {
    return fail(400, "Missing chat messages.");
  }
  return { ok: true, messages };
};

export const parsePrompt = (raw: unknown): { ok: true; prompt: string } | RequestFailure => {
  if (raw === undefined || raw === "") {
    return fail(400, "Missing prompt text.");
  }
  if (typeof raw !== "string") {
    return fail(400, "Prompt must be a string.");
  }
  if (raw.length > MAX_TEXT_CHARS) {
    return fail(413, "Prompt is too long.");
  }
  const prompt = raw.trim();
  if (!prompt) {
    return fail(400, "Missing prompt text.");
  }
  return { ok: true, prompt };
};

export const parseSessionMessages = (
  raw: unknown,
  options: { required?: boolean } = {}
): { ok: true; messages: SessionMessage[] } | RequestFailure => {
  const required = options.required !== false;
  if (raw === undefined) {
    if (!required) return { ok: true, messages: [] };
    return fail(400, "Session messages are required.");
  }
  if (!Array.isArray(raw)) {
    return fail(400, "Session messages must be an array.");
  }

  const messages: SessionMessage[] = [];
  let totalChars = 0;
  for (const entry of raw) {
    if (!isPlainObject(entry)) {
      return fail(400, "Each session message must be an object with string content.");
    }
    const content = readStringContent(entry, "session message");
    const contentError = errorPayload(content);
    if (contentError) return fail(contentError.status, contentError.error);
    const text = successOf(content).content;
    totalChars += typeof entry.content === "string" ? entry.content.length : 0;
    if (totalChars > MAX_JSON_BODY_BYTES) {
      return fail(413, "Session messages are too large.");
    }
    if (!text) continue;
    if (entry.role !== "user" && entry.role !== "assistant") {
      return fail(400, "Each session message must have a user or assistant role.");
    }
    const role = entry.role;
    messages.push(
      role === "assistant" && SAFETY_KINDS.has(String(entry.safety))
        ? { role, content: text, safety: entry.safety as SessionMessage["safety"] }
        : { role, content: text }
    );
  }

  if (required && messages.length === 0) {
    return fail(400, "Session messages are required.");
  }
  return { ok: true, messages };
};

export const asOptionalString = (
  raw: unknown,
  field: string,
  max = MAX_TEXT_CHARS
): { ok: true; value: string | undefined } | RequestFailure => {
  if (raw === undefined) return { ok: true, value: undefined };
  if (typeof raw !== "string") {
    return fail(400, `${field} must be a string.`);
  }
  if (raw.length > max) {
    return fail(413, `${field} is too long.`);
  }
  return { ok: true, value: raw };
};
