"use client";

import type { ChangeEvent, KeyboardEvent } from "react";
import { useEffect, useRef, useState } from "react";

const screens = [
  { id: "onboarding", label: "Onboarding" },
  { id: "intake", label: "Style Intake" },
  { id: "home", label: "Home" },
  { id: "session", label: "Session" },
  { id: "summary", label: "Summary" },
  { id: "history", label: "History" }
];

const coacheeStyles = [
  { id: "direct", label: "Direct and concise" },
  { id: "warm", label: "Warm and supportive" },
  { id: "analytical", label: "Analytical and structured" },
  { id: "balanced", label: "Balanced and practical" }
];

const pacePreferences = [
  { id: "fast", label: "Fast and focused" },
  { id: "moderate", label: "Moderate and steady" },
  { id: "slow", label: "Slow and reflective" }
];

const stressLevels = [
  { id: "low", label: "Low" },
  { id: "medium", label: "Medium" },
  { id: "high", label: "High" }
];

const readinessLevels = [
  { id: "low", label: "Low" },
  { id: "medium", label: "Medium" },
  { id: "high", label: "High" }
];

const confidenceLevels = [
  { id: "low", label: "Low" },
  { id: "medium", label: "Medium" },
  { id: "high", label: "High" }
];

const conversationContexts = [
  { id: "visibility", label: "Executive visibility" },
  { id: "ownership", label: "Ownership and accountability" },
  { id: "conflict", label: "Conflict or tension" },
  { id: "growth", label: "Career growth" },
  { id: "delivery", label: "Delivery risk" }
];

const promptByContext = {
  visibility: {
    direct: "What is the one outcome you want the SVP to associate with you?",
    warm: "When you imagine the SVP describing your impact, what would you want them to say?",
    analytical: "Which result or metric best proves your value to the SVP?",
    balanced: "What outcome would you most want senior leaders to associate with you?"
  },
  ownership: {
    direct: "What is the smallest ownership ask that would still matter this week?",
    warm: "What would feeling supported by ownership look like this week?",
    analytical: "Which decision or review would most reduce rework right now?",
    balanced: "What specific ownership would make the biggest difference?"
  },
  conflict: {
    direct: "What boundary do you need to set, clearly and calmly?",
    warm: "What would a fair, respectful outcome look like here?",
    analytical: "What evidence supports your position, and what is still unclear?",
    balanced: "What do you want to be true after the next conversation?"
  },
  growth: {
    direct: "What role or scope do you want to lead next?",
    warm: "What kind of work energizes you most right now?",
    analytical: "Which skills or wins make your next move most credible?",
    balanced: "What growth move matters most in the next 6 months?"
  },
  delivery: {
    direct: "What must happen by when to hit the deadline?",
    warm: "What support would make the deadline feel realistic?",
    analytical: "What are the critical path items and risks?",
    balanced: "What is the clearest path to deliver on time?"
  }
};

const actionHintByContext = {
  visibility: "Pick one result and one leader to brief this month.",
  ownership: "Name one decision and one deadline you need aligned.",
  conflict: "Define one boundary and one request you will make.",
  growth: "Choose one growth move and one sponsor to engage.",
  delivery: "List the top two risks and your mitigation plan."
};

const coachResponseByStyle = {
  direct: (hint: string) => `Let's be concrete. ${hint}`,
  warm: (hint: string) => `If you are open to it, let's make this concrete. ${hint}`,
  analytical: (hint: string) => `Let's operationalize this. ${hint}`,
  balanced: (hint: string) => `Let's make this concrete. ${hint}`
};

type CoachMeta = {
  heron_mode?: string;
  push_pull?: string;
  intensity?: number;
  gestalt_move?: string;
  action_focus?: string;
  tone_notes?: string;
};

type ChatMessage = {
  role: "user" | "assistant";
  content: string;
};

type SessionAction = {
  title: string;
  when?: string;
  confidence?: "low" | "medium" | "high";
};

type SessionSummary = {
  bullets: string[];
  insights: string[];
  actions: SessionAction[];
};

type SessionRecord = {
  id: string;
  title: string;
  summary?: SessionSummary;
  createdAt?: string;
  messages?: ChatMessage[];
  context?: string;
  style?: string;
  nowState?: Record<string, string>;
};

const defaultSummary: SessionSummary = {
  bullets: [
    "You want clearer ownership on key reviews.",
    "Delays cause rework and erode trust.",
    "A focused review window reduces friction."
  ],
  insights: [
    "Your strongest lever is a concrete ask with a deadline.",
    "Parallel peer review protects the timeline."
  ],
  actions: [
    { title: "Ask for a 20-minute review", when: "Thursday 3pm", confidence: "high" },
    { title: "Send a 1-page decision summary", when: "Thursday 9am", confidence: "medium" }
  ]
};

