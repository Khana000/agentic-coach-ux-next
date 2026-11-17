// Test process only. Never contacts the model, mail provider or database.
const originalFetch = globalThis.fetch;
globalThis.fetch = async (input, init) => {
  const url = typeof input === 'string' ? input : input.url ?? String(input);
  if (url.startsWith('https://api.openai.com/')) {
    console.log('TEST_MODEL_CALL');
    const body = JSON.parse(init.body);
    const messages = body.messages ?? [];
    const isPlan = messages.some(m => m.content.includes('PlanMode is requested'));
    const text = isPlan
      ? '## Reflection\nYou want clearer project updates.\n\n## Focus Plan\n- Identify the key message, due: Fri 20 Nov\n- Rehearse your outline, due: Fri 20 Nov\n- Present the next step, due: Fri 20 Nov\n\n## First Step\nSpend 15 minutes tomorrow identifying your message.'
      : 'You want to improve communication in your team. What change would make the biggest difference in your next meeting?';
    return Response.json({ choices: [{ message: { content: text }, finish_reason: 'stop' }] });
  }
  if (/^https?:/.test(url) && !/^http:\/\/(127\.0\.0\.1|localhost):/.test(url)) {
    throw new Error('External request blocked in integration tests');
  }
  return originalFetch(input, init);
};
