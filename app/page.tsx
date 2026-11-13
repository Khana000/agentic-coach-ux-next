"use client";

import { useEffect, useMemo, useRef, useState, type KeyboardEvent } from "react";
import { Orbit, ArrowUpRight } from "lucide-react";
import { AccessGate } from "../components/access-gate";
import { CoachingLanding } from "../components/coaching-landing";
import { AIPresence } from "../components/ai-presence";
import { useConversation } from "@elevenlabs/react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { Button } from "../components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "../components/ui/card";
import { Input } from "../components/ui/input";
import { Label } from "../components/ui/label";
import { Select } from "../components/ui/select";
import { Textarea } from "../components/ui/textarea";

type AppScreen = "cover" | "access" | "welcome" | "session";
type CoachGender = "male" | "female";
type ChatRole = "assistant" | "user";
type CoachingStartMode = "text" | "voice";
type VoiceChannelStatus = "disconnected" | "connecting" | "connected";
type CalendarAgreement = "pending" | "agreed" | "skip";

type ChatMessage = {
  role: ChatRole;
  content: string;
};

type TrialStatus = {
  sessionsLimit: number;
  sessionsUsed: number;
  sessionsRemaining: number;
  activeSessionId: string | null;
};

type SessionSnapshot = {
  version: 1;
  screen: string;
  sessionActive: boolean;
  coachingStartMode: string;
  coachGender: string;
  conversationContext: string;
  chatMessages: ChatMessage[];
  executionToolsEnabled: boolean;
  actionHubItems: string[];
  actionDueDates: Record<string, string>;
  actionCalendarAgreements: Record<string, CalendarAgreement>;
  deliveryEmail: string;
  coacheeReminderEmail: string;
  deliveryName: string;
  calendarAction: string;
  calendarStartLocal: string;
  trialStatus: TrialStatus | null;
  authenticatedBetaUsername: string | null;
  pendingPlanItems: string[];
  pendingPlanSignature: string;
  appliedPlanSignature: string;
};

type AssistantToolCall = {
  name: string;
  payload?: unknown;
  raw: string;
};

type ToolPlanItem = {
  action: string;
};

type HubFeedbackTarget = "email" | "calendar" | "all" | "combined" | `item:${number}`;
type HubFeedback = { target: HubFeedbackTarget; tone: "error" | "success"; text: string };

type ReminderItem = {
  id: string;
  action: string;
  dueAt: string;
  toEmail: string;
  createdAt: string;
  completedAt: string | null;
  browserNotifiedAt: string | null;
};

const MAX_BETA_USERS = 8;
const MAX_TRIAL_SESSIONS = 1;
const SHARED_TEST_MAX_TRIAL_SESSIONS = 2;
const SHARED_TEST_QUERY_KEYS = ["test", "sharedTest", "shared_test"] as const;
const REQUIRE_BETA_LOGIN = process.env.NEXT_PUBLIC_REQUIRE_BETA_LOGIN === "true";
const TRIAL_STATE_STORAGE_KEY_PREFIX = "agenticCoach.trialState.v7";
const TRIAL_STATE_STORAGE_KEY_ROOT = "agenticCoach.trialState.";
const TRIAL_RESET_QUERY_KEYS = ["trialReset", "resetTrial", "reset_trial", "renewTrial"] as const;
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const SESSION_SNAPSHOT_STORAGE_KEY = "agenticCoach.sessionSnapshot.v1";
const REMINDERS_STORAGE_KEY = "agenticCoach.reminders.v1";
const REMINDER_POLL_MS = 30_000;
const VOICE_CONNECT_TIMEOUT_MS = 5_000;
const VOICE_TOKEN_TIMEOUT_MS = 2_500;
const VOICE_CONNECT_POLL_MS = 100;
const VOICE_LAST_ATTEMPT_STORAGE_KEY = "agenticCoach.voice.lastAttempt.v1";
const ENABLE_WEBSOCKET_VOICE_FALLBACK =
  process.env.NEXT_PUBLIC_VOICE_ENABLE_WEBSOCKET_FALLBACK !== "false";
const VOICE_CONTEXT_GUARDRAIL =
  "Never verbalize internal automation/tool details. Do not speak words like calling tool, payload, connector, debug, or internal steps. Speak only natural coaching responses.";
const TEST_TRIAL_STATUS: TrialStatus = {
  sessionsLimit: 999,
  sessionsUsed: 0,
  sessionsRemaining: 999,
  activeSessionId: null
};

const INITIAL_COACH_MESSAGE =
  "Welcome. What outcome would make this coaching session most valuable for you today?";

const PLAN_INTENT_PATTERN =
  /\b(create|build|make|generate|draft|prepare|show|give)\b[\s\w]{0,40}\b(coaching plan|action plan|development plan|plan)\b|\b(action plan|development plan|coaching plan)\b/i;
