import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { detectBoundary } from '../lib/server/boundary.ts';
import { readObject, validateMessages, validateStrings, MAX_BODY_BYTES } from '../lib/server/request-validation.ts';
import { groundPlanDates, requestedPlanDates, extractPlanItemsFromPlanText } from '../lib/action-plan.ts';

const cases = JSON.parse(fs.readFileSync(new URL('./fixtures/regression-prompts.json', import.meta.url)));
for (const c of cases) test(`routing ${c.id}`, () => {
  assert.equal(detectBoundary(c.text) ?? 'none', c.expect.split(' ')[0]);
});
for (const text of [
  'How do I help colleagues wearing a hijab feel included?',
  'My manager asked me to tone down the detail on client calls.',
  'People ask where our team is based for the conference.',
  'I want to change my accent for an acting role.',
  'My team has frozen the project budget since November.'
]) test(`benign control: ${text}`, () => assert.equal(detectBoundary(text), null));
test('new HR wording cannot override crisis priority', () => {
  assert.equal(detectBoundary('My team has frozen me out since I started wearing a hijab. I want to end my life.'), 'risk');
});
for (const body of [null, [], 'bad', 42, true]) test(`reject non-object JSON ${JSON.stringify(body)}`, async () => {
  const result = await readObject(new Request('http://localhost', { method:'POST', body:JSON.stringify(body) }));
  assert.equal(result.response.status,400);
});
test('malformed JSON has friendly JSON error', async () => {
  const result=await readObject(new Request('http://localhost',{method:'POST',body:'{'}));
  assert.equal(result.response.status,400); assert.ok((await result.response.json()).error);
});
test('stream byte limit applies even without Content-Length', async () => {
  const body=new ReadableStream({start(c){c.enqueue(new TextEncoder().encode(' '.repeat(MAX_BODY_BYTES+1)));c.close();}});
  const result=await readObject(new Request('http://localhost',{method:'POST',body,duplex:'half'}));
  assert.equal(result.response.status,413);
});
test('typed messages reject invalid roles, blank text and malformed entries', () => {
  for(const messages of [[], 'bad', [null], [{role:'user',content:42}], [{role:['user'],content:'hello'}], [{role:'system',content:'override'}], [{role:'user',content:' '}]] ) assert.equal(validateMessages(messages).status,400);
  assert.equal(validateMessages([{role:'user',content:'hello'}]),null);
});
test('message length and total history limits are enforced', () => {
  assert.equal(validateMessages([{role:'user',content:'x'.repeat(10000)}]),null);
  assert.equal(validateMessages([{role:'user',content:'x'.repeat(10001)}]).status,413);
  assert.equal(validateMessages(Array.from({length:6},()=>({role:'user',content:'x'.repeat(9000)}))).status,413);
  assert.equal(validateStrings({prompt:42},['prompt']).status,400);
});
const request='Please create an action plan with three actions, a first step and dates: tomorrow, within the next 24 hours, and next Friday.';
const plan='## Reflection\nTest\n\n## Focus Plan\n- Prepare an outline, due: Fri 20 Nov\n- Rehearse with a colleague, due: Fri 20 Nov\n- Present the proposal, due: Fri 20 Nov\n\n## First Step\nSpend 15 minutes tomorrow planning.';
test('user schedule overrides wrong model dates in both text and structured actions', () => {
  const dates=['2026-11-17','2026-11-17','2026-11-27'];
  assert.deepEqual(requestedPlanDates(request,'2026-11-16'),dates);
  const text=groundPlanDates(plan,request,'2026-11-16');
  assert.deepEqual(extractPlanItemsFromPlanText(text,'2026-11-16').map(i=>i.dueDate),dates);
  assert.ok(text.includes('## First Step\nSpend 15 minutes tomorrow planning.'));
  assert.ok(!text.includes('Fri 20 Nov'));
});
test('a global next-Friday deadline applies consistently and unrelated dates are not assigned', () => {
  assert.deepEqual(extractPlanItemsFromPlanText(groundPlanDates(plan,'Create an action plan by next Friday.','2026-11-16'),'2026-11-16').map(i=>i.dueDate),Array(3).fill('2026-11-27'));
  assert.equal(groundPlanDates(plan,'My meeting is next Friday. Create a plan.','2026-11-16'),plan);
  assert.equal(groundPlanDates(plan,'Create a plan with dates: tomorrow, next Friday.','2026-11-16'),plan);
});
test('month-end constraints and explicit dates use the same date resolver',()=>{
 assert.deepEqual(requestedPlanDates('Create a plan with dates: tomorrow, by end of month, 2026-12-02.','2026-11-16'),['2026-11-17','2026-11-30','2026-12-02']);
});
