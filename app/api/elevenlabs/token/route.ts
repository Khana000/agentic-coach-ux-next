import { NextResponse } from "next/server";

const DEFAULT_AGENT_ID = "agent_2301kj5gk2bkezts94y36e0tzxza";

export async function GET(request: Request) {
  const url = new URL(request.url);
  const agentId =
    url.searchParams.get("agentId")?.trim() ||
    process.env.ELEVENLABS_AGENT_ID?.trim() ||
    process.env.NEXT_PUBLIC_ELEVENLABS_AGENT_ID?.trim() ||
    DEFAULT_AGENT_ID;

  if (!agentId) {
    return NextResponse.json({ error: "Missing ElevenLabs agent ID." }, { status: 400 });
  }

  const apiKey = process.env.ELEVENLABS_API_KEY?.trim() ?? "";
  if (!apiKey) {
    // Keep route healthy for public-agent fallback in the client.
    return NextResponse.json({
      token: "",
      agentId,
      warning: "ELEVENLABS_API_KEY is not configured; using direct public agent connection."
    });
  }

  try {
    const response = await fetch(
      `https://api.elevenlabs.io/v1/convai/conversation/token?agent_id=${encodeURIComponent(agentId)}`,
      {
        method: "GET",
        headers: {
          "xi-api-key": apiKey,
          Accept: "application/json"
        },
        cache: "no-store"
      }
    );

    const payload = await response.json().catch(() => ({}));

    if (!response.ok) {
      return NextResponse.json(
        {
          error: "Unable to create ElevenLabs conversation token.",
          details: payload
        },
        { status: response.status }
      );
    }

    const token = typeof payload?.token === "string" ? payload.token : "";
    if (!token) {
      return NextResponse.json(
        { error: "ElevenLabs returned an empty conversation token." },
        { status: 502 }
      );
    }

    return NextResponse.json({ token, agentId });
  } catch (error) {
    return NextResponse.json(
      {
        error: error instanceof Error ? error.message : "Failed to contact ElevenLabs."
      },
      { status: 502 }
    );
  }
}
