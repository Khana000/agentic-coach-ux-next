# Product Requirements Document (PRD)

## Product
Agentic Coach

## Date
February 10, 2026

## Owner
Product + Engineering

## Version
v2.0 (Finish-to-Launch)

---

## 1. Purpose
Define the final product requirements and delivery plan to finish Agentic Coach as a production-ready web app for desktop and mobile.

---

## 2. Product Vision
Agentic Coach helps a coachee move from insight to action in one session by combining structured coaching dialogue and practical follow-through tools (tasks, calendar invites, reminders, escalation paths).

---

## 3. Problem Statement
People leave coaching conversations with good intent but weak execution. They need:
- a focused coaching flow that finds root cause,
- practical strategy selection,
- optional conversion into a time-bound plan only when requested,
- and immediate follow-through actions.

---

## 4. Product Principles
1. Coaching first, planning second.
2. No auto-plan generation unless the coachee asks.
3. Two-way dialogue at all times.
4. Actionability over generic advice.
5. Safe escalation for sensitive issues.
6. Mobile and desktop parity.

---

## 5. Personas
- Coachee (primary): needs support on performance, growth, conflict, and execution.
- Manager (secondary): may provide support when aligned by coachee request.
- Program admin (future): needs outcomes and adoption analytics.

---

## 6. Scope

### In Scope (v1)
- Start page with personal details + beta login.
- Session page with text coaching.
- 15-minute coaching session with transcription.
- Two-way coaching dialogue using GROW, DISC cues, SDI cues, Gestalt, and Heron push/pull.
- Root-cause exploration and strategy prompts.
- Plan generation only when explicitly requested or explicitly accepted.
- Action Hub with tick-menu actions.
- Task list and reminder list.
- Calendar event (.ics download) and calendar invite email.
- Manager-support prompt flow with talking prompts and email draft.
- HR and counselor escalation prompts.

### Out of Scope (v1)
- Native mobile app.
- Enterprise SSO/RBAC portal.
- Full HR case management.
- Multi-tenant admin dashboard.

---

## 7. Current Product State (As Built)
- Personal details + beta credential gate exists.
- Voice session starts only after login and Start Coaching.
- Coaching prompt enforces dialogue-first behavior.
- Plan prompt asks: "Would you like me to create a coaching plan for you?"
- Manager-support prompt asks for manager meeting support.
- Avatar present in session header.
- Action Hub supports tick-menu execution:
  - Add to task list
  - Add to calendar
  - Remind in 4 weeks
- Calendar behavior:
  - downloads .ics
  - attempts email invite via `/api/calendar-invite`
- New coaching session clears previous transcript-derived plan/action output.

---

## 8. Target End-to-End User Flow
1. User enters personal details and logs in.
2. User starts coaching session.
3. Coach asks focused questions to identify root cause.
4. User and coach explore options and strategies.
5. On discussion completion, coach asks:
   - manager support meeting question
   - coaching plan opt-in question
6. If user opts in, coach generates structured plan.
7. User applies actions via Action Hub tick-menu.
8. User saves session.

---

## 9. Functional Requirements

### FR-1: Onboarding + Access
- Start page captures: full name, work email, company, role, grade, manager name, manager email.
- Beta login supports username/password `beta1` for pilot mode.

Acceptance Criteria:
- User cannot proceed without required profile fields.
- User reaches session page only after successful login.

### FR-2: Coaching Dialogue Core
- Coach response mode is conversational and two-way.
- Coach should end response with a relevant follow-up question.
- Coaching style uses GROW, Gestalt, Heron, and communication/motive cues from DISC/SDI without labeling user types.

Acceptance Criteria:
- No full plan output in early dialogue by default.
- Every coaching response contains at least one clear forward question.

### FR-3: Plan Gating
- Plan is generated only if:
  - user explicitly requests plan generation, or
  - user accepts explicit plan opt-in question.
- Otherwise plan sections must be suppressed.

Acceptance Criteria:
- No "Action Plan" or "Development Plan" sections appear unless plan mode is active.
- Opt-in question appears after discussion-closure signal.

### FR-4: Manager Support Flow
- At discussion closure, coach can ask if user wants manager support meeting.
- If accepted, response includes:
  - manager discussion prompts (talking points),
  - concise manager email draft.

Acceptance Criteria:
- Manager prompts and email draft appear only when requested/accepted.

### FR-5: Text Coaching Session
- Session starts only after Start Coaching.
- Session duration capped at 15 minutes.
- Dialogue remains text-only in this version.

Acceptance Criteria:
- Only text interaction controls are displayed in the UI.
- Session messaging works on desktop/mobile supported browsers.

### FR-6: Action Hub
- Parse latest assistant response for action items.
- Show each action with tick-menu options and Apply.

Acceptance Criteria:
- User can apply one or multiple actions in one click per item.
- Action list refreshes from latest eligible response.