const parseCoachJson = (raw: string) => {
  const firstBrace = raw.indexOf("{");
  const lastBrace = raw.lastIndexOf("}");
  if (firstBrace === -1 || lastBrace === -1) {
    return { question: raw } as { question: string } & CoachMeta;
  }

  try {
    const parsed = JSON.parse(raw.slice(firstBrace, lastBrace + 1));
    return {
      question: parsed.question ?? raw,
      heron_mode: parsed.heron_mode,
      push_pull: parsed.push_pull,
      intensity: parsed.intensity,
      gestalt_move: parsed.gestalt_move,
      action_focus: parsed.action_focus,
      tone_notes: parsed.tone_notes
    } as { question: string } & CoachMeta;
  } catch (error) {
    return { question: raw } as { question: string } & CoachMeta;
  }
};

const buildPrompt = (
  basePrompt: string,
  {
    stressLevel,
    challengeReadiness,
    confidenceLevel
  }: {
    stressLevel: string;
    challengeReadiness: string;
    confidenceLevel: string;
  }
) => {
  const prefixParts = [];
  if (stressLevel === "high") {
    prefixParts.push("Take a breath.");
  }
  if (challengeReadiness === "low") {
    prefixParts.push("Let's keep this small and manageable.");
  }
  if (confidenceLevel === "low") {
    prefixParts.push("Start with one step you can fully own.");
  }
  const prefix = prefixParts.length > 0 ? `${prefixParts.join(" ")} ` : "";
  return `${prefix}${basePrompt}`;
};

const buildCoachResponse = (
  baseResponse: string,
  {
    stressLevel,
    pacePreference,
    confidenceLevel
  }: {
    stressLevel: string;
    pacePreference: string;
    confidenceLevel: string;
  }
) => {
  const prefixParts = [];
  if (stressLevel === "high") {
    prefixParts.push("No rush.");
  }
  if (pacePreference === "fast") {
    prefixParts.push("Quick version.");
  }
  if (pacePreference === "slow") {
    prefixParts.push("Let's slow it down.");
  }
  const prefix = prefixParts.length > 0 ? `${prefixParts.join(" ")} ` : "";
  let suffix = "";
  if (confidenceLevel === "low") {
    suffix = " Keep it small and build momentum.";
  }
  if (confidenceLevel === "high") {
    suffix = " If you want to stretch, add one bolder step.";
  }
  return `${prefix}${baseResponse}${suffix}`;
};

