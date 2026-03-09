"use client";

import { useEffect, useMemo, useRef, useState, type KeyboardEvent } from "react";
import { useConversation } from "@elevenlabs/react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { Button } from "../components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "../components/ui/card";
import { Input } from "../components/ui/input";
import { Label } from "../components/ui/label";
import { Select } from "../components/ui/select";
import { Textarea } from "../components/ui/textarea";

type AppScreen = "cover" | "welcome" | "session";
type CoachGender = "male" | "female";
type ChatRole = "assistant" | "user";
type CoachingStartMode = "text" | "voice";
type VoiceChannelStatus = "disconnected" | "connecting" | "connected";

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

type AssistantToolCall = {
  name: string;
  payload?: unknown;
  raw: string;
};

type ToolPlanItem = {
  action: string;
};

type ReminderItem = {
  id: string;
  action: string;
  dueAt: string;
  toEmail: string;
  createdAt: string;
  completedAt: string | null;
  browserNotifiedAt: string | null;
};

const BETA_PASSWORD = "12345";
const MAX_BETA_USERS = 8;
const MAX_TRIAL_SESSIONS = 1;
const REQUIRE_BETA_LOGIN = process.env.NEXT_PUBLIC_REQUIRE_BETA_LOGIN === "true";
const TRIAL_STATE_STORAGE_KEY_PREFIX = "agenticCoach.trialState.v7";
const TRIAL_STATE_STORAGE_KEY_ROOT = "agenticCoach.trialState.";
const TRIAL_RESET_QUERY_KEYS = ["trialReset", "resetTrial", "reset_trial", "renewTrial"] as const;
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const REMINDERS_STORAGE_KEY = "agenticCoach.reminders.v1";
const REMINDER_POLL_MS = 30_000;
const DEFAULT_ELEVENLABS_AGENT_ID = "agent_2301kj5gk2bkezts94y36e0tzxza";
const DEFAULT_ELEVENLABS_VOICE_ID_MALE = "QF9HJC7XWnue5c9W3LkY";
const DEFAULT_ELEVENLABS_VOICE_ID_FEMALE = "gJx1vCzNCD1EQHT212Ls";
const VOICE_CONNECT_TIMEOUT_MS = 5_000;
const VOICE_TOKEN_TIMEOUT_MS = 2_500;
const VOICE_LAST_ATTEMPT_STORAGE_KEY = "agenticCoach.voice.lastAttempt.v1";
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
const PLAN_OUTPUT_PATTERN = /^#{1,6}\s*(action plan|development plan)\b/im;
const PLAN_APPROVAL_PATTERN =
  /\b(i agree|agreed|approve|approved|yes|yep|sounds good|looks good|go ahead|proceed|let'?s do it)\b/i;
const PLAN_REJECTION_PATTERN = /\b(don't agree|do not agree|not now|decline|reject|no)\b/i;

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

const normalizeTrialStatus = (raw?: Partial<TrialStatus> | null): TrialStatus => {
  const sessionsLimit = MAX_TRIAL_SESSIONS;
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
  const resolved = resolveAllowedBetaUsername(betaUsername ?? "");
  return resolved
    ? `${TRIAL_STATE_STORAGE_KEY_PREFIX}:${resolved.toLowerCase()}`
    : `${TRIAL_STATE_STORAGE_KEY_PREFIX}:guest`;
};

const normalizeToolCallName = (name: string) =>
  name
    .trim()
    .toLowerCase()
    .replace(/[:\s-]+/g, "_");

const TOOL_CALL_START_PATTERN = /\(\s*calling tool\b/i;
const TOOL_CALL_NAME_PATTERN = /\(\s*calling tool\s*:?\s*([a-zA-Z0-9_:-]+)/i;

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
    .replace(/\(\s*calling tool\b[\s\S]*?(?:\n{2,}|$)/gi, "\n")
    .replace(/^\s*calling tool\b.*$/gim, "")
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

const extractPlanItemsFromToolPayload = (payload: unknown): ToolPlanItem[] => {
  if (!payload || typeof payload !== "object") {
    return [];
  }

  const source = payload as Record<string, unknown>;
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

const extractActionItemsFromText = (text: string) => {
  const bulletPattern = /^\s*([-*+]\s+|\d+[.)]\s+)(.+)$/;
  const lines = text.split("\n");
  const result: string[] = [];

  for (const line of lines) {
    const match = line.match(bulletPattern);
    if (!match) {
      continue;
    }

    const item = match[2].trim();
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

const buildActionPlanSignature = (items: string[]) =>
  normalizeActionItems(items)
    .map((item) => item.toLowerCase())
    .join("||");

const getTrialResetRequested = () => {
  if (typeof window === "undefined") {
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
  const [password, setPassword] = useState("");
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
  const [deliveryName, setDeliveryName] = useState("");
  const [calendarAction, setCalendarAction] = useState("");
  const [calendarStartLocal, setCalendarStartLocal] = useState("");
  const [actionDueDates, setActionDueDates] = useState<Record<string, string>>({});
  const [reminders, setReminders] = useState<ReminderItem[]>([]);
  const [notificationPermission, setNotificationPermission] = useState<NotificationPermission | "unsupported">(
    "unsupported"
  );
  const [isSendingPlanEmail, setIsSendingPlanEmail] = useState(false);
  const [isSendingCalendarInvite, setIsSendingCalendarInvite] = useState(false);
  const [isSendingAllCalendarInvites, setIsSendingAllCalendarInvites] = useState(false);
  const [isSendingCombinedDelivery, setIsSendingCombinedDelivery] = useState(false);

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

  const selectedCoach = coachProfiles[coachGender];

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

  const finalizeActionPlan = (rawItems: string[], signatureHint?: string) => {
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
    setStatusMessage("Action plan finalised and moved to Action Hub.");
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
      const next = [...previous, { role, content }];
      chatMessagesRef.current = next;
      return next;
    });
  };

  const resolveElevenLabsAgentId = () =>
    process.env.NEXT_PUBLIC_ELEVENLABS_AGENT_ID?.trim() || DEFAULT_ELEVENLABS_AGENT_ID;

  const resolveElevenLabsVoiceId = (gender: CoachGender) =>
    gender === "female"
      ? process.env.NEXT_PUBLIC_ELEVENLABS_VOICE_ID_FEMALE?.trim() || DEFAULT_ELEVENLABS_VOICE_ID_FEMALE
      : process.env.NEXT_PUBLIC_ELEVENLABS_VOICE_ID_MALE?.trim() || DEFAULT_ELEVENLABS_VOICE_ID_MALE;

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
        const assistantText = (toolEnvelope.displayText || rawMessage).trim();
        if (assistantText) {
          appendLiveMessage("assistant", assistantText);
        }
        if (toolEnvelope.toolCalls.length > 0) {
          void handleAssistantToolCalls(toolEnvelope.toolCalls, assistantText || rawMessage);
        }
        return;
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

    const planItemsFromMessage = extractActionItemsFromText(lastMessage.content);
    if (!PLAN_OUTPUT_PATTERN.test(lastMessage.content) || planItemsFromMessage.length === 0) {
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
    setStatusMessage(
      "Action plan created. If the coachee agrees, I will keep it in Action Hub."
    );
  }, [chatMessages]);

  useEffect(() => {
    const lastMessage = chatMessages[chatMessages.length - 1];
    if (lastMessage?.role !== "user") {
      return;
    }

    if (!pendingPlanSignatureRef.current) {
      return;
    }

    if (chatMessages.length - 1 <= pendingPlanAssistantIndexRef.current) {
      return;
    }

    const text = lastMessage.content.trim();
    if (!text || PLAN_REJECTION_PATTERN.test(text) || !PLAN_APPROVAL_PATTERN.test(text)) {
      return;
    }

    if (pendingPlanItemsRef.current.length === 0) {
      return;
    }

    finalizeActionPlan(pendingPlanItemsRef.current, pendingPlanSignatureRef.current);
  }, [chatMessages]);

  useEffect(() => {
    if (actionHubItems.length === 0) {
      setCalendarAction("");
      setActionDueDates({});
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
      }, 150);
    });
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

    const agentId = resolveElevenLabsAgentId();

    try {
      await navigator.mediaDevices.getUserMedia({ audio: true });

      let conversationToken = "";
      let tokenError = "";
      try {
        const controller = new AbortController();
        const timeoutId = window.setTimeout(() => controller.abort(), VOICE_TOKEN_TIMEOUT_MS);
        let tokenResponse: Response;
        try {
          tokenResponse = await fetch(`/api/elevenlabs/token?agentId=${encodeURIComponent(agentId)}`, {
            method: "GET",
            cache: "no-store",
            signal: controller.signal
          });
        } finally {
          window.clearTimeout(timeoutId);
        }

        const tokenRaw = await tokenResponse.text();
        const tokenPayload = (tokenRaw ? JSON.parse(tokenRaw) : {}) as {
          token?: string;
          error?: string;
          warning?: string;
        };

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
        attempts.push({
          label: "token + websocket",
          options: {
            conversationToken,
            connectionType: "websocket"
          }
        });
      }
      attempts.push({
        label: "agent + webrtc",
        options: {
          agentId,
          connectionType: "webrtc"
        }
      });
      attempts.push({
        label: "agent + websocket",
        options: {
          agentId,
          connectionType: "websocket"
        }
      });

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
      if (sessionActiveRef.current) {
        setSessionActive(true);
        setStatusMessage("Coaching session active.");
        setErrorMessage("");
        return true;
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
      setTrialStatus(TEST_TRIAL_STATUS);
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
      setTrialStatus(TEST_TRIAL_STATUS);
      setScreen("session");
      sessionActiveRef.current = false;
      setSessionActive(false);
      setStatusMessage("Test mode active. Login is disabled.");
      return;
    }

    const normalizedPassword = password.trim();
    const resolvedUsername = resolveAllowedBetaUsername(username);

    if (!resolvedUsername || normalizedPassword !== BETA_PASSWORD) {
      setAuthError("Invalid credentials. Use username Beta1 to Beta8 and password 12345.");
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

  const openWelcome = () => {
    if (coachingStartModeRef.current === "voice" || voiceChannelStatus !== "disconnected") {
      void stopVoiceSession();
    }

    if (!REQUIRE_BETA_LOGIN) {
      setAuthenticatedBetaUsername("TestUser");
      setTrialStatus(TEST_TRIAL_STATUS);
      setScreen("session");
      sessionActiveRef.current = false;
      setSessionActive(false);
      setStatusMessage("Test mode active. Login is disabled.");
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
      const explicit = new Date(actionSpecificDate);
      if (!Number.isNaN(explicit.getTime())) {
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

  const postCalendarInvite = async (toEmail: string, actionText: string, start: Date) => {
    const end = new Date(start.getTime() + 30 * 60 * 1000);
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

    const data = (await response.json().catch(() => ({}))) as { error?: string; details?: string };
    const details = data?.details ? ` ${data.details}` : "";
    return {
      ok: false as const,
      error: `${data?.error ?? "Unable to send calendar invite."}${details}`.trim()
    };
  };

  const sendActionPlanEmail = async () => {
    const toEmail = deliveryEmail.trim();
    if (!EMAIL_PATTERN.test(toEmail)) {
      setErrorMessage("Enter a valid recipient email.");
      return;
    }

    if (actionHubItems.length === 0) {
      setErrorMessage("No action items found to email.");
      return;
    }

    setErrorMessage("");
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

      const data = (await response.json()) as { error?: string; details?: string };
      if (!response.ok) {
        const details = data?.details ? ` ${data.details}` : "";
        throw new Error(`${data?.error ?? "Unable to send action plan email."}${details}`.trim());
      }

      setStatusMessage(`Action plan emailed to ${toEmail}.`);
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : "Unable to send action plan email.");
    } finally {
      setIsSendingPlanEmail(false);
    }
  };

  const sendCalendarInvite = async (actionOverride?: string, fallbackIndex = 0) => {
    const actionText = actionOverride?.trim() || calendarAction.trim() || actionHubItems[0] || "";
    if (!actionText) {
      setErrorMessage("No action selected for calendar invite.");
      return;
    }
    const toEmail = deliveryEmail.trim();
    if (!EMAIL_PATTERN.test(toEmail)) {
      setErrorMessage("Enter a valid recipient email in Action Hub.");
      return;
    }

    const start = resolveActionStartDate(actionText, fallbackIndex);
    if (!start) {
      setErrorMessage("Choose a valid date/time for calendar invite.");
      return;
    }

    setErrorMessage("");
    setIsSendingCalendarInvite(true);

    try {
      const result = await postCalendarInvite(toEmail, actionText, start);
      if (!result.ok) {
        throw new Error(result.error);
      }

      upsertReminder(actionText, start.toISOString(), toEmail);
      setStatusMessage(`Calendar invite sent to ${toEmail}.`);
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : "Unable to send calendar invite.");
    } finally {
      setIsSendingCalendarInvite(false);
    }
  };

  const sendAllCalendarInvites = async () => {
    if (actionHubItems.length === 0) {
      setErrorMessage("No action items found for calendar invites.");
      return;
    }
    const toEmail = deliveryEmail.trim();
    if (!EMAIL_PATTERN.test(toEmail)) {
      setErrorMessage("Enter a valid recipient email in Action Hub.");
      return;
    }

    setErrorMessage("");
    setIsSendingAllCalendarInvites(true);

    let sent = 0;
    const failedActions: string[] = [];

    for (let index = 0; index < actionHubItems.length; index += 1) {
      const actionText = actionHubItems[index];
      const start = resolveActionStartDate(actionText, index);
      if (!start) {
        failedActions.push(`${actionText} (invalid date)`);
        continue;
      }

      try {
        const result = await postCalendarInvite(toEmail, actionText, start);
        if (!result.ok) {
          failedActions.push(actionText);
          continue;
        }

        upsertReminder(actionText, start.toISOString(), toEmail);
        sent += 1;
      } catch {
        failedActions.push(actionText);
      }
    }

    if (sent > 0) {
      setStatusMessage(
        `Sent ${sent} calendar invite${sent === 1 ? "" : "s"} for action reminders.`
      );
    }

    if (failedActions.length > 0) {
      setErrorMessage(
        `Failed to send ${failedActions.length} invite${failedActions.length === 1 ? "" : "s"}: ${failedActions.join("; ")}`
      );
    }

    setIsSendingAllCalendarInvites(false);
  };

  const sendPlanEmailAndAllCalendarInvites = async () => {
    const toEmail = deliveryEmail.trim();
    if (!EMAIL_PATTERN.test(toEmail)) {
      setErrorMessage("Enter a valid recipient email.");
      return;
    }

    if (actionHubItems.length === 0) {
      setErrorMessage("No action items found to send.");
      return;
    }

    setErrorMessage("");
    setIsSendingCombinedDelivery(true);

    let emailSent = false;
    let sentInvites = 0;
    const failedActions: string[] = [];

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

      if (emailResponse.ok) {
        emailSent = true;
      } else {
        const emailData = (await emailResponse.json().catch(() => ({}))) as {
          error?: string;
          details?: string;
        };
        const details = emailData?.details ? ` ${emailData.details}` : "";
        setErrorMessage(
          `${emailData?.error ?? "Unable to send action plan email."}${details}`.trim()
        );
      }

      for (let index = 0; index < actionHubItems.length; index += 1) {
        const actionText = actionHubItems[index];
        const start = resolveActionStartDate(actionText, index);
        if (!start) {
          failedActions.push(`${actionText} (invalid date)`);
          continue;
        }

        try {
          const result = await postCalendarInvite(toEmail, actionText, start);
          if (!result.ok) {
            failedActions.push(actionText);
            continue;
          }

          upsertReminder(actionText, start.toISOString(), toEmail);
          sentInvites += 1;
        } catch {
          failedActions.push(actionText);
        }
      }

      const statusParts: string[] = [];
      statusParts.push(emailSent ? "Action plan email sent." : "Action plan email failed.");
      statusParts.push(
        `Calendar invites sent: ${sentInvites}/${actionHubItems.length}.`
      );
      setStatusMessage(statusParts.join(" "));

      if (failedActions.length > 0) {
        setErrorMessage(
          `Failed invites for ${failedActions.length} action${failedActions.length === 1 ? "" : "s"}: ${failedActions.join("; ")}`
        );
      }
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : "Combined send failed.");
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
        const planItems = extractPlanItemsFromToolPayload(toolCall.payload);
        setExecutionToolsEnabled(true);

        if (planItems.length > 0) {
          const actionOnlyItems = planItems.map((item) => item.action.trim()).filter(Boolean);
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
          const alreadyAgreed =
            Boolean(latestUserMessage) &&
            PLAN_APPROVAL_PATTERN.test(latestUserMessage) &&
            !PLAN_REJECTION_PATTERN.test(latestUserMessage);

          if (alreadyAgreed) {
            if (finalizeActionPlan(actionOnlyItems, signature)) {
              savedPlanActions += planItems.length;
            }
          }
        }
      } else if (name === "end_session") {
        shouldEndSession = true;
      }
    }

    if (savedPlanActions > 0) {
      setStatusMessage(
        `Action plan finalised and moved to Action Hub (${savedPlanActions} action${savedPlanActions === 1 ? "" : "s"}).`
      );
    } else if (dedupedCalls.some((toolCall) => normalizeToolCallName(toolCall.name) === "save_action_plan")) {
      setStatusMessage("Tool call handled: save_action_plan (pending coachee agreement).");
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
      };

      if (!response.ok) {
        throw new Error(data?.error ?? "Unable to send message.");
      }

      const assistantRaw = String(data?.text ?? "");
      const toolEnvelope = extractAssistantToolCalls(assistantRaw);
      const assistantText = (toolEnvelope.displayText || assistantRaw).trim();

      if (assistantText) {
        const updatedMessages = [...nextMessages, { role: "assistant" as const, content: assistantText }];
        setChatMessages(updatedMessages);
        chatMessagesRef.current = updatedMessages;
      }

      if (toolEnvelope.toolCalls.length > 0) {
        await handleAssistantToolCalls(toolEnvelope.toolCalls, assistantText || assistantRaw);
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
    if ((event.metaKey || event.ctrlKey) && event.key === "Enter") {
      event.preventDefault();
      handleChatSend();
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
    <div className="app">
      {screen !== "cover" ? (
        <header className="topbar">
          <div className="brand">
            <div className="brand-mark">AC</div>
            <div>
              <h1 className="brand-title">Agentic Coach</h1>
              <p className="brand-subtitle">Action-focused coaching for mobile and desktop.</p>
            </div>
          </div>
        </header>
      ) : null}

      <main className={`shell ${screen === "cover" ? "shell--cover" : ""}`}>
        {screen === "cover" ? (
          <section className="ec-cover">
            <header className="ec-header">
              <button type="button" className="ec-enter-btn" onClick={openWelcome}>
                Enter
              </button>
            </header>

            <section className="ec-hero">
              <div className="ec-hero-content">
                <h1>
                  World-Class Leadership.
                  <br />
                  Locally Rooted.
                </h1>
                <p>
                  Evidence-based executive coaching designed for visionaries shaping the future of the Gulf.
                  The Agentic Coaching Engine is built by executive coaches with more than 10,000 hours of
                  executive coaching experience across the GCC, EU, and US.
                </p>
                <Button type="button" onClick={openWelcome}>
                  Start coaching
                </Button>
              </div>
              <div className="ec-hero-image-container">
                <img
                  src="/cover-saudi-coaching.jpg"
                  alt="Saudi male and female in a coaching discussion"
                  className="ec-hero-image"
                />
              </div>
            </section>
          </section>
        ) : null}

        {screen === "welcome" ? (
          <section className="welcome-grid">
            <Card>
              <CardHeader>
                <CardTitle>Start Here</CardTitle>
                <CardDescription>Use beta credentials to continue to the coaching screen.</CardDescription>
              </CardHeader>
              <CardContent className="form-grid">
                <div className="field">
                  <Label htmlFor="username">Username (beta)</Label>
                  <Input id="username" value={username} onChange={(event) => setUsername(event.target.value)} />
                </div>
                <div className="field">
                  <Label htmlFor="password">Password (beta)</Label>
                  <Input
                    id="password"
                    type="password"
                    value={password}
                    onChange={(event) => setPassword(event.target.value)}
                  />
                </div>

                <p className="info">Use username `Beta1` to `Beta8` and password `12345`.</p>
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
            <Card>
              <CardHeader>
                <div className="coach-intro">
                  <div className={`coach-avatar ${sessionActive ? "active" : ""}`}>
                    <img src={selectedCoach.avatarSrc} alt={selectedCoach.avatarAlt} />
                  </div>
                  <div className="coach-meta">
                    <p className="coach-label">Your coach</p>
                    <p className="coach-name">{selectedCoach.displayName}</p>
                    <div className="coach-selector">
                      <Label htmlFor="coach-gender">Coach gender</Label>
                      <Select
                        id="coach-gender"
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

                <CardTitle>Live coaching dialogue</CardTitle>
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
                    <span className="session-pill">Trial sessions left: {trialStatus?.sessionsRemaining ?? 0}</span>
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

                <div className="transcript" ref={transcriptRef}>
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

                <h3 className="section-subtitle">Short cut buttons</h3>
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

                <div className="composer">
                  <Label htmlFor="user-text">Your message</Label>
                  <Textarea
                    id="user-text"
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

            <div>
              <Card>
                <CardHeader>
                  <CardTitle>Action Hub</CardTitle>
                  <CardDescription>Action plans requested during coaching are shown here.</CardDescription>
                </CardHeader>
                <CardContent className="form-grid">
                  {!executionToolsEnabled ? (
                    <>
                      <p className="info">
                        Action Hub is clear until an action plan is requested via `Create action plan`.
                      </p>
                      {transcriptActionItems.length > 0 ? (
                        <Button type="button" variant="outline" onClick={importTranscriptActionsToHub}>
                          Import {transcriptActionItems.length} action{transcriptActionItems.length === 1 ? "" : "s"} from transcript
                        </Button>
                      ) : null}
                    </>
                  ) : actionHubItems.length === 0 ? (
                    <>
                      <p className="info">No finalised actions yet. Confirm the proposed action plan to move it here.</p>
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
                      <div className="action-hub-list">
                        {actionHubItems.map((item, index) => (
                          <div key={item} className="action-hub-item">
                            <div>
                              <p className="action-hub-text">{item}</p>
                              <div className="field" style={{ marginTop: "0.5rem" }}>
                                <Label htmlFor={`action-date-${index}`}>Reminder date/time</Label>
                                <Input
                                  id={`action-date-${index}`}
                                  type="datetime-local"
                                  value={actionDueDates[item] ?? ""}
                                  onChange={(event) =>
                                    setActionDueDates((previous) => ({
                                      ...previous,
                                      [item]: event.target.value
                                    }))
                                  }
                                />
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
