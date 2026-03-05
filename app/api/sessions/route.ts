import { NextResponse } from "next/server";
import clientPromise from "../../../lib/mongodb";

const COLLECTION = "sessions";
const DB_NAME = process.env.MONGO_DB_NAME ?? "coaching";

type SessionMessage = {
  role: "user" | "assistant";
  content: string;
};

type SessionSummary = {
  bullets?: string[];
  insights?: string[];
  actions?: Array<{
    title: string;
    when?: string;
    confidence?: "low" | "medium" | "high";
  }>;
};

type SessionPayload = {
  title?: string;
  context?: string;
  style?: string;
  nowState?: Record<string, string>;
  messages?: SessionMessage[];
  summary?: SessionSummary;
};

const isPlainObject = (value: unknown): value is Record<string, unknown> =>
  Boolean(value) && typeof value === "object" && !Array.isArray(value);

const sanitizeMessages = (raw: unknown): SessionMessage[] => {
  if (!Array.isArray(raw)) {
    return [];
  }

  return raw
    .filter(
      (message): message is SessionMessage =>
        Boolean(message) &&
        (message as SessionMessage).role !== undefined &&
        (message as SessionMessage).content !== undefined
    )
    .map((message) => ({
      role: (message.role === "assistant" ? "assistant" : "user") as "user" | "assistant",
      content: String(message.content ?? "").trim()
    }))
    .filter((message) => message.content.length > 0);
};

const buildTitle = (payload: SessionPayload, messages: SessionMessage[]) => {
  if (payload.title && payload.title.trim()) {
    return payload.title.trim().slice(0, 120);
  }
  const firstUser = messages.find((message) => message.role === "user");
  if (firstUser?.content) {
    return firstUser.content.slice(0, 120);
  }
  return "Coaching session";
};

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const limitParam = Number(searchParams.get("limit") ?? 20);
    const limit = Number.isFinite(limitParam) ? Math.min(Math.max(limitParam, 1), 100) : 20;

    const client = await clientPromise;
    const db = client.db(DB_NAME);
    const sessions = await db
      .collection(COLLECTION)
      .find({})
      .sort({ createdAt: -1 })
      .limit(limit)
      .toArray();

    return NextResponse.json({
      sessions: sessions.map(({ _id, ...session }) => ({
        id: _id.toString(),
        ...session
      }))
    });
  } catch (error) {
    return NextResponse.json({
      sessions: [],
      warning: "Session storage is temporarily unavailable."
    });
  }
}

export async function POST(request: Request) {
  let payload: SessionPayload;
  try {
    payload = (await request.json()) as SessionPayload;
  } catch (error) {
    return NextResponse.json({ error: "Invalid JSON payload." }, { status: 400 });
  }

  const messages = sanitizeMessages(payload.messages);
  const title = buildTitle(payload, messages);
  const nowState = isPlainObject(payload.nowState) ? payload.nowState : undefined;
  const summary = isPlainObject(payload.summary) ? (payload.summary as SessionSummary) : undefined;

  const now = new Date();
  const session = {
    title,
    context: typeof payload.context === "string" ? payload.context : undefined,
    style: typeof payload.style === "string" ? payload.style : undefined,
    nowState,
    messages,
    summary,
    createdAt: now,
    updatedAt: now
  };

  try {
    const client = await clientPromise;
    const db = client.db(DB_NAME);
    const result = await db.collection(COLLECTION).insertOne(session);

    return NextResponse.json({
      id: result.insertedId.toString(),
      ...session
    });
  } catch (error) {
    return NextResponse.json({
      id: `fallback-${Date.now()}`,
      ...session,
      warning: "Session was not persisted because storage is temporarily unavailable."
    });
  }
}