export default function Page() {
  const [activeScreen, setActiveScreen] = useState("onboarding");
  const [coacheeStyle, setCoacheeStyle] = useState("balanced");
  const [conversationContext, setConversationContext] = useState("visibility");
  const [pacePreference, setPacePreference] = useState("moderate");
  const [stressLevel, setStressLevel] = useState("medium");
  const [challengeReadiness, setChallengeReadiness] = useState("medium");
  const [confidenceLevel, setConfidenceLevel] = useState("medium");
  const [chatMessages, setChatMessages] = useState<ChatMessage[]>([
    { role: "assistant", content: "How can I help you today?" }
  ]);
  const [chatInput, setChatInput] = useState("");
  const [coachMeta, setCoachMeta] = useState<CoachMeta | null>(null);
  const [statusMessage, setStatusMessage] = useState("");
  const [errorMessage, setErrorMessage] = useState("");
  const [audioUrl, setAudioUrl] = useState<string | null>(null);
  const [isSpeaking, setIsSpeaking] = useState(false);
  const [isTranscribing, setIsTranscribing] = useState(false);
  const [isChatting, setIsChatting] = useState(false);
  const [isRecording, setIsRecording] = useState(false);
  const [voiceRepliesEnabled, setVoiceRepliesEnabled] = useState(true);
  const [sessions, setSessions] = useState<SessionRecord[]>([]);
  const [selectedSession, setSelectedSession] = useState<SessionRecord | null>(null);
  const [isSavingSession, setIsSavingSession] = useState(false);
  const [historyStatus, setHistoryStatus] = useState("");
  const [historyError, setHistoryError] = useState("");

  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const audioChunksRef = useRef<Blob[]>([]);
  const transcriptRef = useRef<HTMLDivElement>(null);

  const basePrompt =
    promptByContext[conversationContext]?.[coacheeStyle] ?? promptByContext.visibility.balanced;
  const actionHint =
    actionHintByContext[conversationContext] ?? actionHintByContext.visibility;
  const baseCoachResponse =
    coachResponseByStyle[coacheeStyle]?.(actionHint) ?? coachResponseByStyle.balanced(actionHint);

  const promptText = buildPrompt(basePrompt, {
    stressLevel,
    challengeReadiness,
    confidenceLevel
  });
  const coachResponse = buildCoachResponse(baseCoachResponse, {
    stressLevel,
    pacePreference,
    confidenceLevel
  });
  const lastAssistantMessage =
    [...chatMessages].reverse().find((message) => message.role === "assistant")?.content ?? "";
  const displayCoachOutput = lastAssistantMessage || coachResponse;

  const styleLabel =
    coacheeStyles.find((style) => style.id === coacheeStyle)?.label ?? "Balanced and practical";

  const contextLabel =
    conversationContexts.find((context) => context.id === conversationContext)?.label ??
    "Executive visibility";

  const stressLabel = stressLevels.find((level) => level.id === stressLevel)?.label ?? "Medium";
  const readinessLabel =
    readinessLevels.find((level) => level.id === challengeReadiness)?.label ?? "Medium";
  const confidenceLabel =
    confidenceLevels.find((level) => level.id === confidenceLevel)?.label ?? "Medium";
  const paceLabel =
    pacePreferences.find((preference) => preference.id === pacePreference)?.label ??
    "Moderate and steady";
  const summaryData = selectedSession?.summary ?? defaultSummary;
  const summaryBullets =
    summaryData.bullets.length > 0 ? summaryData.bullets : defaultSummary.bullets;
  const summaryInsights =
    summaryData.insights.length > 0 ? summaryData.insights : defaultSummary.insights;
  const summaryActions =
    summaryData.actions.length > 0 ? summaryData.actions : defaultSummary.actions;

  const formatSessionDate = (value?: string) => {
    if (!value) {
      return "Recently";
    }
    const parsed = new Date(value);
    if (Number.isNaN(parsed.getTime())) {
      return "Recently";
    }
    return parsed.toLocaleDateString("en-US", {
      month: "short",
      day: "numeric",
      year: "numeric"
    });
  };

  useEffect(() => {
    return () => {
      if (audioUrl) {
        URL.revokeObjectURL(audioUrl);
      }
    };
  }, [audioUrl]);

  useEffect(() => {
    if (activeScreen !== "history") {
      return;
    }

    let isCurrent = true;

    const loadHistory = async () => {
      setHistoryError("");
      setHistoryStatus("Loading saved sessions...");

      try {
        const response = await fetch("/api/sessions?limit=20", { cache: "no-store" });
        const data = await response.json();
        if (!response.ok) {
          throw new Error(data?.error ?? "Unable to load history.");
        }

        if (!isCurrent) {
          return;
        }

        const nextSessions = Array.isArray(data?.sessions)
          ? (data.sessions as SessionRecord[])
          : [];
        setSessions(nextSessions);
        setHistoryStatus(nextSessions.length === 0 ? "No saved sessions yet." : "");
      } catch (error) {
        if (!isCurrent) {
          return;
        }
        setHistoryError(error instanceof Error ? error.message : "Unable to load history.");
        setHistoryStatus("");
      }
    };

    loadHistory();

    return () => {
      isCurrent = false;
    };
  }, [activeScreen]);

  const handleChatSend = async () => {
    setErrorMessage("");
    setStatusMessage("");
    setCoachMeta(null);

    const trimmedInput = chatInput.trim();
    if (!trimmedInput) {
      setErrorMessage("Add a message to send.");
      return;
    }

    const nextMessages: ChatMessage[] = [...chatMessages, { role: "user" as const, content: trimmedInput }];
    setChatMessages(nextMessages);
    setChatInput("");
    setIsChatting(true);
    setStatusMessage("Thinking...");

    try {
      const response = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          messages: nextMessages,
          context: conversationContext,
          style: coacheeStyle,
          nowState: {
            stressLevel,
            challengeReadiness,
            confidenceLevel,
            pacePreference
          }
        })
      });

      const data = await response.json();
      if (!response.ok) {
        throw new Error(data?.error ?? "Chat request failed.");
      }

      const parsed = parseCoachJson(data?.text ?? "");
      const assistantMessage = parsed.question ?? "";
      setChatMessages([...nextMessages, { role: "assistant" as const, content: assistantMessage }]);
      setCoachMeta(parsed);
      setStatusMessage("Response ready.");
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : "Something went wrong.");
      setStatusMessage("");
    } finally {
      setIsChatting(false);
    }
  };

  const handleSaveSession = async () => {
    setErrorMessage("");
    setStatusMessage("");

    if (chatMessages.length <= 1) {
      setErrorMessage("Add at least one message before saving.");
      return;
    }

    setIsSavingSession(true);

    try {
      const response = await fetch("/api/sessions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          title: contextLabel,
          context: conversationContext,
          style: coacheeStyle,
          nowState: {
            stressLevel,
            challengeReadiness,
            confidenceLevel,
            pacePreference
          },
          messages: chatMessages,
          summary: defaultSummary
        })
      });

      const data = await response.json();
      if (!response.ok) {
        throw new Error(data?.error ?? "Session save failed.");
      }

      setSessions((previous) => {
        const filtered = previous.filter((session) => session.id !== data.id);
        return [data as SessionRecord, ...filtered];
      });
      setSelectedSession(data as SessionRecord);
      setStatusMessage("Session saved.");
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : "Unable to save session.");
      setStatusMessage("");
    } finally {
      setIsSavingSession(false);
    }
  };

  const handleSpeakResponse = async () => {
    setErrorMessage("");
    setStatusMessage("");

    if (!displayCoachOutput) {
      setErrorMessage("Generate or enter a response before speaking.");
      return;
    }

    setIsSpeaking(true);
    setStatusMessage("Synthesizing voice...");

    try {
      const response = await fetch("/api/tts", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text: displayCoachOutput })
      });

      if (!response.ok) {
        const errorPayload = await response.json();
        throw new Error(errorPayload?.error ?? "TTS request failed.");
      }

      const audioBlob = await response.blob();
      const nextUrl = URL.createObjectURL(audioBlob);
      setAudioUrl((previous) => {
        if (previous) {
          URL.revokeObjectURL(previous);
        }
        return nextUrl;
      });

      const audio = new Audio(nextUrl);
      await audio.play();
      setStatusMessage("Playing audio.");
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : "Unable to play audio.");
      setStatusMessage("");
    } finally {
      setIsSpeaking(false);
    }
  };

  const handleAudioUpload = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) {
      return;
    }

    setErrorMessage("");
    setStatusMessage("Transcribing audio...");
    setIsTranscribing(true);

    try {
      const form = new FormData();
      form.append("file", file);

      const response = await fetch("/api/stt", {
        method: "POST",
        body: form
      });

      const data = await response.json();
      if (!response.ok) {
        throw new Error(data?.error ?? "STT request failed.");
      }

      setChatInput(data?.text ?? "");
      setStatusMessage("Transcription added to the message box.");
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : "Unable to transcribe audio.");
      setStatusMessage("");
    } finally {
      setIsTranscribing(false);
      event.target.value = "";
    }
  };

  const startRecording = async () => {
    setErrorMessage("");
    setStatusMessage("");

    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const mediaRecorder = new MediaRecorder(stream, { mimeType: "audio/webm" });
      mediaRecorderRef.current = mediaRecorder;
      audioChunksRef.current = [];

      mediaRecorder.ondataavailable = (event) => {
        if (event.data.size > 0) {
          audioChunksRef.current.push(event.data);
        }
      };

      mediaRecorder.onstop = async () => {
        stream.getTracks().forEach((track) => track.stop());

        if (audioChunksRef.current.length === 0) {
          setStatusMessage("");
          return;
        }

        const audioBlob = new Blob(audioChunksRef.current, { type: "audio/webm" });
        setStatusMessage("Transcribing...");
        setIsTranscribing(true);

        try {
          const form = new FormData();
          form.append("file", audioBlob, "recording.webm");

          const response = await fetch("/api/stt", {
            method: "POST",
            body: form
          });

          const data = await response.json();
          if (!response.ok) {
            throw new Error(data?.error ?? "STT request failed.");
          }

          setChatInput(data?.text ?? "");
          setStatusMessage("Transcription ready. Press Send or Enter.");
        } catch (error) {
          setErrorMessage(error instanceof Error ? error.message : "Unable to transcribe.");
          setStatusMessage("");
        } finally {
          setIsTranscribing(false);
        }
      };

      mediaRecorder.start();
      setIsRecording(true);
      setStatusMessage("Recording... Release to stop.");
    } catch (error) {
      setErrorMessage("Microphone access denied or unavailable.");
    }
  };

  const stopRecording = () => {
    if (mediaRecorderRef.current && mediaRecorderRef.current.state !== "inactive") {
      mediaRecorderRef.current.stop();
    }
    setIsRecording(false);
  };

  const handleKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault();
      handleChatSend();
    }
  };

  // Auto-scroll transcript when new messages arrive
  useEffect(() => {
    if (transcriptRef.current) {
      transcriptRef.current.scrollTop = transcriptRef.current.scrollHeight;
    }
  }, [chatMessages]);

  // Auto-TTS when assistant responds and voice replies enabled
  useEffect(() => {
    const lastMessage = chatMessages[chatMessages.length - 1];
    if (
      voiceRepliesEnabled &&
      lastMessage?.role === "assistant" &&
      lastMessage.content &&
      !isChatting &&
      chatMessages.length > 1
    ) {
      handleSpeakResponse();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [chatMessages, isChatting]);

  return (
    <div className="page">
      <header className="site-header">
        <div className="brand">
          <div className="brand-mark">AC</div>
          <div>
            <p className="brand-title">Agentic Coach</p>
            <p className="brand-subtitle">Real-time coaching, grounded in presence.</p>
          </div>
        </div>
        <nav className="nav-tabs" aria-label="Screens">
          {screens.map((screen) => (
            <button
              key={screen.id}
              className={`tab ${activeScreen === screen.id ? "is-active" : ""}`}
              onClick={() => setActiveScreen(screen.id)}
              aria-pressed={activeScreen === screen.id}
              type="button"
            >
              {screen.label}
            </button>
          ))}
        </nav>
      </header>

      <main className="shell">
        <section
          id="onboarding"
          className={`screen ${activeScreen === "onboarding" ? "is-active" : ""}`}
          aria-labelledby="onboarding-title"
        >
          <div className="screen-header">
            <p className="eyebrow">Start here</p>
            <h1 id="onboarding-title">Set the context for your coaching.</h1>
            <p className="lead">
              Share a few details so your sessions feel relevant, focused, and useful.
            </p>
          </div>
          <div className="panel grid-two" data-reveal>
            <form className="form-card" aria-label="Profile form">
              <div className="field">
                <label htmlFor="name">Full name</label>
                <input id="name" type="text" placeholder="Asif Khan" />
              </div>
              <div className="field">
                <label htmlFor="company">Company</label>
                <input id="company" type="text" placeholder="IBM" />
              </div>
              <div className="field">
                <label htmlFor="role">Role</label>
                <input id="role" type="text" placeholder="Associate Partner" />
              </div>
              <div className="field">
                <label htmlFor="grade">Grade</label>
                <input id="grade" type="text" placeholder="B10" />
              </div>
              <div className="field">
                <label htmlFor="manager">Manager name</label>
                <input id="manager" type="text" placeholder="Justin Gatenby" />
              </div>
              <div className="field">
                <label htmlFor="manager-email">Manager email</label>
                <input id="manager-email" type="email" placeholder="name@company.com" />
              </div>
              <button
                className="primary"
                type="button"
                onClick={() => setActiveScreen("intake")}
              >
                Save and continue
              </button>
            </form>
            <aside className="side-card">
              <h2>What gets stored</h2>
              <ul>
                <li>Profile data stays private and encrypted.</li>
                <li>Used only to personalize tone and follow-up.</li>
                <li>No personality labels are shown to you.</li>
              </ul>
              <div className="pill-row">
                <span className="pill">Private</span>
                <span className="pill">Encrypted</span>
                <span className="pill">User-controlled</span>
              </div>
            </aside>
          </div>
        </section>

        <section
          id="intake"
          className={`screen ${activeScreen === "intake" ? "is-active" : ""}`}
          aria-labelledby="intake-title"
        >
          <div className="screen-header">
            <p className="eyebrow">Optional</p>
            <h1 id="intake-title">Style intake (2 minutes).</h1>
            <p className="lead">
              Pick what helps you think clearly. We will match pace, tone, and challenge.
            </p>
          </div>
          <div className="panel grid-two" data-reveal>
            <div className="form-card">
              <div className="question-block">
                <p className="question">When you are under pressure, you prefer...</p>
                <div className="choices">
                  <button
                    className={`choice ${coacheeStyle === "direct" ? "is-selected" : ""}`}
                    type="button"
                    onClick={() => setCoacheeStyle("direct")}
                  >
                    Direct, concise feedback
                  </button>
                  <button
                    className={`choice ${coacheeStyle === "balanced" ? "is-selected" : ""}`}
                    type="button"
                    onClick={() => setCoacheeStyle("balanced")}
                  >
                    Balanced feedback with options
                  </button>
                  <button
                    className={`choice ${coacheeStyle === "warm" ? "is-selected" : ""}`}
                    type="button"
                    onClick={() => setCoacheeStyle("warm")}
                  >
                    Gentle pacing and support
                  </button>
                </div>
              </div>
              <div className="question-block">
                <p className="question">Decision style</p>
                <div className="choices">
                  <button
                    className={`choice ${coacheeStyle === "analytical" ? "is-selected" : ""}`}
                    type="button"
                    onClick={() => setCoacheeStyle("analytical")}
                  >
                    Data-first
                  </button>
                  <button
                    className={`choice ${coacheeStyle === "warm" ? "is-selected" : ""}`}
                    type="button"
                    onClick={() => setCoacheeStyle("warm")}
                  >
                    People-first
                  </button>
                  <button
                    className={`choice ${coacheeStyle === "direct" ? "is-selected" : ""}`}
                    type="button"
                    onClick={() => setCoacheeStyle("direct")}
                  >
                    Speed-first
                  </button>
                </div>
              </div>
              <div className="question-block">
                <p className="question">Pace preference</p>
                <div className="choices">
                  <button
                    className={`choice ${pacePreference === "fast" ? "is-selected" : ""}`}
                    type="button"
                    onClick={() => setPacePreference("fast")}
                  >
                    Fast and focused
                  </button>
                  <button
                    className={`choice ${pacePreference === "moderate" ? "is-selected" : ""}`}
                    type="button"
                    onClick={() => setPacePreference("moderate")}
                  >
                    Moderate and steady
                  </button>
                  <button
                    className={`choice ${pacePreference === "slow" ? "is-selected" : ""}`}
                    type="button"
                    onClick={() => setPacePreference("slow")}
                  >
                    Slow and reflective
                  </button>
                </div>
              </div>
              <div className="button-row">
                <button
                  className="ghost"
                  type="button"
                  onClick={() => setActiveScreen("home")}
                >
                  Skip
                </button>
                <button
                  className="primary"
                  type="button"
                  onClick={() => setActiveScreen("home")}
                >
                  Save preferences
                </button>
              </div>
            </div>
            <aside className="side-card accent">
              <h2>Live style signals</h2>
              <p>
                Derived from your responses and language. Used to subtly tune
                questions and adapt to context.
              </p>
              <div className="signal">
                <span>Directness</span>
                <div className="bar">
                  <span style={{ width: "72%" }} />
                </div>
              </div>
              <div className="signal">
                <span>Pace</span>
                <div className="bar">
                  <span style={{ width: "58%" }} />
                </div>
              </div>
              <div className="signal">
                <span>Challenge level</span>
                <div className="bar">
                  <span style={{ width: "40%" }} />
                </div>
              </div>
              <p className="caption">Signals are internal guidance, not labels.</p>
              <div className="preview">
                <h3>Preview</h3>
                <div className="field">
                  <label htmlFor="context-preview">Preview context</label>
                  <select
                    id="context-preview"
                    value={conversationContext}
                    onChange={(event) => setConversationContext(event.target.value)}
                  >
                    {conversationContexts.map((context) => (
                      <option key={context.id} value={context.id}>
                        {context.label}
                      </option>
                    ))}
                  </select>
                </div>
                <p className="preview-label">Prompt</p>
                <p className="preview-text">{promptText}</p>
                <p className="preview-label">Coach response</p>
                <p className="preview-text">{coachResponse}</p>
              </div>
            </aside>
          </div>
        </section>

        <section
          id="home"
          className={`screen ${activeScreen === "home" ? "is-active" : ""}`}
          aria-labelledby="home-title"
        >
          <div className="panel hero" data-reveal>
            <div>
              <p className="eyebrow">Welcome back</p>
              <h1 id="home-title">Ready to coach in the moment?</h1>
              <p className="lead">
                Speak or type. We keep the session present, supportive, and
                focused on ownership.
              </p>
              <div className="button-row">
                <button
                  className="primary"
                  type="button"
                  onClick={() => setActiveScreen("session")}
                >
                  Start coaching
                </button>
                <button
                  className="ghost"
                  type="button"
                  onClick={() => setActiveScreen("history")}
                >
                  View history
                </button>
              </div>
            </div>
            <div className="hero-card">
              <div className="metric">
                <p>Supportive / Direct Mix</p>
                <strong>70 / 30</strong>
              </div>
              <div className="metric">
                <p>Current focus</p>
                <strong>Leadership presence</strong>
              </div>
              <div className="metric">
                <p>Next prompt style</p>
                <strong>Catalytic, calm</strong>
              </div>
            </div>
          </div>
        </section>

        <section
          id="session"
          className={`screen ${activeScreen === "session" ? "is-active" : ""}`}
          aria-labelledby="session-title"
        >
          <div className="screen-header">
            <p className="eyebrow">Live session</p>
            <h1 id="session-title">We stay with what matters now.</h1>
          </div>
          <div className="panel session-grid" data-reveal>
            <div className="session-main">
              <div className="controls">
                <button
                  className={`mic ${isRecording ? "is-recording" : ""}`}
                  type="button"
                  onMouseDown={startRecording}
                  onMouseUp={stopRecording}
                  onMouseLeave={stopRecording}
                  onTouchStart={startRecording}
                  onTouchEnd={stopRecording}
                  disabled={isTranscribing}
                >
                  <span className="mic-ring" />
                  <span className="mic-core" />
                  <span className="mic-label">
                    {isRecording ? "Recording..." : isTranscribing ? "Transcribing..." : "Hold to speak"}
                  </span>
                </button>
                <div className="toggle-row">
                  <label className="toggle">
                    <input
                      type="checkbox"
                      checked={voiceRepliesEnabled}
                      onChange={(e) => setVoiceRepliesEnabled(e.target.checked)}
                    />
                    <span>Voice replies</span>
                  </label>
                  <label className="toggle">
                    <input type="checkbox" />
                    <span>More direct</span>
                  </label>
                </div>
              </div>
              <div className="transcript" ref={transcriptRef}>
                <h2>Transcript</h2>
                {chatMessages.length === 0 ? (
                  <p className="caption">No messages yet.</p>
                ) : (
                  chatMessages.map((message, index) => (
                    <div
                      key={`${message.role}-${index}`}
                      className={`bubble ${message.role === "assistant" ? "coach" : "user"}`}
                    >
                      {message.content}
                    </div>
                  ))
                )}
              </div>
              <div className="coach-reply">
                <h2>Coach response</h2>
                <p className="lead">{displayCoachOutput}</p>
                {coachMeta ? (
                  <div className="coach-meta">
                    <span className="pill">{coachMeta.heron_mode ?? "supportive"}</span>
                    <span className="pill">{coachMeta.push_pull ?? "pull"}</span>
                    <span className="pill">intensity {coachMeta.intensity ?? 1}</span>
                    <span className="pill">{coachMeta.gestalt_move ?? "none"}</span>
                  </div>
                ) : null}
                {coachMeta?.action_focus ? (
                  <p className="caption">Action focus: {coachMeta.action_focus}</p>
                ) : null}
                <div className="button-row">
                  <button
                    className="ghost"
                    type="button"
                    onClick={handleSpeakResponse}
                    disabled={isSpeaking || !displayCoachOutput}
                  >
                    {isSpeaking ? "Speaking..." : "Speak response"}
                  </button>
                </div>
              </div>
              <div className="demo-controls">
                <h2>Live chat</h2>
                <div className="field">
                  <label htmlFor="user-text">Your message</label>
                  <textarea
                    id="user-text"
                    value={chatInput}
                    onChange={(event) => setChatInput(event.target.value)}
                    onKeyDown={handleKeyDown}
                    placeholder="Type a message or hold the mic button to speak. Press Enter to send."
                    rows={4}
                  />
                </div>
                <div className="button-row">
                  <button
                    className="primary"
                    type="button"
                    onClick={handleChatSend}
                    disabled={isChatting}
                  >
                    {isChatting ? "Sending..." : "Send message"}
                  </button>
                </div>
                <div className="field">
                  <label htmlFor="audio-upload">Upload audio for transcription</label>
                  <input
                    id="audio-upload"
                    type="file"
                    accept="audio/*"
                    onChange={handleAudioUpload}
                    disabled={isTranscribing}
                  />
                </div>
                {statusMessage ? <p className="status">{statusMessage}</p> : null}
                {errorMessage ? <p className="error">{errorMessage}</p> : null}
                {audioUrl ? <audio controls src={audioUrl} /> : null}
              </div>
            </div>

            <aside className="session-side">
              <div className="side-card">
                <h2>Adaptive drivers</h2>
                <div className="field">
                  <label htmlFor="style-select">Coachee style</label>
                  <select
                    id="style-select"
                    value={coacheeStyle}
                    onChange={(event) => setCoacheeStyle(event.target.value)}
                  >
                    {coacheeStyles.map((style) => (
                      <option key={style.id} value={style.id}>
                        {style.label}
                      </option>
                    ))}
                  </select>
                </div>
                <div className="field">
                  <label htmlFor="context-select">Conversation context</label>
                  <select
                    id="context-select"
                    value={conversationContext}
                    onChange={(event) => setConversationContext(event.target.value)}
                  >
                    {conversationContexts.map((context) => (
                      <option key={context.id} value={context.id}>
                        {context.label}
                      </option>
                    ))}
                  </select>
                </div>
                <div className="field">
                  <label htmlFor="pace-select">Pace preference</label>
                  <select
                    id="pace-select"
                    value={pacePreference}
                    onChange={(event) => setPacePreference(event.target.value)}
                  >
                    {pacePreferences.map((preference) => (
                      <option key={preference.id} value={preference.id}>
                        {preference.label}
                      </option>
                    ))}
                  </select>
                </div>
                <div className="field">
                  <label htmlFor="stress-select">Stress level</label>
                  <select
                    id="stress-select"
                    value={stressLevel}
                    onChange={(event) => setStressLevel(event.target.value)}
                  >
                    {stressLevels.map((level) => (
                      <option key={level.id} value={level.id}>
                        {level.label}
                      </option>
                    ))}
                  </select>
                </div>
                <div className="field">
                  <label htmlFor="readiness-select">Challenge readiness</label>
                  <select
                    id="readiness-select"
                    value={challengeReadiness}
                    onChange={(event) => setChallengeReadiness(event.target.value)}
                  >
                    {readinessLevels.map((level) => (
                      <option key={level.id} value={level.id}>
                        {level.label}
                      </option>
                    ))}
                  </select>
                </div>
                <div className="field">
                  <label htmlFor="confidence-select">Confidence level</label>
                  <select
                    id="confidence-select"
                    value={confidenceLevel}
                    onChange={(event) => setConfidenceLevel(event.target.value)}
                  >
                    {confidenceLevels.map((level) => (
                      <option key={level.id} value={level.id}>
                        {level.label}
                      </option>
                    ))}
                  </select>
                </div>
                <p className="caption">
                  Prompt basis: {styleLabel} + {contextLabel}
                </p>
                <p className="caption">
                  Context signals: {stressLabel} stress, {readinessLabel} readiness,{" "}
                  {confidenceLabel} confidence, {paceLabel} pace
                </p>
              </div>
              <div className="side-card">
                <h2>Now state</h2>
                <div className="state-row">
                  <span>Emotion</span>
                  <strong>Frustrated</strong>
                </div>
                <div className="state-row">
                  <span>Stress level</span>
                  <strong>{stressLabel}</strong>
                </div>
                <div className="state-row">
                  <span>Challenge readiness</span>
                  <strong>{readinessLabel}</strong>
                </div>
                <div className="state-row">
                  <span>Confidence</span>
                  <strong>{confidenceLabel}</strong>
                </div>
              </div>
              <div className="side-card">
                <h2>Heron mix</h2>
                <div className="signal">
                  <span>Pull</span>
                  <div className="bar">
                    <span style={{ width: "68%" }} />
                  </div>
                </div>
                <div className="signal">
                  <span>Push</span>
                  <div className="bar">
                    <span style={{ width: "32%" }} />
                  </div>
                </div>
                <div className="pill-row">
                  <span className="pill">Catalytic</span>
                  <span className="pill">Supportive</span>
                </div>
              </div>
              <div className="side-card accent">
                <h2>Internal style panel</h2>
                <p>Visible only to internal reviewers.</p>
                <div className="signal">
                  <span>Primary style</span>
                  <div className="bar">
                    <span style={{ width: "74%" }} />
                  </div>
                </div>
                <div className="signal">
                  <span>Feedback preference</span>
                  <div className="bar">
                    <span style={{ width: "46%" }} />
                  </div>
                </div>
              </div>
            </aside>
          </div>
          <div className="button-row" data-reveal>
            <button
              className="ghost"
              type="button"
              onClick={() => setActiveScreen("home")}
            >
              Pause
            </button>
            <button
              className="primary"
              type="button"
              onClick={() => setActiveScreen("summary")}
            >
              End session
            </button>
          </div>
        </section>

        <section
          id="summary"
          className={`screen ${activeScreen === "summary" ? "is-active" : ""}`}
          aria-labelledby="summary-title"
        >
          <div className="screen-header">
            <p className="eyebrow">Wrap-up</p>
            <h1 id="summary-title">Session summary and action plan.</h1>
          </div>
          <div className="panel grid-two" data-reveal>
            <div className="summary-card">
              <h2>Summary</h2>
              <ul>
                {summaryBullets.map((item) => (
                  <li key={item}>{item}</li>
                ))}
              </ul>
              <h2>Insights</h2>
              <ul>
                {summaryInsights.map((item) => (
                  <li key={item}>{item}</li>
                ))}
              </ul>
            </div>
            <div className="summary-card">
              <h2>Action plan</h2>
              {summaryActions.map((action) => {
                const confidence = action.confidence
                  ? action.confidence[0].toUpperCase() + action.confidence.slice(1)
                  : "Medium";
                return (
                  <div className="action" key={action.title}>
                    <div>
                      <strong>{action.title}</strong>
                      {action.when ? <p>When: {action.when}</p> : null}
                    </div>
                    <span className="pill">Confidence: {confidence}</span>
                  </div>
                );
              })}
              <div className="manager-share">
                <p>Share action plan with your manager?</p>
                <div className="button-row">
                  <button className="ghost" type="button">
                    No
                  </button>
                  <button className="primary" type="button">
                    Yes, send
                  </button>
                </div>
              </div>
              <div className="manager-share">
                <p>Save this session to your history?</p>
                <div className="button-row">
                  <button
                    className="ghost"
                    type="button"
                    onClick={handleSaveSession}
                    disabled={isSavingSession}
                  >
                    {isSavingSession ? "Saving..." : "Save session"}
                  </button>
                </div>
              </div>
            </div>
          </div>
        </section>

        <section
          id="history"
          className={`screen ${activeScreen === "history" ? "is-active" : ""}`}
          aria-labelledby="history-title"
        >
          <div className="screen-header">
            <p className="eyebrow">History</p>
            <h1 id="history-title">Past sessions and actions.</h1>
          </div>
          <div className="panel" data-reveal>
            {historyStatus ? <p className="status">{historyStatus}</p> : null}
            {historyError ? <p className="error">{historyError}</p> : null}
            {sessions.map((session) => (
              <div className="history-item" key={session.id}>
                <div>
                  <h3>{session.title}</h3>
                  <p>Saved: {formatSessionDate(session.createdAt)}</p>
                </div>
                <button
                  className="ghost"
                  type="button"
                  onClick={() => {
                    setSelectedSession(session);
                    setActiveScreen("summary");
                  }}
                >
                  View summary
                </button>
              </div>
            ))}
          </div>
        </section>
      </main>
    </div>
  );
}
