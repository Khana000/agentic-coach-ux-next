import { NextResponse } from "next/server";

type LlmRequest = {
  prompt?: string;
  context?: string;
  style?: string;
  nowState?: Record<string, string>;
};

export async function POST(request: Request) {
  const apiKey = process.env.OPENAI_API_KEY;
  const model = process.env.OPENAI_CHAT_MODEL ?? "gpt-4o-mini";

  if (!apiKey) {
    return NextResponse.json({ error: "Missing OPENAI_API_KEY." }, { status: 500 });
  }

  let payload: LlmRequest;
  try {
    payload = await request.json();
  } catch (error) {
    return NextResponse.json({ error: "Invalid JSON payload." }, { status: 400 });
  }

  if (!payload.prompt || !payload.prompt.trim()) {
    return NextResponse.json({ error: "Missing prompt text." }, { status: 400 });
  }

  const systemPrompt = [
    "You are an executive coaching assistant using Heron and Gestalt guidance.",
    "Always output STRICT JSON and nothing else.",
    "Rules:",
    "- Ask concise, empathetic questions that drive ownership.",
    "- Use Heron push/pull: 70% pull (supportive/catalytic/cathartic) and 30% push (confronting/informative/prescriptive).",
    "- Avoid confronting when stress is high or readiness is low.",
    "- Use Gestalt in-the-moment moves periodically (awareness/contact/experiment/integration).",
    "- Keep tone aligned with coachee style and current context.",
    "- Never label the user with a personality type.",
    "JSON schema:",
    "{",
    '  "question": "string",',
    '  "heron_mode": "supportive|catalytic|cathartic|confronting|informative|prescriptive",',
    '  "push_pull": "pull|push",',
    '  "intensity": 1,',
    '  "gestalt_move": "awareness|contact|experiment|integration|none",',
    '  "action_focus": "short action or ownership focus",',
    '  "tone_notes": "short tone reminder"',
    "}"
  ].join("\n");

  const nowState = payload.nowState ? JSON.stringify(payload.nowState) : "{}";
  const userContent = `Context: ${payload.context ?? "general"}\nStyle: ${payload.style ?? "balanced"
    }\nNowState: ${nowState}\nUser: ${payload.prompt ?? ""}`;

  const response = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      model,
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: userContent }
      ],
      temperature: 0.5,
      response_format: { type: "json_object" }
    })
  });

  if (!response.ok) {
    const errorText = await response.text();
    return NextResponse.json(
      { error: "OpenAI request failed.", details: errorText },
      { status: 502 }
    );
  }

  const data = await response.json();
  const text = data?.choices?.[0]?.message?.content ?? "";

  return NextResponse.json({ text });
}
