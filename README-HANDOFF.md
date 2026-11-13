# Agentic Coach — current local redesign

This source bundle contains the latest local UI changes, including human coach portraits, desktop/iPad responsive layouts, and a compact single-screen layout. These changes have NOT been pushed to GitHub or deployed to the public Vercel app.

## Run locally
Use Node.js 20 or newer. Run `npm ci`, then `npm run dev`. Open http://localhost:3000. Run `npm run build` to verify production compilation.

## Important files
- app/page.tsx: coaching state and existing chat/voice/action flows
- app/future.css: redesigned responsive UI
- components/coaching-landing.tsx: landing page
- components/ai-presence.tsx: male/female portrait avatars (not lip-synced video)
- app/api: existing backend routes

Environment files, credentials, Git history, dependencies, generated builds, caches, and local logs are excluded. Chat, voice, database, and delivery integrations require the owner's environment configuration; never embed private keys in client code. This bundle includes existing local backend edits, not just the design changes.

Repository: https://github.com/Khana000/agentic-coach-ux-next
Existing live app (older design): https://agentic-coach-ux-next-asif-khans-projects-9583c067.vercel.app/

## ElevenLabs voice configuration (Fix #3)
- Agent and voice IDs are no longer hard-coded; set them as environment variables (the previous values are listed in `.env.example`).
- `/api/elevenlabs/token` only mints tokens for `ELEVENLABS_AGENT_ID` (plus any `ELEVENLABS_ALLOWED_AGENT_IDS`); other `agentId` values get a 403.
- Recommended setup: make the agent private in ElevenLabs and set `ELEVENLABS_API_KEY`, so browsers only ever connect with a short-lived signed token from your server.
- Without an API key, voice is turned off and users see "Voice coaching isn't available right now. You can continue by text." To keep using a public agent anyway, set `ELEVENLABS_ALLOW_PUBLIC_AGENT=true`. Anyone who learns a public agent's ID can use its minutes.

## Access gate and API protection (Fix #2)
All coaching API routes (`/api/chat`, `/api/llm`, `/api/sessions*`, `/api/elevenlabs/token`, `/api/action-plan-email`, `/api/calendar-invite`) now require a server-checked beta access code.

- Testers enter a code from `BETA_ACCESS_CODES` on the "Enter your access code" screen. `/api/access` checks it on the server and sets an httpOnly, signed cookie (`ac_access`, signed with `ACCESS_COOKIE_SECRET`, valid for `ACCESS_SESSION_TTL_HOURS`).
- Without both variables set, protected routes return 503 and the app shows "Coaching access isn't set up yet". The variable names only appear in the server logs.
- `/api/sessions` only returns sessions created with the same access cookie (`ownerId`).
- Chat, voice-token and email/calendar routes have a simple per-session and per-IP rate limit (`*_RATE_LIMIT_*`). It is held in memory per serverless instance, so it is a brake rather than a global quota; use a shared store such as Upstash Redis if you need a hard limit.
- For local development you can set `ACCESS_GATE_DISABLED=true`; it is ignored in production.

See `.env.example` for every variable.

## Beta login and trial limits (Fix #4)
- The hard-coded beta password (`12345`) is gone from the client and the welcome screen. Access is controlled by the server-checked access code (see Fix #2). With `NEXT_PUBLIC_REQUIRE_BETA_LOGIN=true`, testers still enter a beta username (Beta1–Beta8), but only to pick which trial record to use.
- The `?trialReset` / `?resetTrial` URL bypass only works in local development (`npm run dev`). Production builds ignore it.
- Trial session counts are still kept in the browser, so clearing site data resets them. Enforcing them on the server would need a store keyed by user (for example MongoDB), which is not part of this change.
