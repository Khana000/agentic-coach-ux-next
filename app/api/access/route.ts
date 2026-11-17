import { NextResponse } from "next/server";
import {
  ACCESS_COOKIE_NAME,
  accessCookieOptions,
  createAccessToken,
  getAccessFromRequest,
  isAccessConfigured,
  isGateDisabled,
  isValidAccessCode
} from "../../../lib/server/access";
import { getClientIp, rateLimit } from "../../../lib/server/rate-limit";

export const dynamic = "force-dynamic";

/** GET: is this browser unlocked? */
export async function GET(request: Request) {
  const configured = isAccessConfigured();
  return NextResponse.json({
    configured,
    authorized: configured && Boolean(getAccessFromRequest(request)),
    gateDisabled: isGateDisabled()
  });
}

/** POST { code }: check the access code server-side and issue a signed httpOnly cookie. */
export async function POST(request: Request) {
  if (!isAccessConfigured()) {
    return NextResponse.json(
      { error: "Coaching access isn't set up yet. Please contact the Agentic Coach team.", code: "access_not_configured" },
      { status: 503 }
    );
  }

  const attempt = rateLimit(`access:ip:${getClientIp(request)}`, 10, 15 * 60_000);
  if (!attempt.ok) {
    return NextResponse.json(
      { error: "Too many attempts. Please wait a few minutes and try again.", code: "rate_limited" },
      { status: 429, headers: { "Retry-After": String(attempt.retryAfterSeconds) } }
    );
  }

  let code = "";
  try {
    const body = (await request.json()) as { code?: unknown };
    code = typeof body?.code === "string" ? body.code : "";
  } catch {
    // fall through with empty code
  }

  if (!isValidAccessCode(code)) {
    return NextResponse.json(
      { error: "That access code isn't valid. Please check it and try again.", code: "invalid_code" },
      { status: 401 }
    );
  }

  const { token, maxAge } = createAccessToken();
  const response = NextResponse.json({ authorized: true });
  response.cookies.set(ACCESS_COOKIE_NAME, token, accessCookieOptions(maxAge));
  return response;
}

/** DELETE: lock this browser again. */
export async function DELETE() {
  const response = NextResponse.json({ authorized: false });
  response.cookies.set(ACCESS_COOKIE_NAME, "", accessCookieOptions(0));
  return response;
}