### FR-7: Tasks and Reminders
- Add actions to task list.
- Add reminders (default four weeks).

Acceptance Criteria:
- Task/reminder states persist at least locally in current version.

### FR-8: Calendar and Email Invite
- Add to calendar downloads .ics event.
- System attempts to send calendar invite to coachee email.

Acceptance Criteria:
- If email config exists, invite email sends successfully.
- If email config is missing/fails, user still gets .ics download and clear status message.

### FR-9: Safety and Escalation
- If sensitive topics indicate code-of-conduct risk, coach advises HR/reporting path.
- Counselor referral prompt supports wellbeing escalation.

Acceptance Criteria:
- Escalation language appears consistently on high-risk prompts.

### FR-10: Session Reset and Save
- Starting a new coaching session resets prior transcript-derived outputs.
- User can save session transcript and summary.

Acceptance Criteria:
- Old action plan content does not carry into a new session.

---

## 10. Non-Functional Requirements
- Performance: acceptable interactive latency for chat UI; graceful loading states.
- Reliability: robust handling for chat API failures.
- Security: secrets in env vars only; no keys in frontend.
- Accessibility: keyboard and readable contrast on key workflows.
- Responsiveness: full usability on iPhone-sized screens and desktop.
- Observability: logs for API failures and invite delivery outcomes.

---

## 11. Technical Requirements

### Frontend
- Next.js App Router.
- Session UI with transcript, text composer, and action hub.
- Client-side status/error messaging for all async operations.

### Backend
- `/api/chat` for coaching orchestration.
- `/api/sessions` for session persistence.
- `/api/calendar-invite` for email invite delivery.

### Required Env Vars
- `OPENAI_API_KEY`
- `OPENAI_CHAT_MODEL` (optional override)
- `RESEND_API_KEY` (for invite email)
- `CALENDAR_FROM_EMAIL` (verified sender)

---

## 12. Data and Storage (v1 vs v2)

### v1 (current)
- Tasks/reminders in browser localStorage.
- Sessions persisted via backend endpoint.

### v2 target
- Move tasks/reminders server-side by user identity.
- Add reminder scheduler + delivery status.
- Add audit trail for escalations.

---

## 13. Milestones to Finish the App

### Milestone A: Production Hardening (1 week)
- Add tests for plan gating, manager prompt gating, and action extraction.
- Add API timeout/retry guards and user-friendly fallback messages.
- Fix CSS import warning.
- Add basic analytics events for key funnel actions.

### Milestone B: Data Reliability (1-2 weeks)
- Replace localStorage task/reminder with API-backed storage.
- Add CRUD for tasks/reminders.
- Add status model for reminder delivery.

### Milestone C: Calendar + Notifications (1-2 weeks)
- Harden invite delivery (retry + error logging).
- Add timezone selection and locale-safe scheduling.
- Add optional Google/Microsoft Calendar integration.

### Milestone D: Auth + Multi-User Readiness (2 weeks)
- Replace beta credentials with real auth (OAuth/SSO).
- Enforce per-user data scoping for all APIs.
- Add role boundaries for admin/reporting (if needed).

### Milestone E: Safety + Governance (1 week)
- Add safety policy tests for HR/counselor escalation.
- Add escalation event tracking.
- Add review workflow for flagged sessions.

### Milestone F: Launch Readiness (1 week)
- E2E tests for primary journeys (text, action hub, calendar email).
- Security review and dependency audit.
- Pilot rollout, collect feedback, then GA.

---

## 14. KPIs and Success Metrics
- % sessions with completed multi-turn dialogue.
- % sessions where user opts into plan generation.
- % action items converted to task/calendar/reminder.
- Reminder delivery success rate.
- Return rate (7-day and 30-day).
- Escalation path usage and completion quality.

---

## 15. Risks and Mitigations
- Over-automation into plans too early.
  - Mitigation: strict gating + post-response stripping + tests.
- Calendar invite email failures.
  - Mitigation: fallback .ics download + clear status + retries/logging.
- Voice UX inconsistency across browsers.
  - Mitigation: browser capability checks + robust fallback to text.
- Safety misses in high-risk coaching topics.
  - Mitigation: deterministic escalation rules + regression suite.

---

## 16. Open Decisions
- Which production auth provider: Azure AD, Okta, Google?
- Should manager-email send require explicit confirmation each time?
- Which reminder channels are required for GA: email only or push/SMS?
- Should session data retention be configurable by organization?

---

## 17. Definition of Done (v1 Complete)
The app is ready for production launch when:
1. Coaching flow is reliably two-way and root-cause focused.
2. Plans are generated only when explicitly requested/accepted.
3. Action Hub reliably converts outputs into tasks/calendar/reminders.
4. Calendar invites can be emailed successfully in production config.
5. New sessions always start clean without prior plan/action carryover.
6. Safety escalation paths are dependable and test-covered.
