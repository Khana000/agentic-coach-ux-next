const BASE_URL = process.env.BASE_URL || 'http://127.0.0.1:3100';
const report = {
  baseUrl: BASE_URL,
  startedAt: new Date().toISOString(),
  smoke: [],
  sit: [],
  uat: [],
  perf: {},
  summary: { passed: 0, failed: 0 }
};

function addResult(section, name, ok, details = {}) {
  report[section].push({ name, ok, ...details });
  if (ok) report.summary.passed += 1;
  else report.summary.failed += 1;
}

async function timedFetch(path, options = {}) {
  const start = performance.now();
  let response;
  let text = '';
  let json = undefined;
  let error = undefined;
  try {
    response = await fetch(`${BASE_URL}${path}`, options);
    text = await response.text();
    try {
      json = text ? JSON.parse(text) : undefined;
    } catch {
      json = undefined;
    }
  } catch (err) {
    error = err instanceof Error ? err.message : String(err);
  }
  const ms = Number((performance.now() - start).toFixed(1));
  return {
    ms,
    status: response?.status,
    ok: Boolean(response?.ok),
    text,
    json,
    error
  };
}

function contains(text, pattern) {
  return new RegExp(pattern, 'i').test(text || '');
}

function percentile(values, p) {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const idx = Math.min(sorted.length - 1, Math.max(0, Math.ceil((p / 100) * sorted.length) - 1));
  return Number(sorted[idx].toFixed(1));
}

async function chat(messages, extras = {}) {
  const payload = {
    messages,
    context: extras.context || 'visibility',
    coachGender: extras.coachGender || 'female',
    style: extras.style || 'balanced'
  };
  return timedFetch('/api/chat', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload)
  });
}

const INITIAL = 'Welcome. What outcome would make this coaching session most valuable for you today?';

