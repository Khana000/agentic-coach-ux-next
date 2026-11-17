import { createHmac, randomUUID, timingSafeEqual } from "crypto";
import { NextResponse } from "next/server";
import { rateLimit, getClientIp } from "./rate-limit";

/**
 * Server-checked beta access.
 *
 * - BETA_ACCESS_CODES: comma-separated access codes you hand to testers (required).
 * - ACCESS_COOKIE_SECRET: long random string (>= 32 chars) used to sign the access cookie (required).
 * - ACCESS_SESSION_TTL_HOURS: how long an unlocked browser stays unlocked (default 12).
 * - ACCESS_GATE_DISABLED=true: skip the gate for local development only (ignored in production).
 *
 * A correct code issues an httpOnly, signed cookie. Protected API routes call `requireAccess`.
 */

export const ACCESS_COOKIE_NAME = "ac_access";

type AccessPayload = { sid: string; iat: number; exp: number };

export type AccessResult =
  | { ok: true; sid: string; response?: undefined }
  | { ok: false; sid?: undefined; response: NextResponse };

const isProduction = () => process.env.NODE_ENV === "production";

export const isGateDisabled = () => !isProduction() && process.env.ACCESS_GATE_DISABLED === "true";

const getCodes = () =>
  (process.env.BETA_ACCESS_CODES ?? "")
    .split(",")
    .map((code) => code.trim())
    .filter(Boolean);

const getSecret = () => process.env.ACCESS_COOKIE_SECRET?.trim() ?? "";

const getTtlSeconds = () => {
  const hours = Number(process.env.ACCESS_SESSION_TTL_HOURS ?? 12);
  return Math.round((Number.isFinite(hours) && hours > 0 ? hours : 12) * 3600);
};

export const isAccessConfigured = () => {
  if (isGateDisabled()) {
    return true;
  }
  const configured = getCodes().length > 0 && getSecret().length >= 32;
  if (!configured) {
    console.error(
      "[access] Not configured: set BETA_ACCESS_CODES and ACCESS_COOKIE_SECRET (at least 32 characters)."
    );
  }
  return configured;
};

const base64url = (input: Buffer | string) => Buffer.from(input).toString("base64url");

const sign = (data: string) => createHmac("sha256", getSecret()).update(data).digest("base64url");

const safeEqual = (a: string, b: string) => {
  const left = Buffer.from(a);
  const right = Buffer.from(b);
  return left.length === right.length && timingSafeEqual(left, right);
};

export const isValidAccessCode = (candidate: string) => {
  const value = candidate.trim();
  if (!value) {
    return false;
  }
  return getCodes().some((code) => safeEqual(code, value));
};

export const createAccessToken = () => {
  const now = Math.floor(Date.now() / 1000);
  const payload: AccessPayload = { sid: randomUUID(), iat: now, exp: now + getTtlSeconds() };
  const body = base64url(JSON.stringify(payload));
  return { token: `${body}.${sign(body)}`, maxAge: getTtlSeconds() };
};

export const verifyAccessToken = (token: string | undefined | null): AccessPayload | null => {
  if (!token || !getSecret()) {
    return null;
  }
  const [body, signature] = token.split(".");
  if (!body || !signature || !safeEqual(sign(body), signature)) {
    return null;
  }
  try {
    const payload = JSON.parse(Buffer.from(body, "base64url").toString("utf8")) as AccessPayload;
    if (!payload?.sid || typeof payload.exp !== "number" || payload.exp < Math.floor(Date.now() / 1000)) {
      return null;
    }
    return payload;
  } catch {
    return null;
  }
};

const readCookie = (request: Request, name: string) => {
  const header = request.headers.get("cookie") ?? "";
  for (const part of header.split(";")) {
    const [key, ...rest] = part.trim().split("=");
    if (key === name) {
      return decodeURIComponent(rest.join("="));
    }
  }
  return null;
};

export const getAccessFromRequest = (request: Request): AccessPayload | null => {
  if (isGateDisabled()) {
    return { sid: `dev-${getClientIp(request)}`, iat: 0, exp: Number.MAX_SAFE_INTEGER };
  }
  return verifyAccessToken(readCookie(request, ACCESS_COOKIE_NAME));
};

export const accessCookieOptions = (maxAge: number) => ({
  httpOnly: true,
  secure: isProduction(),
  sameSite: "lax" as const,
  path: "/",
  maxAge
});

/** Call at the top of every protected route handler. */
export const requireAccess = (
  request: Request,
  limits?: { name: string; perSessionPerMinute: number; perIpPerMinute: number }
): AccessResult => {
  if (!isAccessConfigured()) {
    return {
      ok: false,
      response: NextResponse.json(
        { error: "Coaching isn't available right now. Please try again later.", code: "access_not_configured" },
        { status: 503 }
      )
    };
  }

  const access = getAccessFromRequest(request);
  if (!access) {
    return {
      ok: false,
      response: NextResponse.json(
        {
          error: "Your access has expired. Please refresh the page and enter your access code again.",
          code: "access_required"
        },
        { status: 401 }
      )
    };
  }

  if (limits) {
    const ip = getClientIp(request);
    const perSession = rateLimit(`${limits.name}:sid:${access.sid}`, limits.perSessionPerMinute, 60_000);
    const perIp = rateLimit(`${limits.name}:ip:${ip}`, limits.perIpPerMinute, 60_000);
    if (!perSession.ok || !perIp.ok) {
      const retryAfter = Math.max(perSession.retryAfterSeconds, perIp.retryAfterSeconds);
      return {
        ok: false,
        response: NextResponse.json(
          { error: "You're sending messages very quickly. Please wait a moment and try again.", code: "rate_limited" },
          { status: 429, headers: { "Retry-After": String(retryAfter) } }
        )
      };
    }
  }

  return { ok: true, sid: access.sid };
};

const numberFromEnv = (name: string, fallback: number) => {
  const value = Number(process.env[name]);
  return Number.isFinite(value) && value > 0 ? value : fallback;
};

export const CHAT_LIMITS = () => ({
  name: "chat",
  perSessionPerMinute: numberFromEnv("CHAT_RATE_LIMIT_PER_MINUTE", 20),
  perIpPerMinute: numberFromEnv("CHAT_RATE_LIMIT_PER_IP_PER_MINUTE", 60)
});

export const VOICE_TOKEN_LIMITS = () => ({
  name: "voice-token",
  perSessionPerMinute: numberFromEnv("VOICE_TOKEN_RATE_LIMIT_PER_MINUTE", 6),
  perIpPerMinute: numberFromEnv("VOICE_TOKEN_RATE_LIMIT_PER_IP_PER_MINUTE", 20)
});

export const DELIVERY_LIMITS = () => ({
  name: "delivery",
  perSessionPerMinute: numberFromEnv("DELIVERY_RATE_LIMIT_PER_MINUTE", 10),
  perIpPerMinute: numberFromEnv("DELIVERY_RATE_LIMIT_PER_IP_PER_MINUTE", 30)
});