const PLAN_NEGATIVE_PATTERN = /\b(don't|do not|not now|no plan|without plan)\b/i;
const PLAN_OUTPUT_PATTERN = /^#{1,6}\s*(reflection|focus plan|first step|action plan|development plan)\b/im;
const PLAN_TRANSFER_SIGNAL_PATTERN =
  /\b(action plan|focus plan|owner\s*:|deadline\s*:|success signal\s*:|action\s*\d+\s*[:\-]|(?:one|two|three|four|five)\.)\b/i;
const PLAN_APPROVAL_PATTERN =
  /\b(i agree|agreed|approve|approved|yes|yeah|yep|ok|okay|sounds good|sounds fine|looks good|looks fine|go ahead|proceed|let'?s do it|finali[sz]e|confirm|works for me|good plan|all good|happy with (it|that|the plan)|i'?m happy|i am happy|fine with (it|that|the plan)|i'?m fine|i am fine|that'?s fine|thats fine)\b/i;
const PLAN_REJECTION_PATTERN = /\b(don't agree|do not agree|not now|decline|reject|nope|no)\b/i;
const END_SESSION_PROMPT_PATTERN = /\bwould you like to end (the )?coaching session now\??\b/i;
const END_SESSION_APPROVAL_PATTERN =
  /\b(yes|yeah|yep|ok|okay|sure|please|go ahead|do it|end it|end session|stop|close|finish)\b/i;
const END_SESSION_REJECTION_PATTERN = /\b(no|not now|later|continue|keep going)\b/i;

const COACH_ENDING_MESSAGE =
  "Hopefully you found this of use, look forward to our next session, thanks";

const conversationContexts = [
  { id: "visibility", label: "Visibility & influence" },
  { id: "communication", label: "Communication" },
  { id: "leadership", label: "Leadership" },
  { id: "performance", label: "Performance" }
] as const;

const coachProfiles = {
  male: {
    label: "Male coach",
    displayName: "Male coach",
    avatarSrc: "/pexels-8837558.jpg",
    avatarAlt: "Male executive coach"
  },
  female: {
    label: "Female coach",
    displayName: "Female coach",
    avatarSrc: "/u-1698499352020-521e54040e04.jpg",
    avatarAlt: "Female executive coach"
  }
} as const;

const normalizeUsernameInput = (value: string) => value.trim();

const resolveAllowedBetaUsername = (raw: string) => {
  const normalized = normalizeUsernameInput(raw);
  if (!normalized) {
    return null;
  }

  const matched = normalized.match(/^beta([1-9]\d*)$/i);
  if (!matched) {
    return null;
  }

  const index = Number(matched[1]);
  if (!Number.isInteger(index) || index < 1 || index > MAX_BETA_USERS) {
    return null;
  }

  return `Beta${index}`;
};

const isSharedTestMode = () => {
  if (typeof window === "undefined") {
    return false;
  }
  const params = new URLSearchParams(window.location.search);
  return SHARED_TEST_QUERY_KEYS.some((key) => params.has(key));
};

const getMaxTrialSessions = () => (isSharedTestMode() ? SHARED_TEST_MAX_TRIAL_SESSIONS : MAX_TRIAL_SESSIONS);

const normalizeTrialStatus = (raw?: Partial<TrialStatus> | null): TrialStatus => {
  const sessionsLimit = getMaxTrialSessions();
  const sessionsUsed = Math.max(0, Math.min(sessionsLimit, Number(raw?.sessionsUsed ?? 0)));
  const sessionsRemaining = Math.max(0, sessionsLimit - sessionsUsed);

  return {
    sessionsLimit,
    sessionsUsed,
    sessionsRemaining,
    activeSessionId:
      typeof raw?.activeSessionId === "string" && raw.activeSessionId.trim().length > 0
        ? raw.activeSessionId
        : null
  };
};

const getTrialStorageKey = (betaUsername?: string | null) => {
  const modeSuffix = isSharedTestMode() ? ":shared-test" : ":standard";
  const resolved = resolveAllowedBetaUsername(betaUsername ?? "");
  return resolved
    ? `${TRIAL_STATE_STORAGE_KEY_PREFIX}${modeSuffix}:${resolved.toLowerCase()}`
    : `${TRIAL_STATE_STORAGE_KEY_PREFIX}${modeSuffix}:guest`;
};

const normalizeToolCallName = (name: string) =>
  name
    .trim()
    .toLowerCase()
    .replace(/[:\s-]+/g, "_");

const TOOL_CALL_START_PATTERN = /(?:\(\s*)?calling tool\b/i;
const TOOL_CALL_NAME_PATTERN = /(?:\(\s*)?calling tool\s*:?\s*([a-zA-Z0-9_:-]+)/i;

const findToolCallBlockEnd = (text: string, startIndex: number) => {
  let depth = 0;
  let inSingleQuote = false;
  let inDoubleQuote = false;
  let escaped = false;

  for (let index = startIndex; index < text.length; index += 1) {
    const character = text[index];

    if (escaped) {
      escaped = false;
      continue;
    }

    if ((inSingleQuote || inDoubleQuote) && character === "\\") {
      escaped = true;
      continue;
    }

    if (!inDoubleQuote && character === "'") {
      inSingleQuote = !inSingleQuote;
      continue;
    }

    if (!inSingleQuote && character === "\"") {
      inDoubleQuote = !inDoubleQuote;
      continue;
    }

    if (inSingleQuote || inDoubleQuote) {
      continue;
    }

    if (character === "(") {
      depth += 1;
      continue;
    }

    if (character === ")") {
      depth -= 1;
      if (depth === 0) {
        return index;
      }
    }
  }

  return -1;
};

const stripToolCallArtifacts = (text: string) =>
  text
    .replace(/(?:\(\s*)?calling tool\b[\s\S]*?(?:\n{2,}|$)/gi, "\n")
    .replace(/^\s*calling tool\b.*$/gim, "")
    .replace(/\n{3,}/g, "\n\n")
    .trim();

const INTERNAL_ASSISTANT_ARTIFACT_LINE_PATTERN =
  /^\s*(?:\(\s*)?(?:calling\s*tool|tool\s*call|tool:|debug:)\b.*$/gim;
const INTERNAL_ASSISTANT_JARGON_LINE_PATTERN =
  /^\s*.*\b(payload|connector(?:s)?)\b.*$/gim;

const sanitizeAssistantDisplayText = (text: string) =>
  text
    .replace(INTERNAL_ASSISTANT_ARTIFACT_LINE_PATTERN, "")
    .replace(INTERNAL_ASSISTANT_JARGON_LINE_PATTERN, "")
    .replace(/\n{3,}/g, "\n\n")
    .trim();

const tryParseToolPayload = (rawPayload: string): unknown => {
  const trimmed = rawPayload.trim();
  if (!trimmed) {
    return undefined;
  }

  try {
    return JSON.parse(trimmed);
  } catch {
    const objectStart = trimmed.indexOf("{");
    const objectEnd = trimmed.lastIndexOf("}");
    if (objectStart >= 0 && objectEnd > objectStart) {
      const objectCandidate = trimmed.slice(objectStart, objectEnd + 1);
      try {
        return JSON.parse(objectCandidate);
      } catch {
        // no-op
      }
    }
  }

  return trimmed;
};

const extractAssistantToolCalls = (rawText: string) => {
  const toolCalls: AssistantToolCall[] = [];
  let cleanedText = "";
  let cursor = 0;

  while (cursor < rawText.length) {
    const relativeStart = rawText.slice(cursor).search(TOOL_CALL_START_PATTERN);
    if (relativeStart < 0) {
      cleanedText += rawText.slice(cursor);
      break;
    }

    const startIndex = cursor + relativeStart;
    cleanedText += rawText.slice(cursor, startIndex);

    let endIndex = findToolCallBlockEnd(rawText, startIndex);
    if (endIndex < 0) {
      const paragraphBreak = rawText.indexOf("\n\n", startIndex);
      endIndex = paragraphBreak >= 0 ? paragraphBreak - 1 : rawText.length - 1;
    }

    const block = rawText.slice(startIndex, endIndex + 1);
    const nameMatch = block.match(TOOL_CALL_NAME_PATTERN);
    const name = normalizeToolCallName(String(nameMatch?.[1] ?? ""));

    if (name) {
      const payloadLabelMatch = block.match(/\bwith payload\s*:?\s*/i);
      let payloadRaw = "";

      if (payloadLabelMatch && payloadLabelMatch.index !== undefined) {
        const payloadStart = payloadLabelMatch.index + payloadLabelMatch[0].length;
        payloadRaw = block
          .slice(payloadStart)
          .replace(/\)\s*$/, "")
          .trim();
      }

      toolCalls.push({
        name,
        payload: payloadRaw ? tryParseToolPayload(payloadRaw) : undefined,
        raw: block.trim()
      });
    }

    cursor = endIndex + 1;
  }

  const displayText = stripToolCallArtifacts(cleanedText);

  return { displayText, toolCalls };
};

const resolveAssistantDisplayText = (
  rawText: string,
  toolEnvelope: { displayText: string; toolCalls: AssistantToolCall[] }
) => {
  const baseText =
    toolEnvelope.toolCalls.length > 0
      ? toolEnvelope.displayText
      : toolEnvelope.displayText || rawText;
  return sanitizeAssistantDisplayText(baseText);
};

const isAutomationArtifactMessage = (text: string) =>
  /\b(calling tool|tool call|with payload|payload\s*[:{]|connector(?:s)?\s*[:{]|save_action_plan|end_session|debug)\b/i.test(
    text
  );

const coerceAssistantToolCall = (value: unknown): AssistantToolCall | null => {
  if (!value || typeof value !== "object") {
    return null;
  }

  const record = value as Record<string, unknown>;
  const name = normalizeToolCallName(String(record.name ?? ""));
  if (!name) {
    return null;
  }

  const payload = record.payload;
  let payloadText = "";
  if (payload !== undefined) {
    try {
      payloadText = ` with payload ${JSON.stringify(payload)}`;
    } catch {
      payloadText = " with payload [unserializable]";
    }
  }
  const raw =
    typeof record.raw === "string" && record.raw.trim().length > 0
      ? record.raw.trim()
      : `(Calling tool ${name}${payloadText})`;

  return {
    name,
    payload,
    raw
  };
};

const extractAssistantToolCallsFromApi = (toolCalls: unknown): AssistantToolCall[] => {
  if (!Array.isArray(toolCalls)) {
    return [];
  }

  return toolCalls
    .map((toolCall) => coerceAssistantToolCall(toolCall))
    .filter((toolCall): toolCall is AssistantToolCall => Boolean(toolCall));
};

const extractPlanItemsFromToolPayload = (payload: unknown): ToolPlanItem[] => {
  let sourcePayload = payload;
  if (typeof sourcePayload === "string") {
    sourcePayload = tryParseToolPayload(sourcePayload);
  }

  if (!sourcePayload || typeof sourcePayload !== "object") {
    return [];
  }

  const source = sourcePayload as Record<string, unknown>;
  const rawItems = source.action_plan ?? source.actions ?? source.plan ?? [];
  if (!Array.isArray(rawItems)) {
    return [];
  }

  return rawItems
    .map((item) => {
      if (!item || typeof item !== "object") {
        return null;
      }
      const action = String((item as Record<string, unknown>).action ?? "").trim();
      return action ? { action } : null;
    })
    .filter((item): item is ToolPlanItem => Boolean(item));
};

const extractPlanItemsFromToolRaw = (rawText: string): ToolPlanItem[] => {
  const actionPattern = /"action"\s*:\s*"([^"]+)"/gi;
  const actions: string[] = [];

  let match = actionPattern.exec(rawText);
  while (match) {
    const action = String(match[1] ?? "").replace(/\\"/g, "\"").trim();
    if (action) {
      actions.push(action);
    }
    match = actionPattern.exec(rawText);
  }

  return normalizeActionItems(actions).map((action) => ({ action }));
};

const extractActionItemsFromText = (text: string) => {
  const bulletPattern = /^\s*([-*+]\s+|\d+[.)]\s+)(.+)$/;
  const actionLinePattern = /^\s*(action|step)\s*\d*\s*[:\-]\s+(.+)$/i;
  const lines = text.split("\n");
  const result: string[] = [];

  for (const line of lines) {
    const bulletMatch = line.match(bulletPattern);
    const actionLineMatch = line.match(actionLinePattern);
    const tableCells = line.includes("|")
      ? line
          .split("|")
          .map((cell) => cell.trim())
          .filter(Boolean)
      : [];

    let item = "";
    if (bulletMatch) {
      item = bulletMatch[2].trim();
    } else if (actionLineMatch) {
      item = actionLineMatch[2].trim();
    } else if (
      tableCells.length >= 2 &&
      !/^:?-{2,}:?$/.test(tableCells[0]) &&
      !/^action$/i.test(tableCells[0])
    ) {
      item = tableCells[0].match(/^\d+$/) ? tableCells[1] : tableCells[0];
    }

    if (!item) {
      continue;
    }

    const lowered = item.toLowerCase();
    if (result.some((existing) => existing.toLowerCase() === lowered)) {
      continue;
    }

    result.push(item);
  }

  return result;
};

const sanitizeNarrativeActionCandidate = (value: string) =>
  value
    .replace(/\bowner\s*:\s*[\s\S]*$/i, "")
    .replace(/\bdeadline\s*:\s*[\s\S]*$/i, "")
    .replace(/\bsuccess signal\s*:\s*[\s\S]*$/i, "")
    .replace(/^[:;,\-\s]+/, "")
    .replace(/\s+/g, " ")
    .replace(/[;,\.\s]+$/, "")
    .trim();

const isLikelyNarrativeAction = (value: string) => {
  const words = value.split(/\s+/).filter(Boolean);
  if (words.length < 4 || words.length > 40) {
    return false;
  }

  if (
    /\b(action hub|coachee email|calendar fields|does this action plan work|would you like|if you are happy|if you're happy)\b/i.test(
      value
    )
  ) {
    return false;
  }

  if (/^#{1,6}\s*/.test(value) || /\b(reflection|focus plan|first step)\b/i.test(value)) {
    return false;
  }

  return /\b(define|rehearse|deliver|schedule|create|draft|prepare|practice|review|track|share|set|block|ask|send|complete|follow up|align|meet)\b/i.test(
    value
  );
};

const extractActionItemsFromPlanNarrative = (text: string) => {
  const compact = text.replace(/\r/g, " ").replace(/\n+/g, " ").replace(/\s+/g, " ").trim();
  if (!compact) {
    return [];
  }

  const results: string[] = [];
  const pushCandidate = (raw: string) => {
    const cleaned = sanitizeNarrativeActionCandidate(raw);
    if (!cleaned || !isLikelyNarrativeAction(cleaned)) {
      return;
    }
    if (results.some((existing) => existing.toLowerCase() === cleaned.toLowerCase())) {
      return;
    }
    results.push(cleaned);
  };

  const numberedPattern = /(?:^|\s)(?:[1-9]\d*)[.)]\s*(.*?)(?=(?:\s(?:[1-9]\d*)[.)]\s)|$)/g;
  let numberedMatch = numberedPattern.exec(compact);
  while (numberedMatch) {
    pushCandidate(String(numberedMatch[1] ?? ""));
    numberedMatch = numberedPattern.exec(compact);
  }

  const ordinalPattern =
    /\b(first|second|third)\b\s*(?:action|step)?\s*[:\-]?\s*(.*?)(?=(?:\b(?:first|second|third)\b\s*(?:action|step)?\s*[:\-]?)|$)/gi;
  let ordinalMatch = ordinalPattern.exec(compact);
  while (ordinalMatch) {
    pushCandidate(String(ordinalMatch[2] ?? ""));
    ordinalMatch = ordinalPattern.exec(compact);
  }

  const wordNumberPattern =
    /(?:^|\s)(one|two|three|four|five)\.\s*(.*?)(?=(?:\s(?:one|two|three|four|five)\.\s)|$)/gi;
  let wordNumberMatch = wordNumberPattern.exec(compact);
  while (wordNumberMatch) {
    pushCandidate(String(wordNumberMatch[2] ?? ""));
    wordNumberMatch = wordNumberPattern.exec(compact);
  }

  const stepPattern =
    /\b(?:action|step)\s*(?:\d+|one|two|three|first|second|third)?\s*[:\-]\s*(.*?)(?=(?:\b(?:action|step)\s*(?:\d+|one|two|three|first|second|third)?\s*[:\-])|$)/gi;
  let stepMatch = stepPattern.exec(compact);
  while (stepMatch) {
    pushCandidate(String(stepMatch[1] ?? ""));
    stepMatch = stepPattern.exec(compact);
  }

  return results;
};

const normalizeActionItems = (items: string[]) => {
  const result: string[] = [];

  for (const item of items) {
    const trimmed = item.trim();
    if (!trimmed) {
      continue;
    }

    const lowered = trimmed.toLowerCase();
    if (result.some((existing) => existing.toLowerCase() === lowered)) {
      continue;
    }

    result.push(trimmed);
  }

  return result;
};

const parseActionDueDateInput = (raw: string) => {
  const trimmed = raw.trim();
  if (!trimmed) {
    return null;
  }

  const dateOnlyMatch = trimmed.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (dateOnlyMatch) {
    const year = Number(dateOnlyMatch[1]);
    const month = Number(dateOnlyMatch[2]);
    const day = Number(dateOnlyMatch[3]);
    const localDate = new Date(year, month - 1, day, 9, 0, 0, 0);
    return Number.isNaN(localDate.getTime()) ? null : localDate;
  }

  const parsed = new Date(trimmed);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
};

const isPlanApprovedMessage = (text: string) => PLAN_APPROVAL_PATTERN.test(text.trim());

const isPlanRejectedMessage = (text: string) => {
  const normalized = text.trim().toLowerCase();
  if (!normalized) {
    return false;
  }

  if (isPlanApprovedMessage(normalized)) {
    return false;
  }

  if (/^(no|nah|nope)\b/.test(normalized)) {
    return true;
  }

  return /\b(don't agree|do not agree|not now|decline|reject|skip it|leave it)\b/i.test(normalized);
};

const hasPlanTransferSignal = (text: string, itemCount: number) =>
  PLAN_OUTPUT_PATTERN.test(text) || /does this action plan work for you\??/i.test(text) || itemCount >= 1 && PLAN_TRANSFER_SIGNAL_PATTERN.test(text);

const isEndSessionApprovedMessage = (text: string) => {
  const normalized = text.trim();
  if (!normalized || END_SESSION_REJECTION_PATTERN.test(normalized)) {
    return false;
  }
  return END_SESSION_APPROVAL_PATTERN.test(normalized);
};

const buildActionPlanSignature = (items: string[]) =>
  normalizeActionItems(items)
    .map((item) => item.toLowerCase())
    .join("||");

const getTrialResetRequested = () => {
  // Fix #4: the ?trialReset bypass only works in local development, never in production builds.
  if (typeof window === "undefined" || process.env.NODE_ENV === "production") {
    return false;
  }

  const params = new URLSearchParams(window.location.search);
  return TRIAL_RESET_QUERY_KEYS.some((key) => params.has(key));
};

const clearAllTrialStates = () => {
  if (typeof window === "undefined") {
    return;
  }

  const keysToRemove: string[] = [];
  for (let index = 0; index < window.localStorage.length; index += 1) {
    const key = window.localStorage.key(index);
    if (key && key.startsWith(TRIAL_STATE_STORAGE_KEY_ROOT)) {
      keysToRemove.push(key);
    }
  }

  keysToRemove.forEach((key) => window.localStorage.removeItem(key));
};

export default function HomePage() {
  const [screen, setScreen] = useState<AppScreen>("cover");

  const [username, setUsername] = useState("");
  const [authError, setAuthError] = useState("");
  const [isAuthenticatingTrial, setIsAuthenticatingTrial] = useState(false);
  const [authenticatedBetaUsername, setAuthenticatedBetaUsername] = useState<string | null>(null);

  const [trialStatus, setTrialStatus] = useState<TrialStatus | null>(null);
  const [sessionActive, setSessionActive] = useState(false);
  const [coachingStartMode, setCoachingStartMode] = useState<CoachingStartMode>("text");
  const [voiceChannelStatus, setVoiceChannelStatus] = useState<VoiceChannelStatus>("disconnected");
  const [isVoiceAgentSpeaking, setIsVoiceAgentSpeaking] = useState(false);

  const [coachGender, setCoachGender] = useState<CoachGender>("male");
  const [conversationContext, setConversationContext] =
    useState<(typeof conversationContexts)[number]["id"]>("visibility");

  const [chatMessages, setChatMessages] = useState<ChatMessage[]>([
    { role: "assistant", content: INITIAL_COACH_MESSAGE }
  ]);
  const [chatInput, setChatInput] = useState("");
  const [isChatting, setIsChatting] = useState(false);
  const [statusMessage, setStatusMessage] = useState("");
  const [errorMessage, setErrorMessage] = useState("");

  const [executionToolsEnabled, setExecutionToolsEnabled] = useState(false);
  const [actionHubItems, setActionHubItems] = useState<string[]>([]);
  const [deliveryEmail, setDeliveryEmail] = useState("");
  const [coacheeReminderEmail, setCoacheeReminderEmail] = useState("");
  const [deliveryName, setDeliveryName] = useState("");
  const [calendarAction, setCalendarAction] = useState("");
  const [calendarStartLocal, setCalendarStartLocal] = useState("");
  const [actionDueDates, setActionDueDates] = useState<Record<string, string>>({});
  const [actionCalendarAgreements, setActionCalendarAgreements] = useState<
    Record<string, CalendarAgreement>
  >({});
  const [reminders, setReminders] = useState<ReminderItem[]>([]);
  const [notificationPermission, setNotificationPermission] = useState<NotificationPermission | "unsupported">(
    "unsupported"
  );
  const [isSendingPlanEmail, setIsSendingPlanEmail] = useState(false);
  const [isSendingCalendarInvite, setIsSendingCalendarInvite] = useState(false);
  const [isSendingAllCalendarInvites, setIsSendingAllCalendarInvites] = useState(false);
  const [isSendingCombinedDelivery, setIsSendingCombinedDelivery] = useState(false);
  const [hubFeedback, setHubFeedbackState] = useState<HubFeedback | null>(null);

  const chatMessagesRef = useRef(chatMessages);
  const transcriptRef = useRef<HTMLDivElement | null>(null);
  const pendingPlanSignatureRef = useRef("");
  const pendingPlanItemsRef = useRef<string[]>([]);
  const pendingPlanAssistantIndexRef = useRef(-1);
  const appliedPlanSignatureRef = useRef("");
  const sessionActiveRef = useRef(sessionActive);
  const coachingStartModeRef = useRef<CoachingStartMode>(coachingStartMode);
  const voiceBootingRef = useRef(false);
  const voiceAutoConnectAttemptedRef = useRef(false);
  const voiceChannelStatusRef = useRef<VoiceChannelStatus>(voiceChannelStatus);
  const awaitingEndSessionApprovalRef = useRef(false);


  const lastAssistantMessage =
    [...chatMessages].reverse().find((message) => message.role === "assistant")?.content ?? "";

  const reminderItemsSorted = useMemo(
    () => [...reminders].sort((a, b) => new Date(a.dueAt).getTime() - new Date(b.dueAt).getTime()),
    [reminders]
  );
  const transcriptActionItems = useMemo(() => {
    const collected: string[] = [];

    chatMessages.forEach((message) => {
      if (message.role !== "assistant") {
        return;
      }

      extractActionItemsFromText(message.content).forEach((item) => {
        collected.push(item);
      });

      const hasPlanSignal =
        PLAN_OUTPUT_PATTERN.test(message.content) ||
        /does this action plan work for you\??/i.test(message.content);
      if (hasPlanSignal) {
        extractActionItemsFromPlanNarrative(message.content).forEach((item) => {
          collected.push(item);
        });
      }
    });

    return normalizeActionItems(collected);
  }, [chatMessages]);
  const hasTranscriptItemsNotInHub = useMemo(
    () =>
      transcriptActionItems.some(
        (item) => !actionHubItems.some((existing) => existing.toLowerCase() === item.toLowerCase())
      ),
    [transcriptActionItems, actionHubItems]
  );

  const clearPendingActionPlan = () => {
    pendingPlanSignatureRef.current = "";
    pendingPlanItemsRef.current = [];
    pendingPlanAssistantIndexRef.current = -1;
  };

  const finalizeActionPlan = (
    rawItems: string[],
    signatureHint?: string,
    options?: { autoImported?: boolean }
  ) => {
    const normalized = normalizeActionItems(rawItems);
    if (normalized.length === 0) {
      return false;
    }

    const signature = signatureHint?.trim() || buildActionPlanSignature(normalized);
    if (!signature) {
      return false;
    }

    appliedPlanSignatureRef.current = signature;
    clearPendingActionPlan();
    setExecutionToolsEnabled(true);
    setActionHubItems(normalized);
    setStatusMessage(
      options?.autoImported
        ? "Action plan imported automatically to Action Hub. Add the coachee email and set due date per action."
        : "Action plan finalised and moved to Action Hub. Add the coachee email and set due date per action."
    );
    return true;
  };

  const importTranscriptActionsToHub = () => {
    if (transcriptActionItems.length === 0) {
      setErrorMessage("No action bullets found in transcript yet.");
      return;
    }

    const currentItems = actionHubItems;
    const mergedItems = normalizeActionItems([...currentItems, ...transcriptActionItems]);
    const addedCount = mergedItems.length - currentItems.length;
    if (addedCount <= 0) {
      setStatusMessage("Action Hub is already synced with transcript actions.");
      setErrorMessage("");
      return;
    }

    setExecutionToolsEnabled(true);
    setActionHubItems(mergedItems);
    setStatusMessage(`Imported ${addedCount} transcript action${addedCount === 1 ? "" : "s"} into Action Hub.`);
    setErrorMessage("");
  };

  const appendLiveMessage = (role: ChatRole, rawContent: string) => {
    const content = rawContent.trim();
    if (!content) {
      return;
    }

    setChatMessages((previous) => {
      const last = previous[previous.length - 1];
      if (last && last.role === role && last.content.trim() === content) {
        return previous;
      }
      // The voice agent speaks its own greeting on connect. If the transcript still only holds the
      // built-in text greeting, replace it so the user doesn't see two welcomes.
      const replacesBuiltInGreeting =
        role === "assistant" &&
        previous.length === 1 &&
        previous[0].role === "assistant" &&
        previous[0].content === INITIAL_COACH_MESSAGE;
      const next = replacesBuiltInGreeting ? [{ role, content }] : [...previous, { role, content }];
      chatMessagesRef.current = next;
      return next;
    });
  };

  // Fix #3: no hard-coded ElevenLabs IDs. The agent comes from the server's allow-list via the token
  // route; NEXT_PUBLIC_ELEVENLABS_AGENT_ID is only an optional hint (it must also be allow-listed).
  const resolveElevenLabsAgentId = () => process.env.NEXT_PUBLIC_ELEVENLABS_AGENT_ID?.trim() || "";

  const resolveElevenLabsVoiceId = (gender: CoachGender) =>
    (gender === "female"
      ? process.env.NEXT_PUBLIC_ELEVENLABS_VOICE_ID_FEMALE?.trim()
      : process.env.NEXT_PUBLIC_ELEVENLABS_VOICE_ID_MALE?.trim()) || undefined;

  const elevenConversation = useConversation({
    onConnect: () => {
      setVoiceChannelStatus("connected");
      setErrorMessage("");
      setStatusMessage("Voice channel connected. Speak naturally.");
    },
    onDisconnect: () => {
      setVoiceChannelStatus("disconnected");
      setIsVoiceAgentSpeaking(false);
      if (sessionActiveRef.current && coachingStartModeRef.current === "voice") {
        setStatusMessage("Voice channel disconnected. You can continue by text or reconnect voice.");
      }
    },
    onError: (message) => {
      const resolved =
        typeof message === "string" && message.trim() ? message : "Voice channel error.";
      setVoiceChannelStatus("disconnected");
      setIsVoiceAgentSpeaking(false);
      setErrorMessage(resolved);
    },
    onModeChange: ({ mode }) => {
      setIsVoiceAgentSpeaking(mode === "speaking");
    },
    onStatusChange: ({ status }) => {
      if (status === "connected") {
        setVoiceChannelStatus("connected");
        return;
      }
      if (status === "connecting") {
        setVoiceChannelStatus("connecting");
        return;
      }
      if (status === "disconnecting" || status === "disconnected") {
        setVoiceChannelStatus("disconnected");
      }
    },
    onMessage: (payload) => {
      const rawMessage = typeof payload?.message === "string" ? payload.message : "";
      if (!rawMessage.trim()) {
        return;
      }

      const isAssistant = payload?.role === "agent";
      if (isAssistant) {
        const toolEnvelope = extractAssistantToolCalls(rawMessage);
        const assistantText = resolveAssistantDisplayText(rawMessage, toolEnvelope);
        const artifactOnly = isAutomationArtifactMessage(rawMessage) && !assistantText;

        if (artifactOnly) {
          try {
            elevenConversation.sendUserActivity();
          } catch {
            // no-op
          }
        }

        if (assistantText) {
          appendLiveMessage("assistant", assistantText);
          if (END_SESSION_PROMPT_PATTERN.test(assistantText)) {
            awaitingEndSessionApprovalRef.current = true;
          } else if (/hopefully you found this of use/i.test(assistantText)) {
            awaitingEndSessionApprovalRef.current = false;
            if (sessionActiveRef.current) {
              endTextSession(resolveCoachEndingMessage(assistantText));
            }
            return;
          }
        }
        if (toolEnvelope.toolCalls.length > 0) {
          void handleAssistantToolCalls(toolEnvelope.toolCalls, assistantText || rawMessage);
        }
        return;
      }

      if (awaitingEndSessionApprovalRef.current) {
        if (isEndSessionApprovedMessage(rawMessage)) {
          awaitingEndSessionApprovalRef.current = false;
          appendLiveMessage("user", rawMessage);
          endTextSession(COACH_ENDING_MESSAGE);
          return;
        }
        if (END_SESSION_REJECTION_PATTERN.test(rawMessage)) {
          awaitingEndSessionApprovalRef.current = false;
        }
      }

      if (PLAN_INTENT_PATTERN.test(rawMessage) && !PLAN_NEGATIVE_PATTERN.test(rawMessage)) {
        setExecutionToolsEnabled(true);
      }

      if (pendingPlanSignatureRef.current && pendingPlanItemsRef.current.length > 0) {
        const normalizedMessage = rawMessage.trim();
        if (isPlanRejectedMessage(normalizedMessage)) {
          clearPendingActionPlan();
        } else if (isPlanApprovedMessage(normalizedMessage)) {
          appendLiveMessage("user", rawMessage);
          if (
            finalizeActionPlan(
              pendingPlanItemsRef.current,
              pendingPlanSignatureRef.current,
              { autoImported: true }
            )
          ) {
            setErrorMessage("");
          }
          return;
        }
      }

      appendLiveMessage("user", rawMessage);
    }
  });

  useEffect(() => {
    chatMessagesRef.current = chatMessages;
  }, [chatMessages]);

  useEffect(() => {
    sessionActiveRef.current = sessionActive;
  }, [sessionActive]);

  useEffect(() => {
    coachingStartModeRef.current = coachingStartMode;
  }, [coachingStartMode]);

  useEffect(() => {
    voiceChannelStatusRef.current = voiceChannelStatus;
  }, [voiceChannelStatus]);

  useEffect(() => {
    if (!sessionActive || coachingStartMode !== "voice") {
      voiceAutoConnectAttemptedRef.current = false;
      return;
    }

    if (voiceChannelStatus !== "disconnected") {
      return;
    }

    if (voiceBootingRef.current || voiceAutoConnectAttemptedRef.current) {
      return;
    }

    voiceAutoConnectAttemptedRef.current = true;
    void startVoiceSession();
  // startVoiceSession is intentionally excluded to avoid re-running auto-connect on every render.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sessionActive, coachingStartMode, voiceChannelStatus, coachGender]);

  useEffect(() => {
    const container = transcriptRef.current;
    if (!container) {
      return;
    }

    const frame = window.requestAnimationFrame(() => {
      container.scrollTop = container.scrollHeight;
    });

    return () => window.cancelAnimationFrame(frame);
  }, [chatMessages.length, isChatting]);

  useEffect(() => {
    if (typeof window === "undefined") {
      return;
    }

    if (getTrialResetRequested()) {
      clearAllTrialStates();
    }
  }, []);

  useEffect(() => {
    if (typeof window === "undefined") {
      return;
    }

    if (!("Notification" in window)) {
      setNotificationPermission("unsupported");
      return;
    }

    setNotificationPermission(window.Notification.permission);
  }, []);

  useEffect(() => {
    if (typeof window === "undefined") {
      return;
    }

    const raw = window.localStorage.getItem(REMINDERS_STORAGE_KEY);
    if (!raw) {
      return;
    }

    try {
      const parsed = JSON.parse(raw);
      if (!Array.isArray(parsed)) {
        return;
      }

      const normalized = parsed
        .map((item) => {
          if (!item || typeof item !== "object") {
            return null;
          }

          const record = item as Partial<ReminderItem>;
          const action = String(record.action ?? "").trim();
          const dueAt = String(record.dueAt ?? "").trim();
          const toEmail = String(record.toEmail ?? "").trim();
          if (!action || !dueAt || !toEmail) {
            return null;
          }

          return {
            id: String(record.id ?? `${action}-${dueAt}`),
            action,
            dueAt,
            toEmail,
            createdAt: String(record.createdAt ?? new Date().toISOString()),
            completedAt: record.completedAt ? String(record.completedAt) : null,
            browserNotifiedAt: record.browserNotifiedAt ? String(record.browserNotifiedAt) : null
          } as ReminderItem;
        })
        .filter((item): item is ReminderItem => Boolean(item));

      setReminders(normalized);
    } catch {
      setReminders([]);
    }
  }, []);

  useEffect(() => {
    if (typeof window === "undefined") {
      return;
    }
    window.localStorage.setItem(REMINDERS_STORAGE_KEY, JSON.stringify(reminders));
  }, [reminders]);

  // Fix #5: keep the in-progress session (chat, Action Hub, coach choice) across a page refresh.
  // sessionStorage is per-tab and cleared when the tab closes, which suits private coaching content.
  const sessionRestoredRef = useRef(false);
  useEffect(() => {
    if (typeof window === "undefined") {
      return;
    }
    try {
      const raw = window.sessionStorage.getItem(SESSION_SNAPSHOT_STORAGE_KEY);
      const snapshot = raw ? (JSON.parse(raw) as Partial<SessionSnapshot>) : null;
      if (snapshot && snapshot.version === 1 && snapshot.screen === "session") {
        if (Array.isArray(snapshot.chatMessages) && snapshot.chatMessages.length > 0) {
          const restoredMessages = snapshot.chatMessages.filter(
            (message): message is ChatMessage =>
              Boolean(message) &&
              (message.role === "assistant" || message.role === "user") &&
              typeof message.content === "string"
          );
          setChatMessages(restoredMessages);
          chatMessagesRef.current = restoredMessages;
        }
        if (snapshot.coachGender === "male" || snapshot.coachGender === "female") {
          setCoachGender(snapshot.coachGender);
        }
        if (conversationContexts.some((context) => context.id === snapshot.conversationContext)) {
          setConversationContext(snapshot.conversationContext as (typeof conversationContexts)[number]["id"]);
        }
        if (snapshot.coachingStartMode === "text" || snapshot.coachingStartMode === "voice") {
          setCoachingStartMode(snapshot.coachingStartMode);
          coachingStartModeRef.current = snapshot.coachingStartMode;
        }
        setExecutionToolsEnabled(Boolean(snapshot.executionToolsEnabled));
        setActionHubItems(Array.isArray(snapshot.actionHubItems) ? snapshot.actionHubItems.map(String) : []);
        setActionDueDates(snapshot.actionDueDates ?? {});
        setActionCalendarAgreements(snapshot.actionCalendarAgreements ?? {});
        setDeliveryEmail(snapshot.deliveryEmail ?? "");
        setCoacheeReminderEmail(snapshot.coacheeReminderEmail ?? "");
        setDeliveryName(snapshot.deliveryName ?? "");
        setCalendarAction(snapshot.calendarAction ?? "");
        setCalendarStartLocal(snapshot.calendarStartLocal ?? "");
        if (snapshot.trialStatus) {
          setTrialStatus(snapshot.trialStatus);
        }
        if (snapshot.authenticatedBetaUsername) {
          setAuthenticatedBetaUsername(snapshot.authenticatedBetaUsername);
          setUsername(snapshot.authenticatedBetaUsername);
        }
        if (snapshot.pendingPlanItems?.length && snapshot.pendingPlanSignature) {
          pendingPlanItemsRef.current = snapshot.pendingPlanItems;
          pendingPlanSignatureRef.current = snapshot.pendingPlanSignature;
        }
        appliedPlanSignatureRef.current = snapshot.appliedPlanSignature ?? "";
        const wasActive = Boolean(snapshot.sessionActive);
        // Don't auto-reconnect voice after a reload; the user can press "Connect voice".
        voiceAutoConnectAttemptedRef.current = true;
        sessionActiveRef.current = wasActive;
        setSessionActive(wasActive);
        setScreen("session");
        setStatusMessage(
          wasActive
            ? snapshot.coachingStartMode === "voice"
              ? "Session restored. Press Connect voice to resume speaking, or continue by text."
              : "Session restored. You can carry on where you left off."
            : ""
        );
      }
    } catch {
      window.sessionStorage.removeItem(SESSION_SNAPSHOT_STORAGE_KEY);
    } finally {
      sessionRestoredRef.current = true;
    }
  // Restore once on mount.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (typeof window === "undefined" || !sessionRestoredRef.current) {
      return;
    }
    if (screen !== "session") {
      window.sessionStorage.removeItem(SESSION_SNAPSHOT_STORAGE_KEY);
      return;
    }
    const snapshot: SessionSnapshot = {
      version: 1,
      screen,
      sessionActive,
      coachingStartMode,
      coachGender,
      conversationContext,
      chatMessages,
      executionToolsEnabled,
      actionHubItems,
      actionDueDates,
      actionCalendarAgreements,
      deliveryEmail,
      coacheeReminderEmail,
      deliveryName,
      calendarAction,
      calendarStartLocal,
      trialStatus,
      authenticatedBetaUsername,
      pendingPlanItems: pendingPlanItemsRef.current,
      pendingPlanSignature: pendingPlanSignatureRef.current,
      appliedPlanSignature: appliedPlanSignatureRef.current
    };
    try {
      window.sessionStorage.setItem(SESSION_SNAPSHOT_STORAGE_KEY, JSON.stringify(snapshot));
    } catch {
      // Storage full or unavailable: persistence is best-effort.
    }
  }, [
    screen,
    sessionActive,
    coachingStartMode,
    coachGender,
    conversationContext,
    chatMessages,
    executionToolsEnabled,
    actionHubItems,
    actionDueDates,
    actionCalendarAgreements,
    deliveryEmail,
    coacheeReminderEmail,
    deliveryName,
    calendarAction,
    calendarStartLocal,
    trialStatus,
    authenticatedBetaUsername
  ]);

  // Warn before closing the tab or navigating away mid-session (a refresh restores the session).
  useEffect(() => {
    if (typeof window === "undefined" || !sessionActive || chatMessages.length <= 1) {
      return;
    }
    const handleBeforeUnload = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = "";
    };
    window.addEventListener("beforeunload", handleBeforeUnload);
    return () => window.removeEventListener("beforeunload", handleBeforeUnload);
  }, [sessionActive, chatMessages.length]);

  useEffect(() => {
    if (typeof window === "undefined" || notificationPermission !== "granted") {
      return;
    }

    const notifyDueReminders = () => {
      const now = Date.now();
      const due = reminders.filter((reminder) => {
        if (reminder.completedAt || reminder.browserNotifiedAt) {
          return false;
        }
        return new Date(reminder.dueAt).getTime() <= now;
      });

      if (due.length === 0) {
        return;
      }

      due.forEach((reminder) => {
        try {
          new window.Notification("Agentic Coach reminder", {
            body: reminder.action
          });
        } catch {
          // no-op
        }
      });

      const stamp = new Date().toISOString();
      setReminders((previous) =>
        previous.map((item) =>
          due.some((entry) => entry.id === item.id)
            ? { ...item, browserNotifiedAt: stamp }
            : item
        )
      );
    };

    notifyDueReminders();
    const interval = window.setInterval(notifyDueReminders, REMINDER_POLL_MS);
    return () => window.clearInterval(interval);
  }, [notificationPermission, reminders]);

  useEffect(() => {
    const lastMessage = chatMessages[chatMessages.length - 1];
    if (lastMessage?.role !== "assistant") {
      return;
    }

    const recentAssistantWindow = [...chatMessages]
      .reverse()
      .filter((message) => message.role === "assistant")
      .slice(0, 4)
      .reverse()
      .map((message) => message.content)
      .join("\n\n");

    const planItemsFromMessage = normalizeActionItems([
      ...extractActionItemsFromText(recentAssistantWindow),
      ...extractActionItemsFromPlanNarrative(recentAssistantWindow),
      ...extractPlanItemsFromToolRaw(recentAssistantWindow).map((item) => item.action)
    ]);
    const hasPlanSignal = hasPlanTransferSignal(recentAssistantWindow, planItemsFromMessage.length);
    const hasPlanStructureSignal =
      /(?:^|\s)(?:\d+[.)]|first\b|second\b|third\b|action\s*\d*[:\-]|step\s*\d*[:\-]|focus plan|first step)/im.test(
        recentAssistantWindow
      );
    const minimumPlanItemCount = executionToolsEnabled ? 1 : 3;
    const hasLikelyPlanContent =
      planItemsFromMessage.length >= minimumPlanItemCount &&
      (executionToolsEnabled || hasPlanStructureSignal);
    if ((!hasPlanSignal && !hasLikelyPlanContent) || planItemsFromMessage.length === 0) {
      return;
    }

    const signature = buildActionPlanSignature(planItemsFromMessage);

    if (!signature) {
      return;
    }

    if (signature === appliedPlanSignatureRef.current || signature === pendingPlanSignatureRef.current) {
      return;
    }

    pendingPlanSignatureRef.current = signature;
    pendingPlanItemsRef.current = planItemsFromMessage;
    pendingPlanAssistantIndexRef.current = chatMessages.length - 1;
    setExecutionToolsEnabled(true);

    const latestUserMessage =
      [...chatMessages]
        .reverse()
        .find((message) => message.role === "user")?.content ?? "";
    const alreadyAgreed = Boolean(latestUserMessage) && isPlanApprovedMessage(latestUserMessage);

    if (alreadyAgreed) {
      if (finalizeActionPlan(planItemsFromMessage, signature, { autoImported: true })) {
        setErrorMessage("");
      }
      return;
    }

    setStatusMessage(
      "Action plan ready. If the coachee says yes/okay/fine, it will transfer automatically to Action Hub."
    );
    setErrorMessage("");
  // finalizeActionPlan and executionToolsEnabled are intentionally excluded to prevent transfer-loop reprocessing.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [chatMessages]);

  useEffect(() => {
    const lastMessage = chatMessages[chatMessages.length - 1];
    if (lastMessage?.role !== "user") {
      return;
    }

    if (!pendingPlanSignatureRef.current) {
      return;
    }

    if (chatMessages.length - 1 < pendingPlanAssistantIndexRef.current) {
      return;
    }

    const text = lastMessage.content.trim();
    if (!text || isPlanRejectedMessage(text) || !isPlanApprovedMessage(text)) {
      return;
    }

    if (pendingPlanItemsRef.current.length === 0) {
      return;
    }

    finalizeActionPlan(pendingPlanItemsRef.current, pendingPlanSignatureRef.current);
  // finalizeActionPlan is intentionally excluded to avoid duplicate finalize attempts on callback identity changes.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [chatMessages]);

  useEffect(() => {
    const lastMessage = chatMessages[chatMessages.length - 1];
    if (lastMessage?.role !== "user") {
      return;
    }

    const text = lastMessage.content.trim();
    if (!text || isPlanRejectedMessage(text) || !isPlanApprovedMessage(text)) {
      return;
    }

    if (pendingPlanSignatureRef.current) {
      return;
    }

    const recentAssistantWindow = [...chatMessages]
      .slice(0, -1)
      .reverse()
      .filter((message) => message.role === "assistant")
      .slice(0, 6)
      .reverse()
      .map((message) => message.content)
      .join("\n\n");
    if (!recentAssistantWindow.trim()) {
      return;
    }

    const planItems = normalizeActionItems([
      ...extractActionItemsFromText(recentAssistantWindow),
      ...extractActionItemsFromPlanNarrative(recentAssistantWindow),
      ...extractPlanItemsFromToolRaw(recentAssistantWindow).map((item) => item.action)
    ]);
    const hasPlanSignal = hasPlanTransferSignal(recentAssistantWindow, planItems.length);
    const canAutoImportFromExecutionMode = executionToolsEnabled && planItems.length > 0;
    if (!hasPlanSignal && !canAutoImportFromExecutionMode) {
      return;
    }
    if (planItems.length === 0) {
      return;
    }

    const signature = buildActionPlanSignature(planItems);
    if (!signature || signature === appliedPlanSignatureRef.current) {
      return;
    }

    finalizeActionPlan(planItems, signature);
  // finalizeActionPlan is intentionally excluded to avoid duplicate finalize attempts on callback identity changes.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [chatMessages]);

  useEffect(() => {
    if (actionHubItems.length === 0) {
      setCalendarAction("");
      setActionDueDates({});
      setActionCalendarAgreements({});
      return;
    }

    setCalendarAction((current) =>
      current && actionHubItems.includes(current) ? current : actionHubItems[0]
    );
    setActionDueDates((previous) => {
      const next: Record<string, string> = {};
      actionHubItems.forEach((item) => {
        next[item] = previous[item] ?? "";
      });
      return next;
    });
    setActionCalendarAgreements((previous) => {
      const next: Record<string, CalendarAgreement> = {};
      actionHubItems.forEach((item) => {
        next[item] = previous[item] ?? "pending";
      });
      return next;
    });
  }, [actionHubItems]);

  const getStoredTrialStatus = (betaUsername?: string | null) => {
    if (typeof window === "undefined") {
      return normalizeTrialStatus();
    }

    const storageKey = getTrialStorageKey(betaUsername);
    const raw = window.localStorage.getItem(storageKey);
    if (!raw) {
      return normalizeTrialStatus();
    }

    try {
      const parsed = JSON.parse(raw) as Partial<TrialStatus>;
      return normalizeTrialStatus(parsed);
    } catch {
      return normalizeTrialStatus();
    }
  };

  const saveTrialStatus = (status: TrialStatus, betaUsername?: string | null) => {
    const normalized = normalizeTrialStatus(status);
    setTrialStatus(normalized);

    if (typeof window !== "undefined") {
      const storageKey = getTrialStorageKey(betaUsername);
      window.localStorage.setItem(storageKey, JSON.stringify(normalized));
    }

    return normalized;
  };

  const readApiError = async (response: Response, fallback: string) => {
    const payload = (await response.json().catch(() => ({}))) as {
      error?: string;
      details?: string;
    };
    const primary = typeof payload?.error === "string" && payload.error.trim() ? payload.error.trim() : fallback;
    const details = typeof payload?.details === "string" && payload.details.trim() ? payload.details.trim() : "";
    return details ? `${primary} ${details}` : primary;
  };

  const stopVoiceSession = async (options?: { preserveBooting?: boolean }) => {
    if (!options?.preserveBooting) {
      voiceBootingRef.current = false;
    }
    try {
      await elevenConversation.endSession();
    } catch {
      // no-op
    }
    setVoiceChannelStatus("disconnected");
    setIsVoiceAgentSpeaking(false);
  };

  const waitForVoiceConnected = async (timeoutMs = 9000) => {
    if (voiceChannelStatusRef.current === "connected") {
      return;
    }

    await new Promise<void>((resolve, reject) => {
      const startedAt = Date.now();
      const intervalId = window.setInterval(() => {
        if (voiceChannelStatusRef.current === "connected") {
          window.clearInterval(intervalId);
          resolve();
          return;
        }

        if (Date.now() - startedAt >= timeoutMs) {
          window.clearInterval(intervalId);
          reject(new Error("Timed out waiting for voice channel connection."));
        }
      }, VOICE_CONNECT_POLL_MS);
    });
  };

  const requestMicrophoneAccess = async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      stream.getTracks().forEach((track) => track.stop());
      return true;
    } catch (error) {
      const message = error instanceof Error ? error.message : "Microphone permission was denied.";
      const permissionDenied =
        error instanceof DOMException &&
        (error.name === "NotAllowedError" || error.name === "PermissionDeniedError");

      setErrorMessage(
        permissionDenied
          ? "Microphone access is blocked. Allow microphone access for this page and for the browser/Codex in macOS System Settings, then reload and choose Connect voice."
          : message
      );
      setStatusMessage("Voice channel unavailable. Check microphone access, then reconnect.");
      return false;
    }
  };

  const startVoiceSession = async () => {
    if (voiceBootingRef.current) {
      return false;
    }

    if (typeof window === "undefined" || typeof navigator === "undefined") {
      setErrorMessage("Voice is only available in the browser.");
      return false;
    }

    if (!navigator.mediaDevices?.getUserMedia) {
      setErrorMessage("Microphone is not available in this browser.");
      return false;
    }

    if (voiceChannelStatus === "connected") {
      return true;
    }

    setErrorMessage("");
    setStatusMessage("Connecting voice channel...");
    setVoiceChannelStatus("connecting");
    voiceBootingRef.current = true;

    const requestedAgentId = resolveElevenLabsAgentId();
    let agentId = "";

    try {
      const microphoneReady = await requestMicrophoneAccess();
      if (!microphoneReady) {
        setVoiceChannelStatus("disconnected");
        setIsVoiceAgentSpeaking(false);
        return false;
      }

      let conversationToken = "";
      let tokenError = "";
      try {
        const controller = new AbortController();
        const timeoutId = window.setTimeout(() => controller.abort(), VOICE_TOKEN_TIMEOUT_MS);
        let tokenResponse: Response;
        try {
          tokenResponse = await fetch(
            requestedAgentId
              ? `/api/elevenlabs/token?agentId=${encodeURIComponent(requestedAgentId)}`
              : "/api/elevenlabs/token",
            {
            method: "GET",
            cache: "no-store",
            signal: controller.signal
            }
          );
        } finally {
          window.clearTimeout(timeoutId);
        }

        const tokenRaw = await tokenResponse.text();
        const tokenPayload = (tokenRaw ? JSON.parse(tokenRaw) : {}) as {
          token?: string;
          agentId?: string;
          mode?: string;
          error?: string;
          warning?: string;
        };

        if (!tokenResponse.ok) {
          // Server refused (voice not configured, not allow-listed, access expired, rate-limited):
          // show its plain-language message and don't try to reach ElevenLabs directly.
          setVoiceChannelStatus("disconnected");
          setIsVoiceAgentSpeaking(false);
          setErrorMessage(
            typeof tokenPayload?.error === "string" && tokenPayload.error.trim()
              ? tokenPayload.error.trim()
              : "Voice coaching isn't available right now. You can continue by text."
          );
          setStatusMessage("");
          return false;
        }
        agentId = typeof tokenPayload?.agentId === "string" ? tokenPayload.agentId.trim() : "";

        if (tokenResponse.ok) {
          conversationToken =
            typeof tokenPayload?.token === "string" && tokenPayload.token.trim()
              ? tokenPayload.token.trim()
              : "";
          if (!conversationToken && typeof tokenPayload?.warning === "string" && tokenPayload.warning.trim()) {
            tokenError = tokenPayload.warning.trim();
          }
        } else {
          tokenError = await readApiError(tokenResponse, "Unable to create voice token.");
        }
      } catch (tokenFetchError) {
        const tokenErrorMessage =
          tokenFetchError instanceof Error &&
          (tokenFetchError.name === "AbortError" || /aborted|timeout/i.test(tokenFetchError.message))
            ? "Voice token request timed out."
            : "";
        tokenError =
          tokenErrorMessage ||
          (tokenFetchError instanceof Error
            ? tokenFetchError.message
            : "Unable to read voice token response.");
      }

      const attempts: Array<{ label: string; options: Record<string, unknown> }> = [];
      if (conversationToken) {
        attempts.push({
          label: "token + webrtc",
          options: {
            conversationToken,
            connectionType: "webrtc"
          }
        });
      }
      const allowDirectAgent = !conversationToken && Boolean(agentId);
      if (allowDirectAgent) {
        attempts.push({
          label: "agent + webrtc",
          options: {
            agentId,
            connectionType: "webrtc"
          }
        });
      }
      if (ENABLE_WEBSOCKET_VOICE_FALLBACK) {
        if (conversationToken) {
          attempts.push({
            label: "token + websocket",
            options: {
              conversationToken,
              connectionType: "websocket"
            }
          });
        }
        if (allowDirectAgent) {
          attempts.push({
            label: "agent + websocket",
            options: {
              agentId,
              connectionType: "websocket"
            }
          });
        }
      }

      if (typeof window !== "undefined") {
        const preferredLabel = window.localStorage.getItem(VOICE_LAST_ATTEMPT_STORAGE_KEY)?.trim();
        if (preferredLabel) {
          const preferredAttemptIndex = attempts.findIndex((attempt) => attempt.label === preferredLabel);
          if (preferredAttemptIndex > 0) {
            const [preferredAttempt] = attempts.splice(preferredAttemptIndex, 1);
            attempts.unshift(preferredAttempt);
          }
        }
      }

      const attemptErrors: string[] = [];
      for (const attempt of attempts) {
        try {
          setStatusMessage(`Connecting voice (${attempt.label})...`);
          await stopVoiceSession({ preserveBooting: true });
          await elevenConversation.startSession(attempt.options as any);
          await waitForVoiceConnected(VOICE_CONNECT_TIMEOUT_MS);
          if (typeof window !== "undefined") {
            window.localStorage.setItem(VOICE_LAST_ATTEMPT_STORAGE_KEY, attempt.label);
          }
          try {
            elevenConversation.sendContextualUpdate(VOICE_CONTEXT_GUARDRAIL);
          } catch {
            // no-op
          }
          setErrorMessage("");
          setStatusMessage("Voice channel connected. Two-way conversation is live.");
          return true;
        } catch (attemptError) {
          const detail =
            attemptError instanceof Error ? attemptError.message : "Connection attempt failed.";
          attemptErrors.push(`${attempt.label}: ${detail}`);
        }
      }

      const detailMessage = [tokenError, ...attemptErrors].filter(Boolean).join(" | ");
      setVoiceChannelStatus("disconnected");
      setIsVoiceAgentSpeaking(false);
      setErrorMessage(detailMessage || "Unable to connect voice channel.");
      setStatusMessage("Voice channel unavailable. Continue by text or reconnect.");
      return false;
    } catch (primaryError) {
      const detail =
        primaryError instanceof Error ? primaryError.message : "Unable to connect voice channel.";
      setVoiceChannelStatus("disconnected");
      setIsVoiceAgentSpeaking(false);
      setErrorMessage(detail);
      setStatusMessage("Voice channel unavailable. Continue by text or reconnect.");
      return false;
    } finally {
      voiceBootingRef.current = false;
    }
  };

  const startTextSession = () => {
    if (!REQUIRE_BETA_LOGIN) {
      const sharedTestMode = isSharedTestMode();
      const trialUser = "TestUser";

      if (sessionActiveRef.current) {
        setSessionActive(true);
        setStatusMessage("Coaching session active.");
        setErrorMessage("");
        return true;
      }

      if (sharedTestMode) {
        const current = trialStatus ?? getStoredTrialStatus(trialUser);

        if (current.activeSessionId) {
          sessionActiveRef.current = true;
          setSessionActive(true);
          setStatusMessage("Coaching session active.");
          setErrorMessage("");
          return true;
        }

        if (current.sessionsRemaining <= 0) {
          setErrorMessage("Test limit reached: no coaching sessions remaining.");
          return false;
        }

        saveTrialStatus(
          {
            ...current,
            sessionsUsed: current.sessionsUsed + 1,
            sessionsRemaining: current.sessionsRemaining - 1,
            activeSessionId: `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`
          },
          trialUser
        );
      }

      sessionActiveRef.current = true;
      setSessionActive(true);
      setChatMessages([{ role: "assistant", content: INITIAL_COACH_MESSAGE }]);
      setChatInput("");
      setExecutionToolsEnabled(false);
      setActionHubItems([]);
      setCalendarAction("");
      setActionDueDates({});
      appliedPlanSignatureRef.current = "";
      clearPendingActionPlan();
      if (!sharedTestMode) {
        setTrialStatus(TEST_TRIAL_STATUS);
      }
      setStatusMessage("Coaching session started.");
      setErrorMessage("");
      return true;
    }

    const trialUser = authenticatedBetaUsername ?? resolveAllowedBetaUsername(username);
    const current = trialStatus ?? getStoredTrialStatus(trialUser);

    if (current.activeSessionId) {
      sessionActiveRef.current = true;
      setSessionActive(true);
      setStatusMessage("Coaching session active.");
      setErrorMessage("");
      return true;
    }

    if (current.sessionsRemaining <= 0) {
      setErrorMessage("Trial limit reached: no coaching sessions remaining.");
      return false;
    }

    const next = saveTrialStatus(
      {
        ...current,
        sessionsUsed: current.sessionsUsed + 1,
        sessionsRemaining: current.sessionsRemaining - 1,
        activeSessionId: `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`
      },
      trialUser
    );

    sessionActiveRef.current = Boolean(next.activeSessionId);
    setSessionActive(Boolean(next.activeSessionId));
    setChatMessages([{ role: "assistant", content: INITIAL_COACH_MESSAGE }]);
    setChatInput("");
    setExecutionToolsEnabled(false);
    setActionHubItems([]);
    setCalendarAction("");
    setActionDueDates({});
    appliedPlanSignatureRef.current = "";
    clearPendingActionPlan();
    setStatusMessage("Coaching session started.");
    setErrorMessage("");
    return true;
  };

  const startSelectedSession = async () => {
    const started = startTextSession();
    if (!started) {
      return;
    }

    if (coachingStartMode === "voice") {
      await startVoiceSession();
      return;
    }

    await stopVoiceSession();
  };

  const endTextSession = (reason?: string) => {
    if (!REQUIRE_BETA_LOGIN) {
      if (isSharedTestMode()) {
        const trialUser = "TestUser";
        const current = trialStatus ?? getStoredTrialStatus(trialUser);
        saveTrialStatus(
          {
            ...current,
            activeSessionId: null
          },
          trialUser
        );
      }
      sessionActiveRef.current = false;
      setSessionActive(false);
      if (coachingStartModeRef.current === "voice" || voiceChannelStatus !== "disconnected") {
        void stopVoiceSession();
      }
      setStatusMessage(reason ?? "Coaching session ended.");
      setErrorMessage("");
      return;
    }

    const trialUser = authenticatedBetaUsername ?? resolveAllowedBetaUsername(username);
    const current = trialStatus ?? getStoredTrialStatus(trialUser);

    saveTrialStatus(
      {
        ...current,
        activeSessionId: null
      },
      trialUser
    );

    sessionActiveRef.current = false;
    setSessionActive(false);
    if (coachingStartModeRef.current === "voice" || voiceChannelStatus !== "disconnected") {
      void stopVoiceSession();
    }
    setStatusMessage(reason ?? "Coaching session ended.");
    setErrorMessage("");
  };

  const startApp = async () => {
    setAuthError("");
    setErrorMessage("");

    if (!REQUIRE_BETA_LOGIN) {
      setAuthenticatedBetaUsername("TestUser");
      if (isSharedTestMode()) {
        const trial = getStoredTrialStatus("TestUser");
        saveTrialStatus(trial, "TestUser");
      } else {
        setTrialStatus(TEST_TRIAL_STATUS);
      }
      setScreen("session");
      sessionActiveRef.current = false;
      setSessionActive(false);
      setStatusMessage(
        isSharedTestMode()
          ? "Shared test mode active. 2 coaching attempts per browser."
          : ""
      );
      return;
    }

    // Fix #4: access is checked on the server (access-code cookie). The beta username only selects
    // which trial record to use; no password lives in client code any more.
    const resolvedUsername = resolveAllowedBetaUsername(username);

    if (!resolvedUsername) {
      setAuthError("Enter your beta username, for example Beta1.");
      return;
    }

    setIsAuthenticatingTrial(true);
    try {
      setUsername(resolvedUsername);
      setAuthenticatedBetaUsername(resolvedUsername);
      const trial = getStoredTrialStatus(resolvedUsername);
      saveTrialStatus(trial, resolvedUsername);
      setScreen("session");

      if (trial.activeSessionId) {
        sessionActiveRef.current = true;
        setSessionActive(true);
        setStatusMessage("Coaching session active.");
      } else {
        sessionActiveRef.current = false;
        setSessionActive(false);
        setStatusMessage(
          trial.sessionsRemaining > 0
            ? `Trial active. ${trial.sessionsRemaining} coaching session(s) remaining. Choose coaching mode on the coaching screen, then press Start Coaching.`
            : "Trial limit reached: no coaching sessions remaining."
        );
      }
    } finally {
      setIsAuthenticatingTrial(false);
    }
  };

  // Fix #2: the server must unlock this browser (signed httpOnly cookie) before the coaching screen opens.
  const [accessConfigured, setAccessConfigured] = useState(true);
  const openWelcome = async () => {
    try {
      const response = await fetch("/api/access", { cache: "no-store" });
      const data = (await response.json()) as { configured?: boolean; authorized?: boolean };
      if (!data?.authorized) {
        setAccessConfigured(data?.configured !== false);
        setScreen("access");
        setStatusMessage("");
        setErrorMessage("");
        return;
      }
    } catch {
      setAccessConfigured(true);
      setScreen("access");
      return;
    }
    openWelcomeUnlocked();
  };

  const openWelcomeUnlocked = () => {
    if (coachingStartModeRef.current === "voice" || voiceChannelStatus !== "disconnected") {
      void stopVoiceSession();
    }

    if (!REQUIRE_BETA_LOGIN) {
      setAuthenticatedBetaUsername("TestUser");
      if (isSharedTestMode()) {
        const trial = getStoredTrialStatus("TestUser");
        saveTrialStatus(trial, "TestUser");
      } else {
        setTrialStatus(TEST_TRIAL_STATUS);
      }
      setScreen("session");
      sessionActiveRef.current = false;
      setSessionActive(false);
      setStatusMessage(
        isSharedTestMode()
          ? "Shared test mode active. 2 coaching attempts per browser."
          : ""
      );
      setErrorMessage("");
      setAuthError("");
      return;
    }

    setScreen("welcome");
    setStatusMessage("");
    setErrorMessage("");
    setAuthError("");
  };

  const openCover = () => {
    if (coachingStartModeRef.current === "voice" || voiceChannelStatus !== "disconnected") {
      void stopVoiceSession();
    }
    setScreen("cover");
    setStatusMessage("");
    setErrorMessage("");
    setAuthError("");
  };

  const getResolvedRecipientName = () =>
    deliveryName.trim() || authenticatedBetaUsername || resolveAllowedBetaUsername(username) || "Coachee";

  const upsertReminder = (actionText: string, dueAtIso: string, toEmail: string) => {
    setReminders((previous) => {
      const existing = previous.find((item) => item.action === actionText);
      if (existing) {
        return previous.map((item) =>
          item.id === existing.id
            ? {
                ...item,
                dueAt: dueAtIso,
                toEmail,
                completedAt: null
              }
            : item
        );
      }

      return [
        {
          id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
          action: actionText,
          dueAt: dueAtIso,
          toEmail,
          createdAt: new Date().toISOString(),
          completedAt: null,
          browserNotifiedAt: null
        },
        ...previous
      ];
    });
  };

  const requestBrowserNotificationPermission = async () => {
    if (typeof window === "undefined" || !("Notification" in window)) {
      setNotificationPermission("unsupported");
      setErrorMessage("Browser notifications are not supported on this device/browser.");
      return;
    }

    try {
      const permission = await window.Notification.requestPermission();
      setNotificationPermission(permission);
      if (permission === "granted") {
        setStatusMessage("Browser notifications enabled.");
      } else {
        setErrorMessage("Browser notifications were not enabled.");
      }
    } catch {
      setErrorMessage("Unable to request browser notification permission.");
    }
  };

  const markReminderComplete = (id: string) => {
    setReminders((previous) =>
      previous.map((item) =>
        item.id === id
          ? {
              ...item,
              completedAt: item.completedAt ?? new Date().toISOString()
            }
          : item
      )
    );
  };

  const removeReminder = (id: string) => {
    setReminders((previous) => previous.filter((item) => item.id !== id));
  };

  const resolveActionStartDate = (actionText: string, fallbackIndex = 0) => {
    const actionSpecificDate = actionDueDates[actionText]?.trim() ?? "";
    if (actionSpecificDate) {
      const explicit = parseActionDueDateInput(actionSpecificDate);
      if (explicit) {
        return explicit;
      }
    }

    const baseStart = calendarStartLocal
      ? new Date(calendarStartLocal)
      : new Date(Date.now() + 24 * 60 * 60 * 1000);

    if (Number.isNaN(baseStart.getTime())) {
      return null;
    }

    return new Date(baseStart.getTime() + fallbackIndex * 24 * 60 * 60 * 1000);
  };

  const hasCalendarAgreement = (actionText: string) =>
    (actionCalendarAgreements[actionText] ?? "pending") === "agreed";

  // Fix #7: delivery feedback is shown inline next to the Action Hub button that triggered it,
  // in plain language. Technical details stay in the server logs.
  const setHubFeedback = (target: HubFeedbackTarget, tone: "error" | "success", text: string) => {
    setHubFeedbackState(text ? { target, tone, text } : null);
  };

  const friendlyDeliveryError = async (response: Response, kind: "email" | "invite") => {
    const data = (await response.json().catch(() => ({}))) as { code?: string };
    if (data?.code === "not_configured" || response.status === 503) {
      return kind === "email"
        ? "Email delivery isn't switched on yet, so nothing was sent. Your action plan is still saved here."
        : "Calendar invites aren't switched on yet, so nothing was sent. Your actions are still saved here.";
    }
    if (response.status === 400) {
      return "Please check the email address and details, then try again.";
    }
    if (response.status === 401 || response.status === 403) {
      return "Your access has expired. Please refresh the page and enter your access code again.";
    }
    if (response.status === 429) {
      return "Too many requests in a short time. Please wait a minute and try again.";
    }
    return kind === "email"
      ? "We couldn't send the email just now. Please try again in a moment."
      : "We couldn't send the calendar invite just now. Please try again in a moment.";
  };

  const postCalendarInvite = async (toEmail: string, actionText: string, start: Date) => {
    const end = new Date(start.getTime() + 30 * 60 * 1000);
    try {
      const response = await fetch("/api/calendar-invite", {
        method: "POST",
        headers: {
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          toEmail,
          coacheeName: getResolvedRecipientName(),
          actionText,
          startAt: start.toISOString(),
          endAt: end.toISOString()
        })
      });

      if (response.ok) {
        return { ok: true as const };
      }

      return { ok: false as const, error: await friendlyDeliveryError(response, "invite") };
    } catch {
      return {
        ok: false as const,
        error: "We couldn't reach the server. Check your connection and try again."
      };
    }
  };

  const sendActionPlanEmail = async () => {
    const toEmail = deliveryEmail.trim();
    if (!EMAIL_PATTERN.test(toEmail)) {
      setHubFeedback("email", "error", "Enter a valid recipient email above, then try again.");
      return;
    }

    if (actionHubItems.length === 0) {
      setHubFeedback("email", "error", "There are no actions to email yet.");
      return;
    }

    setHubFeedback("email", "error", "");
    setIsSendingPlanEmail(true);

    try {
      const response = await fetch("/api/action-plan-email", {
        method: "POST",
        headers: {
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          toEmail,
          coacheeName: getResolvedRecipientName(),
          summary: lastAssistantMessage,
          actions: actionHubItems
        })
      });

      if (!response.ok) {
        setHubFeedback("email", "error", await friendlyDeliveryError(response, "email"));
        return;
      }

      setHubFeedback("email", "success", `Action plan emailed to ${toEmail}.`);
    } catch {
      setHubFeedback("email", "error", "We couldn't reach the server. Check your connection and try again.");
    } finally {
      setIsSendingPlanEmail(false);
    }
  };

  const sendCalendarInvite = async (actionOverride?: string, fallbackIndex = 0) => {
    const target: HubFeedbackTarget = actionOverride ? `item:${fallbackIndex}` : "calendar";
    const actionText = actionOverride?.trim() || calendarAction.trim() || actionHubItems[0] || "";
    if (!actionText) {
      setHubFeedback(target, "error", "Choose an action for the calendar invite.");
      return;
    }

    if (!hasCalendarAgreement(actionText)) {
      setHubFeedback(target, "error", "Set “Calendar agreement” to “Agreed for calendar” before sending this invite.");
      return;
    }

    const toEmail = deliveryEmail.trim();
    if (!EMAIL_PATTERN.test(toEmail)) {
      setHubFeedback(target, "error", "Enter a valid recipient email at the top of the Action Hub.");
      return;
    }

    const start = resolveActionStartDate(actionText, fallbackIndex);
    if (!start) {
      setHubFeedback(target, "error", "Choose a valid date and time for the invite.");
      return;
    }

    setHubFeedback(target, "error", "");
    setIsSendingCalendarInvite(true);

    try {
      const result = await postCalendarInvite(toEmail, actionText, start);
      if (!result.ok) {
        setHubFeedback(target, "error", result.error);
        return;
      }

      upsertReminder(actionText, start.toISOString(), toEmail);
      setHubFeedback(target, "success", `Calendar invite sent to ${toEmail}.`);
    } finally {
      setIsSendingCalendarInvite(false);
    }
  };

  const sendAllCalendarInvites = async () => {
    if (actionHubItems.length === 0) {
      setHubFeedback("all", "error", "There are no actions to send yet.");
      return;
    }
    const toEmail = deliveryEmail.trim();
    if (!EMAIL_PATTERN.test(toEmail)) {
      setHubFeedback("all", "error", "Enter a valid recipient email at the top of the Action Hub.");
      return;
    }

    setHubFeedback("all", "error", "");
    setIsSendingAllCalendarInvites(true);

    let sent = 0;
    let failed = 0;
    let firstError = "";
    let skippedByAgreement = 0;

    for (let index = 0; index < actionHubItems.length; index += 1) {
      const actionText = actionHubItems[index];
      if (!hasCalendarAgreement(actionText)) {
        skippedByAgreement += 1;
        continue;
      }

      const start = resolveActionStartDate(actionText, index);
      if (!start) {
        failed += 1;
        firstError = firstError || "One action has an invalid date.";
        continue;
      }

      const result = await postCalendarInvite(toEmail, actionText, start);
      if (!result.ok) {
        failed += 1;
        firstError = firstError || result.error;
        continue;
      }

      upsertReminder(actionText, start.toISOString(), toEmail);
      sent += 1;
    }

    const parts: string[] = [];
    if (sent > 0) {
      parts.push(`Sent ${sent} calendar invite${sent === 1 ? "" : "s"}.`);
    }
    if (failed > 0) {
      parts.push(firstError);
    }
    if (skippedByAgreement > 0) {
      parts.push(
        `${skippedByAgreement} action${skippedByAgreement === 1 ? " isn't" : "s aren't"} marked “Agreed for calendar”, so ${skippedByAgreement === 1 ? "it was" : "they were"} skipped.`
      );
    }
    setHubFeedback("all", failed > 0 || sent === 0 ? "error" : "success", parts.join(" "));

    setIsSendingAllCalendarInvites(false);
  };

  const sendPlanEmailAndAllCalendarInvites = async () => {
    const toEmail = deliveryEmail.trim();
    if (!EMAIL_PATTERN.test(toEmail)) {
      setHubFeedback("combined", "error", "Enter a valid recipient email above, then try again.");
      return;
    }

    if (actionHubItems.length === 0) {
      setHubFeedback("combined", "error", "There are no actions to send yet.");
      return;
    }

    setHubFeedback("combined", "error", "");
    setIsSendingCombinedDelivery(true);

    let emailError = "";
    let sentInvites = 0;
    let failedInvites = 0;
    let firstInviteError = "";
    let skippedByAgreement = 0;

    try {
      try {
        const emailResponse = await fetch("/api/action-plan-email", {
          method: "POST",
          headers: {
            "Content-Type": "application/json"
          },
          body: JSON.stringify({
            toEmail,
            coacheeName: getResolvedRecipientName(),
            summary: lastAssistantMessage,
            actions: actionHubItems
          })
        });
        if (!emailResponse.ok) {
          emailError = await friendlyDeliveryError(emailResponse, "email");
        }
      } catch {
        emailError = "We couldn't reach the server to send the email.";
      }

      for (let index = 0; index < actionHubItems.length; index += 1) {
        const actionText = actionHubItems[index];
        if (!hasCalendarAgreement(actionText)) {
          skippedByAgreement += 1;
          continue;
        }

        const start = resolveActionStartDate(actionText, index);
        if (!start) {
          failedInvites += 1;
          firstInviteError = firstInviteError || "One action has an invalid date.";
          continue;
        }

        const result = await postCalendarInvite(toEmail, actionText, start);
        if (!result.ok) {
          failedInvites += 1;
          firstInviteError = firstInviteError || result.error;
          continue;
        }

        upsertReminder(actionText, start.toISOString(), toEmail);
        sentInvites += 1;
      }

      const parts: string[] = [];
      const bothUnavailable =
        /switched on yet/.test(emailError) && /switched on yet/.test(firstInviteError) && sentInvites === 0;
      if (bothUnavailable) {
        parts.push("Email and calendar delivery aren't switched on yet, so nothing was sent. Your action plan is still saved here.");
      } else {
        parts.push(emailError || `Action plan emailed to ${toEmail}.`);
        if (sentInvites > 0) {
          parts.push(`Sent ${sentInvites} calendar invite${sentInvites === 1 ? "" : "s"}.`);
        }
        if (failedInvites > 0) {
          parts.push(firstInviteError);
        }
      }
      if (skippedByAgreement > 0) {
        parts.push(
          `${skippedByAgreement} action${skippedByAgreement === 1 ? " isn't" : "s aren't"} marked “Agreed for calendar”, so no invite${skippedByAgreement === 1 ? " was" : "s were"} sent for ${skippedByAgreement === 1 ? "it" : "them"}.`
        );
      }
      setHubFeedback("combined", emailError || failedInvites > 0 ? "error" : "success", parts.join(" "));
    } finally {
      setIsSendingCombinedDelivery(false);
    }
  };

  const handleAssistantToolCalls = async (toolCalls: AssistantToolCall[], assistantContextText: string) => {
    if (!toolCalls.length) {
      return;
    }

    const dedupedCalls = Array.from(
      new Map(toolCalls.map((toolCall) => [`${normalizeToolCallName(toolCall.name)}:${toolCall.raw}`, toolCall])).values()
    );

    let savedPlanActions = 0;
    let shouldEndSession = false;

    for (const toolCall of dedupedCalls) {
      const name = normalizeToolCallName(toolCall.name);

      if (name === "save_action_plan") {
        const planItems = [
          ...extractPlanItemsFromToolPayload(toolCall.payload),
          ...extractPlanItemsFromToolRaw(toolCall.raw)
        ];
        setExecutionToolsEnabled(true);

        if (planItems.length > 0) {
          const actionOnlyItems = normalizeActionItems(
            planItems.map((item) => item.action.trim()).filter(Boolean)
          );
          const signature = buildActionPlanSignature(actionOnlyItems);
          if (!signature || signature === appliedPlanSignatureRef.current) {
            continue;
          }

          pendingPlanSignatureRef.current = signature;
          pendingPlanItemsRef.current = actionOnlyItems;
          pendingPlanAssistantIndexRef.current = Math.max(0, chatMessagesRef.current.length - 1);

          const latestUserMessage =
            [...chatMessagesRef.current]
              .reverse()
              .find((message) => message.role === "user")?.content ?? "";
          const alreadyAgreed = Boolean(latestUserMessage) && isPlanApprovedMessage(latestUserMessage);

          if (alreadyAgreed && finalizeActionPlan(actionOnlyItems, signature, { autoImported: true })) {
            savedPlanActions += actionOnlyItems.length;
          }
        }
      } else if (name === "end_session") {
        shouldEndSession = true;
      }
    }

    if (savedPlanActions > 0) {
      setStatusMessage(
        `Action plan imported to Action Hub (${savedPlanActions} action${savedPlanActions === 1 ? "" : "s"}).`
      );
    } else if (dedupedCalls.some((toolCall) => normalizeToolCallName(toolCall.name) === "save_action_plan")) {
      setStatusMessage(
        "Action plan ready. Awaiting coachee confirmation (yes/okay/fine) to transfer to Action Hub."
      );
    }

    if (shouldEndSession && sessionActive) {
      endTextSession(resolveCoachEndingMessage(assistantContextText));
    }
  };

  const resolveCoachEndingMessage = (assistantText: string) => {
    const trimmed = assistantText.trim();
    if (trimmed.length > 0) {
      return trimmed;
    }
    return COACH_ENDING_MESSAGE;
  };

  const sendChatMessage = async (inputText: string) => {
    setErrorMessage("");

    const trimmedInput = inputText.trim();
    if (!trimmedInput) {
      setErrorMessage("Add a message to send.");
      return;
    }

    if (!sessionActive) {
      setErrorMessage("Start Coaching to send messages.");
      return;
    }

    if (PLAN_INTENT_PATTERN.test(trimmedInput) && !PLAN_NEGATIVE_PATTERN.test(trimmedInput)) {
      setExecutionToolsEnabled(true);
    }

    setIsChatting(true);

    const nextMessages: ChatMessage[] = [...chatMessagesRef.current, { role: "user", content: trimmedInput }];
    setChatMessages(nextMessages);
    chatMessagesRef.current = nextMessages;
    setChatInput("");

    try {
      const isLiveVoiceTurn = coachingStartMode === "voice" && voiceChannelStatus === "connected";
      if (isLiveVoiceTurn) {
        elevenConversation.sendUserMessage(trimmedInput);
        try {
          elevenConversation.sendUserActivity();
        } catch {
          // no-op
        }
        setStatusMessage("Sent to voice coach.");
        return;
      }

      if (coachingStartMode === "voice" && voiceChannelStatus !== "connected") {
        setStatusMessage("Voice channel is not connected. Sending this turn as text.");
      }

      const response = await fetch("/api/chat", {
        method: "POST",
        headers: {
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          messages: nextMessages,
          context: conversationContext,
          coachGender,
          style: "balanced"
        })
      });

      const data = (await response.json()) as {
        text?: string;
        endSession?: boolean;
        error?: string;
        toolCalls?: unknown;
      };

      if (!response.ok) {
        throw new Error(data?.error ?? "Unable to send message.");
      }

      const assistantRaw = String(data?.text ?? "");
      const toolEnvelope = extractAssistantToolCalls(assistantRaw);
      const assistantText = resolveAssistantDisplayText(assistantRaw, toolEnvelope);
      const responseToolCalls = extractAssistantToolCallsFromApi(data?.toolCalls);
      const mergedToolCalls = [...responseToolCalls, ...toolEnvelope.toolCalls];

      if (assistantText) {
        const updatedMessages = [...nextMessages, { role: "assistant" as const, content: assistantText }];
        setChatMessages(updatedMessages);
        chatMessagesRef.current = updatedMessages;
      }

      if (mergedToolCalls.length > 0) {
        await handleAssistantToolCalls(mergedToolCalls, assistantText || assistantRaw);
      }

      if (data?.endSession) {
        endTextSession(resolveCoachEndingMessage(assistantText || assistantRaw));
      }
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : "Unable to send message.");
    } finally {
      setIsChatting(false);
    }
  };

  const handleChatSend = () => {
    void sendChatMessage(chatInput);
  };

  const handleKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    // Enter sends; Shift+Enter inserts a new line. Ignore Enter while an IME composition is active.
    if (event.key === "Enter" && !event.shiftKey && !event.nativeEvent.isComposing) {
      event.preventDefault();
      if (!isChatting && sessionActive) {
        handleChatSend();
      }
    }
  };

  const handleResponseAction = (actionId: string) => {
    if (actionId === "create-action-plan") {
      void sendChatMessage("Please create an action plan for me.");
      return;
    }

    if (actionId === "refer-to-hr") {
      void sendChatMessage("Please refer this topic to an HR specialist.");
      return;
    }

    if (actionId === "end-session") {
      endTextSession(COACH_ENDING_MESSAGE);
      return;
    }
  };

  const responseActions = [
    { id: "create-action-plan", label: "Create action plan" },
    { id: "refer-to-hr", label: "Refer to HR specialist" },
    { id: "end-session", label: "End coaching" }
  ];

  return (
    <div className={`app app--${screen}`}>
      {screen !== "cover" ? (
        <header className="topbar">
          <div className="brand">
            <div className="brand-mark"><Orbit size={26} strokeWidth={1.3} /></div>
            <div>
              <h1 className="brand-title">Agentic Coach</h1>
              <p className="brand-subtitle">YOUR PERSONAL LEADERSHIP STUDIO</p>
            </div>
          </div>
          <span className="studio-topnote"><span className="future-live-dot" /> AI-POWERED. HUMAN-CENTRED.</span>
          <Button
            type="button"
            variant="ghost"
            onClick={() => {
              // Leaving mid-session ends it, so confirm first.
              if (sessionActive) {
                if (!window.confirm("Leave this page? Your current coaching session will end.")) {
                  return;
                }
                endTextSession("Coaching session ended.");
              }
              openCover();
            }}
          >
            {sessionActive ? "End & go home" : "Home"} <ArrowUpRight size={16} />
          </Button>
        </header>
      ) : null}

      <main className={`shell ${screen === "cover" ? "shell--cover" : ""}`}>
        {screen === "cover" ? (
          <CoachingLanding onStart={openWelcome} coachGender={coachGender} onCoachChange={setCoachGender} />
        ) : null}

        {screen === "access" ? (
          <AccessGate configured={accessConfigured} onUnlocked={openWelcomeUnlocked} onBack={openCover} />
        ) : null}

        {screen === "welcome" ? (
          <section className="welcome-grid">
            <Card>
              <CardHeader>
                <CardTitle>Your space for what comes next.</CardTitle>
                <CardDescription>Enter the beta username you were given to continue to the coaching screen.</CardDescription>
              </CardHeader>
              <CardContent className="form-grid">
                <div className="field">
                  <Label htmlFor="username">Username (beta)</Label>
                  <Input id="username" value={username} onChange={(event) => setUsername(event.target.value)} />
                </div>
                {authError ? <p className="error">{authError}</p> : null}

                <div className="inline-actions">
                  <Button type="button" onClick={() => void startApp()} disabled={isAuthenticatingTrial}>
                    {isAuthenticatingTrial ? "Authenticating..." : "Start Coaching"}
                  </Button>
                  <Button type="button" variant="outline" onClick={openCover}>
                    Back
                  </Button>
                </div>
              </CardContent>
            </Card>
          </section>
        ) : null}

        {screen === "session" ? (
          <section className="session-grid">
            <div className="studio-heading"><div><span className="future-eyebrow">A LITTLE SPACE. A NEW PERSPECTIVE.</span><h1>Your next chapter <em>starts here.</em></h1></div><p>Pause. Reflect. Move forward.</p></div>
            <Card className="session-dialogue">
              <CardHeader>
                <div className="coach-intro">
                  <AIPresence compact active={sessionActive} speaking={isVoiceAgentSpeaking || isChatting} variant={coachGender} />
                  <div className="coach-meta">
                    <p className="coach-label">YOUR AI THINKING PARTNER</p>
                    <p className="coach-name">Space to think. Clarity to lead.</p>
                    <div className="coach-selector">
                      <Label htmlFor="coach-gender">Choose your coach</Label>
                      <Select
                        id="coach-gender"
                        aria-label="Choose your coach"
                        value={coachGender}
                        onChange={(event) => setCoachGender(event.target.value as CoachGender)}
                      >
                        {(Object.keys(coachProfiles) as CoachGender[]).map((gender) => (
                          <option key={gender} value={gender}>
                            {coachProfiles[gender].label}
                          </option>
                        ))}
                      </Select>
                    </div>
                  </div>
                </div>

                <CardTitle>Your coaching conversation</CardTitle>
                <CardDescription>
                  Two-way coaching conversation. Choose text or live voice mode.
                </CardDescription>
              </CardHeader>

              <CardContent>
                <div className="session-controls-bar">
                  <div className="inline-actions">
                    <Button
                      type="button"
                      variant={coachingStartMode === "text" ? "default" : "outline"}
                      onClick={() => setCoachingStartMode("text")}
                      disabled={sessionActive}
                    >
                      Coach by text
                    </Button>
                    <Button
                      type="button"
                      variant={coachingStartMode === "voice" ? "default" : "outline"}
                      onClick={() => setCoachingStartMode("voice")}
                      disabled={sessionActive}
                    >
                      Coaching by voice
                    </Button>
                  </div>
                  <Button
                    type="button"
                    variant={sessionActive ? "destructive" : "default"}
                    onClick={() =>
                      sessionActive
                        ? endTextSession("Coaching session ended.")
                        : void startSelectedSession()
                    }
                    disabled={!sessionActive && (trialStatus?.sessionsRemaining ?? 0) <= 0}
                  >
                    {sessionActive
                      ? "End Coaching"
                      : (trialStatus?.sessionsRemaining ?? 0) <= 0
                      ? "Trial Complete"
                      : "Start Coaching"}
                  </Button>
                  {sessionActive && coachingStartMode === "voice" ? (
                    <Button
                      type="button"
                      variant="outline"
                      onClick={() => {
                        voiceAutoConnectAttemptedRef.current = false;
                        void startVoiceSession();
                      }}
                      disabled={voiceChannelStatus === "connecting"}
                    >
                      {voiceChannelStatus === "connected" ? "Reconnect voice" : "Connect voice"}
                    </Button>
                  ) : null}

                  <div className="session-metrics">
                    <span className="session-pill">
                      Mode: {coachingStartMode === "voice" ? "Voice (live)" : "Text"}
                    </span>
                    {coachingStartMode === "voice" ? (
                      <span className="session-pill">
                        Voice: {voiceChannelStatus}
                        {voiceChannelStatus === "connected"
                          ? isVoiceAgentSpeaking
                            ? " (coach speaking)"
                            : " (coach listening)"
                          : ""}
                      </span>
                    ) : null}
                    {trialStatus && trialStatus.sessionsLimit < TEST_TRIAL_STATUS.sessionsLimit ? (
                      <span className="session-pill">Sessions left: {trialStatus.sessionsRemaining}</span>
                    ) : null}
                  </div>
                </div>

                <div className="controls-row">
                  <div className="field">
                    <Label htmlFor="context">Context</Label>
                    <Select
                      id="context"
                      value={conversationContext}
                      onChange={(event) =>
                        setConversationContext(
                          event.target.value as (typeof conversationContexts)[number]["id"]
                        )
                      }
                    >
                      {conversationContexts.map((context) => (
                        <option key={context.id} value={context.id}>
                          {context.label}
                        </option>
                      ))}
                    </Select>
                  </div>
                </div>

                <p className="info">
                  {sessionActive
                    ? coachingStartMode === "voice"
                      ? voiceChannelStatus === "connected"
                        ? "Coaching session active. Speak naturally or type and send."
                        : voiceChannelStatus === "connecting"
                        ? "Coaching session active. Voice channel is connecting."
                        : "Coaching session active. Voice channel disconnected. Use Connect voice or continue by text."
                      : "Coaching session active. Type your response and send."
                    : "Choose coaching mode, then press Start Coaching to begin."}
                </p>

                <div
                  className="transcript"
                  ref={transcriptRef}
                  role="log"
                  aria-label="Coaching conversation"
                  aria-live="polite"
                  tabIndex={0}
                >
                  {chatMessages.map((message, index) => (
                    <div
                      key={`${message.role}-${index}`}
                      className={`message ${message.role === "assistant" ? "assistant" : "user"}`}
                    >
                      {message.role === "assistant" ? (
                        <div className="md-content">
                          <ReactMarkdown remarkPlugins={[remarkGfm]}>{message.content}</ReactMarkdown>
                        </div>
                      ) : (
                        <p>{message.content}</p>
                      )}
                    </div>
                  ))}
                </div>

                <details className="session-actions"><summary>Session actions</summary>
                <div className="action-grid">
                  {responseActions.map((action) => (
                    <Button
                      key={action.id}
                      type="button"
                      variant={action.id === "refer-to-hr" ? "destructive" : "outline"}
                      onClick={() => handleResponseAction(action.id)}
                      disabled={isChatting || !sessionActive}
                    >
                      {action.label}
                    </Button>
                  ))}
                </div>

                </details>

                <div className="composer">
                  <Label htmlFor="user-text">
                    Your message <span className="composer-hint" id="user-text-hint">Enter to send · Shift+Enter for a new line</span>
                  </Label>
                  <Textarea
                    id="user-text"
                    aria-describedby="user-text-hint"
                    value={chatInput}
                    onChange={(event) => setChatInput(event.target.value)}
                    onKeyDown={handleKeyDown}
                    placeholder="Type your coaching response here."
                    rows={4}
                  />
                <div className="inline-actions">
                  <Button type="button" onClick={handleChatSend} disabled={isChatting || !sessionActive}>
                    {isChatting ? "Sending..." : "Send message"}
                  </Button>
                  <Button type="button" variant="outline" onClick={REQUIRE_BETA_LOGIN ? openWelcome : openCover}>
                    {REQUIRE_BETA_LOGIN ? "Log out" : "Back"}
                  </Button>
                </div>
                </div>

                {statusMessage ? <p className="status">{statusMessage}</p> : null}
                {errorMessage ? <p className="error">{errorMessage}</p> : null}
              </CardContent>
            </Card>

            <div className="session-sidebar">
              <Card>
                <CardHeader>
                  <CardTitle>Action Hub</CardTitle>
                  <CardDescription>Action plans requested during coaching are shown here.</CardDescription>
                </CardHeader>
                <CardContent className="form-grid">
                  {!executionToolsEnabled ? (
                    <>
                      <p className="info">
                        Your action plan will appear here. Ask your coach for one, or choose “Create action plan” under Session actions.
                      </p>
                      {transcriptActionItems.length > 0 ? (
                        <Button type="button" variant="outline" onClick={importTranscriptActionsToHub}>
                          Import {transcriptActionItems.length} action{transcriptActionItems.length === 1 ? "" : "s"} from transcript
                        </Button>
                      ) : null}
                    </>
                  ) : actionHubItems.length === 0 ? (
                    <>
                      <p className="info">
                        No actions in Action Hub yet. Confirm the proposed plan (for example: yes / okay / fine)
                        and it will transfer here automatically.
                      </p>
                      {transcriptActionItems.length > 0 ? (
                        <Button type="button" variant="outline" onClick={importTranscriptActionsToHub}>
                          Import {transcriptActionItems.length} action{transcriptActionItems.length === 1 ? "" : "s"} from transcript
                        </Button>
                      ) : null}
                    </>
                  ) : (
                    <>
                      {hasTranscriptItemsNotInHub ? (
                        <Button type="button" variant="outline" onClick={importTranscriptActionsToHub}>
                          Sync additional actions from transcript
                        </Button>
                      ) : null}
                      <div className="field">
                        <Label htmlFor="delivery-email">Recipient email</Label>
                        <Input
                          id="delivery-email"
                          type="email"
                          value={deliveryEmail}
                          onChange={(event) => setDeliveryEmail(event.target.value)}
                          placeholder="name@company.com"
                        />
                      </div>
                      <div className="field">
                        <Label htmlFor="coachee-reminder-email">Reminder email (optional)</Label>
                        <Input
                          id="coachee-reminder-email"
                          type="email"
                          value={coacheeReminderEmail}
                          onChange={(event) => setCoacheeReminderEmail(event.target.value)}
                          placeholder="coachee@company.com"
                        />
                        <p className="info">
                          We’ll use this for reminder emails once they’re available. Nothing is sent from this field today.
                        </p>
                      </div>
                      <div className="action-hub-list">
                        {actionHubItems.map((item, index) => (
                          <div key={item} className="action-hub-item">
                            <div>
                              <p className="action-hub-text">{item}</p>
                              <div className="field" style={{ marginTop: "0.5rem" }}>
                                <Label htmlFor={`action-date-${index}`}>Due date</Label>
                                <Input
                                  id={`action-date-${index}`}
                                  type="date"
                                  value={actionDueDates[item] ?? ""}
                                  onChange={(event) =>
                                    setActionDueDates((previous) => ({
                                      ...previous,
                                      [item]: event.target.value
                                    }))
                                  }
                                />
                              </div>
                              <div className="field" style={{ marginTop: "0.5rem" }}>
                                <Label htmlFor={`action-calendar-agreement-${index}`}>Calendar agreement</Label>
                                <Select
                                  id={`action-calendar-agreement-${index}`}
                                  value={actionCalendarAgreements[item] ?? "pending"}
                                  onChange={(event) =>
                                    setActionCalendarAgreements((previous) => ({
                                      ...previous,
                                      [item]: (event.target.value as CalendarAgreement) ?? "pending"
                                    }))
                                  }
                                >
                                  <option value="pending">Not agreed yet</option>
                                  <option value="agreed">Agreed for calendar</option>
                                  <option value="skip">Skip calendar</option>
                                </Select>
                              </div>
                            </div>
                            <div className="action-hub-menu">
                              <Button
                                type="button"
                                variant="outline"
                                onClick={() => void sendCalendarInvite(item, index)}
                                disabled={
                                  isSendingCalendarInvite ||
                                  isSendingAllCalendarInvites ||
                                  isSendingCombinedDelivery
                                }
                              >
                                {isSendingCalendarInvite ? "Sending..." : "Send invite"}
                              </Button>
                              {hubFeedback?.target === `item:${index}` ? (
                                <p className={`hub-feedback hub-feedback--${hubFeedback.tone}`} role={hubFeedback.tone === "error" ? "alert" : "status"}>
                                  {hubFeedback.text}
                                </p>
                              ) : null}
                            </div>
                          </div>
                        ))}
                      </div>
                      <div className="field">
                        <Label htmlFor="delivery-name">Recipient name (optional)</Label>
                        <Input
                          id="delivery-name"
                          value={deliveryName}
                          onChange={(event) => setDeliveryName(event.target.value)}
                          placeholder="Coachee name"
                        />
                      </div>
                      <div className="field">
                        <Label htmlFor="calendar-action">Action for calendar invite</Label>
                        <Select
                          id="calendar-action"
                          value={calendarAction}
                          onChange={(event) => setCalendarAction(event.target.value)}
                        >
                          {actionHubItems.map((action) => (
                            <option key={action} value={action}>
                              {action}
                            </option>
                          ))}
                        </Select>
                      </div>
                      <div className="field">
                        <Label htmlFor="calendar-start">Calendar time (optional)</Label>
                        <Input
                          id="calendar-start"
                          type="datetime-local"
                          value={calendarStartLocal}
                          onChange={(event) => setCalendarStartLocal(event.target.value)}
                        />
                      </div>
                      <div className="inline-actions">
                        <Button
                          type="button"
                          variant="outline"
                          onClick={() => void sendActionPlanEmail()}
                          disabled={isSendingPlanEmail}
                        >
                          {isSendingPlanEmail ? "Sending email..." : "Email action plan"}
                        </Button>
                        <Button
                          type="button"
                          variant="outline"
                          onClick={() => void sendCalendarInvite()}
                          disabled={isSendingCalendarInvite}
                        >
                          {isSendingCalendarInvite ? "Sending invite..." : "Send to calendar"}
                        </Button>
                        <Button
                          type="button"
                          variant="outline"
                          onClick={() => void sendAllCalendarInvites()}
                          disabled={isSendingAllCalendarInvites}
                        >
                          {isSendingAllCalendarInvites ? "Sending all..." : "Send all actions to calendar"}
                        </Button>
                        <Button
                          type="button"
                          onClick={() => void sendPlanEmailAndAllCalendarInvites()}
                          disabled={isSendingCombinedDelivery}
                        >
                          {isSendingCombinedDelivery
                            ? "Sending all (email + calendar)..."
                            : "Email plan + send all invites"}
                        </Button>
                      </div>
                      {hubFeedback && !hubFeedback.target.startsWith("item:") ? (
                        <p className={`hub-feedback hub-feedback--${hubFeedback.tone}`} role={hubFeedback.tone === "error" ? "alert" : "status"}>
                          <strong>
                            {hubFeedback.target === "email"
                              ? "Email action plan: "
                              : hubFeedback.target === "calendar"
                              ? "Send to calendar: "
                              : hubFeedback.target === "all"
                              ? "Send all actions to calendar: "
                              : "Email plan + send all invites: "}
                          </strong>
                          {hubFeedback.text}
                        </p>
                      ) : null}
                    </>
                  )}
                </CardContent>
              </Card>

              <Card>
                <CardHeader>
                  <CardTitle>Reminder Center</CardTitle>
                  <CardDescription>In-app reminders with optional browser pop-up alerts.</CardDescription>
                </CardHeader>
                <CardContent className="form-grid">
                  <div className="inline-actions">
                    <Button
                      type="button"
                      variant="outline"
                      onClick={() => void requestBrowserNotificationPermission()}
                      disabled={notificationPermission === "granted" || notificationPermission === "unsupported"}
                    >
                      {notificationPermission === "granted"
                        ? "Browser notifications enabled"
                        : notificationPermission === "unsupported"
                        ? "Browser notifications unsupported"
                        : "Enable browser notifications"}
                    </Button>
                  </div>

                  {reminderItemsSorted.length === 0 ? (
                    <p className="info">No reminders yet. Sending calendar invites will add reminders here.</p>
                  ) : (
                    <div className="action-hub-list">
                      {reminderItemsSorted.map((reminder) => {
                        const dueAt = new Date(reminder.dueAt);
                        const isOverdue = !reminder.completedAt && dueAt.getTime() <= Date.now();
                        return (
                          <div key={reminder.id} className="action-hub-item">
                            <div>
                              <p className="action-hub-text">{reminder.action}</p>
                              <p className="info">
                                Due: {Number.isNaN(dueAt.getTime()) ? reminder.dueAt : dueAt.toLocaleString()}
                              </p>
                              <p className="info">Recipient: {reminder.toEmail}</p>
                              {reminder.completedAt ? (
                                <p className="status">Completed</p>
                              ) : isOverdue ? (
                                <p className="error">Due now</p>
                              ) : null}
                            </div>
                            <div className="action-hub-menu">
                              <Button
                                type="button"
                                variant="outline"
                                onClick={() => markReminderComplete(reminder.id)}
                                disabled={Boolean(reminder.completedAt)}
                              >
                                {reminder.completedAt ? "Completed" : "Mark done"}
                              </Button>
                              <Button
                                type="button"
                                variant="outline"
                                onClick={() => removeReminder(reminder.id)}
                              >
                                Remove
                              </Button>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  )}
                </CardContent>
              </Card>
            </div>
          </section>
        ) : null}
      </main>
    </div>
  );
}
