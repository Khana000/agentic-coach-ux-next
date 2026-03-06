import { NextResponse } from "next/server";

type ChatMessage = {
  role: "user" | "assistant";
  content: string;
};

type ChatRequest = {
  messages?: ChatMessage[];
  context?: string;
  style?: string;
  coachGender?: "male" | "female";
  nowState?: Record<string, string>;
};

const PLAN_OPT_IN_QUESTION = "Would you like me to create a coaching plan for you?";
const MANAGER_MEETING_QUESTION =
  "Would you like to set up a meeting with your manager to align on what support they can provide?";
const PLAN_FEASIBILITY_QUESTION = "Does this action plan work for you?";
const PLAN_STRUCTURED_OUTPUT_PATTERN =
  /^#{1,6}\s*(reflection|focus plan|first step|action plan|development plan)\b/im;
const END_SESSION_QUESTION = "Would you like to end the coaching session now?";
const END_SESSION_CLOSING_TEXT =
  "Hopefully you found this of use, look forward to our next session, thanks";
const END_SESSION_TOOL_CALL_PATTERN = /\bcalling\s*tool\s*:?\s*end_session\b/i;

type AssistantToolCall = {
  name: string;
  payload?: unknown;
  raw: string;
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
  } catch (error) {
    const objectStart = trimmed.indexOf("{");
    const objectEnd = trimmed.lastIndexOf("}");
    if (objectStart >= 0 && objectEnd > objectStart) {
      const objectCandidate = trimmed.slice(objectStart, objectEnd + 1);
      try {
        return JSON.parse(objectCandidate);
      } catch (secondError) {
        // no-op
      }
    }

    const arrayStart = trimmed.indexOf("[");
    const arrayEnd = trimmed.lastIndexOf("]");
    if (arrayStart >= 0 && arrayEnd > arrayStart) {
      const arrayCandidate = trimmed.slice(arrayStart, arrayEnd + 1);
      try {
        return JSON.parse(arrayCandidate);
      } catch (thirdError) {
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

const isAffirmative = (text: string) =>
  /\b(yes|yeah|yep|sure|please|ok|okay|go ahead|do it|let's do it|create one|create it|sounds good)\b/i.test(
    text
  );

const isNegative = (text: string) => /\b(no|not now|later|skip|nope)\b/i.test(text);

const getFocusPhrase = (text: string) =>
  text
    .replace(/[\r\n]+/g, " ")
    .replace(/[^\w\s-]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 80);

const isLowSignalReply = (text: string) => {
  const normalized = text.trim();
  if (!normalized) {
    return false;
  }

  if (isAffirmative(normalized) || isNegative(normalized)) {
    return false;
  }

  // Treat short keyword-style turns as ambiguous and request clarification.
  const words = normalized.split(/\s+/).filter(Boolean);
  return words.length <= 5;
};

const ANCHOR_STOPWORDS = new Set([
  "the",
  "and",
  "that",
  "this",
  "with",
  "from",
  "have",
  "your",
  "about",
  "into",
  "what",
  "when",
  "where",
  "which",
  "would",
  "could",
  "should",
  "there",
  "their",
  "them",
  "they",
  "been",
  "being",
  "were",
  "very",
  "just",
  "more",
  "like"
]);

const tokenizeForAnchoring = (text: string) =>
  text
    .toLowerCase()
    .replace(/[^\w\s-]/g, " ")
    .split(/\s+/)
    .map((token) => token.trim())
    .filter(
      (token) => token.length >= 4 && !ANCHOR_STOPWORDS.has(token)
    );

const hasKeywordOverlap = (userText: string, assistantText: string) => {
  const userTokens = tokenizeForAnchoring(userText);
  if (userTokens.length === 0) {
    return true;
  }

  const assistantTokens = tokenizeForAnchoring(assistantText);
  return userTokens.some((userToken) =>
    assistantTokens.some(
      (assistantToken) =>
        assistantToken === userToken ||
        assistantToken.startsWith(userToken) ||
        userToken.startsWith(assistantToken)
    )
  );
};

const COACHING_GUIDANCE_REQUEST_PATTERN =
  /\b(coaching tips?|tips?|advice|guidance|strateg(y|ies)|how can i|how do i|help me|what should i do|need support|support me|support with|support on|support doing)\b/i;
const CONTEXT_CONTINUATION_PREFIX_PATTERN = /^\s*(on|about|regarding|for)\b/i;
const CONTEXT_BRIDGE_PREFIX_PATTERN = /^\s*(as|and|so|because|then|also|but)\b/i;
const CONTEXT_REFERENCE_PATTERN = /\b(it|this|that|one|those|these|before|again)\b/i;
const HOW_TO_FOLLOWUP_PATTERN = /^\s*how do (i|you|we)\b/i;
const EXPLANATION_FOLLOWUP_PATTERN =
  /^\s*(please\s*)?((can|could)\s+you\s*)?(explain|elaborate|expand|clarify|break (this|that|it) down|tell me more)(\s+(more|further))?\b/i;
const COACHING_TOPIC_HINT_PATTERN =
  /\b(present|presentation|presenting|audience|public speaking|ted talks?|communication|influence|confidence)\b/i;

const shouldBypassClarificationPrompt = (latestUserMessage: string, messages: ChatMessage[]) => {
  const normalized = latestUserMessage.trim();
  if (!normalized) {
    return false;
  }

  if (COACHING_GUIDANCE_REQUEST_PATTERN.test(normalized)) {
    return true;
  }

  if (COACHING_TOPIC_HINT_PATTERN.test(normalized)) {
    return true;
  }

  const previousAssistantMessage =
    [...messages]
      .slice(0, -1)
      .reverse()
      .find((message) => message.role === "assistant" && message.content.trim())?.content ?? "";
  if (EXPLANATION_FOLLOWUP_PATTERN.test(normalized) && previousAssistantMessage.trim()) {
    return true;
  }

  if (!CONTEXT_CONTINUATION_PREFIX_PATTERN.test(normalized)) {
    const hasFollowUpShape =
      HOW_TO_FOLLOWUP_PATTERN.test(normalized) ||
      CONTEXT_BRIDGE_PREFIX_PATTERN.test(normalized) ||
      CONTEXT_REFERENCE_PATTERN.test(normalized);
    if (!hasFollowUpShape) {
      return false;
    }
  }

  const previousContext = messages
    .slice(0, -1)
    .slice(-6)
    .map((message) => message.content)
    .join(" ")
    .trim();

  if (!previousContext) {
    return false;
  }

  // If the conversation already has content and the user is continuing with "on/about/for",
  // treat it as a contextual follow-up instead of forcing a clarification reset.
  return tokenizeForAnchoring(previousContext).length > 0;
};

const getPreviousUserMessage = (messages: ChatMessage[]) =>
  [...messages]
    .slice(0, -1)
    .reverse()
    .find((message) => message.role === "user" && message.content.trim())?.content
    ?.trim() ?? "";

const getPreviousAssistantMessage = (messages: ChatMessage[]) =>
  [...messages]
    .slice(0, -1)
    .reverse()
    .find((message) => message.role === "assistant" && message.content.trim())?.content
    ?.trim() ?? "";

const isExplanationFollowupIntent = (text: string, messages: ChatMessage[]) => {
  const normalized = text.trim();
  if (!normalized) {
    return false;
  }

  if (!EXPLANATION_FOLLOWUP_PATTERN.test(normalized)) {
    return false;
  }

  const previousAssistantMessage = getPreviousAssistantMessage(messages);
  return previousAssistantMessage.length > 0;
};

const inferDefinitionTopicHint = (latestUserMessage: string, messages: ChatMessage[]) => {
  const previousUserMessage = getPreviousUserMessage(messages);
  if (!previousUserMessage) {
    return "";
  }

  if (previousUserMessage.toLowerCase() === latestUserMessage.trim().toLowerCase()) {
    return "";
  }

  return previousUserMessage.slice(0, 140);
};

const isDefinitionIntent = (text: string, messages: ChatMessage[]) => {
  const normalized = text.trim();
  if (!normalized) {
    return false;
  }

  const explicitMeaningPattern =
    /\bwhat does\b[\s\S]{0,80}\bmean\b|\bmeaning of\b|\bdefine\b|\bstands for\b/i;
  if (explicitMeaningPattern.test(normalized)) {
    return true;
  }

  const contextualDefinitionPattern =
    /\b(what (are|is) (they|it|this|that|those|these)|what (they|it|this|that|those|these) (are|is)|how (are|is) (they|it|this|that|those|these) (put together|structured|built|organized)|how (they|it|this|that|those|these) (are|is) (put together|structured|built|organized)|tell me about (them|it|this|that)|explain (them|it|this|that))\b/i;
  if (contextualDefinitionPattern.test(normalized)) {
    const previousUserMessage = getPreviousUserMessage(messages);
    if (previousUserMessage) {
      return true;
    }
  }

  // Treat short "what is X" term questions as definition requests, but avoid
  // routing real-time/info lookup queries (weather, date, prices, etc.) into definition mode.
  const shortWhatIsMatch = normalized.match(/^\s*(what is|what's)\s+(.{1,40}?)\??\s*$/i);
  if (!shortWhatIsMatch) {
    return false;
  }

  const subject = shortWhatIsMatch[2].toLowerCase().trim();
  const subjectWordCount = subject.split(/\s+/).filter(Boolean).length;
  const nonDefinitionSignal =
    /\b(weather|temperature|forecast|time|date|today|tomorrow|yesterday|news|price|cost|stock|score|capital|president|ceo|who|where|when)\b/i;

  if (subjectWordCount > 4 || nonDefinitionSignal.test(subject)) {
    return false;
  }

  return true;
};

const stripPlanSections = (markdown: string) => {
  const lines = markdown.split("\n");
  const headingPattern = /^#{1,6}\s+/;
  const planHeadingPattern =
    /^#{1,6}\s*(action plan|development plan|smart action plan|30-60-90.*|next steps)\b/i;
  const planMarkerPattern =
    /\b(action plan|development plan|30-60-90|milestones|weekly checkpoints)\b/i;

  const output: string[] = [];
  let skippingPlanSection = false;

  for (const line of lines) {
    const trimmed = line.trim();

    if (planHeadingPattern.test(trimmed)) {
      skippingPlanSection = true;
      continue;
    }

    if (skippingPlanSection && headingPattern.test(trimmed)) {
      skippingPlanSection = false;
    }

    if (skippingPlanSection) {
      continue;
    }

    if (planMarkerPattern.test(trimmed) && /^[-*+]\s+/.test(trimmed)) {
      continue;
    }

    output.push(line);
  }

  return output.join("\n").replace(/\n{3,}/g, "\n\n").trim();
};

type CoachingEngine = "grow" | "heron" | "gestalt" | "disc" | "sdi";
type HeronStance = "pull" | "push";
type HeronIntervention =
  | "catalytic"
  | "supportive"
  | "cathartic"
  | "confronting"
  | "prescriptive"
  | "informative";
type GrowFocusStep = "goal" | "reality" | "options" | "way_forward";
type DiscCue = "direct" | "analytical" | "relational" | "steady";
type SdiRapportCue = "red" | "blue" | "green" | "hub";
type CoachingKnowledgeDoc = {
  id: string;
  engine: CoachingEngine;
  tags: string[];
  text: string;
};

const COACHING_ENGINE_KB: CoachingKnowledgeDoc[] = [
  {
    id: "grow_structure",
    engine: "grow",
    tags: ["grow", "goal", "reality", "options", "way forward", "structure"],
    text: "Use GROW as overall session spine: clarify the goal, ground in current reality, explore practical options, then secure a specific way-forward commitment."
  },
  {
    id: "grow_progression",
    engine: "grow",
    tags: ["grow", "progression", "coaching", "questioning"],
    text: "Do not jump to action until reality is clear. Move progressively from goal clarity to concrete next step with ownership and timing."
  },
  {
    id: "disc_adaptation",
    engine: "disc",
    tags: ["disc", "communication", "style", "rapport", "audience"],
    text: "Use DISC as communication adaptation layer across the whole dialogue: tailor pacing, detail depth, and directness without explicitly typing the coachee."
  },
  {
    id: "disc_language",
    engine: "disc",
    tags: ["disc", "language", "structure", "influence"],
    text: "Match response style to observed language: concise and decisive for direct cues, structured and data-based for analytical cues, empathic for relational cues, and stepwise for steady cues."
  },
  {
    id: "gestalt_presence",
    engine: "gestalt",
    tags: ["gestalt", "in-the-moment", "awareness", "questioning"],
    text: "Use Gestalt for in-the-moment coaching questions: surface what is happening now, the felt response, and what the coachee notices in body, tone, and assumptions."
  },
  {
    id: "gestalt_experiment",
    engine: "gestalt",
    tags: ["gestalt", "experiment", "micro-action", "reflection"],
    text: "Translate insight into a small immediate experiment and debrief learning, rather than abstract discussion."
  },
  {
    id: "heron_pull_push",
    engine: "heron",
    tags: ["heron", "pull", "push", "action plan", "challenge"],
    text: "Start with Heron pull to uncover root causes (patterns, assumptions, triggers, constraints). Shift to Heron push when readiness appears to lock accountable action."
  },
  {
    id: "heron_action_lock",
    engine: "heron",
    tags: ["heron", "action plan", "commitment", "ownership"],
    text: "Use constructive challenge to test feasibility and commitment, then capture a tight action plan with owner, timeline, and success signal."
  },
  {
    id: "sdi_empathy",
    engine: "sdi",
    tags: ["sdi", "empathy", "motives", "personality", "rapport"],
    text: "Use SDI as empathy layer over ongoing interaction by inferring motivational drivers from repeated language patterns, then mirror language that builds trust."
  },
  {
    id: "sdi_conflict",
    engine: "sdi",
    tags: ["sdi", "conflict", "trigger", "relationship"],
    text: "When tension appears, identify likely motive shifts under conflict and respond with language that reduces defensiveness while preserving accountability."
  }
];

const selectCoachingEngines = (
  latestUserMessage: string,
  context?: string
): { primary: CoachingEngine; secondary: CoachingEngine | null; reason: string } => {
  const text = `${latestUserMessage} ${context ?? ""}`.toLowerCase();

  const conflictPattern =
    /\b(conflict|tension|argument|clash|misunderstood|bully|harass|discriminat|defensive|blame)\b/;
  const communicationPattern =
    /\b(communication|communicat|message|feedback|listen|listening|stakeholder|present|presentation|conversation)\b/;
  const emotionPattern =
    /\b(frustrat|anxious|angry|overwhelm|stressed|hurt|afraid|fear|emotion|reactive|trigger)\b/;
  const directionPattern =
    /\b(stuck|unclear|goal|priority|plan|next step|what should i do|where do i start|not sure)\b/;

  if (conflictPattern.test(text)) {
    return {
      primary: "heron",
      secondary: "sdi",
      reason: "conflict_or_relationship_tension_with_root_cause_focus"
    };
  }

  if (communicationPattern.test(text)) {
    return {
      primary: "heron",
      secondary: "disc",
      reason: "communication_or_influence_need_with_heron_root_cause"
    };
  }

  if (emotionPattern.test(text)) {
    return {
      primary: "heron",
      secondary: "gestalt",
      reason: "emotion_or_trigger_awareness_with_heron_actioning"
    };
  }

  if (directionPattern.test(text)) {
    return {
      primary: "heron",
      secondary: "grow",
      reason: "clarity_goal_and_next_step_need_with_heron"
    };
  }

  return {
    primary: "heron",
    secondary: "grow",
    reason: "heron_led_default"
  };
};

const getRecentUserHistoryText = (messages: ChatMessage[], turns = 6) =>
  messages
    .filter((message) => message.role === "user")
    .slice(-turns)
    .map((message) => message.content)
    .join(" ");

const retrieveCoachingKnowledge = (queryText: string, limit = 6) => {
  const queryTokens = new Set(tokenizeForAnchoring(queryText));
  const scored = COACHING_ENGINE_KB.map((doc) => {
    const haystack = `${doc.engine} ${doc.tags.join(" ")} ${doc.text}`.toLowerCase();
    let score = 0;
    queryTokens.forEach((token) => {
      if (haystack.includes(token)) {
        score += 1;
      }
    });

    // Bias to always include the core methods requested by product guidance.
    if (["grow", "disc", "gestalt", "heron", "sdi"].some((token) => haystack.includes(token))) {
      score += 1;
    }

    return { doc, score };
  })
    .sort((a, b) => b.score - a.score)
    .slice(0, limit)
    .map((item) => item.doc);

  return {
    ids: scored.map((doc) => doc.id),
    snippets: scored.map((doc) => `${doc.engine.toUpperCase()}: ${doc.text}`)
  };
};

const getEngineDirective = (engine: CoachingEngine) => {
  if (engine === "grow") {
    return "GROW emphasis: clarify one concrete goal, current reality, one option, and one next step.";
  }
  if (engine === "heron") {
    return "Heron emphasis: use pull to uncover root cause first, then push to secure one concrete owned action.";
  }
  if (engine === "gestalt") {
    return "Gestalt emphasis: focus on in-the-moment awareness, emotional signal, and one immediate experiment.";
  }
  if (engine === "disc") {
    return "DISC emphasis: adapt communication strategy to audience style cues without labeling personality types.";
  }
  return "SDI emphasis: surface motive, conflict trigger, and one repair move for the relationship dynamic.";
};

const selectHeronStance = (
  latestUserMessage: string,
  trimmedMessages: ChatMessage[]
): { stance: HeronStance; reason: string } => {
  const text = latestUserMessage.toLowerCase();
  const rootCauseSignalPattern =
    /\b(because|root cause|pattern|trigger|assumption|constraint|underlying|the reason is)\b/;
  const uncertaintyPattern =
    /\b(not sure|don't know|dont know|maybe|i guess|kind of|sort of|whatever)\b/;
  const avoidancePattern =
    /\b(can't|cannot|won't|no time|too busy|they should|someone else|not my fault|i have to wait)\b/;
  const commitmentPattern =
    /\b(i will|i can|i'm going to|i am going to|next step|by (monday|tuesday|wednesday|thursday|friday|tomorrow|next week)|deadline)\b/;

  const recentUserTurns = trimmedMessages
    .filter((message) => message.role === "user")
    .map((message) => message.content)
    .slice(-3);
  const lowSignalTurns = recentUserTurns.filter((turn) => isLowSignalReply(turn)).length;

  if (rootCauseSignalPattern.test(text) || commitmentPattern.test(text)) {
    return { stance: "push", reason: "root_cause_visible_or_action_readiness_detected" };
  }

  if (lowSignalTurns >= 2) {
    return { stance: "push", reason: "repeated_ambiguous_short_replies" };
  }

  if (uncertaintyPattern.test(text) || avoidancePattern.test(text)) {
    return { stance: "pull", reason: "root_cause_needs_exploration_before_action_push" };
  }

  return { stance: "pull", reason: "default_exploratory_mode" };
};

const getHeronStanceDirective = (stance: HeronStance) => {
  if (stance === "push") {
    return "Heron turn mode: push. Use respectful challenge to convert insight into one specific action with owner and timing.";
  }
  return "Heron turn mode: pull. Use catalytic exploration to uncover root cause (patterns, assumptions, triggers, constraints) before prescribing.";
};

const selectHeronIntervention = (
  latestUserMessage: string,
  stance: HeronStance
): { intervention: HeronIntervention; reason: string } => {
  const text = latestUserMessage.toLowerCase();
  const highEmotionPattern =
    /\b(angry|upset|hurt|frustrat|anxious|overwhelm|fear|afraid|stressed|shaken|drained)\b/;
  const releasePattern = /\b(i feel|i felt|it was hard|it hit me|it got to me|i'm exhausted|im exhausted)\b/;
  const adviceAskPattern =
    /\b(what should i do|what do i do|how do i|help me|give me|suggest|advice|recommend)\b/;
  const resistancePattern =
    /\b(can't|cannot|won't|no time|too busy|they should|not my fault|i have to wait)\b/;
  const explainPattern =
    /\b(explain|clarify|what does .* mean|meaning|example|walk me through)\b/;

  if (stance === "pull") {
    if (highEmotionPattern.test(text) && releasePattern.test(text)) {
      return { intervention: "cathartic", reason: "high_emotion_with_release_language" };
    }
    if (highEmotionPattern.test(text)) {
      return { intervention: "supportive", reason: "elevated_emotion_needing_empathic_containment" };
    }
    return { intervention: "catalytic", reason: "root_cause_exploration_needed" };
  }

  if (resistancePattern.test(text)) {
    return { intervention: "confronting", reason: "avoidance_or_externalization_detected" };
  }
  if (adviceAskPattern.test(text)) {
    return { intervention: "prescriptive", reason: "clear_request_for_direction_or_next_step" };
  }
  if (explainPattern.test(text)) {
    return { intervention: "informative", reason: "clarification_or_definition_request" };
  }
  return { intervention: "confronting", reason: "action_readiness_with_need_for_constructive_challenge" };
};

const getHeronInterventionDirective = (intervention: HeronIntervention) => {
  if (intervention === "catalytic") {
    return "Heron intervention: catalytic. Ask probing questions that help the coachee surface assumptions, patterns, and root cause.";
  }
  if (intervention === "supportive") {
    return "Heron intervention: supportive. Validate experience briefly, stabilize tone, then continue focused exploration.";
  }
  if (intervention === "cathartic") {
    return "Heron intervention: cathartic. Allow emotional naming and release briefly, then guide to meaning and choice.";
  }
  if (intervention === "prescriptive") {
    return "Heron intervention: prescriptive. Offer one practical, bounded next move with clear ownership and timing.";
  }
  if (intervention === "informative") {
    return "Heron intervention: informative. Provide concise clarification, then pivot back to coaching application.";
  }
  return "Heron intervention: confronting. Use respectful challenge to test assumptions, avoidance, and accountability gaps.";
};

const selectGrowFocusStep = (
  latestUserMessage: string,
  userTurnCount: number
): { step: GrowFocusStep; reason: string } => {
  const text = latestUserMessage.toLowerCase();
  const goalPattern = /\b(goal|outcome|target|objective|want to|aim|focus on)\b/;
  const realityPattern =
    /\b(current|now|today|happened|situation|challenge|problem|stuck|blocker|issue)\b/;
  const optionsPattern =
    /\b(option|could|might|try|approach|alternative|ideas|choice|choices)\b/;
  const wayForwardPattern =
    /\b(i will|commit|next step|plan to|by tomorrow|by next week|deadline|schedule)\b/;

  if (wayForwardPattern.test(text)) {
    return { step: "way_forward", reason: "commitment_or_execution_language" };
  }
  if (optionsPattern.test(text)) {
    return { step: "options", reason: "option_generation_language" };
  }
  if (realityPattern.test(text)) {
    return { step: "reality", reason: "current_state_or_problem_language" };
  }
  if (goalPattern.test(text)) {
    return { step: "goal", reason: "goal_or_outcome_language" };
  }

  const phase = userTurnCount % 4;
  if (phase === 1) {
    return { step: "goal", reason: "turn_progression_default" };
  }
  if (phase === 2) {
    return { step: "reality", reason: "turn_progression_default" };
  }
  if (phase === 3) {
    return { step: "options", reason: "turn_progression_default" };
  }
  return { step: "way_forward", reason: "turn_progression_default" };
};

const getGrowFocusDirective = (step: GrowFocusStep) => {
  if (step === "goal") {
    return "GROW turn focus: GOAL. Clarify one concrete near-term outcome in coachee language.";
  }
  if (step === "reality") {
    return "GROW turn focus: REALITY. Surface facts, patterns, and constraints of the current situation.";
  }
  if (step === "options") {
    return "GROW turn focus: OPTIONS. Generate 1-2 practical alternatives and tradeoffs.";
  }
  return "GROW turn focus: WAY FORWARD. Drive one specific commitment with timing and ownership.";
};

const selectDiscCue = (
  latestUserMessage: string,
  context?: string
): { cue: DiscCue; reason: string } => {
  const text = `${latestUserMessage} ${context ?? ""}`.toLowerCase();
  const directPattern = /\b(quick|fast|urgent|straight|bottom line|brief|short)\b/;
  const analyticalPattern = /\b(data|detail|evidence|analysis|logic|metrics|numbers)\b/;
  const relationalPattern =
    /\b(team|people|relationship|trust|feel|emotion|support|stakeholder)\b/;
  const steadyPattern = /\b(step by step|process|consistent|stability|careful|risk)\b/;

  if (directPattern.test(text)) {
    return { cue: "direct", reason: "speed_and_decision_language" };
  }
  if (analyticalPattern.test(text)) {
    return { cue: "analytical", reason: "detail_and_evidence_language" };
  }
  if (relationalPattern.test(text)) {
    return { cue: "relational", reason: "people_and_relationship_language" };
  }
  if (steadyPattern.test(text)) {
    return { cue: "steady", reason: "stability_and_process_language" };
  }
  return { cue: "relational", reason: "balanced_default" };
};

const getDiscCueDirective = (cue: DiscCue) => {
  if (cue === "direct") {
    return "DISC cue: direct. Keep language concise, outcome-first, and explicit on decision and ownership.";
  }
  if (cue === "analytical") {
    return "DISC cue: analytical. Use precise wording, cause/effect logic, and clear criteria.";
  }
  if (cue === "steady") {
    return "DISC cue: steady. Use calm pacing, step-by-step progression, and low-pressure wording.";
  }
  return "DISC cue: relational. Emphasize rapport, impact on people, and collaborative language.";
};

const getTurnStructureDirective = (step: GrowFocusStep, cue: DiscCue) => {
  const growStructure =
    step === "goal"
      ? "GROW structure for this turn: define one near-term outcome in coachee wording, then ask one goal-sharpening question."
      : step === "reality"
      ? "GROW structure for this turn: reflect observed reality (facts/patterns/constraints), then ask one root-cause question."
      : step === "options"
      ? "GROW structure for this turn: offer 1-2 options with tradeoff framing, then ask which option they will test."
      : "GROW structure for this turn: convert insight into one committed next action with owner and timing, then confirm feasibility.";

  const discStructure =
    cue === "direct"
      ? "DISC phrasing style: concise, outcome-first, and decisive. Keep wording tight and action-oriented."
      : cue === "analytical"
      ? "DISC phrasing style: structured and precise. Use brief cause/effect logic and explicit criteria."
      : cue === "steady"
      ? "DISC phrasing style: calm, stepwise, and low-pressure. Use predictable progression."
      : "DISC phrasing style: empathetic and collaborative. Lead with people impact and shared intent.";

  return `${growStructure} ${discStructure}`;
};

const selectSdiRapportCue = (
  latestUserMessage: string,
  context?: string,
  interactionHistory?: string
): { cue: SdiRapportCue; reason: string } => {
  const text = `${latestUserMessage} ${context ?? ""} ${interactionHistory ?? ""}`.toLowerCase();
  const redPattern =
    /\b(result|deliver|urgent|quick|fast|decide|decision|impact|bottom line|win|execute)\b/;
  const bluePattern =
    /\b(people|team|support|help|trust|care|relationship|together|collaborat|respect)\b/;
  const greenPattern =
    /\b(data|evidence|logic|analy|detail|accurate|process|structure|plan|criteria)\b/;
  const hubPattern =
    /\b(depends|it depends|both|balance|adapt|flex|on one hand|on the other hand|different angles)\b/;

  const redHit = redPattern.test(text);
  const blueHit = bluePattern.test(text);
  const greenHit = greenPattern.test(text);
  const hitCount = Number(redHit) + Number(blueHit) + Number(greenHit);

  if (hubPattern.test(text) || hitCount >= 2) {
    return { cue: "hub", reason: "mixed_multi_style_language" };
  }
  if (redHit) {
    return { cue: "red", reason: "results_and_decision_language" };
  }
  if (greenHit) {
    return { cue: "green", reason: "analysis_structure_language" };
  }
  if (blueHit) {
    return { cue: "blue", reason: "people_and_support_language" };
  }
  return { cue: "hub", reason: "balanced_default" };
};

const getSdiRapportDirective = (cue: SdiRapportCue) => {
  if (cue === "red") {
    return "SDI rapport cue: RED. Keep tempo brisk, outcome-focused, and action-oriented.";
  }
  if (cue === "blue") {
    return "SDI rapport cue: BLUE. Lead with empathy, shared intent, and impact on people.";
  }
  if (cue === "green") {
    return "SDI rapport cue: GREEN. Use clear logic, structure, and precision in phrasing.";
  }
  return "SDI rapport cue: HUB. Blend directness, empathy, and structure with flexible wording.";
};

const compactPlanOutput = (markdown: string) => {
  const lines = markdown.split("\n");
  const headingPattern = /^#{1,6}\s+/;
  const dropSectionPattern =
    /^#{1,6}\s*(development plan|30-60-90.*|optional script|references?)\b/i;
  const bulletPattern = /^(-|\*|\+)\s+/;
  const numberedPattern = /^\d+\.\s+/;

  const output: string[] = [];
  let skippingSection = false;
  let actionCount = 0;

  for (const line of lines) {
    const trimmed = line.trim();

    if (dropSectionPattern.test(trimmed)) {
      skippingSection = true;
      continue;
    }

    if (skippingSection && headingPattern.test(trimmed)) {
      skippingSection = false;
    }

    if (skippingSection) {
      continue;
    }

    if (bulletPattern.test(trimmed) || numberedPattern.test(trimmed)) {
      actionCount += 1;
      if (actionCount > 3) {
        continue;
      }
    }

    output.push(line);
  }

  const compacted = output.join("\n").replace(/\n{3,}/g, "\n\n").trim();
  const words = compacted.split(/\s+/).filter(Boolean);
  if (words.length <= 180) {
    return compacted;
  }

  return words.slice(0, 180).join(" ").trim();
};

const hasStructuredPlanOutput = (text: string) => {
  const headingPattern = /^#{1,6}\s*(reflection|focus plan|first step)\b/im;
  const bulletPattern = /^(\s*[-*+]\s+|\s*\d+\.\s+)/m;
  return headingPattern.test(text) && bulletPattern.test(text);
};

export async function POST(request: Request) {
  const openaiKey = process.env.OPENAI_API_KEY;
  const model = process.env.OPENAI_CHAT_MODEL ?? "gpt-4o-mini";
  const antigravKey = process.env.ANTIGRAVITY_API_KEY;
  const antigravEndpoint = process.env.ANTIGRAVITY_ENDPOINT ?? "https://api.antigravity.com/v1/chat";

  if (!openaiKey && !antigravKey) {
    return NextResponse.json({ error: "Missing OPENAI_API_KEY or ANTIGRAVITY_API_KEY." }, { status: 500 });
  }

  let payload: ChatRequest;
  try {
    payload = await request.json();
  } catch (error) {
    return NextResponse.json({ error: "Invalid JSON payload." }, { status: 400 });
  }

  const allMessages = (payload.messages ?? []).filter(
    (message) => message.content && message.content.trim()
  );

  const trimmedMessages = allMessages
    .filter((message) => message.content && message.content.trim())
    .slice(-8);

  if (trimmedMessages.length === 0) {
    return NextResponse.json({ error: "Missing chat messages." }, { status: 400 });
  }

  const userTurnCount = trimmedMessages.filter((message) => message.role === "user").length;
  const latestUserMessage =
    [...trimmedMessages].reverse().find((message) => message.role === "user")?.content ?? "";
  const explicitPlanRequestPattern =
    /\b(create|build|make|generate|draft|produce|prepare|design|turn (this|it) into)\b[\s\w]{0,40}\b(coaching plan|action plan|development plan|plan)\b|\b(can you|could you|please)\b[\s\w]{0,40}\b(coaching plan|action plan|development plan)\b/i;
  const explicitEndSessionRequestPattern =
    /\b(end (the )?(coaching )?session|finish (the )?(coaching )?session|close (the )?(coaching )?session|stop (the )?(coaching )?session|wrap up (the )?(coaching )?session|i'?m done|im done|we are done)\b/i;
  const endSessionIntentPattern = /\b(end|finish|close|stop|wrap up|exit)\b/i;
  const explicitManagerSupportRequestPattern =
    /\b(manager|line manager|my manager)\b[\s\w]{0,40}\b(meeting|support|1:1|one on one|discussion|email|prompt|talking points?)\b|\bset up\b[\s\w]{0,20}\bmeeting\b[\s\w]{0,20}\bmanager\b/i;
  const explicitManagerExecutionRequestPattern =
    /\b(set up|schedule|book|draft|write|send)\b[\s\w]{0,40}\b(meeting|invite|email|message)\b[\s\w]{0,40}\b(manager|line manager|my manager)\b|\b(talking points?|email draft|manager email)\b/i;
  const explicitManagerDeclinePattern =
    /\b(don't|do not|no|not now|skip|avoid|without)\b[\s\w]{0,40}\b(manager|line manager|my manager)\b/i;
  const managerRedirectToSelfPattern =
    /\b(don't|do not|no)\b[\s\w]{0,20}\b(send|email|share|forward)\b[\s\w]{0,30}\b(manager|line manager|my manager)\b[\s\w]{0,30}\b(to me|my email|me|myself)\b|\b(send|email|share|forward)\b[\s\w]{0,40}\b(to me|my email|me|myself)\b/i;
  const routingInstructionPattern =
    /\b(send|email|share|forward)\b[\s\w]{0,60}\b(to me|my email|me|myself|manager|line manager|my manager)\b/i;
  const discussionCompletePattern =
    /\b(that'?s all|that helps for now|i'?m done(?: for now)?|im done(?: for now)?|wrap (this|it) up|wrap[- ]up|summari[sz]e|end (the )?(coaching )?session|finish (the )?(coaching )?session|close (the )?(coaching )?session|close this out|we can stop here|we can end here|enough for today)\b/i;

  const explicitPlanRequested = explicitPlanRequestPattern.test(latestUserMessage);
  const managerSupportDeclinedThisTurn =
    explicitManagerDeclinePattern.test(latestUserMessage) || managerRedirectToSelfPattern.test(latestUserMessage);
  const explicitManagerSupportRequested =
    explicitManagerSupportRequestPattern.test(latestUserMessage) && !managerSupportDeclinedThisTurn;
  const explicitManagerExecutionRequested =
    explicitManagerExecutionRequestPattern.test(latestUserMessage) && !managerSupportDeclinedThisTurn;
  const explanationFollowupRequested = isExplanationFollowupIntent(latestUserMessage, allMessages);
  const definitionRequested = isDefinitionIntent(latestUserMessage, allMessages);
  const explanationRequested = definitionRequested || explanationFollowupRequested;
  const definitionTopicHint = inferDefinitionTopicHint(latestUserMessage, allMessages);
  const assistantTopicHint = getPreviousAssistantMessage(allMessages).slice(0, 180);
  const bypassClarificationPrompt = shouldBypassClarificationPrompt(latestUserMessage, allMessages);
  const nonLeadershipQuestionRequested = false;
  const discussionMarkedComplete = discussionCompletePattern.test(latestUserMessage);
  const hasAskedPlanOptIn = allMessages.some(
    (message) =>
      message.role === "assistant" && message.content.toLowerCase().includes(PLAN_OPT_IN_QUESTION.toLowerCase())
  );
  const hasAskedManagerSupportOptIn = allMessages.some(
    (message) =>
      message.role === "assistant" && message.content.toLowerCase().includes(MANAGER_MEETING_QUESTION.toLowerCase())
  );
  const hasAskedEndSessionPrompt = allMessages.some(
    (message) =>
      message.role === "assistant" && message.content.toLowerCase().includes(END_SESSION_QUESTION.toLowerCase())
  );
  const hasAskedPlanFeasibilityPrompt = allMessages.some(
    (message) =>
      message.role === "assistant" && message.content.toLowerCase().includes(PLAN_FEASIBILITY_QUESTION.toLowerCase())
  );
  const hasGeneratedPlanAlready = allMessages.some(
    (message) =>
      message.role === "assistant" &&
      (PLAN_STRUCTURED_OUTPUT_PATTERN.test(message.content) ||
        message.content.toLowerCase().includes(PLAN_FEASIBILITY_QUESTION.toLowerCase()))
  );
  const hasUserAcceptedPlan =
    !hasGeneratedPlanAlready &&
    hasAskedPlanOptIn &&
    isAffirmative(latestUserMessage) &&
    !isNegative(latestUserMessage);
  const hasUserApprovedPlanFeasibility =
    hasAskedPlanFeasibilityPrompt &&
    isAffirmative(latestUserMessage) &&
    !isNegative(latestUserMessage);
  const hasUserAcceptedManagerSupport =
    hasAskedManagerSupportOptIn &&
    isAffirmative(latestUserMessage) &&
    !isNegative(latestUserMessage);
  const hasUserDeclinedManagerSupport = allMessages.some(
    (message) => message.role === "user" && explicitManagerDeclinePattern.test(message.content)
  );
  const hasManagerRoutingInstruction = routingInstructionPattern.test(latestUserMessage);
  const explicitEndSessionRequested = explicitEndSessionRequestPattern.test(latestUserMessage);
  const promptedEndSessionRequested =
    hasAskedEndSessionPrompt &&
    !isNegative(latestUserMessage) &&
    (endSessionIntentPattern.test(latestUserMessage) || isAffirmative(latestUserMessage));

  if (explicitEndSessionRequested || promptedEndSessionRequested) {
    return NextResponse.json({ text: END_SESSION_CLOSING_TEXT, endSession: true });
  }

  const managerSupportRequested =
    !managerSupportDeclinedThisTurn &&
    (explicitManagerSupportRequested || hasUserAcceptedManagerSupport);
  const managerSupportDecisionThisTurn =
    hasAskedManagerSupportOptIn &&
    (isAffirmative(latestUserMessage) || isNegative(latestUserMessage));
  const shouldOfferManagerSupportPrompt =
    !managerSupportRequested &&
    !hasAskedManagerSupportOptIn &&
    !hasUserDeclinedManagerSupport &&
    hasUserApprovedPlanFeasibility;
  const shouldOfferPlanPrompt =
    !hasAskedPlanOptIn &&
    !hasUserAcceptedPlan &&
    !explicitPlanRequested &&
    !managerSupportRequested &&
    !shouldOfferManagerSupportPrompt &&
    !nonLeadershipQuestionRequested &&
    userTurnCount >= 2 &&
    discussionMarkedComplete;

  const planRequested = explicitPlanRequested || hasUserAcceptedPlan;

  if (shouldOfferManagerSupportPrompt) {
    return NextResponse.json({ text: MANAGER_MEETING_QUESTION });
  }

  if (
    !hasAskedEndSessionPrompt &&
    ((hasUserApprovedPlanFeasibility && hasUserDeclinedManagerSupport) ||
      (managerSupportDecisionThisTurn && !managerSupportRequested))
  ) {
    return NextResponse.json({ text: END_SESSION_QUESTION });
  }

  if (shouldOfferPlanPrompt) {
    return NextResponse.json({ text: PLAN_OPT_IN_QUESTION });
  }

  if (
    !planRequested &&
    !managerSupportRequested &&
    !hasManagerRoutingInstruction &&
    !explanationRequested &&
    !bypassClarificationPrompt &&
    !nonLeadershipQuestionRequested &&
    isLowSignalReply(latestUserMessage)
  ) {
    const focusPhrase = getFocusPhrase(latestUserMessage);
    if (focusPhrase) {
      return NextResponse.json({
        text: `When you say "${focusPhrase}", what specific situation are you referring to? What was said, by whom, and what impact did it have on you?`
      });
    }
  }

  const nowState = payload.nowState ? JSON.stringify(payload.nowState) : "{}";
  const coachGender = payload.coachGender === "female" ? "female" : "male";
  const selectedEngines = selectCoachingEngines(latestUserMessage, payload.context);
  const heronStance = selectHeronStance(latestUserMessage, trimmedMessages);
  const heronIntervention = selectHeronIntervention(latestUserMessage, heronStance.stance);
  const growFocus = selectGrowFocusStep(latestUserMessage, userTurnCount);
  const discCue = selectDiscCue(latestUserMessage, payload.context);
  const userHistoryText = getRecentUserHistoryText(allMessages);
  const sdiRapportCue = selectSdiRapportCue(latestUserMessage, payload.context, userHistoryText);
  const ragKnowledge = retrieveCoachingKnowledge(
    `${latestUserMessage} ${payload.context ?? ""} grow disc gestalt heron sdi action plan empathy`
  );
  const maxResponseTokens = planRequested ? 220 : 200;
  const systemPrompt = [
    "You are an executive coaching assistant.",
    `The user selected a ${coachGender} coach persona.`,
    "Keep that persona consistent if self-reference is needed, without using stereotypes.",
    "Primary mode is coaching dialogue, not plan generation.",
    "Use these methods as your coaching backbone:",
    "- GROW: Goal, Reality, Options, Way forward.",
    "- Heron push/pull guidance (about 75% pull, 25% push).",
    "- Gestalt in-the-moment awareness and experiments.",
    "- DISC communication cues to adapt style (without typing the user).",
    "- SDI motives and conflict sequence cues to surface drivers and triggers.",
    "Default to Heron-led coaching for root-cause thinking and action ownership.",
    "Adapt coaching method to the coachee's need on each turn (do not use a fixed script).",
    `Primary engine for this turn: ${selectedEngines.primary.toUpperCase()}.`,
    selectedEngines.secondary
      ? `Secondary engine for this turn: ${selectedEngines.secondary.toUpperCase()}.`
      : "Secondary engine for this turn: none.",
    `Engine selection reason: ${selectedEngines.reason}.`,
    `Heron stance for this turn: ${heronStance.stance.toUpperCase()}.`,
    `Heron stance reason: ${heronStance.reason}.`,
    getHeronStanceDirective(heronStance.stance),
    `Heron intervention for this turn: ${heronIntervention.intervention.toUpperCase()}.`,
    `Heron intervention reason: ${heronIntervention.reason}.`,
    getHeronInterventionDirective(heronIntervention.intervention),
    `GROW focus step for this turn: ${growFocus.step.toUpperCase()}.`,
    `GROW focus reason: ${growFocus.reason}.`,
    getGrowFocusDirective(growFocus.step),
    `DISC communication cue for this turn: ${discCue.cue.toUpperCase()}.`,
    `DISC cue reason: ${discCue.reason}.`,
    getDiscCueDirective(discCue.cue),
    `SDI rapport cue for this turn: ${sdiRapportCue.cue.toUpperCase()}.`,
    `SDI rapport cue reason: ${sdiRapportCue.reason}.`,
    getSdiRapportDirective(sdiRapportCue.cue),
    "Use retrieved coaching knowledge (RAG) below as turn-level operating guidance.",
    ...ragKnowledge.snippets.map((snippet, index) => `RAG[${index + 1}]: ${snippet}`),
    getTurnStructureDirective(growFocus.step, discCue.cue),
    getEngineDirective(selectedEngines.primary),
    selectedEngines.secondary ? getEngineDirective(selectedEngines.secondary) : "",
    "Guide the coachee to identify root causes: patterns, assumptions, constraints, emotional triggers, and tradeoffs.",
    "Then help the coachee choose practical strategies and small experiments to address root causes.",
    "Heron sequence rule: when root cause is unclear, use pull/catalytic questioning; when root cause is clearer, use push/accountability to lock one next action.",
    "Root-cause-first rule: do not jump to goal framing until the underlying cause is explored enough.",
    "For each coaching reply, first give a short explanation/reflection tied to their exact words, then ask one clear next question.",
    "Reflection style must follow the selected Heron stance for this turn (pull = exploratory; push = constructive challenge).",
    "The question focus must follow the selected GROW step for this turn.",
    "Wording style must follow the selected DISC cue for this turn.",
    "Rapport style must subtly mirror the selected SDI cue (red/blue/green/hub) without explicitly naming colors to the coachee.",
    "Use Heron intervention subtly through tone and question shape; do not announce intervention type.",
    "Keep questions concise, empathetic, and action-oriented. Prefer one strong question at a time.",
    "Sound human and conversational, not scripted or academic.",
    "Use brief empathy first, then constructive challenge where avoidance, inconsistency, or unclear ownership appears.",
    "Always anchor to the coachee's exact wording; echo one key phrase from their last message before asking the next question.",
    "Avoid generic prompts like 'what outcome would you like' unless the coachee explicitly asks to define goals.",
    "If their input is short or ambiguous, ask a clarification question tied to their exact words instead of giving a generic answer.",
    explanationRequested
      ? "DefinitionMode is requested. Give a concise plain-language meaning of the term and one practical workplace example."
      : "If they ask for a term meaning, explain briefly and then return to coaching dialogue.",
    explanationRequested && definitionTopicHint
      ? `Use this prior-topic hint when they used pronouns like it/they: ${definitionTopicHint}`
      : "",
    explanationRequested && assistantTopicHint
      ? `When they ask to explain further, first explain the most recent assistant point using this context: ${assistantTopicHint}`
      : "",
    explanationRequested
      ? "Then explicitly say this is a coaching discussion, not a lecture or class, and connect it back to their real situation."
      : "Avoid long educational lectures; keep responses anchored to coaching context.",
    "Keep responses focused on coaching dialogue.",
    "Do not use the phrase 'we should get back to the coaching session'.",
    "Avoid repetitive transition phrases like 'First', 'Next', and 'Finally'.",
    "Keep responses compact for speed: 60-140 words in coaching mode unless the user explicitly asks for more detail.",
    "If the coachee says not to involve their manager or asks to send details to them directly, acknowledge that preference and continue coaching without reopening manager support flow.",
    managerSupportRequested
      ? "ManagerSupportMode is requested. Include concise manager-support guidance relevant to the coachee's current challenge (what support to ask for, and how to ask)."
      : "Manager can be mentioned only when clearly relevant as one optional support lever; do not force manager involvement and do not shift the discussion away from coachee-owned actions.",
    "Always respond in clean Markdown only (no JSON, no code fences unless asked).",
    "Never expose internal tool-invocation text to the coachee (for example: 'Calling tool ... with payload ...').",
    planRequested
      ? "PlanMode is requested. Provide a concise structured micro-plan now."
      : "PlanMode is not requested. Do not generate a full action plan or development plan.",
    planRequested
      ? "When plan is requested, use this exact compact structure:"
      : "When in coaching mode, provide a short reflection + probing question + 1-2 strategy options, not a full plan.",
    planRequested ? "## Reflection" : "In coaching mode, keep formatting light and conversational (prefer plain paragraphs over rigid templates).",
    planRequested ? "1 short paragraph" : "Do not include headings like 'Action Plan' or 'Development Plan' in coaching mode.",
    planRequested ? "## Focus Plan" : "Do not propose a full plan unless asked.",
    planRequested
      ? "- Exactly 3 action bullets only, each one line and behavior-specific."
      : "Keep guidance practical and behavior-focused.",
    planRequested
      ? "- For each bullet include: action, owner, and timeline."
      : "Avoid filler and avoid repeating the same framework names.",
    planRequested ? "## First Step" : "Do not mention the word SMART.",
    planRequested
      ? "- One sentence for what to do in the next 24 hours."
      : "Do not label the user with personality types.",
    planRequested
      ? "Keep total plan output between 90 and 170 words."
      : "Do not include references/citations/source lists.",
    planRequested
      ? "In plan mode, finish with a short check question on commitment or feasibility."
      : "In coaching mode, always end your response with one clear follow-up question to continue a two-way dialogue.",
    managerSupportRequested && explicitManagerExecutionRequested
      ? "Because the coachee explicitly requested manager execution support, include concise talking prompts and an optional short manager email draft."
      : "Do not generate manager meeting prompts or email drafts unless the coachee explicitly asks for those artifacts.",
    shouldOfferPlanPrompt
      ? `The discussion appears complete. Ask this exact question once and only once: "${PLAN_OPT_IN_QUESTION}"`
      : "Do not ask for plan consent yet unless the coachee signals discussion completion.",
    shouldOfferPlanPrompt
      ? "When asking plan consent, do not include a plan in the same message. Keep it concise."
      : "Continue coaching dialogue with root-cause exploration and practical strategy options.",
    "Do not include a References section, citations, or source lists.",
    "Never name or explain internal frameworks in the reply (Heron, GROW, Gestalt, DISC, SDI). Keep output natural and coach-like.",
    "Do not include laughter tokens like 'ha ha', 'haha', or 'lol'.",
    "If the user reports bullying, harassment, discrimination, or other code-of-conduct issues,",
    "stop coaching on the topic and recommend contacting HR or the appropriate reporting channel.",
    `PlanMode: ${planRequested ? "requested" : "not_requested"}`,
    `ManagerSupportMode: ${managerSupportRequested ? "requested" : "not_requested"}`,
    `ManagerExecutionMode: ${explicitManagerExecutionRequested ? "requested" : "not_requested"}`,
    `DefinitionMode: ${definitionRequested ? "requested" : "not_requested"}`,
    `ExplainFollowupMode: ${explanationFollowupRequested ? "requested" : "not_requested"}`,
    `ManagerSupportPrompt: ${shouldOfferManagerSupportPrompt ? "ask_now" : "not_now"}`,
    `PlanConsentPrompt: ${shouldOfferPlanPrompt ? "ask_now" : "not_now"}`,
    `Context: ${payload.context ?? "general"}`,
    `Style: ${payload.style ?? "balanced"}`,
    `CoachGender: ${coachGender}`,
    `HeronStance: ${heronStance.stance}`,
    `HeronIntervention: ${heronIntervention.intervention}`,
    `GrowStep: ${growFocus.step}`,
    `DiscCue: ${discCue.cue}`,
    `SdiRapportCue: ${sdiRapportCue.cue}`,
    `RagKnowledgeIds: ${ragKnowledge.ids.join(",")}`,
    `NowState: ${nowState}`
  ].join("\n");

  let response: Response;

  if (antigravKey) {
    // Prefer Antigravity API when key provided. Try it first, but fall back to OpenAI on network/DNS errors.
    try {
      response = await fetch(antigravEndpoint, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${antigravKey}`,
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          messages: [
            { role: "system", content: systemPrompt },
            ...trimmedMessages
          ],
          context: payload.context,
          style: payload.style,
          nowState: payload.nowState,
          temperature: 0.4,
          model
        })
      });
    } catch (err: any) {
      // Network or DNS error when calling Antigravity.
      const msg = err?.message || String(err);
      const isDnsError = (err?.cause && (err.cause.code === "ENOTFOUND" || err.cause.code === "EAI_AGAIN")) || /ENOTFOUND|getaddrinfo|EAI_AGAIN/.test(msg);

      if (isDnsError && openaiKey) {
        // Fallback to OpenAI
        response = await fetch("https://api.openai.com/v1/chat/completions", {
          method: "POST",
          headers: {
            Authorization: `Bearer ${openaiKey}`,
            "Content-Type": "application/json"
          },
          body: JSON.stringify({
            model,
            messages: [
              { role: "system", content: systemPrompt },
              ...trimmedMessages
            ],
            temperature: 0.4,
            max_completion_tokens: maxResponseTokens
          })
        });
      } else {
        return NextResponse.json({ error: "Antigravity API unreachable.", details: msg }, { status: 502 });
      }
    }
  } else {
    response = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${openaiKey}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        model,
        messages: [
          { role: "system", content: systemPrompt },
          ...trimmedMessages
        ],
        temperature: 0.4,
        max_completion_tokens: maxResponseTokens
      })
    });
  }

  if (!response.ok) {
    const errorText = await response.text();
    return NextResponse.json(
      { error: "Upstream chat request failed.", details: errorText },
      { status: 502 }
    );
  }

  const data = await response.json();

  // Support multiple providers: check common response shapes.
  let text =
    data?.text ||
    data?.reply ||
    data?.choices?.[0]?.message?.content ||
    data?.choices?.[0]?.text ||
    "";

  if (!planRequested) {
    const stripped = stripPlanSections(text);
    text = stripped || "What feels like the core root cause behind this for you right now?";
  } else {
    const compacted = compactPlanOutput(text);
    const fallbackPlan =
      "## Reflection\nYou are ready to move from insight to action. A focused, realistic plan will help you build momentum.\n\n## Focus Plan\n- Define one specific presentation outcome for your next key meeting, owner: you, timeline: within 24 hours.\n- Rehearse your opening and one influence point with a trusted colleague, owner: you, timeline: before your next presentation.\n- Deliver the presentation using the revised structure and capture feedback from at least one stakeholder, owner: you, timeline: in your next live opportunity.\n\n## First Step\nIn the next 24 hours, write your one-sentence presentation objective and your opening line.";
    text = hasStructuredPlanOutput(compacted) ? compacted : fallbackPlan;
    if (!/does this action plan work for you\??/i.test(text)) {
      text = `${text}\n\n${PLAN_FEASIBILITY_QUESTION}`;
    }
  }

  if (
    explanationRequested &&
    !/coaching discussion|not a lecture|not a class/i.test(text)
  ) {
    text = `${text}\n\nLet's keep this as a coaching discussion, not a lecture or class. What part of this shows up most in your situation right now?`.trim();
  }

  if (
    nonLeadershipQuestionRequested &&
    !/we should get back to (the )?coaching session|get back to (your )?coaching session|return to (the )?coaching session|back to coaching/i.test(
      text
    )
  ) {
    text = `${text}\n\nWe should get back to the coaching session. What part of your current work challenge should we focus on next?`.trim();
  }

  if (!nonLeadershipQuestionRequested) {
    text = text
      .replace(
        /\s*however,\s*we should get back to (the )?coaching session\.?/gi,
        ""
      )
      .replace(
        /\s*we should get back to (the )?coaching session\.?/gi,
        ""
      )
      .replace(/\n{3,}/g, "\n\n")
      .trim();
  }

  const latestUserWordCount = latestUserMessage
    .split(/\s+/)
    .filter(Boolean).length;
  if (
    !planRequested &&
    !managerSupportRequested &&
    !hasManagerRoutingInstruction &&
    !explanationRequested &&
    !bypassClarificationPrompt &&
    !nonLeadershipQuestionRequested &&
    latestUserWordCount <= 12 &&
    !hasKeywordOverlap(latestUserMessage, text)
  ) {
    const focusPhrase = getFocusPhrase(latestUserMessage);
    if (focusPhrase) {
      text = `When you say "${focusPhrase}", what specific situation are you referring to? What words were used, by whom, and what impact did that have on you?`;
    }
  }

  const toolEnvelope = extractAssistantToolCalls(text);
  const hasEndSessionTool =
    toolEnvelope.toolCalls.some(
      (toolCall) => normalizeToolCallName(toolCall.name) === "end_session"
    ) || END_SESSION_TOOL_CALL_PATTERN.test(text);

  let cleanText = toolEnvelope.displayText || text;
  if (hasEndSessionTool && !/hopefully you found this of use/i.test(cleanText)) {
    cleanText = cleanText ? `${cleanText}\n\n${END_SESSION_CLOSING_TEXT}`.trim() : END_SESSION_CLOSING_TEXT;
  }

  const debugLabel = hasEndSessionTool
    ? "tool:end_session"
    : toolEnvelope.toolCalls.length > 0
    ? `tool:${toolEnvelope.toolCalls.map((toolCall) => toolCall.name).join(",")}`
    : undefined;

  return NextResponse.json({
    text: cleanText,
    endSession: hasEndSessionTool,
    debug: debugLabel,
    toolCalls: toolEnvelope.toolCalls.length > 0 ? toolEnvelope.toolCalls : undefined
  });
}
