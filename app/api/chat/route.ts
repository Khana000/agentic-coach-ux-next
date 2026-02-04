import { NextResponse } from "next/server";

type ChatMessage = {
  role: "user" | "assistant";
  content: string;
};

type ChatRequest = {
  messages?: ChatMessage[];
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

  let payload: ChatRequest;
  try {
    payload = await request.json();
  } catch (error) {
    return NextResponse.json({ error: "Invalid JSON payload." }, { status: 400 });
  }

  const trimmedMessages = (payload.messages ?? [])
    .filter((message) => message.content && message.content.trim())
    .slice(-12);

  if (trimmedMessages.length === 0) {
    return NextResponse.json({ error: "Missing chat messages." }, { status: 400 });
  }

  const nowState = payload.nowState ? JSON.stringify(payload.nowState) : "{}";
  const systemPrompt = [
    "You are an executive coaching assistant.",
    "Use Heron push/pull guidance (70% pull, 30% push) and Gestalt in-the-moment awareness.",
    "Keep questions concise, empathetic, and action-oriented.",
    "Do not label the user with personality types.",
    "If the user reports bullying, harassment, discrimination, or other code-of-conduct issues,",
    "stop coaching on the topic and recommend contacting HR or the appropriate reporting channel.",
    `Context: ${payload.context ?? "general"}`,
    `Style: ${payload.style ?? "balanced"}`,
    `NowState: ${nowState}`
  ].join("\n");

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
        ...trimmedMessages
      ],
      temperature: 0.6
    })
  });

  if (!response.ok) {
    const errorText = await response.text();
    return NextResponse.json(
      { error: "OpenAI chat request failed.", details: errorText },
      { status: 502 }
    );
  }

  const data = await response.json();
  const text = data?.choices?.[0]?.message?.content ?? "";

  return NextResponse.json({ text });
}
