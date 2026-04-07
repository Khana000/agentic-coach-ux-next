import { NextResponse } from "next/server";
import { ObjectId } from "mongodb";
import getMongoClient from "../../../../lib/mongodb";

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

const toObjectId = (id: string) => (ObjectId.isValid(id) ? new ObjectId(id) : null);

export async function GET(_request: Request, { params }: { params: { id: string } }) {
  try {
    const objectId = toObjectId(params.id);
    if (!objectId) {
      return NextResponse.json({ error: "Invalid session id." }, { status: 400 });
    }

    const client = await getMongoClient();
    const db = client.db(DB_NAME);
    const session = await db.collection(COLLECTION).findOne({ _id: objectId });

    if (!session) {
      return NextResponse.json({ error: "Session not found." }, { status: 404 });
    }

    const { _id, ...rest } = session;
    return NextResponse.json({
      id: _id.toString(),
      ...rest
    });
  } catch (error) {
    return NextResponse.json({ error: "Unable to load session." }, { status: 500 });
  }
}

export async function PATCH(request: Request, { params }: { params: { id: string } }) {
  try {
    const objectId = toObjectId(params.id);
    if (!objectId) {
      return NextResponse.json({ error: "Invalid session id." }, { status: 400 });
    }

    let payload: Record<string, unknown>;
    try {
      payload = (await request.json()) as Record<string, unknown>;
    } catch (error) {
      return NextResponse.json({ error: "Invalid JSON payload." }, { status: 400 });
    }

    const updates: Record<string, unknown> = {};

    if (typeof payload.title === "string" && payload.title.trim()) {
      updates.title = payload.title.trim().slice(0, 120);
    }
    if (typeof payload.context === "string") {
      updates.context = payload.context;
    }
    if (typeof payload.style === "string") {
      updates.style = payload.style;
    }
    if (isPlainObject(payload.nowState)) {
      updates.nowState = payload.nowState;
    }
    if (payload.messages !== undefined) {
      updates.messages = sanitizeMessages(payload.messages);
    }
    if (isPlainObject(payload.summary)) {
      updates.summary = payload.summary as SessionSummary;
    }

    if (Object.keys(updates).length === 0) {
      return NextResponse.json({ error: "No valid fields to update." }, { status: 400 });
    }

    updates.updatedAt = new Date();

    const client = await getMongoClient();
    const db = client.db(DB_NAME);
    const result = await db
      .collection(COLLECTION)
      .findOneAndUpdate({ _id: objectId }, { $set: updates }, { returnDocument: "after" });

    // MongoDB v6 returns the document directly unless includeResultMetadata=true.
    const updatedSession = ((result as unknown as { value?: Record<string, unknown> | null })?.value ??
      result) as ({ _id: ObjectId } & Record<string, unknown>) | null;

    if (!updatedSession) {
      return NextResponse.json({ error: "Session not found." }, { status: 404 });
    }

    const { _id, ...rest } = updatedSession;
    return NextResponse.json({
      id: _id.toString(),
      ...rest
    });
  } catch (error) {
    return NextResponse.json({ error: "Unable to update session." }, { status: 500 });
  }
}

export async function DELETE(_request: Request, { params }: { params: { id: string } }) {
  try {
    const objectId = toObjectId(params.id);
    if (!objectId) {
      return NextResponse.json({ error: "Invalid session id." }, { status: 400 });
    }

    const client = await getMongoClient();
    const db = client.db(DB_NAME);
    const result = await db.collection(COLLECTION).deleteOne({ _id: objectId });

    if (!result.deletedCount) {
      return NextResponse.json({ error: "Session not found." }, { status: 404 });
    }

    return NextResponse.json({ ok: true });
  } catch (error) {
    return NextResponse.json({ error: "Unable to delete session." }, { status: 500 });
  }
}
