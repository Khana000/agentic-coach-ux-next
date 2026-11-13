import { NextResponse } from "next/server";
import { VOICE_TOKEN_LIMITS, requireAccess } from "../../../../lib/server/access";

export const dynamic = "force-dynamic";

/**
 * Fix #3: mint ElevenLabs conversation tokens only for allow-listed agents configured on the server.
 * - ELEVENLABS_AGENT_ID: the coaching agent (required for voice).
 * - ELEVENLABS_ALLOWED_AGENT_IDS: optional extra comma-separated agent IDs that may be requested.
 * - ELEVENLABS_API_KEY: required to mint signed tokens.
 * - ELEVENLABS_ALLOW_PUBLIC_AGENT=true: optional; without an API key, let the browser connect to the
 *   (public) agent directly. Off by default because anyone with the agent ID can then use its minutes.
 */
const VOICE_UNAVAILABLE = { error: "Voice coaching isn't available right now. You can continue by text.", code: "voice_not_configured" };

const getAllowedAgentIds = () => {
  const primary = process.env.ELEVENLABS_AGENT_ID?.trim() || process.env.NEXT_PUBLIC_ELEVENLABS_AGENT_ID?.trim() || "";
  const extra = (process.env.ELEVENLABS_ALLOWED_AGENT_IDS ?? "")
    .split(",")
    .map((id) => id.trim())
    .filter(Boolean);
  return { primary, allowed: new Set([primary, ...extra].filter(Boolean)) };
};

export async function GET(request: Request) {
  const access = requireAccess(request, VOICE_TOKEN_LIMITS());
  if (!access.ok) {
    return access.response;
  }

  const { primary, allowed } = getAllowedAgentIds();
  if (!primary) {
    console.error("[elevenlabs/token] Not configured: set ELEVENLABS_AGENT_ID.");
    return NextResponse.json(VOICE_UNAVAILABLE, { status: 503 });
  }

  const url = new URL(request.url);
  const requested = url.searchParams.get("agentId")?.trim();
  if (requested && !allowed.has(requested)) {
    console.warn(`[elevenlabs/token] Rejected request for non-allow-listed agent ${requested.slice(0, 64)}.`);
    return NextResponse.json(
      { error: "Voice coaching isn't available for this agent.", code: "agent_not_allowed" },
      { status: 403 }
    );
  }
  const agentId = requested || primary;

  const apiKey = process.env.ELEVENLABS_API_KEY?.trim() ?? "";
  if (!apiKey) {
    if (process.env.ELEVENLABS_ALLOW_PUBLIC_AGENT === "true") {
      return NextResponse.json({ token: "", agentId, mode: "public" });
    }
    console.error("[elevenlabs/token] Not configured: set ELEVENLABS_API_KEY (or ELEVENLABS_ALLOW_PUBLIC_AGENT=true).");
    return NextResponse.json(VOICE_UNAVAILABLE, { status: 503 });
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
      console.error(`[elevenlabs/token] ElevenLabs responded ${response.status}: ${JSON.stringify(payload).slice(0, 500)}`);
      return NextResponse.json(
        { error: "Voice coaching couldn't start just now. Please try again or continue by text.", code: "token_failed" },
        { status: 502 }
      );
    }

    const token = typeof payload?.token === "string" ? payload.token : "";
    if (!token) {
      console.error("[elevenlabs/token] ElevenLabs returned an empty conversation token.");
      return NextResponse.json(
        { error: "Voice coaching couldn't start just now. Please try again or continue by text.", code: "token_failed" },
        { status: 502 }
      );
    }

    return NextResponse.json({ token, agentId, mode: "token" });
  } catch (error) {
    console.error("[elevenlabs/token] Failed to contact ElevenLabs:", error);
    return NextResponse.json(
      { error: "Voice coaching couldn't start just now. Please try again or continue by text.", code: "token_failed" },
      { status: 502 }
    );
  }
}