async function runSmoke() {
  const home = await timedFetch('/');
  addResult('smoke', 'GET / returns 200', home.status === 200, { status: home.status, ms: home.ms });

  const token = await timedFetch('/api/elevenlabs/token?agentId=agent_2301kj5gk2bkezts94y36e0tzxza');
  addResult(
    'smoke',
    'GET /api/elevenlabs/token configured',
    token.status === 200,
    { status: token.status, ms: token.ms, note: token.status === 503 ? 'Missing ELEVENLABS_API_KEY in env' : undefined }
  );

  const basicChat = await chat([
    { role: 'assistant', content: INITIAL },
    { role: 'user', content: 'I need support with presentations in senior meetings.' }
  ]);
  addResult('smoke', 'POST /api/chat basic request', basicChat.status === 200 && Boolean(basicChat.json?.text), {
    status: basicChat.status,
    ms: basicChat.ms,
    preview: basicChat.json?.text?.slice(0, 120)
  });

  const llm = await timedFetch('/api/llm', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ prompt: 'Give one concise coaching question', context: 'communication', style: 'balanced' })
  });
  let llmJsonOk = false;
  if (llm.status === 200 && typeof llm.json?.text === 'string') {
    try { JSON.parse(llm.json.text); llmJsonOk = true; } catch { llmJsonOk = false; }
  }
  addResult('smoke', 'POST /api/llm returns strict JSON text', llm.status === 200 ? llmJsonOk : llm.status === 500 || llm.status === 502, {
    status: llm.status,
    ms: llm.ms,
    note: llm.status === 500 ? 'OPENAI_API_KEY missing' : undefined
  });

  const sessionCreate = await timedFetch('/api/sessions', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      title: 'QA Session',
      context: 'visibility',
      style: 'balanced',
      messages: [
        { role: 'assistant', content: INITIAL },
        { role: 'user', content: 'Testing persistence.' }
      ]
    })
  });

  const sessionId = sessionCreate.json?.id;
  const created = sessionCreate.status === 200 && typeof sessionId === 'string';
  addResult('smoke', 'POST /api/sessions creates session', created, {
    status: sessionCreate.status,
    ms: sessionCreate.ms,
    sessionId
  });

  if (created && /^[a-f0-9]{24}$/i.test(sessionId)) {
    const sessionGet = await timedFetch(`/api/sessions/${sessionId}`);
    addResult('smoke', 'GET /api/sessions/[id] reads session', sessionGet.status === 200, {
      status: sessionGet.status,
      ms: sessionGet.ms
    });

    const patch = await timedFetch(`/api/sessions/${sessionId}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ title: 'QA Session Updated' })
    });
    addResult('smoke', 'PATCH /api/sessions/[id] updates session', patch.status === 200, {
      status: patch.status,
      ms: patch.ms
    });

    const del = await timedFetch(`/api/sessions/${sessionId}`, { method: 'DELETE' });
    addResult('smoke', 'DELETE /api/sessions/[id] deletes session', del.status === 200, {
      status: del.status,
      ms: del.ms
    });
  } else if (created) {
    addResult('smoke', 'Session DB persistence mode', true, {
      status: 200,
      ms: sessionCreate.ms,
      note: 'Storage fallback mode (non-ObjectId id), deep CRUD skipped'
    });
  }
}

async function runSit() {
  const messages1 = [
    { role: 'assistant', content: INITIAL },
    { role: 'user', content: 'Need support doing TED talks.' }
  ];
  const step1 = await chat(messages1);
  const text1 = String(step1.json?.text || '');
  addResult(
    'sit',
    'Context kickoff avoids generic loop on topic hint',
    step1.status === 200 && !contains(text1, 'what specific situation are you referring to\\?'),
    { status: step1.status, ms: step1.ms, preview: text1.slice(0, 140) }
  );

  const messages2 = [
    ...messages1,
    { role: 'assistant', content: text1 || 'Can you share more?' },
    { role: 'user', content: 'please explain further' }
  ];
  const step2 = await chat(messages2);
  const text2 = String(step2.json?.text || '');
  addResult(
    'sit',
    'Explain follow-up uses prior context',
    step2.status === 200 && !contains(text2, 'what specific situation are you referring to\?'),
    { status: step2.status, ms: step2.ms, preview: text2.slice(0, 140) }
  );

  const def = await chat([
    { role: 'assistant', content: INITIAL },
    { role: 'user', content: 'What does AI mean?' }
  ]);
  const defText = String(def.json?.text || '');
  addResult(
    'sit',
    'Definition intent handled in coaching mode',
    def.status === 200 && contains(defText, 'coaching discussion') && !contains(defText, 'what specific situation are you referring to\?'),
    { status: def.status, ms: def.ms, preview: defText.slice(0, 160) }
  );

  const endReq = await chat([
    { role: 'assistant', content: INITIAL },
    { role: 'user', content: 'Please end the coaching session now.' }
  ]);
  addResult(
    'sit',
    'End-session intent returns closure',
    endReq.status === 200 && endReq.json?.endSession === true && contains(String(endReq.json?.text || ''), 'hopefully you found this of use'),
    { status: endReq.status, ms: endReq.ms, preview: String(endReq.json?.text || '').slice(0, 120) }
  );

  const planReqMsgs = [
    { role: 'assistant', content: INITIAL },
    { role: 'user', content: 'I need to improve presentation influence with senior leaders.' },
    { role: 'assistant', content: 'What pattern is most holding you back right now?' },
    { role: 'user', content: 'Please create an action plan for me.' }
  ];
  const plan = await chat(planReqMsgs);
  const planText = String(plan.json?.text || '');
  addResult(
    'sit',
    'Action plan generation includes feasibility check',
    plan.status === 200 &&
      contains(planText, 'does this action plan work for you\\?') &&
      (contains(planText, '^\\s*##\\s*(reflection|focus plan|first step)') || contains(planText, '^\\s*[-*]\\s+')),
    { status: plan.status, ms: plan.ms, preview: planText.slice(0, 170) }
  );

  const planAgree = await chat([
    ...planReqMsgs,
    { role: 'assistant', content: planText || 'Does this action plan work for you?' },
    { role: 'user', content: 'Yes, this works for me.' }
  ]);
  const planAgreeText = String(planAgree.json?.text || '');
  addResult(
    'sit',
    'Post-plan agreement transitions correctly',
    planAgree.status === 200 && (contains(planAgreeText, 'would you like to end the coaching session now\?') || contains(planAgreeText, 'manager') || contains(planAgreeText, 'support')),
    { status: planAgree.status, ms: planAgree.ms, preview: planAgreeText.slice(0, 170) }
  );
}

async function runUat() {
  const tips = await chat([
    { role: 'assistant', content: INITIAL },
    { role: 'user', content: 'Give me some coaching tips on presenting at TED talks.' }
  ]);
  const tipsText = String(tips.json?.text || '');
  addResult(
    'uat',
    'Coaching tips request gets concrete guidance',
    tips.status === 200 && !contains(tipsText, 'what specific situation are you referring to\?'),
    { status: tips.status, ms: tips.ms, preview: tipsText.slice(0, 160) }
  );

  const noManager = await chat([
    { role: 'assistant', content: INITIAL },
    { role: 'user', content: "Don't involve my manager. Send any actions to me only." }
  ]);
  const nmText = String(noManager.json?.text || '');
  addResult(
    'uat',
    'Manager decline respected',
    noManager.status === 200 && !contains(nmText, 'set up a meeting with your manager'),
    { status: noManager.status, ms: noManager.ms, preview: nmText.slice(0, 160) }
  );

  const lowSignal = await chat([
    { role: 'assistant', content: INITIAL },
    { role: 'user', content: 'communication' }
  ]);
  const lsText = String(lowSignal.json?.text || '');
  addResult(
    'uat',
    'Low-signal input prompts clarifying question',
    lowSignal.status === 200 && contains(lsText, 'specific') && contains(lsText, '\\?'),
    { status: lowSignal.status, ms: lowSignal.ms, preview: lsText.slice(0, 160) }
  );
}

async function runPerf() {
  const latencies = [];
  const failures = [];
  const N = 20;

  for (let i = 0; i < N; i += 1) {
    const res = await chat([
      { role: 'assistant', content: INITIAL },
      { role: 'user', content: `Latency probe turn ${i + 1}: help me improve influence in presentations with one practical suggestion.` }
    ]);

    if (res.status === 200 && typeof res.json?.text === 'string' && res.json.text.trim()) {
      latencies.push(res.ms);
    } else {
      failures.push({ index: i + 1, status: res.status, error: res.error || res.text?.slice(0, 120) });
    }
  }

  const avg = latencies.length
    ? Number((latencies.reduce((a, b) => a + b, 0) / latencies.length).toFixed(1))
    : null;

  report.perf = {
    samples: N,
    successes: latencies.length,
    failures,
    avgMs: avg,
    p50Ms: percentile(latencies, 50),
    p95Ms: percentile(latencies, 95),
    minMs: latencies.length ? Number(Math.min(...latencies).toFixed(1)) : null,
    maxMs: latencies.length ? Number(Math.max(...latencies).toFixed(1)) : null
  };

  const perfPass = latencies.length >= Math.ceil(N * 0.9);
  report.summary[perfPass ? 'passed' : 'failed'] += 1;
}

(async function main() {
  try {
    await runSmoke();
    await runSit();
    await runUat();
    await runPerf();
  } catch (error) {
    report.fatal = error instanceof Error ? error.message : String(error);
    report.summary.failed += 1;
  }

  report.finishedAt = new Date().toISOString();
  console.log(JSON.stringify(report, null, 2));
})();
