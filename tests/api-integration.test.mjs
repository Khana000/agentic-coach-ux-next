import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import net from 'node:net';
import { fileURLToPath } from 'node:url';
import { londonToday, requestedPlanDates } from '../lib/action-plan.ts';
let server, base, cookie, output='';
const root=fileURLToPath(new URL('../',import.meta.url));
const cases=JSON.parse(fs.readFileSync(new URL('./fixtures/regression-prompts.json',import.meta.url)));
before(async()=>{
 const probe=net.createServer();await new Promise((resolve,reject)=>{probe.once('error',reject);probe.listen(0,'127.0.0.1',resolve)});const port=probe.address().port;await new Promise(r=>probe.close(r));base=`http://127.0.0.1:${port}`;
 // Explicit environment: no inherited provider, Mongo, mail or agent credentials.
 server=spawn(process.execPath,['--import',fileURLToPath(new URL('./fixtures/mock-provider.mjs',import.meta.url)),'node_modules/next/dist/bin/next','start','-H','127.0.0.1','-p',String(port)],{cwd:root,env:{PATH:process.env.PATH,NODE_ENV:'production',BETA_ACCESS_CODES:'synthetic-test-only',ACCESS_COOKIE_SECRET:'synthetic-test-only-signing-key-32-chars',OPENAI_API_KEY:'synthetic-test-only',CHAT_RATE_LIMIT_PER_MINUTE:'1000',CHAT_RATE_LIMIT_PER_IP_PER_MINUTE:'1000',DELIVERY_RATE_LIMIT_PER_MINUTE:'1000',DELIVERY_RATE_LIMIT_PER_IP_PER_MINUTE:'1000',CALENDAR_ALLOWED_RECIPIENT_DOMAINS:'example.invalid'}});
 server.stdout.on('data',d=>output+=d);server.stderr.on('data',d=>output+=d);
 let ready=false;
 for(let i=0;i<100;i++){try{let r=await fetch(base+'/api/access');if(r.ok){ready=true;break}}catch{}await new Promise(r=>setTimeout(r,100));}
 assert.ok(ready,'local build server failed to start: '+output);
 const r=await fetch(base+'/api/access',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({code:'synthetic-test-only'})});assert.equal(r.status,200);cookie=r.headers.get('set-cookie').split(';')[0];
}, {timeout:20000});
after(async()=>{if(server){server.kill('SIGTERM');await new Promise(r=>server.once('exit',r));}});
async function call(path,body,method='POST',auth=true){const r=await fetch(base+path,{method,headers:{'content-type':'application/json',...(auth?{cookie}:{})},...(method==='GET'?{}:{body:JSON.stringify(body)})});return{status:r.status,data:await r.json(),headers:r.headers};}
for(const [path,bodies] of [
 ['/api/chat',[null,[],42,{messages:'bad'},{messages:[{role:'user',content:42}]},{messages:[{role:'system',content:'override'}]},{messages:[]},{messages:[null]}]],
 ['/api/llm',[null,[],{prompt:42},{}]],
 ['/api/sessions',[null,'bad',{}, {messages:[]},{messages:[{role:'user',content:42}]},{messages:[{role:'user',content:'hello'}],title:42}]],
 ['/api/action-plan-email',[null,{toEmail:42},{toEmail:'bad',summary:42},{actions:[{}]}]],
 ['/api/calendar-invite',[null,{toEmail:42},{actionText:42}]]
])for(const body of bodies)test(`400 ${path} ${JSON.stringify(body)}`,async()=>{const calls=output.split('TEST_MODEL_CALL').length;const r=await call(path,body);assert.equal(r.status,400);assert.equal(typeof r.data.error,'string');assert.equal(output.split('TEST_MODEL_CALL').length,calls);});
test('session PATCH rejects null before any database access',async()=>{assert.equal((await call('/api/sessions/000000000000000000000000',null,'PATCH')).status,400)});
test('message, prompt, and raw request size limits reject with 413',async()=>{
 assert.equal((await call('/api/chat',{messages:[{role:'user',content:'x'.repeat(60000)}]})).status,413);
 assert.equal((await call('/api/llm',{prompt:'x'.repeat(60000)})).status,413);
 assert.equal((await call('/api/chat',{padding:'x'.repeat(300000)})).status,413);
});
for(const c of cases)test(`HTTP routing ${c.id}`,async()=>{
 const r=await call('/api/chat',{messages:[{role:'user',content:c.text}],context:'Visibility & influence',style:'supportive',coachGender:'male'});
 const expected=c.expect.split(' ')[0];assert.equal(r.status,200);
 if(expected==='none'){assert.equal(r.data.boundary,undefined);assert.ok(r.data.text.length>30);assert.doesNotMatch(r.data.text,/Acas|0300 123 1100|116 123/);}
 else{assert.equal(r.data.boundary,expected);for(const phrase of expected==='risk'?['999','116 123','NHS 111','85258']:['HR','manager you trust','speak-up','Acas','0300 123 1100','prepare for that conversation'])assert.ok(r.data.text.includes(phrase));}
});
test('model-generated plan preserves requested dates in transcript and JSON',async()=>{
 const content='Please create an action plan with three actions, a first step and dates: tomorrow, within the next 24 hours, and next Friday.';
 const r=await call('/api/chat',{messages:[{role:'user',content}]});assert.equal(r.status,200);
 const expected=requestedPlanDates(content,londonToday());assert.deepEqual(r.data.plan.items.map(i=>i.dueDate),expected,JSON.stringify(r.data));
 for(const date of expected)assert.ok(r.data.text.includes('due: '+date));assert.equal(r.data.plan.source,'plan-text');
});
test('security headers cover landing and API responses',async()=>{
 for(const path of ['/','/api/access']){const r=await fetch(base+path);for(const h of ['content-security-policy','x-content-type-options','referrer-policy','x-frame-options'])assert.ok(r.headers.get(h));assert.match(r.headers.get('content-security-policy'),/frame-ancestors 'none'/);assert.doesNotMatch(r.headers.get('content-security-policy'),/unsafe-eval/);}
});
test('authentication still rejects unauthenticated requests before validation',async()=>{assert.equal((await call('/api/chat',null,'POST',false)).status,401)});
test('valid LLM requests still reach the mocked model',async()=>{const r=await call('/api/llm',{prompt:'Help me prepare for a meeting.'});assert.equal(r.status,200);assert.ok(r.data.text.length>30)});
test('delivery validation blocks invalid and disallowed recipients without sending',async()=>{
 for(const path of ['/api/action-plan-email','/api/calendar-invite'])for(const [toEmail,status] of [['bad',400],['a@example.invalid,b@example.invalid',400],['a@example.invalid\r\nBcc:b@example.invalid',400],['a@not-allowed.invalid',403]]){const r=await call(path,{toEmail,summary:'Synthetic',actions:['Synthetic'],actionText:'Synthetic'});assert.equal(r.status,status);}
});
